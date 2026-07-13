// 번개팅 클라이언트 라벨. 서버 enum(GENDER_MODES/GENDERS)과 값이 일치해야 한다.
// (schema.ts의 값 export는 @shared 타입 재-export로는 안 넘어와서 여기서 별도 정의)

export const GENDER_MODE_LABELS: Record<string, string> = {
  any: "일반",
  half: "반반",
  female_only: "여성 전용",
  male_only: "남성 전용",
};

// 회차 카드 뱃지용 짧은 설명.
export const GENDER_MODE_DESCRIPTIONS: Record<string, string> = {
  any: "성비 무조정 · 친목 의향자",
  half: "남녀 동수",
  female_only: "여성만 탑승",
  male_only: "남성만 탑승",
};

export const GENDER_LABELS: Record<string, string> = {
  M: "남성",
  F: "여성",
};

export const GENDER_MODE_OPTIONS = ["any", "half", "female_only", "male_only"] as const;
export const GENDER_OPTIONS = ["M", "F"] as const;
