export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// 카카오 로그인으로 리다이렉트. redirect는 로그인 후 돌아올 경로(기본 "/").
export const getLoginUrl = (redirect?: string) => {
  const url = new URL("/api/oauth/kakao/login", window.location.origin);
  if (redirect) url.searchParams.set("redirect", redirect);
  return url.toString();
};
