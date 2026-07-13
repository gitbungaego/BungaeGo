import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { GENDER_MODE_OPTIONS, GENDER_MODE_LABELS } from "@/lib/bungaeting";

// 선호 등록 (spec §2): 조건에 맞는 회차가 열리면 SMS 알림. 알림 채널은 mock(console.log).
export default function BungaetingPreferences() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: pref, isLoading } = trpc.bungaeting.preferences.get.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });

  const [genderMode, setGenderMode] = useState<string>("");
  const [ageMin, setAgeMin] = useState<string>("");
  const [ageMax, setAgeMax] = useState<string>("");
  const [region, setRegion] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);

  // 기존 선호값 로드.
  useEffect(() => {
    if (pref) {
      setGenderMode(pref.preferredGenderMode ?? "");
      setAgeMin(pref.preferredAgeMin != null ? String(pref.preferredAgeMin) : "");
      setAgeMax(pref.preferredAgeMax != null ? String(pref.preferredAgeMax) : "");
      setRegion(pref.preferredRegion ?? "");
      setSmsOptIn(pref.smsOptIn);
    }
  }, [pref]);

  const upsert = trpc.bungaeting.preferences.upsert.useMutation({
    onSuccess: async () => {
      await utils.bungaeting.preferences.get.invalidate();
      toast.success("선호 설정을 저장했어요.");
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading || (isAuthenticated && isLoading)) {
    return <div className="container py-16 text-center text-muted-foreground">불러오는 중…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">로그인 후 이용할 수 있어요.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl("/bungaeting/preferences")}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-md py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold">선호 설정</h1>
        <p className="text-sm text-muted-foreground">
          조건에 맞는 회차가 열리면 알림을 받을 수 있어요.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-white p-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">선호 성비 모드</Label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setGenderMode("")}
              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                genderMode === "" ? "bg-black text-white border-black" : "border-border text-muted-foreground"
              }`}
            >
              상관없음
            </button>
            {GENDER_MODE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setGenderMode(m)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  genderMode === m ? "bg-black text-white border-black" : "border-border text-muted-foreground"
                }`}
              >
                {GENDER_MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">선호 나이 (최소)</Label>
            <Input type="number" min={0} max={120} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="예: 27" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">선호 나이 (최대)</Label>
            <Input type="number" min={0} max={120} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="예: 35" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">관심 지역 (선택)</Label>
          <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="예: 부산, 창원" />
        </div>

        <label className="flex items-center justify-between pt-1 cursor-pointer">
          <span className="text-sm">알림 받기 (SMS)</span>
          <Switch checked={smsOptIn} onCheckedChange={setSmsOptIn} />
        </label>
      </section>

      <Button
        className="w-full bg-[#FEE500] hover:bg-[#FDD800] text-black border-0"
        disabled={upsert.isPending}
        onClick={() =>
          upsert.mutate({
            preferredGenderMode: genderMode ? (genderMode as "any" | "half" | "female_only" | "male_only") : null,
            preferredAgeMin: ageMin ? Number(ageMin) : null,
            preferredAgeMax: ageMax ? Number(ageMax) : null,
            preferredRegion: region.trim() || null,
            smsOptIn,
          })
        }
      >
        {upsert.isPending ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}
