export const CATEGORY_LABELS: Record<string, string> = {
  concert: "콘서트",
  sports: "스포츠",
  festival: "페스티벌",
  local_festival: "지역축제",
  rally: "집회",
  exhibition: "전시",
  expo: "엑스포",
  fair: "박람회",
  forum: "포럼",
  other: "기타",
  all: "전체",
};

export const CATEGORY_COLORS: Record<string, string> = {
  concert: "bg-purple-100 text-purple-700 border-purple-200",
  sports: "bg-blue-100 text-blue-700 border-blue-200",
  festival: "bg-orange-100 text-orange-700 border-orange-200",
  local_festival: "bg-amber-100 text-amber-700 border-amber-200",
  rally: "bg-red-100 text-red-700 border-red-200",
  exhibition: "bg-green-100 text-green-700 border-green-200",
  expo: "bg-cyan-100 text-cyan-700 border-cyan-200",
  fair: "bg-indigo-100 text-indigo-700 border-indigo-200",
  forum: "bg-teal-100 text-teal-700 border-teal-200",
  other: "bg-gray-100 text-gray-700 border-gray-200",
};

// 카카오T 셔틀식 카테고리 아이콘 칩 정의 — 한 곳에 모아 추후 일러스트 에셋 교체 용이.
// (이모지는 OS별 렌더 차이 있으나 에셋 없이 가장 근접한 느낌)
export const CATEGORY_CHIPS: { key: string; label: string; emoji: string; bg: string }[] = [
  { key: "all", label: "전체", emoji: "🚌", bg: "bg-yellow-50" },
  { key: "concert", label: "콘서트", emoji: "🎤", bg: "bg-purple-50" },
  { key: "sports", label: "스포츠", emoji: "⚽", bg: "bg-blue-50" },
  { key: "festival", label: "페스티벌", emoji: "🎪", bg: "bg-orange-50" },
  { key: "local_festival", label: "지역축제", emoji: "🎡", bg: "bg-amber-50" },
  { key: "rally", label: "집회", emoji: "📢", bg: "bg-red-50" },
  { key: "exhibition", label: "전시", emoji: "🖼️", bg: "bg-green-50" },
  { key: "expo", label: "엑스포", emoji: "🌐", bg: "bg-cyan-50" },
  { key: "fair", label: "박람회", emoji: "🏬", bg: "bg-indigo-50" },
  { key: "forum", label: "포럼", emoji: "🎙️", bg: "bg-teal-50" },
];

export const TRIP_STATUS_LABELS: Record<string, string> = {
  collecting: "모집 중",
  confirmed: "확정됨!",
  in_progress: "운행 중",
  completed: "완료",
  cancelled: "취소됨",
};

// 탑승권 종류 (reservations.ticketType). round는 왕복 셔틀에서만 "왕복"으로 표기 —
// 편도 셔틀의 round(전 구간)는 그 자체가 행사장행이므로 별도 표기하지 않는다.
export const TICKET_TYPE_LABELS: Record<string, string> = {
  round: "왕복",
  outbound: "행사장행",
  inbound: "귀가행",
};

export const TRIP_STATUS_COLORS: Record<string, string> = {
  collecting: "bg-blue-50 text-blue-600 border-blue-200",
  confirmed: "bg-emerald-50 text-emerald-600 border-emerald-200",
  in_progress: "bg-purple-50 text-purple-600 border-purple-200",
  completed: "bg-gray-50 text-gray-500 border-gray-200",
  cancelled: "bg-red-50 text-red-500 border-red-200",
};

export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  pending: "결제 대기",
  paid: "예약 완료",
  cancelled: "취소됨",
  refunded: "환불됨",
};

export const formatPrice = (price: number) =>
  new Intl.NumberFormat("ko-KR").format(price) + "원";

export const formatDate = (date: Date | string | number) => {
  const d = new Date(date);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
};

export const formatDateTime = (date: Date | string | number) => {
  const d = new Date(date);
  return d.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatTime = (date: Date | string | number) => {
  const d = new Date(date);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
};

// ── 셔틀 만들기(수요 모집) — 희망 탑승지 목록 (카카오T 수요조사 참고) ─────────────
export const DEMAND_STATIONS: { group: string; stations: string[] }[] = [
  {
    group: "서울",
    stations: ["강남역", "노원역", "마곡역", "사당역", "서울역", "신도림역", "왕십리역", "잠실역", "합정역"],
  },
  {
    group: "경기",
    stations: ["동탄역", "미금역", "백석역", "수원역", "안양역", "영통역", "평택역"],
  },
  { group: "인천", stations: ["부평역"] },
];

export const DEMAND_REGIONS = [
  "강릉", "경주", "광주", "대구", "대전", "부산", "울산", "원주", "전주", "창원", "천안", "청주",
];

// ── 이벤트 만들기 신청 — 도착 희망 사유 ─────────────────────────────────────────
export const ARRIVAL_PREF_OPTIONS: { key: string; label: string }[] = [
  { key: "md_sale", label: "MD 판매시간에 도착하고 싶어요" },
  { key: "ktx", label: "KTX 타야 해서 정시에 출발하고 싶어요" },
  { key: "ticket_booth", label: "티켓부스 오픈시간에 맞춰 도착하고 싶어요" },
  { key: "flexible", label: "공연 지연에 따라 출발시간이 변경됐으면 좋겠어요" },
  { key: "etc", label: "기타" },
];

// 카카오T 리스트식 짧은 날짜: 26.09.04
export const formatShortDate = (date: Date | string | number) => {
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
};
