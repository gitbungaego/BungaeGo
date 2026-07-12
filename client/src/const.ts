export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// 번개고 카카오톡 채널 1:1 채팅 직행 URL. 문의 버튼은 전부 이 상수 하나로.
export const KAKAO_CHANNEL_CHAT_URL = "https://pf.kakao.com/_LBYwX/chat";

// 카카오 로그인으로 리다이렉트. redirect는 로그인 후 돌아올 경로(기본 "/").
export const getLoginUrl = (redirect?: string) => {
  const url = new URL("/api/oauth/kakao/login", window.location.origin);
  if (redirect) url.searchParams.set("redirect", redirect);
  return url.toString();
};
