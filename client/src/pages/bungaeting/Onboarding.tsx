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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ShieldCheck, Sparkles } from "lucide-react";
import { GENDER_OPTIONS, GENDER_LABELS } from "@/lib/bungaeting";

// 최초 온보딩 (spec §3-2): 본인인증(mock) → 프로필 입력 → 번개팅 약관 동의.
export default function BungaetingOnboarding() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // mock 본인인증 결과(성별·생년월일). 실제로는 인증 기관이 돌려주는 값.
  const [verified, setVerified] = useState(false);
  const [gender, setGender] = useState<"M" | "F" | "">("");
  const [birthDate, setBirthDate] = useState("");

  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [agreeTos, setAgreeTos] = useState(false);

  const { data: profile, isLoading: profileLoading } = trpc.bungaeting.profile.me.useQuery(
    undefined,
    { enabled: isAuthenticated, retry: false }
  );

  const onboard = trpc.bungaeting.profile.onboard.useMutation({
    onSuccess: async () => {
      await utils.bungaeting.profile.me.invalidate();
      toast.success("번개팅 프로필이 생성되었어요!");
      navigate("/bungaeting");
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading || (isAuthenticated && profileLoading)) {
    return <div className="container py-16 text-center text-muted-foreground">불러오는 중…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">번개팅은 로그인 후 이용할 수 있어요.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl("/bungaeting/onboarding")}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  // 이미 프로필이 있으면 홈으로.
  if (profile) {
    navigate("/bungaeting");
    return null;
  }

  const canVerify = gender !== "" && /^\d{4}-\d{2}-\d{2}$/.test(birthDate);
  const canSubmit = verified && nickname.trim().length > 0 && agreeTos && !onboard.isPending;

  return (
    <div className="container max-w-md py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          <Sparkles className="h-5 w-5" /> 번개팅 시작하기
        </h1>
        <p className="text-sm text-muted-foreground">
          함께 탄 사람들과 어울리는 동행 서비스예요. 최초 1회만 설정하면 돼요.
        </p>
      </div>

      {/* 1. 본인인증 (mock) */}
      <section className="rounded-xl border border-border bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <ShieldCheck className="h-4 w-4 text-emerald-600" /> 본인인증
          {verified && <span className="text-xs text-emerald-600 font-medium">완료</span>}
        </div>
        {!verified ? (
          <>
            <p className="text-xs text-muted-foreground">
              성인·실명 확인이 필요해요. (개발용 mock 인증 — 실제 서비스에서는 휴대폰 본인인증)
            </p>
            <div className="space-y-2">
              <Label className="text-xs">성별</Label>
              <RadioGroup
                value={gender}
                onValueChange={(v) => setGender(v as "M" | "F")}
                className="flex gap-4"
              >
                {GENDER_OPTIONS.map((g) => (
                  <label key={g} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <RadioGroupItem value={g} /> {GENDER_LABELS[g]}
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">생년월일</Label>
              <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={!canVerify}
              onClick={() => setVerified(true)}
              className="w-full"
            >
              본인인증 하기 (mock)
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {GENDER_LABELS[gender]} · {birthDate} 인증됨
          </p>
        )}
      </section>

      {/* 2. 프로필 */}
      <section className="rounded-xl border border-border bg-white p-4 space-y-3">
        <div className="font-semibold text-sm">프로필</div>
        <div className="space-y-1.5">
          <Label className="text-xs">닉네임</Label>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={30}
            placeholder="회차에서 보일 이름"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">한 줄 소개 (선택)</Label>
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder="가볍게 자기소개를 남겨보세요"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">프로필 사진 URL (선택)</Label>
          <Input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://…"
          />
          {/* TODO(R2): 실제 사진 업로드는 스토리지 연동 후. 현재는 URL 입력만. */}
          <p className="text-[11px] text-muted-foreground">
            본인 사진만 등록하세요. 타인·선정적 사진은 신고 시 즉시 블라인드됩니다.
          </p>
        </div>
      </section>

      {/* 3. 약관 동의 */}
      <label className="flex items-start gap-2 text-sm cursor-pointer px-1">
        <Checkbox checked={agreeTos} onCheckedChange={(v) => setAgreeTos(v === true)} className="mt-0.5" />
        <span>
          <span className="font-medium">번개팅 이용약관</span>에 동의합니다. (본인 사진만 허용, 타인·선정적
          사진 금지, 위반 신고 시 즉시 블라인드 및 이용 제한)
        </span>
      </label>

      <Button
        className="w-full bg-[#FEE500] hover:bg-[#FDD800] text-black border-0"
        disabled={!canSubmit}
        onClick={() =>
          onboard.mutate({
            nickname: nickname.trim(),
            bio: bio.trim() || undefined,
            photoUrl: photoUrl.trim() || undefined,
            gender: gender as "M" | "F",
            birthDate,
            agreeTos: true,
          })
        }
      >
        {onboard.isPending ? "생성 중…" : "번개팅 시작하기"}
      </Button>
    </div>
  );
}
