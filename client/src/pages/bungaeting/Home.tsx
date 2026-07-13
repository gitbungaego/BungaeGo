import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Sparkles, Users } from "lucide-react";
import { GENDER_MODE_LABELS } from "@/lib/bungaeting";
import { formatDateTime, formatPrice } from "@/lib/constants";

// 번개팅 홈 (spec §3-1): 번개팅 회차 카드 리스트.
// 회차(트립) 데이터는 §2단계(트립 생성)에서 붙는다 — 지금은 프로필 게이트 + 빈 상태.
export default function BungaetingHome() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const { data: profile, isLoading: profileLoading } = trpc.bungaeting.profile.me.useQuery(
    undefined,
    { enabled: isAuthenticated, retry: false }
  );

  const { data: trips } = trpc.bungaeting.trips.list.useQuery(undefined, {
    enabled: isAuthenticated && !!profile,
    retry: false,
  });

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

      {!trips || trips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          아직 열린 번개팅 회차가 없어요.
          <br />
          원하는 행사·날짜를 제안하면 회차가 열릴 수 있어요.
        </div>
      ) : (
        <div className="space-y-3">
          {trips.map((t) => (
            <Link
              key={t.id}
              href={`/bungaeting/trips/${t.id}`}
              className="block rounded-xl border border-border bg-white p-4 hover:border-[#FEE500] transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{t.eventTitle}</div>
                  <div className="text-xs text-muted-foreground truncate">{t.venue}</div>
                </div>
                <span className="shrink-0 rounded-full bg-[#FEE500] px-2 py-0.5 text-[11px] font-medium text-black">
                  {GENDER_MODE_LABELS[t.genderMode]}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatDateTime(t.departureAt)}</span>
                <span className="font-medium text-foreground">{formatPrice(t.price)}</span>
                {(t.ageMin != null || t.ageMax != null) && (
                  <span>
                    {t.ageMin ?? ""}~{t.ageMax ?? ""}세
                  </span>
                )}
              </div>

              {/* 잔여석: 반반 모드는 남/여 분리(byGroup), 나머지는 단일 (spec §2-1, §5) */}
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {t.availability.byGroup ? (
                  <span>
                    남 {t.availability.byGroup.M.remaining}석 · 여 {t.availability.byGroup.F.remaining}석
                  </span>
                ) : (
                  <span>잔여 {t.availability.remaining}석</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
