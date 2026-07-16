import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ARRIVAL_PREF_OPTIONS, CATEGORY_CHIPS } from "@/lib/constants";
import { CalendarPlus } from "lucide-react";

// 이벤트 만들기 — 번개고에 아직 등록되지 않은 행사의 셔틀을 신청하는 요청서.
// 운영자가 검토 후 실제 이벤트/셔틀로 개설한다 (관리자 콘솔 '신청' 탭에서 확인).
const CATEGORIES = CATEGORY_CHIPS.filter((c) => c.key !== "all");

export default function EventRequestPage() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [destination, setDestination] = useState("");
  const [origin, setOrigin] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [arrivalPref, setArrivalPref] = useState("");
  const [arrivalNote, setArrivalNote] = useState("");
  const [inquiry, setInquiry] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const create = trpc.eventRequests.create.useMutation({
    onSuccess: () => {
      toast.success("이벤트 신청이 접수됐어요! 검토 후 연락드릴게요.");
      navigate("/");
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading) return <div className="container py-16 text-center text-muted-foreground">불러오는 중…</div>;
  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">이벤트 신청은 로그인 후 이용할 수 있어요.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl("/event-request")}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  const canSubmit =
    category && title.trim().length >= 2 && startDate && destination.trim().length >= 2 &&
    origin.trim().length >= 2 && arrivalPref && phone.trim().length >= 9 &&
    /.+@.+\..+/.test(email.trim()) && (arrivalPref !== "etc" || arrivalNote.trim()) && !create.isPending;

  return (
    <div className="container max-w-md py-6 space-y-5 pb-10">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          <CalendarPlus className="h-5 w-5 text-primary" /> 이벤트 만들기
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          번개고에 없는 행사도 신청하면 셔틀을 준비해 드려요. 모든 행사 신청 가능!
        </p>
      </div>

      {/* 1. 카테고리 */}
      <section className="space-y-2">
        <Label className="font-semibold">1. 카테고리를 선택해 주세요 *</Label>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                category === c.key
                  ? "bg-primary text-black border-primary font-semibold"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </section>

      {/* 2. 행사명 */}
      <section className="space-y-1.5">
        <Label className="font-semibold">2. 행사명 또는 모임명을 작성해 주세요 *</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="예: OO 콘서트, OO 박람회" />
      </section>

      {/* 3. 일정 */}
      <section className="space-y-1.5">
        <Label className="font-semibold">3. 행사 일정을 작성해 주세요 *</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">시작일</span>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">시작 시각</span>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">종료일</span>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">종료 시각</span>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
      </section>

      {/* 4. 목적지 */}
      <section className="space-y-1.5">
        <Label className="font-semibold">4. 도착하는 목적지를 작성해 주세요 *</Label>
        <Input value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={300} placeholder="예: 부산 사직야구장" />
      </section>

      {/* 5. 출발 위치 */}
      <section className="space-y-1.5">
        <Label className="font-semibold">5. 출발하는 위치를 작성해 주세요 *</Label>
        <Input value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={300} placeholder="예: 창원시청, 강남역" />
      </section>

      {/* 6. 도착 희망 시간/사유 */}
      <section className="space-y-3">
        <Label className="font-semibold">6. 도착하길 원하는 시간과 이유를 알려주세요 *</Label>

        {/* 희망 도착 시각 — 가장 위에서 선택 */}
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">희망 도착 시각 (선택)</span>
          <Input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
        </div>

        {/* 이유를 알려주세요 */}
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">이유를 알려주세요</span>
          <RadioGroup value={arrivalPref} onValueChange={setArrivalPref} className="space-y-1.5">
            {ARRIVAL_PREF_OPTIONS.map((o) => (
              <label
                key={o.key}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                  arrivalPref === o.key ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <RadioGroupItem value={o.key} />
                {o.label}
              </label>
            ))}
          </RadioGroup>
          {arrivalPref && (
            <Input
              value={arrivalNote}
              onChange={(e) => setArrivalNote(e.target.value)}
              maxLength={300}
              placeholder={arrivalPref === "etc" ? "이유를 적어주세요" : "추가로 전하고 싶은 이유가 있다면 적어주세요 (선택)"}
            />
          )}
        </div>
      </section>

      {/* 7. 추가 문의 */}
      <section className="space-y-1.5">
        <Label className="font-semibold">7. 번개고 셔틀에 추가로 문의하고 싶은 내용 (선택)</Label>
        <Textarea value={inquiry} onChange={(e) => setInquiry(e.target.value)} maxLength={500} rows={3} placeholder="자유롭게 적어주세요" />
      </section>

      {/* 8. 연락처 */}
      <section className="space-y-1.5">
        <Label className="font-semibold">8. 연락받을 전화번호와 이메일을 작성해 주세요 *</Label>
        <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="010-0000-0000" />
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} placeholder="example@email.com" />
      </section>

      <Button
        className="w-full h-12 text-base font-semibold"
        disabled={!canSubmit}
        onClick={() =>
          create.mutate({
            category,
            title: title.trim(),
            startDate,
            startTime: startTime || undefined,
            endDate: endDate || undefined,
            endTime: endTime || undefined,
            destination: destination.trim(),
            origin: origin.trim(),
            arrivalTime: arrivalTime || undefined,
            arrivalPreference: arrivalPref as "md_sale" | "ktx" | "ticket_booth" | "flexible" | "etc",
            arrivalNote: arrivalNote.trim() || undefined,
            inquiry: inquiry.trim() || undefined,
            phone: phone.trim(),
            email: email.trim(),
          })
        }
      >
        {create.isPending ? "접수 중…" : "이벤트 신청하기"}
      </Button>
    </div>
  );
}
