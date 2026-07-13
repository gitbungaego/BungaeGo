import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { GENDER_LABELS } from "@/lib/bungaeting";
import { ShieldCheck } from "lucide-react";

// 내 번개팅 프로필 보기 (온보딩 완료 후). 프로필 없으면 온보딩으로 유도.
export default function BungaetingMe() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const { data: profile, isLoading } = trpc.bungaeting.profile.me.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });

  if (loading || (isAuthenticated && isLoading)) {
    return <div className="container py-16 text-center text-muted-foreground">불러오는 중…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">로그인 후 이용할 수 있어요.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl("/bungaeting/me")}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">아직 번개팅 프로필이 없어요.</p>
        <Button
          className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0"
          onClick={() => navigate("/bungaeting/onboarding")}
        >
          번개팅 시작하기
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-md py-8 space-y-4">
      <div className="rounded-xl border border-border bg-white p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-[#FEE500]/30 overflow-hidden flex items-center justify-center text-xl font-bold">
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.nickname} className="h-full w-full object-cover" />
            ) : (
              profile.nickname[0]
            )}
          </div>
          <div>
            <div className="font-bold text-lg">{profile.nickname}</div>
            <div className="text-xs text-muted-foreground">
              {GENDER_LABELS[profile.gender]}
              {profile.verifiedAt && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-emerald-600">
                  <ShieldCheck className="h-3 w-3" /> 본인인증
                </span>
              )}
            </div>
          </div>
        </div>
        {profile.bio && <p className="text-sm text-foreground/80">{profile.bio}</p>}
      </div>

      <Button variant="outline" className="w-full" onClick={() => navigate("/bungaeting/preferences")}>
        선호 설정 관리
      </Button>
    </div>
  );
}
