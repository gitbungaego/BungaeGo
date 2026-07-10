import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { isCreatedAfterOwnD5 } from "@shared/cancellationPolicy";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  formatPrice,
  formatDateTime,
  formatTime,
  TRIP_STATUS_LABELS,
} from "@/lib/constants";
import { ArrowLeft, ArrowRight, Bus, CheckCircle2, Clock, MapPin, Minus, Plus, User } from "lucide-react";
import { Link } from "wouter";
import { isTossConfigured } from "@/lib/toss";
import { useTossPayment } from "@/hooks/useTossPayment";

interface Props {
  tripId: number;
}

const STEPS = [
  { id: 1, label: "탑승 포인트" },
  { id: 2, label: "좌석 선택" },
  { id: 3, label: "예약자 정보" },
  { id: 4, label: "결제" },
];

export default function BookingPage({ tripId }: Props) {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);

  const [selectedBoardingPointId, setSelectedBoardingPointId] = useState<number | null>(null);
  const [seats, setSeats] = useState(1);
  const [passengerName, setPassengerName] = useState(user?.name ?? "");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [passengerEmail, setPassengerEmail] = useState(user?.email ?? "");
  const [referralCode, setReferralCode] = useState("");
  const [pointsUsed, setPointsUsed] = useState(0);

  const { data: trip, isLoading: tripLoading } = trpc.trips.byId.useQuery({ id: tripId });
  const { data: boardingPoints, isLoading: bpLoading } = trpc.boardingPoints.byTripId.useQuery({ tripId });
  const { data: pointsBalance } = trpc.points.myBalance.useQuery(undefined, { enabled: isAuthenticated });
  const { data: tossServer } = trpc.payments.tossEnabled.useQuery(undefined, { enabled: isTossConfigured() });
  const tossAvailable = isTossConfigured() && !!tossServer?.enabled;

  const [payMethod, setPayMethod] = useState<"toss" | "mock">("mock");
  // 서버/클라이언트 키가 모두 준비된 경우에만 toss를 기본 선택.
  useEffect(() => {
    if (tossAvailable) setPayMethod("toss");
  }, [tossAvailable]);

  const createReservation = trpc.reservations.create.useMutation({
    onSuccess: (data) => {
      toast.success("예약이 완료되었습니다!");
      navigate(`/reservations/${data.id}/confirm`);
    },
    onError: (err) => {
      toast.error(err.message || "예약에 실패했습니다.");
    },
  });

  const createTossOrder = trpc.payments.createTossOrder.useMutation({
    onError: (err) => toast.error(err.message || "주문 생성에 실패했습니다."),
  });

  // 위젯은 결제 단계에서 toss 선택 시에만 렌더. 금액은 표시용이며, 승인은
  // 서버가 주문 생성 시 계산한 금액과 대조해 이뤄진다.
  const [tossSubmitting, setTossSubmitting] = useState(false);
  const toss = useTossPayment({
    enabled: step === 4 && payMethod === "toss" && tossAvailable,
    amount: (trip?.price ?? 0) * seats - pointsUsed,
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

  if (tripLoading) {
    return (
      <div className="py-10 container max-w-2xl">
        <Skeleton className="h-40 rounded-xl mb-6" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!trip) {
    return <div className="py-20 text-center text-muted-foreground">셔틀을 찾을 수 없습니다.</div>;
  }

  const totalBeforePoints = trip.price * seats;
  const maxPointsUsable = Math.min(pointsBalance?.balance ?? 0, totalBeforePoints);
  const totalAmount = totalBeforePoints - pointsUsed;
  const isRushCreatedTrip = isCreatedAfterOwnD5(
    { departureAt: new Date(trip.departureAt), createdAt: new Date(trip.createdAt) }
  );

  const handleSubmit = async () => {
    if (!passengerName || !passengerPhone) {
      toast.error("예약자 정보를 입력해주세요.");
      return;
    }
    const orderInput = {
      tripId,
      boardingPointId: selectedBoardingPointId ?? undefined,
      seats,
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
        // 결제창으로 리다이렉트 - 이후 플로우는 successUrl/failUrl 페이지가 이어받는다.
        await toss.requestPayment({
          orderId: order.orderId,
          orderName: order.orderName,
          amount: order.amount,
          customerName: passengerName,
          customerEmail: passengerEmail || undefined,
        });
      } catch (err) {
        // 사용자가 결제창을 닫은 경우 등 - 페이지는 그대로 유지.
        if (err instanceof Error && err.message) toast.error(err.message);
      } finally {
        setTossSubmitting(false);
      }
      return;
    }

    createReservation.mutate({ ...orderInput, paymentMethod: "mock_card" });
  };

  const canProceed = () => {
    if (step === 1) return true; // boarding point optional
    if (step === 2) return seats >= 1;
    if (step === 3) return passengerName.length > 0 && passengerPhone.length > 0;
    return true;
  };

  return (
    <div className="py-8">
      <div className="container max-w-2xl">
        {/* Back */}
        <Link href={`/events/${trip.eventId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          이벤트로 돌아가기
        </Link>

        {/* Trip Summary */}
        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bus className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  {trip.mode === "bus" ? "버스" : "밴"}
                </Badge>
                {trip.isRoundTrip && <Badge variant="outline" className="text-xs">왕복</Badge>}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <Clock className="h-3.5 w-3.5" />
                <span>{formatDateTime(trip.departureAt)}</span>
              </div>
            </div>
            <span className="text-lg font-bold text-primary">{formatPrice(trip.price)}</span>
          </div>
          {isRushCreatedTrip && (
            <p className="text-xs text-amber-600 mt-3 pt-3 border-t border-border/60">
              이 셔틀은 예약 후 1시간이 지나면 취소가 불가합니다.
            </p>
          )}
        </div>

        {/* Step Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                      step > s.id
                        ? "bg-primary text-white"
                        : step === s.id
                        ? "bg-primary text-white ring-4 ring-primary/20"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {step > s.id ? <CheckCircle2 className="h-4 w-4" /> : s.id}
                  </div>
                  <span className={`text-xs mt-1 whitespace-nowrap ${step === s.id ? "text-primary font-medium" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${step > s.id ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="rounded-xl border border-border bg-card p-6 mb-6">
          {/* Step 1: Boarding Point */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">탑승 포인트 선택</h2>
              <p className="text-sm text-muted-foreground">가장 가까운 탑승 포인트를 선택하세요.</p>
              {bpLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : boardingPoints && boardingPoints.length > 0 ? (
                <div className="space-y-2">
                  {boardingPoints.map((bp, idx) => (
                    <button
                      key={bp.id}
                      onClick={() => setSelectedBoardingPointId(bp.id)}
                      className={`w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                        selectedBoardingPointId === bp.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                        selectedBoardingPointId === bp.id ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{bp.name}</p>
                        {bp.address && <p className="text-xs text-muted-foreground">{bp.address}</p>}
                        {bp.pickupTime && (
                          <p className="text-xs text-primary mt-0.5">픽업 {formatTime(bp.pickupTime)}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">탑승 포인트 정보가 없습니다.</p>
              )}
            </div>
          )}

          {/* Step 2: Seats */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold">좌석 수 선택</h2>
              <div className="flex items-center justify-center gap-6">
                <button
                  onClick={() => setSeats(Math.max(1, seats - 1))}
                  className="h-10 w-10 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
                  disabled={seats <= 1}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="text-center">
                  <span className="text-4xl font-bold text-primary">{seats}</span>
                  <p className="text-sm text-muted-foreground mt-1">명</p>
                </div>
                <button
                  onClick={() => setSeats(Math.min(8, seats + 1))}
                  className="h-10 w-10 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
                  disabled={seats >= Math.min(8, trip.availability.remaining)}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">소계</p>
                <p className="text-2xl font-bold mt-1">{formatPrice(trip.price * seats)}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="referral" className="text-sm">초대 코드 (선택)</Label>
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
          )}

          {/* Step 3: Passenger Info */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">예약자 정보</h2>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">이름 *</Label>
                  <Input
                    id="name"
                    value={passengerName}
                    onChange={(e) => setPassengerName(e.target.value)}
                    placeholder="홍길동"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">연락처 *</Label>
                  <Input
                    id="phone"
                    value={passengerPhone}
                    onChange={(e) => setPassengerPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    type="tel"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">이메일 (선택)</Label>
                  <Input
                    id="email"
                    value={passengerEmail}
                    onChange={(e) => setPassengerEmail(e.target.value)}
                    placeholder="example@email.com"
                    type="email"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Payment */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">결제</h2>

              {/* Summary */}
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">탑승 포인트</span>
                  <span className="font-medium">
                    {selectedBoardingPointId
                      ? boardingPoints?.find((b) => b.id === selectedBoardingPointId)?.name
                      : "미선택"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">좌석 수</span>
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

                {/* Points */}
                {(pointsBalance?.balance ?? 0) > 0 && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">포인트 사용</span>
                      <span className="text-xs text-muted-foreground">
                        보유 {(pointsBalance?.balance ?? 0).toLocaleString()}P
                      </span>
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPointsUsed(maxPointsUsable)}
                        className="whitespace-nowrap"
                      >
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

              {/* 결제 수단 선택: toss는 서버(TOSS_SECRET_KEY)와 클라이언트
                  (VITE_TOSS_CLIENT_KEY) 키가 모두 있을 때만 노출된다. */}
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
                  {toss.error && (
                    <p className="text-xs text-destructive">{toss.error}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                  ※ 데모 환경입니다. 실제 결제는 이루어지지 않습니다.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              이전
            </Button>
          )}
          {step < 4 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="flex-1"
            >
              다음
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={
                createReservation.isPending ||
                tossSubmitting ||
                (payMethod === "toss" && !toss.ready)
              }
              className="flex-1 bg-primary"
            >
              {createReservation.isPending || tossSubmitting
                ? "처리 중..."
                : payMethod === "toss" && !toss.ready
                ? "결제수단 불러오는 중..."
                : `${formatPrice(totalAmount)} 결제하기`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
