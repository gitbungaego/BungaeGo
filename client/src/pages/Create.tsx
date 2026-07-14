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
import { MapView, centerMapOn, searchKeyword, type KakaoPlaceResult } from "@/components/Map";
import { ImageUrlField } from "@/components/ImageUrlField";
import { CATEGORY_LABELS } from "@/lib/constants";
import { GENDER_MODE_LABELS, GENDER_MODE_OPTIONS } from "@/lib/bungaeting";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  Calendar,
  CheckCircle2,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import { Link } from "wouter";

const STEPS = [
  { id: 1, label: "이벤트 정보", icon: <Ticket className="h-4 w-4" /> },
  { id: 2, label: "출발 설정", icon: <Bus className="h-4 w-4" /> },
  { id: 3, label: "탑승 포인트", icon: <MapPin className="h-4 w-4" /> },
  { id: 4, label: "확인", icon: <CheckCircle2 className="h-4 w-4" /> },
];

const CATEGORIES = ["concert", "sports", "festival", "rally", "exhibition", "other"] as const;

// 인원·요금은 차량(버스 좌석)에 따라 운영자가 추후 확정 — 생성 시엔 기본값으로 자동
// 설정하고 입력받지 않는다. 수정은 관리자 편집(TripEditDialog / bungaeting.admin.updateTrip)으로.
const STANDARD_DEFAULTS = { minCount: 20, maxCount: 45, price: 15000 };
// 번개팅 요금: 스펙 §1 일반 대비 +20,000원 고정. 반반 정원은 maxCount 남녀 균등 분할(16→남8·여8).
const BUNGAETING_DEFAULTS = { minCount: 12, maxCount: 16, price: 45000 };

interface BoardingPointInput {
  name: string;
  address: string;
  pickupTime: string;
}

