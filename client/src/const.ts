export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

const DEFAULT_OAUTH_PORTAL_URL = "https://bungaego.com";
const DEFAULT_APP_ID = "bungaego-web";

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl =
    (import.meta.env.VITE_OAUTH_PORTAL_URL || DEFAULT_OAUTH_PORTAL_URL).trim();
  const appId = (import.meta.env.VITE_APP_ID || DEFAULT_APP_ID).trim();
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const baseUrl = oauthPortalUrl.endsWith("/")
    ? oauthPortalUrl.slice(0, -1)
    : oauthPortalUrl;
  const url = new URL(`${baseUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
