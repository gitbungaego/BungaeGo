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
import { useLocale, useT } from "@/i18n";

interface Props {
  tripId: number;
}

// 카카오T 셔틀 예약창 구성을 따른다: 이용 지역 → 예약 인원 → 날짜 선택 →
// 탑승/하차 위치(지도) → 유의사항 → 취소 정책 → 고객센터 → 하단 고정 CTA.
// CTA 이후는 기존 예약자 정보 → 결제 단계가 이어진다.
type Phase = "config" | "info" | "pay";

// YY.MM.DD(요일)/MM.DD(요일) — 요일만 로케일화(intlTag).
function chipDateLabel(date: Date | string, intlTag: string) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const wd = d.toLocaleDateString(intlTag, { weekday: "short" });
  return `${mm}.${dd}(${wd})`;
}

function rangeDateLabel(date: Date | string, intlTag: string) {
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const wd = d.toLocaleDateString(intlTag, { weekday: "short" });
  return `${yy}.${mm}.${dd}(${wd})`;
}

// 유의사항 탭 콘텐츠 — 아이콘 + catalog 키. 실제 정책(D-5 확정, QR 탑승권, 옵션 변경 불가)과 일치.
const NOTICE_RESERVE = [
  { icon: CalendarCheck, titleKey: "nr1.title", descKey: "nr1.desc", highlight: true },
  { icon: Smile, titleKey: "nr2.title", descKey: "nr2.desc" },
  { icon: Users, titleKey: "nr3.title", descKey: "nr3.desc" },
  { icon: AlertTriangle, titleKey: "nr4.title", descKey: "nr4.desc" },
];

const NOTICE_BOARD = [
  { icon: Smartphone, titleKey: "nb1.title", descKey: "nb1.desc" },
  { icon: Bus, titleKey: "nb2.title", descKey: "nb2.desc" },
  { icon: AlarmClock, titleKey: "nb3.title", descKey: "nb3.desc" },
  { icon: Smile, titleKey: "nb4.title", descKey: "nb4.desc" },
  { icon: AlertTriangle, titleKey: "nb5.title", descKey: "nb5.desc" },
];

// shared/cancellationPolicy.ts의 실제 수수료 스케줄과 1:1. danger = 환불 불가 강조.
const CANCEL_ROWS = [
  { periodKey: "cr1.period", feeKey: "cr1.fee" },
  { periodKey: "cr2.period", feeKey: "cr2.fee" },
  { periodKey: "cr3.period", feeKey: "cr3.fee" },
  { periodKey: "cr4.period", feeKey: "cr4.fee", danger: true },
];

