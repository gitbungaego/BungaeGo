import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, KAKAO_CHANNEL_CHAT_URL } from "@/const";
import { isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatPrice, formatTime } from "@/lib/constants";
import {
  AlarmClock,
  AlertTriangle,
  ArrowLeft,
  Bus,
  CalendarCheck,
  ChevronRight,
  Loader2,
  MapPin,
  Navigation,
  Smile,
  Smartphone,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { MapView, centerMapOn, createArrivalMarker, createBoardingPointMarker } from "@/components/Map";
import { FRAME_FIXED } from "@/components/AppShell";
import { isTossConfigured } from "@/lib/toss";
import { useTossPayment } from "@/hooks/useTossPayment";

interface Props {
  tripId: number;
}

// 카카오T 셔틀 예약창 구성을 따른다: 이용 지역 → 예약 인원 → 날짜 선택 →
// 탑승/하차 위치(지도) → 유의사항 → 취소 정책 → 고객센터 → 하단 고정 CTA.
// CTA 이후는 기존 예약자 정보 → 결제 단계가 이어진다.
type Phase = "config" | "info" | "pay";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function chipDateLabel(date: Date | string) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}.${dd}(${WEEKDAYS[d.getDay()]})`;
}

function rangeDateLabel(date: Date | string) {
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}(${WEEKDAYS[d.getDay()]})`;
}

// 유의사항 탭 콘텐츠 — 카카오T 구성을 참고하되 내용은 번개GO 실제 정책(D-5 확정,
// QR 탑승권, 옵션 변경 불가)과 일치시킨다.
const NOTICE_RESERVE = [
  {
    icon: CalendarCheck,
    title: "탑승 5일 전 운행이 확정돼요",
    desc: "최소 인원 미달 시 자동 취소 및 전액 환불됩니다.",
    highlight: true,
  },
  {
    icon: Smile,
    title: "행사가 늦어져도 괜찮아요",
    desc: "행사가 지연되어 현장 변동사항이 있을 경우, 안내 문자를 보내드립니다.",
  },
  {
    icon: Users,
    title: "예약자 본인만 탑승권이 발급돼요",
    desc: "2인 이상 예약 시 예약자에게만 탑승권(QR)이 발급됩니다. 일행과 함께 탑승해주세요.",
  },
  {
    icon: AlertTriangle,
    title: "예약 완료 후 옵션은 변경할 수 없어요",
    desc: "탑승 장소·시간·인원 수 등 옵션 변경은 불가하며, 취소 후 다시 예약하셔야 합니다.",
  },
];

const NOTICE_BOARD = [
  {
    icon: Smartphone,
    title: "모바일 탑승권을 꼭 준비해주세요",
    desc: "예약자 본인이 직접 탑승권(QR)을 보여주셔야 하며, 캡처·녹화된 탑승권은 이용 불가합니다.",
  },
  {
    icon: Bus,
    title: "차량 전면의 도착지 정보를 확인해주세요",
    desc: "버스 전면 안내판이나 탑승 장소의 팻말을 확인 후 탑승해주세요.",
  },
  {
    icon: AlarmClock,
    title: "출발 15분 전 대기, 5분 전 탑승하세요",
    desc: "자유석 탑승이며, 차량 만차 시 순차적으로 출발해요.",
  },
  {
    icon: Smile,
    title: "쾌적한 이용을 위해 지켜주세요",
    desc: "차량 오염·파손으로 이용에 지장을 줄 경우 손해배용 청구 및 탑승 제한이 있을 수 있어요.",
  },
  {
    icon: AlertTriangle,
    title: "탑승 중 사고 및 분실에 유의하세요",
    desc: "사고·도난 등 본인 부주의에 대한 책임은 본인에게 있습니다.",
  },
];

// shared/cancellationPolicy.ts의 실제 수수료 스케줄과 1:1.
const CANCEL_ROWS = [
  { period: "~ 탑승 8일 전 23:59", fee: "없음" },
  { period: "탑승 7일 전 23:59까지", fee: "결제 금액의 25%" },
  { period: "탑승 6일 전 23:59까지", fee: "결제 금액의 50%" },
  { period: "탑승 5일 전 00:00 ~", fee: "취소/환불 불가" },
];

