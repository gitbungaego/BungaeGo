import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { GENDER_MODE_LABELS } from "@/lib/bungaeting";
import { formatDateTime, formatPrice } from "@/lib/constants";
import { EyeOff, Lock, MessageSquare, Users } from "lucide-react";

// 번개팅 회차 상세 (spec §3-3, §3-4). 참가자 프로필은 확정 트립의 유효 예약자에게만
// 공개된다 — 접근제어는 서버(bungaeting.trips.participants)가 강제하고, 여기선 그 결과를
// 표시만 한다. §4-1 준수: 좋아요/지목/평가/1:1 연결 버튼 없음, 순수 열람.
export default function BungaetingTripDetail({ id }: { id: number }) {
  const { isAuthenticated, loading } = useAuth();

  const { data: trip, isLoading } = trpc.bungaeting.trips.byId.useQuery(
    { id },
    { enabled: isAuthenticated, retry: false }
  );

  const isConfirmed = trip?.status === "confirmed";
  const participantsQuery = trpc.bungaeting.trips.participants.useQuery(
    { tripId: id },
    { enabled: isAuthenticated && isConfirmed, retry: false }
  );

  // 오픈채팅 링크는 서버가 확정 참가자에게만 반환 (participants와 동일 접근제어).
  const openChatQuery = trpc.bungaeting.trips.openChat.useQuery(
    { tripId: id },
    { enabled: isAuthenticated && isConfirmed, retry: false }
  );

  if (loading || (isAuthenticated && isLoading)) {
    return <div className="container py-16 text-center text-muted-foreground">불러오는 중…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="container max-w-md py-16 text-center space-y-4">
        <p className="text-muted-foreground">로그인 후 이용할 수 있어요.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={getLoginUrl(`/bungaeting/trips/${id}`)}>카카오로 3초 로그인</a>
        </Button>
      </div>
    );
  }

  if (!trip) {
    return <div className="container py-16 text-center text-muted-foreground">회차를 찾을 수 없어요.</div>;
  }

  return (
    <div className="container max-w-lg py-6 space-y-5">
      {/* 회차 정보 */}
      <section className="rounded-xl border border-border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-[#FEE500] px-2.5 py-0.5 text-xs font-medium text-black">
            {GENDER_MODE_LABELS[trip.genderMode]}
          </span>
          <span className="text-xs text-muted-foreground">
            {trip.status === "confirmed" ? "확정" : trip.status === "collecting" ? "모집 중" : trip.status}
          </span>
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">출발</span><span>{formatDateTime(trip.departureAt)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">요금</span><span className="font-medium">{formatPrice(trip.price)}</span></div>
          {(trip.ageMin != null || trip.ageMax != null) && (
            <div className="flex justify-between"><span className="text-muted-foreground">나이대</span><span>{trip.ageMin ?? ""}~{trip.ageMax ?? ""}세</span></div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">잔여석</span>
            <span>
              {trip.availability.byGroup
                ? `남 ${trip.availability.byGroup.M.remaining}석 · 여 ${trip.availability.byGroup.F.remaining}석`
                : `${trip.availability.remaining}석`}
            </span>
          </div>
        </div>
      </section>

      {/* 함께 타는 사람들 — 확정 후에만 (spec §3-4) */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <Users className="h-4 w-4" /> 함께 타는 사람들
        </h2>

        {!isConfirmed ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            <Lock className="h-5 w-5 mx-auto mb-2 opacity-60" />
            참가자 정보는 회차 확정 후 공개됩니다.
          </div>
        ) : participantsQuery.isLoading ? (
          <div className="text-center text-sm text-muted-foreground py-6">불러오는 중…</div>
        ) : participantsQuery.error ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            이 회차에 신청한 참가자만 볼 수 있어요.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {participantsQuery.data?.map((p, i) => (
              <div
                key={i}
                className={`rounded-xl border p-3 text-center ${p.isMe ? "border-[#FEE500] bg-[#FFFDF5]" : "border-border bg-white"}`}
              >
                <div className="mx-auto h-16 w-16 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                  {p.blinded ? (
                    <EyeOff className="h-6 w-6 text-muted-foreground" />
                  ) : p.photoUrl ? (
                    <img src={p.photoUrl} alt={p.nickname} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg font-bold">{p.nickname[0]}</span>
                  )}
                </div>
                <div className="mt-2 text-sm font-medium truncate">
                  {p.nickname}
                  {p.isMe && <span className="ml-1 text-[10px] rounded-full bg-[#FEE500] px-1.5 py-0.5 text-black">나</span>}
                </div>
                {p.blinded ? (
                  <div className="text-[11px] text-muted-foreground">신고 검토 중</div>
                ) : (
                  p.bio && <div className="text-[11px] text-muted-foreground truncate">{p.bio}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 카카오 오픈채팅방 입장 — 확정 참가자 + 관리자가 링크를 입력한 경우에만.
          채팅은 외부 카카오 오픈채팅으로 운영, 플랫폼은 링크만 제공 (spec §3-6 축소판). */}
      {isConfirmed && openChatQuery.data?.openChatUrl && (
        <Button asChild className="w-full gap-1.5 bg-[#FEE500] hover:bg-[#FDD800] text-black border-0">
          <a href={openChatQuery.data.openChatUrl} target="_blank" rel="noopener">
            <MessageSquare className="h-4 w-4" /> 회차 오픈채팅방 입장
          </a>
        </Button>
      )}
      {isConfirmed && openChatQuery.data && !openChatQuery.data.openChatUrl && (
        <p className="text-center text-xs text-muted-foreground">
          오픈채팅방 링크는 준비되는 대로 안내드려요.
        </p>
      )}
    </div>
  );
}