export default function BookingPage({ tripId }: Props) {
  const { user, isAuthenticated } = useAuth();
  const t = useT();
  const { intlTag } = useLocale();
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
  // 공유 링크 ?ref= 프리필 (지우거나 교체 가능 — referral-credit-spec §3.2).
  const prefilledRef = useMemo(() => {
    try {
      return sessionStorage.getItem("bungae_ref") ?? "";
    } catch {
      return "";
    }
  }, []);
  const [referralCode, setReferralCode] = useState(prefilledRef);
  const [pointsUsed, setPointsUsed] = useState(0);

  // 추천 코드 실시간 검증 (존재·셀프·활성) — 결제 전에 서버가 다시 검증한다.
  const trimmedCode = referralCode.trim().toUpperCase();
  const { data: codeCheck } = trpc.referrals.validateCode.useQuery(
    { code: trimmedCode },
    { enabled: trimmedCode.length >= 4, staleTime: 30_000 }
  );

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
    const list = (siblingTrips ?? []).filter((st) => st.status !== "cancelled");
    const dayCount = new Map<string, number>();
    list.forEach((st) => {
      const key = chipDateLabel(st.departureAt, intlTag);
      dayCount.set(key, (dayCount.get(key) ?? 0) + 1);
    });
    return list.map((st) => {
      const day = chipDateLabel(st.departureAt, intlTag);
      return {
        trip: st,
        label: (dayCount.get(day) ?? 0) > 1 ? `${day} ${formatTime(st.departureAt)}` : day,
        soldOut: st.availability.remaining <= 0,
      };
    });
  }, [siblingTrips, intlTag]);

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
      toast.success(t("bookingConfirm.done"));
      navigate(`/reservations/${data.id}/confirm`);
    },
    onError: (err) => toast.error(err.message || t("booking.failReserve")),
  });
  const createTossOrder = trpc.payments.createTossOrder.useMutation({
    onError: (err) => toast.error(err.message || t("booking.failOrder")),
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
        <p className="text-muted-foreground">{t("booking.loginNeeded")}</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black">
          <a href={getLoginUrl()}>{t("booking.kakaoLogin")}</a>
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
    return <div className="py-20 text-center text-muted-foreground">{t("booking.notFound")}</div>;
  }

  if (!trip) {
    return <div className="py-20 text-center text-muted-foreground">{t("booking.notFound")}</div>;
  }

  const remaining = trip.availability.remaining;
  const soldOut = remaining <= 0 || trip.status === "cancelled";
  const maxSeats = Math.max(1, Math.min(8, remaining));

  // 탑승권 선택지: 왕복 셔틀 + 편도가 지정 → 왕복/행사장행/귀가행 3종.
  // 편도가 미지정이면 왕복만, 편도 셔틀이면 행사장행 단일(내부적으로 round=전 구간).
  const ticketOptions: { key: "round" | "outbound" | "inbound"; label: string; desc: string; price: number }[] =
    trip.isRoundTrip
      ? [
          { key: "round", label: t("ticket.round"), desc: t("ticket.roundDesc"), price: trip.price },
          ...(trip.oneWayPrice != null
            ? ([
                { key: "outbound", label: t("ticket.outbound"), desc: t("ticket.outboundDesc"), price: trip.oneWayPrice },
                { key: "inbound", label: t("ticket.inbound"), desc: t("ticket.inboundDesc"), price: trip.oneWayPrice },
              ] as const)
            : []),
        ]
      : [{ key: "round", label: t("ticket.outbound"), desc: t("ticket.onewayDesc"), price: trip.price }];
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
      toast.error(t("booking.enterPassenger"));
      return;
    }
    if (trimmedCode && codeCheck && !codeCheck.ok) {
      toast.error(codeCheck.reason);
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
      referralCode: trimmedCode || undefined,
      referralSource: (trimmedCode && trimmedCode === prefilledRef ? "LINK_PREFILL" : "MANUAL") as
        | "LINK_PREFILL"
        | "MANUAL",
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
          {t("booking.back")}
        </button>

        {/* 선택 요약 */}
        <div className="rounded-2xl border border-border bg-card p-4 mb-5 text-sm space-y-1.5">
          <p className="font-semibold">{event?.title ?? t("title.booking")}</p>
          <p className="text-muted-foreground">
            {rangeDateLabel(trip.departureAt, intlTag)} {formatTime(trip.departureAt)} · {selectedTicket.label} · {t("common.seats", { n: seats })}
          </p>
          <p className="text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {selectedBp ? selectedBp.name : t("booking.tripUnset")} → {event?.venue}
          </p>
        </div>

        {phase === "info" ? (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-lg font-semibold">{t("booking.passengerInfo")}</h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t("booking.name")}</Label>
                <Input id="name" value={passengerName} onChange={(e) => setPassengerName(e.target.value)} placeholder={t("booking.namePh")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("booking.phone")}</Label>
                <Input id="phone" value={passengerPhone} onChange={(e) => setPassengerPhone(e.target.value)} placeholder="010-0000-0000" type="tel" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("booking.email")}</Label>
                <Input id="email" value={passengerEmail} onChange={(e) => setPassengerEmail(e.target.value)} placeholder="example@email.com" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="referral">{t("booking.referral")}</Label>
                <Input
                  id="referral"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder={t("booking.referralPh")}
                  maxLength={16}
                  className="uppercase"
                />
                {trimmedCode.length >= 4 && codeCheck ? (
                  codeCheck.ok ? (
                    <p className="text-xs text-emerald-600">{t("booking.codeOk")}</p>
                  ) : (
                    <p className="text-xs text-destructive">{codeCheck.reason}</p>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("booking.codeHint")}
                  </p>
                )}
              </div>
            </div>
            <Button
              className="w-full h-12 text-base font-semibold"
              disabled={!passengerName || !passengerPhone}
              onClick={() => setPhase("pay")}
            >
              {t("common.next")}
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
            <h2 className="text-lg font-semibold">{t("booking.payment")}</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("field.boardingPlace")}</span>
                <span className="font-medium">{selectedBp ? selectedBp.name : t("booking.unset")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("field.ticket")}</span>
                <span className="font-medium">{selectedTicket.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("field.riders")}</span>
                <span className="font-medium">{t("common.seats", { n: seats })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("field.passenger")}</span>
                <span className="font-medium">{passengerName}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("booking.fare", { n: seats })}</span>
                <span>{formatPrice(totalBeforePoints)}</span>
              </div>

              {(pointsBalance?.balance ?? 0) > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t("booking.pointsUse")}</span>
                    <span className="text-xs text-muted-foreground">{t("booking.pointsHave", { n: (pointsBalance?.balance ?? 0).toLocaleString() })}</span>
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
                      {t("booking.useAll")}
                    </Button>
                  </div>
                  {pointsUsed > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>{t("booking.pointsDiscount")}</span>
                      <span>-{formatPrice(pointsUsed)}</span>
                    </div>
                  )}
                </div>
              )}

              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span>{t("booking.finalAmount")}</span>
                <span className="text-primary">{formatPrice(totalAmount)}</span>
              </div>
            </div>

            {tossAvailable && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("booking.payMethod")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod("toss")}
                    className={`rounded-lg border p-3 text-sm font-medium transition-all ${
                      payMethod === "toss" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    {t("booking.tossPay")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod("mock")}
                    className={`rounded-lg border p-3 text-sm font-medium transition-all ${
                      payMethod === "mock" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    {t("booking.demoPay")}
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
                {t("booking.demoNote")}
              </div>
            )}

            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handleSubmit}
              disabled={createReservation.isPending || tossSubmitting || (payMethod === "toss" && !toss.ready)}
            >
              {createReservation.isPending || tossSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("booking.processing")}
                </span>
              ) : payMethod === "toss" && !toss.ready ? (
                t("booking.loadingPay")
              ) : (
                `${formatPrice(totalAmount)} ${t("booking.pay")}`
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
              <p className="font-bold truncate">{event?.title ?? t("title.booking")}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{event?.venue}</span>
              </p>
              {event && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarCheck className="h-3 w-3 flex-shrink-0" />
                  {rangeDateLabel(event.eventDate, intlTag)}
                </p>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Bus className="h-3 w-3 flex-shrink-0" />
                {trip.mode === "bus" ? t("booking.busType") : t("booking.vanType")} {t("booking.capacity", { n: trip.maxCount })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container max-w-2xl space-y-7 pt-5">
        {/* 이용 지역 */}
        <section className="space-y-2">
          <h2 className="font-bold">{t("booking.useRegion")}</h2>
          <button
            type="button"
            onClick={() => setRegionSheetOpen(true)}
            className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium truncate">
                {selectedBp ? selectedBp.name : t("booking.selectBoardingPlace")}
              </span>
            </span>
            <span className="flex items-center gap-0.5 text-sm text-muted-foreground flex-shrink-0">
              {t("common.change")} <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        </section>

        {/* 예약 인원 */}
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="font-bold">{t("field.riders")}</h2>
            <span className="text-xs text-muted-foreground">{t("booking.maxRiders", { n: maxSeats })}</span>
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
                {t("common.seats", { n })}
              </button>
            ))}
          </div>
        </section>

        {/* 날짜 선택 */}
        <section className="space-y-2">
          <h2 className="font-bold">{t("booking.selectDate")}</h2>
          {dateChips.length > 0 ? (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 pb-1">
              {dateChips.map(({ trip: st, label, soldOut: chipSoldOut }) => (
                <button
                  key={st.id}
                  type="button"
                  disabled={chipSoldOut}
                  onClick={() => switchTrip(st.id)}
                  className={`flex-shrink-0 px-3.5 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-40 ${
                    selectedTripId === st.id
                      ? "border-primary bg-primary/10 text-foreground font-bold"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("booking.noDates")}</p>
          )}
          <p className="text-xs text-muted-foreground">{t("eventDetail.depart", { time: formatTime(trip.departureAt) })}</p>
        </section>

        {/* 탑승권 선택 — 왕복 / 행사장행 / 귀가행 */}
        <section className="space-y-2">
          <h2 className="font-bold">{t("booking.selectTicket")}</h2>
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
          <h2 className="font-bold">{t("booking.boardDropLoc")}</h2>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {([["board", t("field.boardingPlace")], ["drop", t("booking.dropPlace")]] as const).map(([key, label]) => (
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
                      <p className="text-xs text-primary">{t("eventDetail.pickup", { time: formatTime(selectedBp.pickupTime) })}</p>
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
                        <Navigation className="h-3 w-3" /> {t("booking.kakaoMap")}
                      </a>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("booking.boardInfoPending")}</p>
                )
              ) : (
                <>
                  <p className="font-semibold text-sm">{event?.venue}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("booking.dropNote")}
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
                      <Navigation className="h-3 w-3" /> {t("booking.kakaoMap")}
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        {/* 유의사항 */}
        <section className="space-y-3">
          <h2 className="font-bold">{t("booking.noticeTitle")}</h2>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {([["reserve", t("booking.noticeReserve")], ["board", t("booking.noticeBoard")]] as const).map(([key, label]) => (
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
              <div key={n.titleKey} className="flex gap-3">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <n.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${"highlight" in n && n.highlight ? "text-primary" : ""}`}>{t(n.titleKey)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(n.descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 취소 정책 */}
        <section className="space-y-2">
          <h2 className="font-bold">{t("booking.cancelPolicy")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("booking.cancelNote")}
            {isRushCreatedTrip && t("booking.rushNote")}
          </p>
          <div className="rounded-xl border border-border overflow-hidden text-sm">
            <div className="grid grid-cols-2 bg-muted/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
              <span>{t("booking.colPeriod")}</span>
              <span>{t("booking.colFee")}</span>
            </div>
            {CANCEL_ROWS.map((row) => (
              <div key={row.periodKey} className="grid grid-cols-2 px-4 py-2.5 border-t border-border/60 text-xs">
                <span className="text-muted-foreground">{t(row.periodKey)}</span>
                <span className={"danger" in row && row.danger ? "text-destructive font-medium" : ""}>{t(row.feeKey)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 고객센터 */}
        <section className="space-y-2">
          <h2 className="font-bold">{t("booking.custCenter")}</h2>
          <p className="text-xs text-muted-foreground">{t("booking.custDesc")}</p>
          <p className="text-xs text-muted-foreground">{t("booking.custHours")}</p>
          <Button variant="outline" className="w-full" asChild>
            <a href={KAKAO_CHANNEL_CHAT_URL} target="_blank" rel="noopener">
              {t("booking.kakaoChannel")}
            </a>
          </Button>
        </section>

        {/* 하단 유의사항 (텍스트) */}
        <section className="rounded-xl bg-muted/40 p-4 space-y-3 text-[11px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-xs text-foreground/70">{t("booking.notice")}</p>
          <div>
            <p className="font-semibold">{t("booking.headPay")}</p>
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              <li>{t("np1")}</li>
              <li>{t("np2")}</li>
              <li>{t("np3")}</li>
              <li>{t("np4")}</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold">{t("booking.headBoard")}</p>
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              <li>{t("nbd1")}</li>
              <li>{t("nbd2")}</li>
              <li>{t("nbd3")}</li>
              <li>{t("nbd4")}</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold">{t("booking.headEtc")}</p>
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              <li>{t("ne1")}</li>
              <li>{t("ne2")}</li>
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
          {soldOut ? t("booking.soldOut") : `${formatPrice(totalBeforePoints)} · ${t("booking.reserveCta")}`}
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
              <h3 className="font-bold">{t("booking.selectRegionSheet")}</h3>
              <button type="button" onClick={() => setRegionSheetOpen(false)} className="p-1 text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {(siblingTrips ?? [])
                .filter((st) => st.status !== "cancelled")
                .map((st) => {
                  const stops = pointsByTrip.get(st.id) ?? [];
                  const full = st.availability.remaining <= 0;
                  if (stops.length === 0) return null;
                  return (
                    <div key={st.id} className="py-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        {chipDateLabel(st.departureAt, intlTag)} {formatTime(st.departureAt)} {t("booking.departSuffix")}
                        {full && t("booking.departFull")}
                      </p>
                      <div className="space-y-1.5">
                        {stops.map((bp) => {
                          const isCurrent = bp.id === selectedBp?.id && st.id === selectedTripId;
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
                                  <p className="text-[11px] text-primary">{t("eventDetail.pickup", { time: formatTime(bp.pickupTime) })}</p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={isCurrent ? "default" : "outline"}
                                className="flex-shrink-0"
                                disabled={full}
                                onClick={() => {
                                  switchTrip(st.id);
                                  setSelectedBpId(bp.id);
                                  setRegionSheetOpen(false);
                                }}
                              >
                                {full ? t("booking.full") : isCurrent ? t("booking.selected") : t("eventDetail.reserve")}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              {(allPoints ?? []).length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("booking.noStops")}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