export default function BookingPage({ tripId }: Props) {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<Phase>("config");

  // EventDetail의 정류장 예약 버튼이 넘겨주는 초기 탑승지 (?bp=).
  const initialBpId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("bp");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }, []);

  const [selectedTripId, setSelectedTripId] = useState(tripId);
  const [selectedBpId, setSelectedBpId] = useState<number | null>(initialBpId);
  const [seats, setSeats] = useState(1);
  // 탑승권 종류 — round=왕복(또는 편도 셔틀의 전 구간), outbound=행사장행, inbound=귀가행.
  const [ticketType, setTicketType] = useState<"round" | "outbound" | "inbound">("round");
  const [regionSheetOpen, setRegionSheetOpen] = useState(false);
  const [locTab, setLocTab] = useState<"board" | "drop">("board");
  const [noticeTab, setNoticeTab] = useState<"reserve" | "board">("reserve");

  const [passengerName, setPassengerName] = useState(user?.name ?? "");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [passengerEmail, setPassengerEmail] = useState(user?.email ?? "");
  const [referralCode, setReferralCode] = useState("");
  const [pointsUsed, setPointsUsed] = useState(0);

  const { data: entryTrip, isLoading: tripLoading } = trpc.trips.byId.useQuery({ id: tripId });
  const eventId = entryTrip?.eventId;
  const { data: event } = trpc.events.byId.useQuery({ id: eventId! }, { enabled: !!eventId });
  const { data: siblingTrips } = trpc.trips.byEventId.useQuery({ eventId: eventId! }, { enabled: !!eventId });
  const { data: allPoints } = trpc.boardingPoints.byEventId.useQuery({ eventId: eventId! }, { enabled: !!eventId });
  const { data: pointsBalance } = trpc.points.myBalance.useQuery(undefined, { enabled: isAuthenticated });
  const { data: tossServer } = trpc.payments.tossEnabled.useQuery(undefined, { enabled: isTossConfigured() });
  const tossAvailable = isTossConfigured() && !!tossServer?.enabled;

  const trip = siblingTrips?.find((t) => t.id === selectedTripId) ?? (entryTrip?.id === selectedTripId ? entryTrip : undefined);

  // 날짜 칩 = 이 이벤트의 회차들(취소 제외). 같은 날 두 회차가 있으면 시간을 붙여 구분.
  const dateChips = useMemo(() => {
    const list = (siblingTrips ?? []).filter((t) => t.status !== "cancelled");
    const dayCount = new Map<string, number>();
    list.forEach((t) => {
      const key = chipDateLabel(t.departureAt);
      dayCount.set(key, (dayCount.get(key) ?? 0) + 1);
    });
    return list.map((t) => {
      const day = chipDateLabel(t.departureAt);
      return {
        trip: t,
        label: (dayCount.get(day) ?? 0) > 1 ? `${day} ${formatTime(t.departureAt)}` : day,
        soldOut: t.availability.remaining <= 0,
      };
    });
  }, [siblingTrips]);

  const tripPoints = useMemo(
    () => (allPoints ?? []).filter((bp) => bp.tripId === selectedTripId),
    [allPoints, selectedTripId]
  );
  const pointsByTrip = useMemo(() => {
    const byTrip = new Map<number, NonNullable<typeof allPoints>>();
    (allPoints ?? []).forEach((bp) => {
      const list = byTrip.get(bp.tripId) ?? [];
      list.push(bp);
      byTrip.set(bp.tripId, list);
    });
    return byTrip;
  }, [allPoints]);

  const selectedBp = tripPoints.find((bp) => bp.id === selectedBpId) ?? tripPoints[0];

  // 회차 전환 시 같은 이름의 탑승지가 있으면 유지, 없으면 첫 탑승지로.
  const switchTrip = (nextTripId: number) => {
    if (nextTripId === selectedTripId) return;
    const nextPoints = (allPoints ?? []).filter((bp) => bp.tripId === nextTripId);
    const sameName = selectedBp ? nextPoints.find((bp) => bp.name === selectedBp.name) : undefined;
    setSelectedTripId(nextTripId);
    setSelectedBpId(sameName?.id ?? nextPoints[0]?.id ?? null);
    setSeats(1);
    setTicketType("round");
  };

  // ── 탑승/하차 위치 지도 ──
  const [locMap, setLocMap] = useState<any>(null);
  const locMarkerRef = useRef<any>(null);
  const venue = event?.lat && event?.lng ? { lat: Number(event.lat), lng: Number(event.lng) } : null;
  const boardPos = selectedBp?.lat && selectedBp?.lng ? { lat: Number(selectedBp.lat), lng: Number(selectedBp.lng) } : null;

  useEffect(() => {
    if (!locMap || !window.kakao) return;
    locMarkerRef.current?.setMap(null);
    locMarkerRef.current = null;
    const target = locTab === "board" ? boardPos : venue;
    if (!target) return;
    locMarkerRef.current =
      locTab === "board"
        ? createBoardingPointMarker(locMap, target, { title: selectedBp?.name })
        : createArrivalMarker(locMap, target, event?.venue);
    centerMapOn(locMap, target, 4);
  }, [locMap, locTab, boardPos?.lat, boardPos?.lng, venue?.lat, venue?.lng, selectedBp?.name, event?.venue]);

  useEffect(() => () => locMarkerRef.current?.setMap(null), []);

  // ── 결제 ──
  const [payMethod, setPayMethod] = useState<"toss" | "mock">("mock");
  useEffect(() => {
    if (tossAvailable) setPayMethod("toss");
  }, [tossAvailable]);

  const createReservation = trpc.reservations.create.useMutation({
    onSuccess: (data) => {
      toast.success("예약이 완료되었습니다!");
      navigate(`/reservations/${data.id}/confirm`);
    },
    onError: (err) => toast.error(err.message || "예약에 실패했습니다."),
  });
  const createTossOrder = trpc.payments.createTossOrder.useMutation({
    onError: (err) => toast.error(err.message || "주문 생성에 실패했습니다."),
  });

  // 훅 순서상 가드보다 먼저 필요 — 아래 unitPrice와 동일한 규칙으로 계산.
  const preUnitPrice =
    ticketType !== "round" && trip?.isRoundTrip && trip?.oneWayPrice != null
      ? trip.oneWayPrice
      : trip?.price ?? 0;

  const [tossSubmitting, setTossSubmitting] = useState(false);
  const toss = useTossPayment({
    enabled: phase === "pay" && payMethod === "toss" && tossAvailable,
    amount: preUnitPrice * seats - pointsUsed,
  });

  if (!isAuthenticated) {
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-muted-foreground">예약하려면 로그인이 필요합니다.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black">
          <a href={getLoginUrl()}>카카오로 로그인</a>
        </Button>
      </div>
    );
  }

  if (tripLoading || !entryTrip) {
    if (tripLoading) {
      return (
        <div className="container max-w-2xl py-6 space-y-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      );
    }
    return <div className="py-20 text-center text-muted-foreground">셔틀을 찾을 수 없습니다.</div>;
  }

  if (!trip) {
    return <div className="py-20 text-center text-muted-foreground">셔틀을 찾을 수 없습니다.</div>;
  }

  const remaining = trip.availability.remaining;
  const soldOut = remaining <= 0 || trip.status === "cancelled";
  const maxSeats = Math.max(1, Math.min(8, remaining));

  // 탑승권 선택지: 왕복 셔틀 + 편도가 지정 → 왕복/행사장행/귀가행 3종.
  // 편도가 미지정이면 왕복만, 편도 셔틀이면 행사장행 단일(내부적으로 round=전 구간).
  const ticketOptions: { key: "round" | "outbound" | "inbound"; label: string; desc: string; price: number }[] =
    trip.isRoundTrip
      ? [
          { key: "round", label: "왕복", desc: "행사장 갈 때 · 올 때 모두 탑승", price: trip.price },
          ...(trip.oneWayPrice != null
            ? ([
                { key: "outbound", label: "행사장행", desc: "행사장 가는 편만 탑승", price: trip.oneWayPrice },
                { key: "inbound", label: "귀가행", desc: "행사장에서 돌아오는 편만 탑승", price: trip.oneWayPrice },
              ] as const)
            : []),
        ]
      : [{ key: "round", label: "행사장행", desc: "행사장 가는 편도 셔틀", price: trip.price }];
  // 선택한 종류가 선택지에서 사라진 경우(예: 관리자가 편도가 해제) 왕복으로 폴백.
  const selectedTicket = ticketOptions.find((o) => o.key === ticketType) ?? ticketOptions[0];
  const unitPrice = selectedTicket.price;

  const totalBeforePoints = unitPrice * seats;
  const maxPointsUsable = Math.min(pointsBalance?.balance ?? 0, totalBeforePoints);
  const totalAmount = totalBeforePoints - pointsUsed;
  const isRushCreatedTrip = isCreatedAfterOwnD5({
    departureAt: new Date(trip.departureAt),
    createdAt: new Date(trip.createdAt),
  });

  const handleSubmit = async () => {
    if (!passengerName || !passengerPhone) {
      toast.error("예약자 정보를 입력해주세요.");
      return;
    }
    const orderInput = {
      tripId: trip.id,
      boardingPointId: selectedBp?.id ?? undefined,
      seats,
      ticketType: selectedTicket.key,
      passengerName,
      passengerPhone,
      passengerEmail: passengerEmail || undefined,
      pointsUsed,
      referralCode: referralCode || undefined,
    };

    if (payMethod === "toss") {
      setTossSubmitting(true);
      try {
        const order = await createTossOrder.mutateAsync({ kind: "reservation", ...orderInput });
        await toss.requestPayment({
          orderId: order.orderId,
          orderName: order.orderName,
          amount: order.amount,
          customerName: passengerName,
          customerEmail: passengerEmail || undefined,
        });
      } catch (err) {
        if (err instanceof Error && err.message) toast.error(err.message);
      } finally {
        setTossSubmitting(false);
      }
      return;
    }
    createReservation.mutate({ ...orderInput, paymentMethod: "mock_card" });
  };

  // ─────────────────────────── 예약자 정보 / 결제 단계 ───────────────────────────
  if (phase !== "config") {
    return (
      <div className="container max-w-2xl py-5 pb-10">
        <button
          type="button"
          onClick={() => setPhase(phase === "pay" ? "info" : "config")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          이전으로
        </button>

        {/* 선택 요약 */}
        <div className="rounded-2xl border border-border bg-card p-4 mb-5 text-sm space-y-1.5">
          <p className="font-semibold">{event?.title ?? "셔틀 예약"}</p>
          <p className="text-muted-foreground">
            {rangeDateLabel(trip.departureAt)} {formatTime(trip.departureAt)} 출발 · {selectedTicket.label} · {seats}명
          </p>
          <p className="text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {selectedBp ? selectedBp.name : "탑승지 미지정"} → {event?.venue}
          </p>
        </div>

        {phase === "info" ? (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-lg font-semibold">예약자 정보</h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">이름 *</Label>
                <Input id="name" value={passengerName} onChange={(e) => setPassengerName(e.target.value)} placeholder="홍길동" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">연락처 *</Label>
                <Input id="phone" value={passengerPhone} onChange={(e) => setPassengerPhone(e.target.value)} placeholder="010-0000-0000" type="tel" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">이메일 (선택)</Label>
                <Input id="email" value={passengerEmail} onChange={(e) => setPassengerEmail(e.target.value)} placeholder="example@email.com" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="referral">초대 코드 (선택)</Label>
                <Input
                  id="referral"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="친구의 초대 코드 입력"
                  maxLength={16}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">초대 코드 입력 시 1,000P 적립</p>
              </div>
            </div>
            <Button
              className="w-full h-12 text-base font-semibold"
              disabled={!passengerName || !passengerPhone}
              onClick={() => setPhase("pay")}
            >
              다음
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
            <h2 className="text-lg font-semibold">결제</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">탑승 장소</span>
                <span className="font-medium">{selectedBp ? selectedBp.name : "미지정"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">탑승권</span>
                <span className="font-medium">{selectedTicket.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">예약 인원</span>
                <span className="font-medium">{seats}명</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">예약자</span>
                <span className="font-medium">{passengerName}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">운임 × {seats}</span>
                <span>{formatPrice(totalBeforePoints)}</span>
              </div>

              {(pointsBalance?.balance ?? 0) > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">포인트 사용</span>
                    <span className="text-xs text-muted-foreground">보유 {(pointsBalance?.balance ?? 0).toLocaleString()}P</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={pointsUsed}
                      onChange={(e) => setPointsUsed(Math.min(maxPointsUsable, Math.max(0, Number(e.target.value))))}
                      min={0}
                      max={maxPointsUsable}
                      className="h-8 text-sm"
                    />
                    <Button variant="outline" size="sm" onClick={() => setPointsUsed(maxPointsUsable)} className="whitespace-nowrap">
                      전액 사용
                    </Button>
                  </div>
                  {pointsUsed > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>포인트 할인</span>
                      <span>-{formatPrice(pointsUsed)}</span>
                    </div>
                  )}
                </div>
              )}

              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span>최종 결제 금액</span>
                <span className="text-primary">{formatPrice(totalAmount)}</span>
              </div>
            </div>

            {tossAvailable && (
              <div className="space-y-2">
                <p className="text-sm font-medium">결제 수단</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod("toss")}
                    className={`rounded-lg border p-3 text-sm font-medium transition-all ${
                      payMethod === "toss" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    토스페이먼츠
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod("mock")}
                    className={`rounded-lg border p-3 text-sm font-medium transition-all ${
                      payMethod === "mock" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    데모 결제
                  </button>
                </div>
              </div>
            )}

            {payMethod === "toss" && tossAvailable ? (
              <div className="space-y-2">
                <div id="toss-payment-methods" />
                <div id="toss-agreement" />
                {toss.error && <p className="text-xs text-destructive">{toss.error}</p>}
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                ※ 데모 환경입니다. 실제 결제는 이루어지지 않습니다.
              </div>
            )}

            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handleSubmit}
              disabled={createReservation.isPending || tossSubmitting || (payMethod === "toss" && !toss.ready)}
            >
              {createReservation.isPending || tossSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> 처리 중...
                </span>
              ) : payMethod === "toss" && !toss.ready ? (
                "결제수단 불러오는 중..."
              ) : (
                `${formatPrice(totalAmount)} 결제하기`
              )}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────── 카카오T식 예약 구성 화면 ───────────────────────────
  return (
    <div className="pb-28">
      {/* 상단 요약 카드 */}
      <div className="bg-primary/5 border-b border-border">
        <div className="container max-w-2xl py-4">
          <div className="flex gap-3">
            <div className="w-14 h-[72px] rounded-lg overflow-hidden border border-border bg-muted flex-shrink-0">
              {event?.imageUrl ? (
                <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Bus className="h-5 w-5 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="font-bold truncate">{event?.title ?? "셔틀 예약"}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{event?.venue}</span>
              </p>
              {event && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarCheck className="h-3 w-3 flex-shrink-0" />
                  {rangeDateLabel(event.eventDate)}
                </p>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Bus className="h-3 w-3 flex-shrink-0" />
                {trip.mode === "bus" ? "일반버스" : "밴"} {trip.maxCount}인승
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container max-w-2xl space-y-7 pt-5">
        {/* 이용 지역 */}
        <section className="space-y-2">
          <h2 className="font-bold">이용 지역</h2>
          <button
            type="button"
            onClick={() => setRegionSheetOpen(true)}
            className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium truncate">
                {selectedBp ? selectedBp.name : "탑승 장소를 선택해 주세요"}
              </span>
            </span>
            <span className="flex items-center gap-0.5 text-sm text-muted-foreground flex-shrink-0">
              변경 <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        </section>

        {/* 예약 인원 */}
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="font-bold">예약 인원</h2>
            <span className="text-xs text-muted-foreground">최대 {maxSeats}명 예약 가능</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 pb-1">
            {Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSeats(n)}
                className={`flex-shrink-0 min-w-[52px] px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                  seats === n ? "border-primary bg-primary/10 text-foreground font-bold" : "border-border text-muted-foreground"
                }`}
              >
                {n}명
              </button>
            ))}
          </div>
        </section>

        {/* 날짜 선택 */}
        <section className="space-y-2">
          <h2 className="font-bold">날짜 선택</h2>
          {dateChips.length > 0 ? (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 pb-1">
              {dateChips.map(({ trip: t, label, soldOut: chipSoldOut }) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={chipSoldOut}
                  onClick={() => switchTrip(t.id)}
                  className={`flex-shrink-0 px-3.5 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-40 ${
                    selectedTripId === t.id
                      ? "border-primary bg-primary/10 text-foreground font-bold"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">예약 가능한 날짜가 없습니다.</p>
          )}
          <p className="text-xs text-muted-foreground">{formatTime(trip.departureAt)} 출발</p>
        </section>

        {/* 탑승권 선택 — 왕복 / 행사장행 / 귀가행 */}
        <section className="space-y-2">
          <h2 className="font-bold">탑승권 선택</h2>
          <div className="space-y-1.5">
            {ticketOptions.map((o) => {
              const isSelected = selectedTicket.key === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setTicketType(o.key)}
                  className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                    isSelected ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`h-[18px] w-[18px] rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? "border-primary" : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm ${isSelected ? "font-bold" : "font-medium"}`}>{o.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{o.desc}</span>
                    </span>
                  </span>
                  <span className={`text-sm flex-shrink-0 ${isSelected ? "font-bold text-primary" : "font-medium"}`}>
                    {formatPrice(o.price)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 탑승/하차 위치 */}
        <section className="space-y-3">
          <h2 className="font-bold">탑승/하차 위치</h2>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {([["board", "탑승 장소"], ["drop", "하차 장소"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setLocTab(key)}
                className={`rounded-full py-2 text-sm font-semibold transition-all ${
                  locTab === key ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-border overflow-hidden">
            <MapView className="h-40" onMapReady={setLocMap} initialCenter={boardPos ?? venue ?? undefined} initialZoom={15} />
            <div className="p-4 space-y-2">
              {locTab === "board" ? (
                selectedBp ? (
                  <>
                    <p className="font-semibold text-sm">{selectedBp.name}</p>
                    {selectedBp.pickupTime && (
                      <p className="text-xs text-primary">픽업 {formatTime(selectedBp.pickupTime)}</p>
                    )}
                    {selectedBp.address && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {selectedBp.address}
                      </p>
                    )}
                    {boardPos && (
                      <a
                        href={`https://map.kakao.com/link/to/${encodeURIComponent(selectedBp.name)},${boardPos.lat},${boardPos.lng}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-black bg-[#FEE500] rounded-full px-3 py-1.5 mt-1"
                      >
                        <Navigation className="h-3 w-3" /> 카카오맵으로 길찾기
                      </a>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">탑승 장소 정보가 준비 중입니다.</p>
                )
              ) : (
                <>
                  <p className="font-semibold text-sm">{event?.venue}</p>
                  <p className="text-xs text-muted-foreground">
                    현장 사정에 따라 하차 위치가 변경될 수 있으며, 변경 시 문자로 안내드립니다.
                  </p>
                  {event?.address && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3 flex-shrink-0" />
                      {event.address}
                    </p>
                  )}
                  {venue && (
                    <a
                      href={`https://map.kakao.com/link/to/${encodeURIComponent(event?.venue ?? "도착지")},${venue.lat},${venue.lng}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-black bg-[#FEE500] rounded-full px-3 py-1.5 mt-1"
                    >
                      <Navigation className="h-3 w-3" /> 카카오맵으로 길찾기
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        {/* 유의사항 */}
        <section className="space-y-3">
          <h2 className="font-bold">유의사항을 꼭 확인하세요!</h2>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {([["reserve", "예약"], ["board", "탑승"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setNoticeTab(key)}
                className={`rounded-full py-2 text-sm font-semibold transition-all ${
                  noticeTab === key ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-4 pt-1">
            {(noticeTab === "reserve" ? NOTICE_RESERVE : NOTICE_BOARD).map((n) => (
              <div key={n.title} className="flex gap-3">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <n.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${"highlight" in n && n.highlight ? "text-primary" : ""}`}>{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 취소 정책 */}
        <section className="space-y-2">
          <h2 className="font-bold">취소 정책</h2>
          <p className="text-xs text-muted-foreground">
            예약 후 <span className="font-semibold text-foreground">1시간 이내에는 무료 취소</span> 가능합니다.
            {isRushCreatedTrip && " (이 셔틀은 예약 후 1시간이 지나면 취소가 불가합니다.)"}
          </p>
          <div className="rounded-xl border border-border overflow-hidden text-sm">
            <div className="grid grid-cols-2 bg-muted/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
              <span>기간</span>
              <span>취소 수수료</span>
            </div>
            {CANCEL_ROWS.map((row) => (
              <div key={row.period} className="grid grid-cols-2 px-4 py-2.5 border-t border-border/60 text-xs">
                <span className="text-muted-foreground">{row.period}</span>
                <span className={row.fee === "취소/환불 불가" ? "text-destructive font-medium" : ""}>{row.fee}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 고객센터 */}
        <section className="space-y-2">
          <h2 className="font-bold">번개GO 고객센터</h2>
          <p className="text-xs text-muted-foreground">운행 관련 문의와 예약 관련 문의는 고객센터로 문의바랍니다.</p>
          <p className="text-xs text-muted-foreground">운영시간: (평일 09:00 ~ 18:00)</p>
          <Button variant="outline" className="w-full" asChild>
            <a href={KAKAO_CHANNEL_CHAT_URL} target="_blank" rel="noopener">
              카카오톡 채널로 문의하기
            </a>
          </Button>
        </section>

        {/* 하단 유의사항 (텍스트) */}
        <section className="rounded-xl bg-muted/40 p-4 space-y-3 text-[11px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-xs text-foreground/70">유의사항</p>
          <div>
            <p className="font-semibold">[예약 / 결제]</p>
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              <li>만석 또는 운행 취소 노선은 예약이 제한되며, 잔여 좌석만 예약 가능</li>
              <li>예약 완료 후 변경은 취소 후 재예약으로만 가능</li>
              <li>최소 인원 미달 시 자동 취소 및 전액 환불</li>
              <li>현장 구매 불가 / 사전 예약 필수</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold">[탑승 안내]</p>
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              <li>공연 지연 시 셔틀 출발도 함께 지연되며, 문자로 안내</li>
              <li>미성년자는 보호자 동반 탑승을 권장하며 단독 탑승 시 책임은 보호자에게 귀속</li>
              <li>안전한 승하차를 위해 출·도착지가 변경될 수 있으며, 이 경우 문자로 안내</li>
              <li>교통 상황에 따라 운행 시간이 변동될 수 있음</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold">[기타]</p>
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              <li>차량 내 음식물 섭취 제한</li>
              <li>지나친 음주자 또는 타인에게 불편을 주는 경우 탑승 제한</li>
            </ul>
          </div>
        </section>
      </div>

      {/* 하단 고정 CTA */}
      <div className={`${FRAME_FIXED} bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}>
        <Button
          size="lg"
          className="w-full text-base font-semibold"
          disabled={soldOut}
          onClick={() => setPhase("info")}
        >
          {soldOut ? "예약이 마감됐어요" : `${formatPrice(totalBeforePoints)} · 셔틀 예약하기`}
        </Button>
      </div>

      {/* 이용 지역 선택 팝업 (프레임 폭 바텀시트) — EventDetail에서 보던 개설 위치 목록 */}
      {regionSheetOpen && (
        <>
          <div
            className={`${FRAME_FIXED} inset-y-0 z-40 bg-black/40`}
            onClick={() => setRegionSheetOpen(false)}
          />
          <div className={`${FRAME_FIXED} bottom-0 z-50 rounded-t-2xl bg-background max-h-[80vh] flex flex-col`}>
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
              <h3 className="font-bold">이용 지역 선택</h3>
              <button type="button" onClick={() => setRegionSheetOpen(false)} className="p-1 text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {(siblingTrips ?? [])
                .filter((t) => t.status !== "cancelled")
                .map((t) => {
                  const stops = pointsByTrip.get(t.id) ?? [];
                  const full = t.availability.remaining <= 0;
                  if (stops.length === 0) return null;
                  return (
                    <div key={t.id} className="py-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        {chipDateLabel(t.departureAt)} {formatTime(t.departureAt)} 출발
                        {full && " · 만석"}
                      </p>
                      <div className="space-y-1.5">
                        {stops.map((bp) => {
                          const isCurrent = bp.id === selectedBp?.id && t.id === selectedTripId;
                          return (
                            <div
                              key={bp.id}
                              className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 ${
                                isCurrent ? "border-primary bg-primary/5" : "border-border"
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{bp.name}</p>
                                {bp.address && <p className="text-[11px] text-muted-foreground truncate">{bp.address}</p>}
                                {bp.pickupTime && (
                                  <p className="text-[11px] text-primary">픽업 {formatTime(bp.pickupTime)}</p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={isCurrent ? "default" : "outline"}
                                className="flex-shrink-0"
                                disabled={full}
                                onClick={() => {
                                  switchTrip(t.id);
                                  setSelectedBpId(bp.id);
                                  setRegionSheetOpen(false);
                                }}
                              >
                                {full ? "만석" : isCurrent ? "선택됨" : "예약"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              {(allPoints ?? []).length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">등록된 탑승 장소가 없습니다.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
