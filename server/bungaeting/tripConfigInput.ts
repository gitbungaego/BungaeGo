import { z } from "zod";
import { GENDER_MODES } from "../../drizzle/schema";

// 번개팅 회차 옵션 입력 zod 셰이프 — 생성(bungaeting.trips.create)과 편집
// (bungaeting.admin.updateTrip)이 공유. buildThemeConfig(policy.ts)로 넘겨 검증한다.
export const bungaetingConfigInput = {
  genderMode: z.enum(GENDER_MODES),
  genderCapM: z.number().int().min(0).optional(),
  genderCapF: z.number().int().min(0).optional(),
  genderMinM: z.number().int().min(0).optional(),
  genderMinF: z.number().int().min(0).optional(),
  ageMin: z.number().int().min(0).max(120).nullable().optional(),
  ageMax: z.number().int().min(0).max(120).nullable().optional(),
  feeAmount: z.number().int().min(0).optional(),
};
