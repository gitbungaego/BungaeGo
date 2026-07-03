export const CATEGORY_LABELS: Record<string, string> = {
  concert: "콘서트",
  sports: "스포츠",
  festival: "페스티벌",
  rally: "집회",
  exhibition: "전시·행사",
  other: "기타",
  all: "전체",
};

export const CATEGORY_COLORS: Record<string, string> = {
  concert: "bg-purple-100 text-purple-700 border-purple-200",
  sports: "bg-blue-100 text-blue-700 border-blue-200",
  festival: "bg-orange-100 text-orange-700 border-orange-200",
  rally: "bg-red-100 text-red-700 border-red-200",
  exhibition: "bg-green-100 text-green-700 border-green-200",
  other: "bg-gray-100 text-gray-700 border-gray-200",
};

export const TRIP_STATUS_LABELS: Record<string, string> = {
  collecting: "모집 중",
  confirmed: "확정됨!",
  in_progress: "운행 중",
  completed: "완료",
  cancelled: "취소됨",
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
