import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

// 번개팅 홈 (spec §3-1): 번개팅 회차 카드 리스트.
// 회차(트립) 데이터는 §2단계(트립 생성)에서 붙는다 — 지금은 프로필 게이트 + 빈 상태.
export default function BungaetingHome() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const { data: profile, isLoading: profileLoading } = trpc.bungaeting.profile.me.useQuery(
    undefined,
    { enabled: isAuthenticated, retry: false }
  );

  // 로그인했지만 프로필이 없으면 최초 온보딩으로 유도 (spec §3-2, 첫 진입 1회).
  useEffect(() => {
    if (isAuthenticated && !profileLoading && profile === null) {
      navigate("/bungaeting/onboarding");
    }
  }, [isAuthenticated, profileLoading, profile, navigate]);

  if (loading || (isAuthenticated && profileLoading)) {
    return <div className="container py-16 text-center text-muted-foreground">불러오는 중…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <Sparkles className="h-10 w-10 mx-auto text-[#FEE500]" />
        <div>
          <h1 className="text-lg font-bold">번개팅</h1>
          <p className="text-sm text-muted-foreground mt-1">
            함께 탄 사람들과 어울리는 동행 서비스. 로그인 후 시작해보세요.
          </p>
        </div>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl("/bungaeting")}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-lg py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold">번개팅 회차</h1>
        <p className="text-sm text-muted-foreground">나이대·성비가 큐레이션된 동행 버스예요.</p>
      </div>

      {/* 빈 상태 — 회차 생성 기능(§2단계) 연결 후 카드 리스트로 대체 */}
      <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        아직 열린 번개팅 회차가 없어요.
        <br />
        원하는 행사·날짜를 제안하면 회차가 열릴 수 있어요.
      </div>
    </div>
  );
}
