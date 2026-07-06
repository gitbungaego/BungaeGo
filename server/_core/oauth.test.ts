import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return { ...actual, upsertUser: vi.fn() };
});

vi.mock("./sdk", () => ({
  sdk: { createSessionToken: vi.fn().mockResolvedValue("fake-session-token") },
}));

import * as db from "../db";
import { registerOAuthRoutes } from "./oauth";

type RouteHandler = (req: Request, res: Response) => unknown;

function collectRoutes() {
  const routes = new Map<string, RouteHandler>();
  const fakeApp = {
    get(path: string, handler: RouteHandler) {
      routes.set(path, handler);
    },
  } as unknown as Express;
  registerOAuthRoutes(fakeApp);
  return routes;
}

function fakeReqRes() {
  const calls: { cookie?: unknown[]; redirect?: unknown[]; status?: number; json?: unknown } = {};
  const res = {
    cookie: (...args: unknown[]) => {
      calls.cookie = args;
      return res;
    },
    redirect: (...args: unknown[]) => {
      calls.redirect = args;
      return res;
    },
    status: (code: number) => {
      calls.status = code;
      return res;
    },
    json: (body: unknown) => {
      calls.json = body;
      return res;
    },
  } as unknown as Response;

  const req = {
    query: {},
    protocol: "http",
    headers: {},
    get: () => "localhost:3000",
  } as unknown as Request;

  return { req, res, calls };
}

// Mirrors the real shape: DrizzleQueryError's own .message has no "doesn't exist"
// text, only its wrapped .cause does - this is exactly what broke classification
// before the isRecoverableDatabaseError fix.
function wrappedMissingTableError() {
  const cause = Object.assign(new Error("Table 'bungaego.users' doesn't exist"), {
    code: "ER_NO_SUCH_TABLE",
  });
  return Object.assign(new Error("Failed query: insert into `users` ..."), { cause });
}

describe("/app-auth registration gate", () => {
  const original = process.env.LOCAL_DEV_AUTH;

  afterEach(() => {
    if (original === undefined) delete process.env.LOCAL_DEV_AUTH;
    else process.env.LOCAL_DEV_AUTH = original;
  });

  it("is not registered when LOCAL_DEV_AUTH is unset (prevents the unauthenticated admin backdoor in production)", () => {
    delete process.env.LOCAL_DEV_AUTH;
    const routes = collectRoutes();
    expect(routes.has("/app-auth")).toBe(false);
    expect(routes.has("/api/dev-login")).toBe(false);
  });

  it("is registered when LOCAL_DEV_AUTH=true", () => {
    process.env.LOCAL_DEV_AUTH = "true";
    const routes = collectRoutes();
    expect(routes.has("/app-auth")).toBe(true);
    expect(routes.has("/api/dev-login")).toBe(true);
  });
});

describe("/app-auth recoverable DB error handling", () => {
  const originalLocalDevAuth = process.env.LOCAL_DEV_AUTH;

  beforeEach(() => {
    process.env.LOCAL_DEV_AUTH = "true";
  });

  afterEach(() => {
    vi.mocked(db.upsertUser).mockReset();
    if (originalLocalDevAuth === undefined) delete process.env.LOCAL_DEV_AUTH;
    else process.env.LOCAL_DEV_AUTH = originalLocalDevAuth;
  });

  it("still sets the session cookie and redirects when upsertUser fails with a recoverable error", async () => {
    vi.mocked(db.upsertUser).mockRejectedValueOnce(wrappedMissingTableError());

    const routes = collectRoutes();
    const handler = routes.get("/app-auth")!;
    const { req, res, calls } = fakeReqRes();

    await handler(req, res);

    expect(calls.status).toBeUndefined();
    expect(calls.cookie).toBeDefined();
    expect(calls.redirect).toBeDefined();
  });

  it("returns 500 when upsertUser fails with a non-recoverable error", async () => {
    vi.mocked(db.upsertUser).mockRejectedValueOnce(new Error("something truly unexpected"));

    const routes = collectRoutes();
    const handler = routes.get("/app-auth")!;
    const { req, res, calls } = fakeReqRes();

    await handler(req, res);

    expect(calls.status).toBe(500);
    expect(calls.cookie).toBeUndefined();
  });
});
