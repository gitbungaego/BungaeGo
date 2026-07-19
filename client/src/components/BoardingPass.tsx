import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { KAKAO_CHANNEL_CHAT_URL } from "@/const";
import type { RouterOutputs } from "@/lib/trpc";

// 핸디버스 탑승권 레이아웃을 참고한 번개GO 탑승권 — 마이페이지 예약 내역 상단.
// 왕복 예약은 행사장행/귀가행 2페이지, 편도는 1페이지. 여러 예약이면 페이지를 이어붙인다.
type Ticket = RouterOutputs["reservations"]["myTickets"][number];

interface TicketLeg {
  key: string;
  headerLabel: string; // 예: "왕복 | 행사장행"
  eventTitle: string;
  from: string;
  to: string;
  at: Date | string | null; // null = 시간 안내 예정
  seats: number;
  passengerName: string | null;
  passengerPhone: string | null;
  reservationId: number;
}

export function buildTicketLegs(tickets: Ticket[]): TicketLeg[] {
  const legs: TicketLeg[] = [];
  for (const t of tickets) {
    const bpName = t.boardingPoint?.name ?? null;
    const isRound = t.ticketType === "round" && t.trip.isRoundTrip;
    const typeLabel = isRound ? "왕복" : "편도";
    const outbound: TicketLeg = {
      key: `${t.reservationId}-out`,
      headerLabel: `${typeLabel} | 행사장행`,
      eventTitle: t.event.title,
      from: bpName ?? "출발지 안내 예정",
      to: t.event.venue,
      at: t.boardingPoint?.pickupTime ?? t.trip.departureAt,
      seats: t.seats,
      passengerName: t.passengerName,
      passengerPhone: t.passengerPhone,
      reservationId: t.reservationId,
    };
    const inbound: TicketLeg = {
      key: `${t.reservationId}-in`,
      headerLabel: `${typeLabel} | 귀가행`,
      eventTitle: t.event.title,
      from: t.event.venue,
      to: bpName ?? "하차지 안내 예정",
      at: t.trip.returnAt,
      seats: t.seats,
      passengerName: t.passengerName,
      passengerPhone: t.passengerPhone,
      reservationId: t.reservationId,
    };

    if (isRound) legs.push(outbound, inbound);
    else if (t.ticketType === "inbound") legs.push(inbound);
    else legs.push(outbound); // outbound 또는 편도 트립의 round(전 구간)
  }
  return legs;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatLegDateTime(at: Date | string | null): string {
  if (!at) return "시간 안내 예정";
  const d = new Date(at);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const time = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return `${yy}.${mm}.${dd} (${WEEKDAYS[d.getDay()]}) ${time}`;
}

// 010-1234-5678 → 010-****-5678 (가운데 자리 마스킹)
function maskPhone(phone: string | null): string {
  if (!phone) return "";
  return phone.replace(/^(\d{2,3})-?(\d{3,4})-?(\d{4})$/, "$1-****-$3");
}

export function BoardingPass({ tickets }: { tickets: Ticket[] }) {
  const legs = useMemo(() => buildTicketLegs(tickets), [tickets]);
  const [page, setPage] = useState(0);
  if (legs.length === 0) return null;

  const idx = Math.min(page, legs.length - 1);
  const leg = legs[idx];

  return (
    <div className="rounded-2xl bg-[#101426] p-3 pb-4 mb-5">
      {/* 캡처 경고 */}
      <div className="rounded-md bg-red-50 py-1.5 text-center text-[11px] font-medium text-red-500">
        캡처 화면은 탑승이 제한될 수 있습니다.
      </div>

      {/* 마키 띠 — "번개GO 탑승권" 무한 스크롤 */}
      <div className="mt-2 overflow-hidden rounded-md bg-[#FEE500] py-1">
        <div className="flex w-max animate-bp-marquee">
          {[0, 1].map((i) => (
            <span key={i} className="whitespace-nowrap text-sm font-extrabold text-black">
              {"번개GO 탑승권   ".repeat(8)}
            </span>
          ))}
        </div>
      </div>

      {/* 티켓 카드 */}
      <div className="mt-3 overflow-hidden rounded-xl bg-white">
        {/* 헤더: 종류 라벨 + 페이저 */}
        <div className="flex items-center justify-between bg-[#FEE500] px-4 py-2.5">
          <span className="text-sm font-bold text-black">{leg.headerLabel}</span>
          {legs.length > 1 && (
            <span className="flex items-center gap-1 text-sm font-semibold text-black/80">
              <button
                type="button"
                aria-label="이전 탑승권"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={idx === 0}
                className="p-0.5 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {idx + 1}/{legs.length}
              <button
                type="button"
                aria-label="다음 탑승권"
                onClick={() => setPage((p) => Math.min(legs.length - 1, p + 1))}
                disabled={idx === legs.length - 1}
                className="p-0.5 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          )}
        </div>

        <div className="px-4 pt-3">
          <p className="text-xs text-muted-foreground">{leg.eventTitle}</p>

          {/* 출발 → 도착 */}
          <div className="relative mt-2 space-y-3 pl-1.5">
            {/* 세로 연결선 */}
            <div className="absolute left-[7px] top-2.5 bottom-2.5 w-0.5 bg-[#FEE500]" />
            <div className="relative flex items-center gap-2">
              <span className="relative z-10 h-3 w-3 flex-shrink-0 rounded-full border-2 border-[#F5C400] bg-white" />
              <span className="rounded bg-[#FFF7C2] px-1.5 py-0.5 text-[10px] font-bold text-amber-700">출발</span>
              <span className="text-base font-bold truncate">{leg.from}</span>
            </div>
            <div className="relative flex items-center gap-2">
              <span className="relative z-10 h-3 w-3 flex-shrink-0 rounded-full bg-[#F5C400]" />
              <span className="rounded bg-[#FFF7C2] px-1.5 py-0.5 text-[10px] font-bold text-amber-700">도착</span>
              <span className="text-base font-bold truncate">{leg.to}</span>
            </div>
          </div>

          {/* 탑승일시 */}
          <div className="mt-4 border-t border-border/60 pt-3">
            <p className="text-xs text-muted-foreground">탑승일시</p>
            <p className="mt-0.5 text-lg font-extrabold">{formatLegDateTime(leg.at)}</p>
          </div>
        </div>

        {/* 절취선 (양옆 노치) */}
        <div className="relative my-3">
          <div className="mx-4 border-t-2 border-dashed border-border" />
          <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#101426]" />
          <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#101426]" />
        </div>

        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground">탑승자 정보</p>
          <p className="mt-0.5 text-sm font-bold">
            {leg.passengerName ?? "탑승자"}
            {leg.passengerPhone && <span className="ml-2 font-medium text-muted-foreground">{maskPhone(leg.passengerPhone)}</span>}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-muted-foreground">탑승인원</p>
              <p className="mt-0.5 text-sm font-bold">{leg.seats}명</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">좌석</p>
              <p className="mt-0.5 text-sm font-bold">자율석</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">예약번호</p>
              <p className="mt-0.5 text-sm font-bold">#{leg.reservationId}</p>
            </div>
          </div>
        </div>

        <a
          href={KAKAO_CHANNEL_CHAT_URL}
          target="_blank"
          rel="noopener"
          className="flex items-center gap-1.5 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground"
        >
          <Info className="h-3.5 w-3.5" />
          번개GO 채널 문의하기
        </a>
      </div>

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-white/50">
        탑승 시간은 현장 운영 상황에 따라 변경될 수 있으며, 변경 시 안내가 이루어집니다.
      </p>
    </div>
  );
}
