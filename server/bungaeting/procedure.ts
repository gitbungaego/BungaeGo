import { TRPCError } from "@trpc/server";
import { isEnabled } from "../featureFlags";
import { protectedProcedure } from "../_core/trpc";

// 번개팅 전체 기능 게이트. FEATURE_BUNGAETING=true일 때만 동작(기본 OFF, spec §7).
// protectedProcedure 기반이라 비로그인은 상위에서 UNAUTHORIZED로 먼저 차단된다.
export const bungaetingProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isEnabled("bungaeting")) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "번개팅 서비스가 활성화되지 않았습니다.",
    });
  }
  return next({ ctx });
});