export default function CreatePage() {
  const { isAuthenticated, user } = useAuth();
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
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [searchAliases, setSearchAliases] = useState("");

  const RECOMMENDED_TAGS = ["K-POP", "콘서트", "페스티벌", "뮤지컬", "스포츠"];

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    setTags((prev) => (prev.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]));
    setTagInput("");
  };
  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

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
      // 선택한 장소가 지도 정중앙에 오도록 (relayout 포함 — 컨테이너 크기 캐시 보정).
      centerMapOn(map, { lat: placeLat, lng: placeLng }, 3);
      if (placeMarker) placeMarker.setMap(null);
      setPlaceMarker(
        new window.kakao.maps.Marker({ map, position: new window.kakao.maps.LatLng(placeLat, placeLng) })
      );
    }
  };

  // Step 2: Departure settings (인원·요금은 기본값 자동 — 입력받지 않음)
  const [departureDate, setDepartureDate] = useState("");
  const [departureTime, setDepartureTime] = useState("16:00");
  const [isRoundTrip, setIsRoundTrip] = useState(true);
  const [notes, setNotes] = useState("");

  // Step 3: Boarding points (optional)
  const [boardingPoints, setBoardingPoints] = useState<BoardingPointInput[]>([]);

  // 번개팅 모드 (동행·친목 회차). FEATURE 플래그 뒤에서만 노출.
  // 정원 숫자는 입력받지 않는다 — 반반 "비율"만 선택하고 좌석은 차량에 따라 추후 확정.
  const bungaetingEnabled = import.meta.env.VITE_FEATURE_BUNGAETING === "true";
  const [bungaetingMode, setBungaetingMode] = useState(false);
  const [genderMode, setGenderMode] = useState<(typeof GENDER_MODE_OPTIONS)[number]>("half");
  const [ageMin, setAgeMin] = useState<string>("20"); // 성인 기본 20살 이상
  const [ageMax, setAgeMax] = useState<string>("");
  const [openChatUrl, setOpenChatUrl] = useState("");
  const isHalf = genderMode === "half";
  // 반반 정원 파생값 (기본 총원 균등 분할) — 표시·전송 양쪽에서 사용.
  const derivedCap = BUNGAETING_DEFAULTS.maxCount / 2;
  const derivedMin = BUNGAETING_DEFAULTS.minCount / 2;

  const createEvent = trpc.events.create.useMutation();
  const createTrip = trpc.trips.create.useMutation();
  const createBungaetingTrip = trpc.bungaeting.trips.create.useMutation();
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
    if (step === 2) return !!departureDate;
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
        tags: tags.length ? tags.join(",") : undefined,
        searchAliases: searchAliases.trim() || undefined,
      });

      const departureMs = new Date(`${departureDate}T${departureTime}`).getTime();
      // 번개팅 모드면 번개팅 회차로 생성(성비 모드/나이밴드/오픈채팅 포함), 아니면 표준 셔틀.
      // 인원·요금·정원은 화면에서 받지 않고 기본값 자동 전송 (차량 확정 후 관리자 편집).
      const { id: tripId } = bungaetingMode
        ? await createBungaetingTrip.mutateAsync({
            eventId,
            departureAt: departureMs,
            price: BUNGAETING_DEFAULTS.price,
            minCount: BUNGAETING_DEFAULTS.minCount,
            maxCount: BUNGAETING_DEFAULTS.maxCount,
            genderMode,
            genderCapM: isHalf ? derivedCap : undefined,
            genderCapF: isHalf ? derivedCap : undefined,
            genderMinM: isHalf ? derivedMin : undefined,
            genderMinF: isHalf ? derivedMin : undefined,
            ageMin: ageMin === "" ? null : Number(ageMin),
            ageMax: ageMax === "" ? null : Number(ageMax),
            openChatUrl: openChatUrl.trim() || undefined,
            notes: notes || undefined,
          })
        : await createTrip.mutateAsync({
            eventId,
            minCount: STANDARD_DEFAULTS.minCount,
            maxCount: STANDARD_DEFAULTS.maxCount,
            price: STANDARD_DEFAULTS.price,
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

  const isSubmitting =
    createEvent.isPending || createTrip.isPending || createBungaetingTrip.isPending || createBoardingPoint.isPending;

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
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">셔틀 만들기</h1>
          <p className="text-muted-foreground text-sm">이벤트 셔틀을 직접 개설하고 참가자를 모집하세요.</p>
        </div>

        {/* 번개팅 모드 토글 — 켜면 성별·나이·성비만 추가 입력하면 동행·친목 회차가 된다.
            FEATURE 플래그 뒤에서만 노출(프로덕션 OFF면 안 보임 → 기존 흐름 그대로). */}
        {bungaetingEnabled && (
          <div
            className={`mb-6 rounded-xl border p-4 flex items-center justify-between transition-colors ${
              bungaetingMode ? "border-[#FEE500] bg-[#FFFDF5]" : "border-border bg-card"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${bungaetingMode ? "bg-[#FEE500]" : "bg-muted"}`}>
                <Sparkles className={`h-5 w-5 ${bungaetingMode ? "text-black" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="text-sm font-semibold">번개팅 모드</p>
                <p className="text-xs text-muted-foreground">함께 탄 사람들과 어울리는 동행 회차로 만들어요 (나이·성비 큐레이션).</p>
              </div>
            </div>
            <Switch checked={bungaetingMode} onCheckedChange={setBungaetingMode} />
          </div>
        )}

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
              <ImageUrlField value={imageUrl} onChange={setImageUrl} />
              <div className="space-y-1.5">
                <Label>설명 (선택)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="이벤트에 대한 간략한 설명을 입력하세요." rows={3} />
              </div>

              {/* Tags — public, shown as badges + searchable */}
              <div className="space-y-1.5">
                <Label>태그 (선택)</Label>
                <p className="text-xs text-muted-foreground">장르·장소·아티스트 등 (예: K-POP, 고척돔, 월드투어)</p>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 min-h-11">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 py-1">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 text-muted-foreground hover:text-foreground" aria-label={`${tag} 삭제`}>
                        ×
                      </button>
                    </Badge>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTag(tagInput);
                      } else if (e.key === "Backspace" && !tagInput && tags.length) {
                        removeTag(tags[tags.length - 1]);
                      }
                    }}
                    placeholder={tags.length ? "" : "태그 입력 후 Enter"}
                    className="flex-1 min-w-[8rem] bg-transparent text-sm outline-none py-1"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {RECOMMENDED_TAGS.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => addTag(t)}
                      className="px-2.5 py-1 rounded-full text-xs border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search aliases — admin-only, hidden bilingual search keywords */}
              {user?.role === "admin" && (
                <div className="space-y-1.5">
                  <Label>검색 별칭 (관리자 전용, 선택)</Label>
                  <Input
                    value={searchAliases}
                    onChange={(e) => setSearchAliases(e.target.value)}
                    placeholder="코르티스, cortis, 코티"
                  />
                  <p className="text-xs text-muted-foreground">
                    표기 변형을 쉼표로 구분해 입력하세요. 화면에는 안 보이고 검색에만 쓰입니다 (한글↔영문 검색 대응).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Departure Settings — 인원·요금은 기본값 자동(차량 확정 후 편집) */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">출발 설정</h2>
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

              {/* 번개팅 설정 — 모드 ON일 때만. 성별·나이·성비 (spec §2) */}
              {bungaetingMode && (
                <div className="space-y-4 rounded-xl border border-[#FEE500]/60 bg-[#FFFDF5] p-4">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="h-4 w-4" /> 번개팅 설정
                  </div>

                  <div className="space-y-1.5">
                    <Label>성비 모드</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {GENDER_MODE_OPTIONS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setGenderMode(m)}
                          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                            genderMode === m ? "bg-black text-white border-black" : "border-border text-muted-foreground"
                          }`}
                        >
                          {GENDER_MODE_LABELS[m]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isHalf && (
                    <p className="text-xs text-muted-foreground">
                      남녀 동수로 모집돼요. 좌석 수는 차량 확정 시 정해집니다.
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>나이 하한 (선택)</Label>
                      <Input type="number" min={0} max={120} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="예: 27" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>나이 상한 (선택)</Label>
                      <Input type="number" min={0} max={120} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="예: 35" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>카카오 오픈채팅 링크 (선택)</Label>
                    <Input value={openChatUrl} onChange={(e) => setOpenChatUrl(e.target.value)} placeholder="https://open.kakao.com/o/..." />
                    <p className="text-xs text-muted-foreground">
                      확정된 참가자에게만 공개돼요. 직접 오픈채팅방을 만들어 링크를 붙여넣으세요.
                    </p>
                  </div>
                </div>
              )}

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
                  <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">출발 설정</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">인원 (기본값)</span>
                      <span>
                        최소 {(bungaetingMode ? BUNGAETING_DEFAULTS : STANDARD_DEFAULTS).minCount}명 / 최대{" "}
                        {(bungaetingMode ? BUNGAETING_DEFAULTS : STANDARD_DEFAULTS).maxCount}명
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">요금 (기본값)</span>
                      <span className="font-semibold text-primary">
                        {(bungaetingMode ? BUNGAETING_DEFAULTS : STANDARD_DEFAULTS).price.toLocaleString()}원
                      </span>
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
                {bungaetingMode && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> 번개팅 설정
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">성비 모드</span>
                          <span>{GENDER_MODE_LABELS[genderMode]}</span>
                        </div>
                        {isHalf && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">정원 / 최소 (기본값)</span>
                            <span>남 {derivedCap}({derivedMin}) · 여 {derivedCap}({derivedMin})</span>
                          </div>
                        )}
                        {(ageMin || ageMax) && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">나이대</span>
                            <span>{ageMin || ""}~{ageMax || ""}세</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">오픈채팅</span>
                          <span>{openChatUrl.trim() ? "링크 등록됨" : "미입력"}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
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
              {isSubmitting ? "생성 중..." : bungaetingMode ? "번개팅 회차 개설하기 ✨" : "셔틀 개설하기 🚌"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
