import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { MapView, searchKeyword, type KakaoPlaceResult } from "@/components/Map";
import { CATEGORY_LABELS } from "@/lib/constants";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  Calendar,
  CheckCircle2,
  MapPin,
  Minus,
  Plus,
  Search,
  Ticket,
  Users,
} from "lucide-react";
import { Link } from "wouter";

const STEPS = [
  { id: 1, label: "이벤트 정보", icon: <Ticket className="h-4 w-4" /> },
  { id: 2, label: "셔틀 설정", icon: <Bus className="h-4 w-4" /> },
  { id: 3, label: "탑승 포인트", icon: <MapPin className="h-4 w-4" /> },
  { id: 4, label: "확인", icon: <CheckCircle2 className="h-4 w-4" /> },
];

const CATEGORIES = ["concert", "sports", "festival", "rally", "exhibition", "other"] as const;

interface BoardingPointInput {
  name: string;
  address: string;
  pickupTime: string;
}

export default function CreatePage() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);

  // Step 1: Event info
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("concert");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("19:00");
  const [venue, setVenue] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const [map, setMap] = useState<any>(null);
  const [placeMarker, setPlaceMarker] = useState<any>(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<KakaoPlaceResult[]>([]);
  const [showPlaceDropdown, setShowPlaceDropdown] = useState(false);

  // Debounced keyword search-as-you-type (Kakao has no plug-and-play
  // autocomplete widget like Google's, so we build a simple dropdown).
  useEffect(() => {
    if (!placeQuery.trim()) {
      setPlaceResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchKeyword(placeQuery);
      setPlaceResults(results);
      setShowPlaceDropdown(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [placeQuery]);

  const selectPlace = (place: KakaoPlaceResult) => {
    const placeLat = Number(place.y);
    const placeLng = Number(place.x);
    setVenue(place.place_name);
    setAddress(place.road_address_name || place.address_name);
    setLat(placeLat);
    setLng(placeLng);
    setPlaceQuery(place.place_name);
    setShowPlaceDropdown(false);

    if (map && window.kakao) {
      const position = new window.kakao.maps.LatLng(placeLat, placeLng);
      map.setCenter(position);
      map.setLevel(3);
      if (placeMarker) placeMarker.setMap(null);
      setPlaceMarker(new window.kakao.maps.Marker({ map, position }));
    }
  };

  // Step 2: Trip settings
  const [minCount, setMinCount] = useState(20);
  const [maxCount, setMaxCount] = useState(45);
  const [price, setPrice] = useState(15000);
  const [departureDate, setDepartureDate] = useState("");
  const [departureTime, setDepartureTime] = useState("16:00");
  const [isRoundTrip, setIsRoundTrip] = useState(true);
  const [notes, setNotes] = useState("");

  // Step 3: Boarding points (optional)
  const [boardingPoints, setBoardingPoints] = useState<BoardingPointInput[]>([]);

  const createEvent = trpc.events.create.useMutation();
  const createTrip = trpc.trips.create.useMutation();
  const createBoardingPoint = trpc.boardingPoints.create.useMutation();

  if (!isAuthenticated) {
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-muted-foreground">셔틀을 만들려면 로그인이 필요합니다.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black">
          <a href={getLoginUrl()}>카카오로 로그인</a>
        </Button>
      </div>
    );
  }

  const canProceed = () => {
    if (step === 1) return title.length >= 2 && eventDate && venue.length >= 2;
    if (step === 2) return minCount > 0 && maxCount >= minCount && price >= 0 && departureDate;
    return true;
  };

  const handleSubmit = async () => {
    try {
      const eventDateMs = new Date(`${eventDate}T${eventTime}`).getTime();
      const { id: eventId } = await createEvent.mutateAsync({
        title,
        category,
        eventDate: eventDateMs,
        venue,
        address: address || undefined,
        lat: lat !== null ? String(lat) : undefined,
        lng: lng !== null ? String(lng) : undefined,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
      });

      const departureMs = new Date(`${departureDate}T${departureTime}`).getTime();
      const { id: tripId } = await createTrip.mutateAsync({
        eventId,
        minCount,
        maxCount,
        price,
        departureAt: departureMs,
        isRoundTrip,
        notes: notes || undefined,
      });

      for (let i = 0; i < boardingPoints.length; i++) {
        const bp = boardingPoints[i];
        if (!bp.name) continue;
        await createBoardingPoint.mutateAsync({
          tripId,
          name: bp.name,
          address: bp.address || undefined,
          pickupTime: bp.pickupTime ? new Date(`${departureDate}T${bp.pickupTime}`).getTime() : undefined,
          order: i + 1,
        });
      }

      toast.success("셔틀이 성공적으로 생성되었습니다!");
      navigate(`/events/${eventId}`);
    } catch (err: any) {
      toast.error(err.message || "생성에 실패했습니다.");
    }
  };

  const isSubmitting = createEvent.isPending || createTrip.isPending || createBoardingPoint.isPending;

  const addBoardingPoint = () => {
    setBoardingPoints([...boardingPoints, { name: "", address: "", pickupTime: "" }]);
  };

  const removeBoardingPoint = (idx: number) => {
    setBoardingPoints(boardingPoints.filter((_, i) => i !== idx));
  };

  const updateBoardingPoint = (idx: number, field: keyof BoardingPointInput, value: string) => {
    setBoardingPoints(boardingPoints.map((bp, i) => (i === idx ? { ...bp, [field]: value } : bp)));
  };

  return (
    <div className="py-8">
      <div className="container max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">셔틀 만들기</h1>
          <p className="text-muted-foreground text-sm">이벤트 셔틀을 직접 개설하고 참가자를 모집하세요.</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((s, idx) => (
            <div key={s.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`h-9 w-9 rounded-full flex items-center justify-center transition-all ${
                    step > s.id
                      ? "bg-primary text-white"
                      : step === s.id
                      ? "bg-primary text-white ring-4 ring-primary/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step > s.id ? <CheckCircle2 className="h-4 w-4" /> : s.icon}
                </div>
                <span className={`text-xs mt-1 whitespace-nowrap hidden sm:block ${step === s.id ? "text-primary font-medium" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 mb-4 sm:mb-5 transition-colors ${step > s.id ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-6 mb-6">
          {/* Step 1: Event Info */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">이벤트 정보</h2>
              <div className="space-y-1.5">
                <Label>이벤트명 *</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 아이유 콘서트 2026" />
              </div>
              <div className="space-y-1.5">
                <Label>카테고리 *</Label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                        category === cat
                          ? "bg-primary text-white border-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>이벤트 날짜 *</Label>
                  <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>시작 시간</Label>
                  <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>공연장 / 장소 *</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={placeQuery}
                    onChange={(e) => {
                      setPlaceQuery(e.target.value);
                      setVenue(e.target.value);
                    }}
                    onFocus={() => placeResults.length > 0 && setShowPlaceDropdown(true)}
                    onBlur={() => setTimeout(() => setShowPlaceDropdown(false), 150)}
                    placeholder="장소명이나 주소를 검색하세요 (예: 잠실종합운동장)"
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
                <p className="text-xs text-muted-foreground">검색 결과를 선택하면 주소가 자동으로 입력됩니다.</p>
                <div className="rounded-lg overflow-hidden border border-border h-40 mt-2">
                  <MapView
                    initialCenter={lat && lng ? { lat, lng } : { lat: 37.5665, lng: 126.978 }}
                    initialZoom={lat && lng ? 15 : 10}
                    onMapReady={(m) => setMap(m)}
                  />
                </div>
                {address && (
                  <p className="text-xs text-emerald-600 flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {address}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>이미지 URL (선택)</Label>
                <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="space-y-1.5">
                <Label>설명 (선택)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="이벤트에 대한 간략한 설명을 입력하세요." rows={3} />
              </div>
            </div>
          )}

          {/* Step 2: Trip Settings */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">셔틀 설정</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>최소 인원 *</Label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMinCount(Math.max(1, minCount - 1))} className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <Input
                      type="number"
                      value={minCount}
                      onChange={(e) => setMinCount(Number(e.target.value))}
                      className="text-center"
                    />
                    <button onClick={() => setMinCount(minCount + 1)} className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>최대 인원 *</Label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMaxCount(Math.max(minCount, maxCount - 1))} className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <Input
                      type="number"
                      value={maxCount}
                      onChange={(e) => setMaxCount(Number(e.target.value))}
                      className="text-center"
                    />
                    <button onClick={() => setMaxCount(maxCount + 1)} className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>1인 요금 (원) *</Label>
                <Input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  min={0}
                  step={1000}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>출발 날짜 *</Label>
                  <Input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>출발 시간</Label>
                  <Input type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium">왕복 셔틀</p>
                  <p className="text-xs text-muted-foreground">공연 종료 후 귀환 포함</p>
                </div>
                <Switch checked={isRoundTrip} onCheckedChange={setIsRoundTrip} />
              </div>
              <div className="space-y-1.5">
                <Label>안내 메모</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="탑승 안내, 주의사항 등을 입력하세요." rows={2} />
              </div>
            </div>
          )}

          {/* Step 3: Boarding Points */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">탑승 포인트 (선택)</h2>
              <p className="text-sm text-muted-foreground">
                지금 등록하지 않아도 셔틀을 개설할 수 있어요. 나중에 언제든 추가할 수 있습니다.
              </p>
              <div className="space-y-3">
                {boardingPoints.map((bp, idx) => (
                  <div key={idx} className="p-4 rounded-xl border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
                          {idx + 1}
                        </div>
                        <span className="text-sm font-medium">탑승 포인트 {idx + 1}</span>
                      </div>
                      {boardingPoints.length > 1 && (
                        <button onClick={() => removeBoardingPoint(idx)} className="text-xs text-destructive hover:underline">
                          삭제
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Input
                        value={bp.name}
                        onChange={(e) => updateBoardingPoint(idx, "name", e.target.value)}
                        placeholder="예: 강남역 10번 출구 *"
                      />
                      <Input
                        value={bp.address}
                        onChange={(e) => updateBoardingPoint(idx, "address", e.target.value)}
                        placeholder="주소 (선택)"
                      />
                      <Input
                        type="time"
                        value={bp.pickupTime}
                        onChange={(e) => updateBoardingPoint(idx, "pickupTime", e.target.value)}
                        placeholder="픽업 시간"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="outline" onClick={addBoardingPoint} className="w-full gap-2">
                <Plus className="h-4 w-4" />
                탑승 포인트 추가
              </Button>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">최종 확인</h2>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">이벤트 정보</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">이벤트명</span>
                      <span className="font-medium">{title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">카테고리</span>
                      <span>{CATEGORY_LABELS[category]}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">날짜</span>
                      <span>{eventDate} {eventTime}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">장소</span>
                      <span className="text-right max-w-[200px]">{venue}</span>
                    </div>
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">셔틀 설정</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">인원</span>
                      <span>최소 {minCount}명 / 최대 {maxCount}명</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">요금</span>
                      <span className="font-semibold text-primary">{price.toLocaleString()}원</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">출발</span>
                      <span>{departureDate} {departureTime}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">왕복</span>
                      <span>{isRoundTrip ? "포함" : "미포함"}</span>
                    </div>
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">탑승 포인트 ({boardingPoints.filter(b => b.name).length}개)</p>
                  {boardingPoints.filter(b => b.name).map((bp, idx) => (
                    <div key={idx} className="flex items-center gap-2 py-1">
                      <div className="h-5 w-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </div>
                      <span>{bp.name}</span>
                      {bp.pickupTime && <span className="text-muted-foreground text-xs ml-auto">{bp.pickupTime}</span>}
                    </div>
                  ))}
                </div>
              </div>
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
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()} className="flex-1">
              다음
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1">
              {isSubmitting ? "생성 중..." : "셔틀 개설하기 🚌"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
