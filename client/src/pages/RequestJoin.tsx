import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { MapView, centerMapOn, searchKeyword, type KakaoPlaceResult } from "@/components/Map";
import { formatPrice, formatDateTime } from "@/lib/constants";
import { ArrowLeft, ArrowRight, CheckCircle2, MapPin, Minus, Plus, Search } from "lucide-react";
import { Link } from "wouter";
import { isTossConfigured } from "@/lib/toss";
import { useTossPayment } from "@/hooks/useTossPayment";

interface Props {
  eventId: number;
}

const STEPS = [
  { id: 1, label: "출발지" },
  { id: 2, label: "도착 희망 시각" },
  { id: 3, label: "참가자 정보" },
  { id: 4, label: "결제" },
];

// A rally point candidate tapped on the event map arrives here with its
// coordinates in the query string, so step 1 starts pre-filled.
function readPrefilledOrigin(): { lat: number; lng: number; address: string } | null {
  const params = new URLSearchParams(window.location.search);
  const rawLat = params.get("originLat");
  const rawLng = params.get("originLng");
  if (!rawLat || !rawLng) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, address: params.get("originAddress") ?? "" };
}

export default function RequestJoinPage({ eventId }: Props) {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);

  const [prefilledOrigin] = useState(readPrefilledOrigin);
  const [originAddress, setOriginAddress] = useState(prefilledOrigin?.address ?? "");
  const [originLat, setOriginLat] = useState<number | null>(prefilledOrigin?.lat ?? null);
  const [originLng, setOriginLng] = useState<number | null>(prefilledOrigin?.lng ?? null);
  // Address the user has already confirmed (prefilled or picked from the
  // dropdown) - typing it back shouldn't reopen the search dropdown.
  const committedAddressRef = useRef(prefilledOrigin?.address ?? "");
  const [map, setMap] = useState<any>(null);
  const [marker, setMarker] = useState<any>(null);
  const [placeResults, setPlaceResults] = useState<KakaoPlaceResult[]>([]);
  const [showPlaceDropdown, setShowPlaceDropdown] = useState(false);

  const [targetArrivalDate, setTargetArrivalDate] = useState("");
  const [targetArrivalTime, setTargetArrivalTime] = useState("");

  const [seats, setSeats] = useState(1);
  const [passengerName, setPassengerName] = useState(user?.name ?? "");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [passengerEmail, setPassengerEmail] = useState(user?.email ?? "");
  const [referralCode, setReferralCode] = useState("");
  const [pointsUsed, setPointsUsed] = useState(0);

  const { data: event, isLoading: eventLoading } = trpc.events.byId.useQuery({ id: eventId });
  const { data: pointsBalance } = trpc.points.myBalance.useQuery(undefined, { enabled: isAuthenticated });
  const { data: tossServer } = trpc.payments.tossEnabled.useQuery(undefined, { enabled: isTossConfigured() });
  const tossAvailable = isTossConfigured() && !!tossServer?.enabled;

  const [payMethod, setPayMethod] = useState<"toss" | "mock">("mock");
  useEffect(() => {
    if (tossAvailable) setPayMethod("toss");
  }, [tossAvailable]);

  const [tossSubmitting, setTossSubmitting] = useState(false);
  // 표시 금액 = 상한가 × 좌석 - 포인트. 실제 승인 금액은 서버가 주문 생성
  // 시점에 같은 식으로 계산해 대조한다.
  const toss = useTossPayment({
    enabled: step === 4 && payMethod === "toss" && tossAvailable,
    amount: (event?.autoMatchPricePerSeat ?? 0) * seats - pointsUsed,
  });

  const createTossOrder = trpc.payments.createTossOrder.useMutation({
    onError: (err) => toast.error(err.message || "주문 생성에 실패했습니다."),
  });

  const createRequest = trpc.rideRequests.create.useMutation({
    onSuccess: (data) => {
      toast.success("참가 신청이 완료되었습니다!");
      navigate(`/requests/${data.id}/confirm`);
    },
    onError: (err) => toast.error(err.message || "참가 신청에 실패했습니다."),
  });

  // Debounced keyword search-as-you-type (Kakao has no plug-and-play
  // autocomplete widget, so we build a simple dropdown).
  useEffect(() => {
    if (!originAddress.trim() || originAddress === committedAddressRef.current) {
      setPlaceResults([]);
      setShowPlaceDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchKeyword(originAddress);
      setPlaceResults(results);
      setShowPlaceDropdown(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [originAddress]);

  const selectPlace = (place: KakaoPlaceResult) => {
    const lat = Number(place.y);
    const lng = Number(place.x);
    const address = place.road_address_name || place.address_name || place.place_name;
    committedAddressRef.current = address;
    setOriginAddress(address);
    setOriginLat(lat);
    setOriginLng(lng);
    setShowPlaceDropdown(false);

    if (map && window.kakao) {
      // 선택한 출발지가 지도 정중앙에 오도록 (relayout 포함).
      centerMapOn(map, { lat, lng }, 3);
      if (marker) marker.setMap(null);
      setMarker(new window.kakao.maps.Marker({ map, position: new window.kakao.maps.LatLng(lat, lng) }));
    }
  };

  // Drop the marker for a pre-filled origin once the map is ready (selectPlace
  // handles the marker itself for dropdown picks).
  useEffect(() => {
    if (!map || !window.kakao || marker || originLat === null || originLng === null) return;
    // 프리필된 출발지도 지도 정중앙에 (relayout 포함).
    centerMapOn(map, { lat: originLat, lng: originLng }, 3);
    setMarker(
      new window.kakao.maps.Marker({ map, position: new window.kakao.maps.LatLng(originLat, originLng) })
    );
  }, [map, marker, originLat, originLng]);

  if (!isAuthenticated) {
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-muted-foreground">참가 신청하려면 로그인이 필요합니다.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black">
          <a href={getLoginUrl()}>카카오로 로그인</a>
        </Button>
      </div>
    );
  }

  if (eventLoading) {
    return (
      <div className="py-10 container max-w-2xl">
        <Skeleton className="h-40 rounded-xl mb-6" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!event) {
    return <div className="py-20 text-center text-muted-foreground">이벤트를 찾을 수 없습니다.</div>;
  }

  if (!event.autoMatchEnabled) {
    return <div className="py-20 text-center text-muted-foreground">이 이벤트는 참가 신청을 지원하지 않습니다.</div>;
  }

  if (event.matchingFrozenAt) {
    return <div className="py-20 text-center text-muted-foreground">이미 배차가 확정되어 신청이 마감되었습니다.</div>;
  }

  const pricePerSeat = event.autoMatchPricePerSeat ?? 0;
  const totalBeforePoints = pricePerSeat * seats;
  const maxPointsUsable = Math.min(pointsBalance?.balance ?? 0, totalBeforePoints);
  const totalAmount = totalBeforePoints - pointsUsed;

  const targetArrivalMs = () => {
    if (!targetArrivalDate || !targetArrivalTime) return null;
    const dt = new Date(`${targetArrivalDate}T${targetArrivalTime}:00`);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  };

  const handleSubmit = async () => {
    if (originLat === null || originLng === null) {
      toast.error("출발지를 검색해주세요.");
      return;
    }
    const arrivalMs = targetArrivalMs();
    if (!arrivalMs) {
      toast.error("도착 희망 시각을 입력해주세요.");
      return;
    }
    if (!passengerName || !passengerPhone) {
      toast.error("참가자 정보를 입력해주세요.");
      return;
    }

    const orderInput = {
      eventId,
      originAddress,
      originLat: String(originLat),
      originLng: String(originLng),
      targetArrivalAt: arrivalMs,
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
        const order = await createTossOrder.mutateAsync({ kind: "rideRequest", ...orderInput });
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

    createRequest.mutate({ ...orderInput, paymentMethod: "mock_card" });
  };

  const canProceed = () => {
    if (step === 1) return originLat !== null && originLng !== null;
    if (step === 2) return !!targetArrivalMs();
    if (step === 3) return passengerName.length > 0 && passengerPhone.length > 0;
    return true;
  };

  return (
    <div className="py-8">
      <div className="container max-w-2xl">
        <Link href={`/events/${eventId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          이벤트로 돌아가기
        </Link>

        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <p className="font-semibold">{event.title}</p>
          <p className="text-sm text-muted-foreground">{event.venue}</p>
          <p className="text-lg font-bold text-primary mt-1">{formatPrice(pricePerSeat)} / 좌석</p>
        </div>

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

        <div className="rounded-xl border border-border bg-card p-6 mb-6">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">출발지 입력</h2>
              <p className="text-sm text-muted-foreground">가까운 정류장이 배정될 수 있도록 출발 주소를 입력해주세요.</p>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={originAddress}
                  onChange={(e) => setOriginAddress(e.target.value)}
                  onFocus={() => placeResults.length > 0 && setShowPlaceDropdown(true)}
                  onBlur={() => setTimeout(() => setShowPlaceDropdown(false), 150)}
                  placeholder="예: 강남역, 서울시 강남구 테헤란로 123"
                  className="pl-9"
                />
                {showPlaceDropdown && placeResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg max-h-56 overflow-auto">
                    {placeResults.map((place) => (
                      <button
                        key={place.id}
                        type="button"
                        onMouseDown={() => selectPlace(place)}
                        className="w-full text-left px-3 py-2 hover:bg-muted transition-colors border-b border-border/60 last:border-0"
                      >
                        <p className="text-sm font-medium">{place.place_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {place.road_address_name || place.address_name}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl overflow-hidden border border-border h-64">
                <MapView
                  initialCenter={
                    event.lat && event.lng
                      ? { lat: Number(event.lat), lng: Number(event.lng) }
                      : { lat: 37.5665, lng: 126.978 }
                  }
                  initialZoom={11}
                  onMapReady={(m) => setMap(m)}
                />
              </div>
              {originLat !== null && (
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  위치가 확인되었습니다.
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">도착 희망 시각</h2>
              <p className="text-sm text-muted-foreground">
                행사장에 도착하고 싶은 시각을 입력해주세요. 비슷한 시각·경로의 참가자와 함께 배차됩니다.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="arrival-date">날짜</Label>
                  <Input
                    id="arrival-date"
                    type="date"
                    value={targetArrivalDate}
                    onChange={(e) => setTargetArrivalDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="arrival-time">시각</Label>
                  <Input
                    id="arrival-time"
                    type="time"
                    value={targetArrivalTime}
                    onChange={(e) => setTargetArrivalTime(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">행사 시각: {formatDateTime(event.eventDate)}</p>

              <Separator />

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
                  disabled={seats >= 8}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">참가자 정보</h2>
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
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">결제</h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">출발지</span>
                  <span className="font-medium text-right">{originAddress}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">도착 희망</span>
                  <span className="font-medium">
                    {targetArrivalDate} {targetArrivalTime}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">좌석 수</span>
                  <span className="font-medium">{seats}명</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">가격 × {seats}</span>
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
                  </div>
                )}

                <Separator />
                <div className="flex justify-between text-base font-bold">
                  <span>최종 결제 금액</span>
                  <span className="text-primary">{formatPrice(totalAmount)}</span>
                </div>
              </div>

              {/* 상한가 안내: 지금 결제하는 금액은 상한이고, 확정가와의
                  차액은 배차 확정 시 자동 환불된다. */}
              <div className="rounded-lg bg-primary/5 border border-primary/30 p-3 text-xs text-foreground/80">
                지금 결제하는 금액은 <span className="font-semibold">상한가</span>입니다. 최종 금액은 배차 확정 시 이
                금액 <span className="font-semibold">이하</span>로 결정되며, 차액은 자동으로 환불됩니다.
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
                  ※ 데모 환경입니다. 실제 결제는 이루어지지 않습니다. 신청 후 배차가 확정되면 정류장과 출발 시각이 배정됩니다.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              이전
            </Button>
          )}
          {step < 4 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()} className="flex-1">
              다음
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={
                createRequest.isPending ||
                tossSubmitting ||
                (payMethod === "toss" && !toss.ready)
              }
              className="flex-1 bg-primary"
            >
              {createRequest.isPending || tossSubmitting
                ? "처리 중..."
                : payMethod === "toss" && !toss.ready
                ? "결제수단 불러오는 중..."
                : `${formatPrice(totalAmount)} 결제하고 신청하기`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
