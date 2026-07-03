import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getKakaoRedirectUri(req: Request): string {
  return `${req.protocol}://${req.get("host")}/api/oauth/kakao/callback`;
}

interface KakaoTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
}

interface KakaoUserInfo {
  id: number;
  kakao_account?: {
    email?: string;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
  };
}

function getSafeRedirectTarget(req: Request, redirectUri: string | undefined) {
  if (!redirectUri) return "/";
  if (redirectUri.startsWith("/")) return redirectUri;

  try {
    const parsed = new URL(redirectUri);
    const currentOrigin = `${req.protocol}://${req.get("host")}`;
    return parsed.origin === currentOrigin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function registerOAuthRoutes(app: Express) {
  app.get("/app-auth", async (req: Request, res: Response) => {
    const redirectUri = getQueryParam(req, "redirectUri");
    const openId = process.env.OWNER_OPEN_ID || "local-admin-openid";
    const name = process.env.OWNER_NAME || "관리자";

    try {
      try {
        await db.upsertUser({
          openId,
          name,
          email: `${openId}@local.dev`,
          loginMethod: "local-fallback",
          lastSignedIn: new Date(),
        });
      } catch (error) {
        if (!db.isRecoverableDatabaseError(error)) {
          throw error;
        }
        console.warn("[OAuth] DB unavailable during fallback login, continuing with session", error);
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      const target = getSafeRedirectTarget(req, redirectUri);
      res.redirect(302, target === "/api/oauth/callback" ? "/" : target);
    } catch (error) {
      console.error("[OAuth] App auth fallback failed", error);
      res.status(500).json({ error: "app auth fallback failed" });
    }
  });

  // ── 로컬 개발 전용 로그인 (LOCAL_DEV_AUTH=true 일 때만 작동) ──
  if (process.env.LOCAL_DEV_AUTH === "true") {
    app.get("/api/dev-login", async (req: Request, res: Response) => {
      const openId =
        (req.query.openId as string) ||
        process.env.OWNER_OPEN_ID ||
        "local-admin-openid";
      const name = (req.query.name as string) || "로컬테스터";

      // DB에 사용자 생성/갱신 (OWNER_OPEN_ID면 자동으로 admin 권한)
      await db.upsertUser({
        openId,
        name,
        email: `${openId}@local.dev`,
        loginMethod: "local-dev",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });
      res.redirect(302, "/");
    });
  }
  // ── 카카오 로그인 ──────────────────────────────────────────────────────────
  app.get("/api/oauth/kakao/login", (req: Request, res: Response) => {
    if (!ENV.kakaoRestApiKey) {
      res.status(500).json({ error: "카카오 로그인이 설정되어 있지 않습니다 (KAKAO_REST_API_KEY 누락)." });
      return;
    }

    const redirectUri = getKakaoRedirectUri(req);
    const target = getSafeRedirectTarget(req, getQueryParam(req, "redirect"));
    const state = Buffer.from(target).toString("base64url");

    const authorizeUrl = new URL("https://kauth.kakao.com/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", ENV.kakaoRestApiKey);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", state);

    res.redirect(302, authorizeUrl.toString());
  });

  app.get("/api/oauth/kakao/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const kakaoError = getQueryParam(req, "error");

    if (kakaoError) {
      console.warn("[OAuth] Kakao login cancelled/denied:", kakaoError);
      res.redirect(302, "/");
      return;
    }
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    let target = "/";
    try {
      if (state) target = Buffer.from(state, "base64url").toString("utf8") || "/";
    } catch {
      target = "/";
    }

    try {
      const redirectUri = getKakaoRedirectUri(req);
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ENV.kakaoRestApiKey,
        redirect_uri: redirectUri,
        code,
      });
      if (ENV.kakaoClientSecret) {
        tokenBody.set("client_secret", ENV.kakaoClientSecret);
      }

      const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: tokenBody,
      });
      if (!tokenRes.ok) {
        throw new Error(`Kakao token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
      }
      const tokenData = (await tokenRes.json()) as KakaoTokenResponse;

      const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) {
        throw new Error(`Kakao user info fetch failed: ${userRes.status} ${await userRes.text()}`);
      }
      const kakaoUser = (await userRes.json()) as KakaoUserInfo;

      const openId = `kakao:${kakaoUser.id}`;
      const name = kakaoUser.kakao_account?.profile?.nickname || "카카오사용자";
      const email = kakaoUser.kakao_account?.email ?? null;

      try {
        await db.upsertUser({
          openId,
          name,
          email,
          loginMethod: "kakao",
          lastSignedIn: new Date(),
        });
      } catch (error) {
        if (!db.isRecoverableDatabaseError(error)) throw error;
        console.warn("[OAuth] DB unavailable during Kakao login, continuing with session", error);
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, target);
    } catch (error) {
      console.error("[OAuth] Kakao callback failed", error);
      res.status(500).json({ error: "카카오 로그인에 실패했습니다." });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
