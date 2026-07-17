import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, KAKAO_CHANNEL_CHAT_URL } from "@/const";
import { evaluateCancellation } from "@shared/cancellationPolicy";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatPrice,
  formatDateTime,
  formatDate,
  RESERVATION_STATUS_LABELS,
} from "@/lib/constants";
import {
  Bus,
  Calendar,
  CheckCircle2,
  Copy,
  Gift,
  Heart,
  MapPin,
  MessageCircle,
  Pencil,
  Route as RouteIcon,
  Share2,
  Star,
  Ticket,
  User,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";

export default function MyPage() {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="py-10 container max-w-3xl">
        <Skeleton className="h-32 rounded-2xl mb-6" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-muted-foreground">마이페이지를 보려면 로그인이 필요합니다.</p>
        <Button asChild className="bg-[#FEE500] hover:bg-[#FDD800] text-black">
          <a href={getLoginUrl()}>카카오로 로그인</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="container max-w-3xl">
        {/* Profile Card */}
        <ProfileCard />

        <Tabs defaultValue="reservations">
          <TabsList className="w-full mb-6">
            <TabsTrigger value="reservations" className="flex-1 gap-1.5">
              <Ticket className="h-3.5 w-3.5" />
              예약 내역
            </TabsTrigger>
            <TabsTrigger value="likes" className="flex-1 gap-1.5">
              <Heart className="h-3.5 w-3.5" />
              찜
            </TabsTrigger>
            <TabsTrigger value="requests" className="flex-1 gap-1.5">
              <RouteIcon className="h-3.5 w-3.5" />
              참가 신청
            </TabsTrigger>
            <TabsTrigger value="points" className="flex-1 gap-1.5">
              <Star className="h-3.5 w-3.5" />
              포인트
            </TabsTrigger>
            <TabsTrigger value="referrals" className="flex-1 gap-1.5">
              <Gift className="h-3.5 w-3.5" />
              레퍼럴
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reservations">
            <ReservationsTab />
          </TabsContent>
          <TabsContent value="likes">
            <LikedEventsTab />
          </TabsContent>
          <TabsContent value="requests">
            <RideRequestsTab />
          </TabsContent>
          <TabsContent value="points">
            <PointsTab />
          </TabsContent>
          <TabsContent value="referrals">
            <ReferralsTab />
          </TabsContent>
        </Tabs>

        {/* 고객센터·정보 — 앱 셸엔 푸터가 없으므로 마이페이지 하단에 배치 */}
        <div className="mt-10 pt-6 border-t border-border/60 space-y-3">
          <a
            href={KAKAO_CHANNEL_CHAT_URL}
            target="_blank"
            rel="noopener"
            className="flex items-center justify-between rounded-xl bg-[#FEE500] px-4 py-3 text-sm font-medium text-black active:scale-[0.98] transition-transform"
          >
            <span className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              카카오톡으로 문의하기
            </span>
            <span className="text-black/50 text-xs">1:1 채팅</span>
          </a>
          <p className="text-center text-[11px] text-muted-foreground">
            번개GO — 함께 타면 더 저렴하고, 더 빠르게 · © 2026 번개GO
          </p>
        </div>
      </div>
    </div>
  );
}

// 프로필 카드 — 닉네임은 연필 아이콘으로 자유 수정. 실명/전화(카카오 수집)는 표시만.
function ProfileCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState("");

  const updateNickname = trpc.auth.updateNickname.useMutation({
    onSuccess: () => {
      toast.success("닉네임이 변경되었습니다.");
      setEditing(false);
      utils.auth.me.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const startEdit = () => {
    setNickname(user?.name ?? "");
    setEditing(true);
  };

  const save = () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      toast.error("닉네임을 입력해주세요.");
      return;
    }
    updateNickname.mutate({ name: trimmed });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 mb-6">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-bold flex-shrink-0">
          {user?.name?.[0]?.toUpperCase() ?? "U"}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={30}
                className="h-9"
                placeholder="닉네임"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <Button size="sm" onClick={save} disabled={updateNickname.isPending}>
                저장
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                취소
              </Button>
            </div>
          ) : (
            <h1 className="text-xl font-bold flex items-center gap-1.5">
              <span className="truncate">{user?.name ?? "사용자"}</span>
              <button
                type="button"
                onClick={startEdit}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                aria-label="닉네임 수정"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </h1>
          )}
          <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
          {(user?.realName || user?.phone) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {user?.realName}
              {user?.realName && user?.phone ? " · " : ""}
              {user?.phone}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ReservationsTab() {
  const { data: reservations, isLoading, refetch } = trpc.reservations.myList.useQuery();
  const utils = trpc.useUtils();

  const cancelReservation = trpc.reservations.cancel.useMutation({
    onSuccess: () => {
      toast.success("예약이 취소되었습니다.");
      utils.reservations.myList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }

  if (!reservations || reservations.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Bus className="h-10 w-10 mx-auto mb-3 opacity-20" />
        <p className="font-medium">예약 내역이 없습니다</p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link href="/events">이벤트 보러 가기</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reservations.map((res) => (
        <ReservationCard
          key={res.id}
          reservation={res}
          onCancel={(id) => cancelReservation.mutate({ id })}
          cancelling={cancelReservation.isPending}
        />
      ))}
    </div>
  );
}

function ReservationCard({ reservation, onCancel, cancelling }: { reservation: any; onCancel: (id: number) => void; cancelling: boolean }) {
  const { data: trip } = trpc.trips.byId.useQuery({ id: reservation.tripId });
  const { data: event } = trpc.events.byId.useQuery(
    { id: trip?.eventId ?? 0 },
    { enabled: !!trip }
  );

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-600 border-yellow-200",
    paid: "bg-emerald-50 text-emerald-600 border-emerald-200",
    cancelled: "bg-red-50 text-red-500 border-red-200",
    refunded: "bg-gray-50 text-gray-500 border-gray-200",
  };

  const cancellation = trip
    ? evaluateCancellation(new Date(trip.departureAt), new Date(reservation.createdAt), new Date())
    : undefined;
  // Fare before the points discount was applied — totalAmount already nets
  // pointsUsed out, and the fee only ever applies to the fare portion (points
  // always come back in full via a separate points-ledger entry).
  const fareAmount = reservation.totalAmount + reservation.pointsUsed;
  const expectedRefund =
    cancellation?.allowed ? Math.round(fareAmount * (1 - cancellation.feeRate)) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{event?.title ?? "이벤트 로딩 중..."}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            예약 #{reservation.id} · {reservation.seats}명
          </p>
        </div>
        <Badge variant="outline" className={`text-xs border flex-shrink-0 ${statusColors[reservation.status] ?? ""}`}>
          {RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status}
        </Badge>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          {trip && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateTime(trip.departureAt)}
            </span>
          )}
        </div>
        <span className="font-bold text-primary">{formatPrice(reservation.totalAmount)}</span>
      </div>

      {reservation.status === "paid" && cancellation && (
        <div className="mt-3 pt-3 border-t border-border/60">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {cancellation.allowed
                ? cancellation.feeRate > 0
                  ? `취소 수수료 ${cancellation.feeRate * 100}% · 예상 환불액 ${formatPrice(expectedRefund)}`
                  : `수수료 없음 · 전액 환불 ${formatPrice(expectedRefund)}`
                : cancellation.reason}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/5 text-xs flex-shrink-0"
              onClick={() => onCancel(reservation.id)}
              disabled={cancelling || !cancellation.allowed}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              예약 취소
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-border/60">
        <a
          href={KAKAO_CHANNEL_CHAT_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#FEE500] px-3 py-1.5 text-xs font-medium text-black hover:brightness-95 transition-all"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          예약 관련 문의
        </a>
      </div>
    </div>
  );
}

const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "매칭 대기 중",
  clustered: "매칭 진행 중",
  route_confirmed: "배차 확정!",
  boarded: "탑승 완료",
  failed_refunded: "매칭 실패 (환불됨)",
};

const REQUEST_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-600 border-amber-200",
  clustered: "bg-blue-50 text-blue-600 border-blue-200",
  route_confirmed: "bg-emerald-50 text-emerald-600 border-emerald-200",
  boarded: "bg-emerald-50 text-emerald-600 border-emerald-200",
  failed_refunded: "bg-red-50 text-red-500 border-red-200",
};

// 참가 신청 탭 — 이벤트 신청(미등록 행사 요청) + 셔틀 신청(희망 탑승지 수요) +
// 자동매칭 참가 신청을 한 곳에서 보여준다.
function RideRequestsTab() {
  const { data: requests, isLoading } = trpc.rideRequests.myList.useQuery();
  const { data: eventRequests, isLoading: erLoading } = trpc.eventRequests.myList.useQuery();
  const { data: demands, isLoading: sdLoading } = trpc.shuttleDemands.myList.useQuery();
  const utils = trpc.useUtils();

  const cancelRequest = trpc.rideRequests.cancel.useMutation({
    onSuccess: () => {
      toast.success("참가 신청이 취소되었습니다.");
      utils.rideRequests.myList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || erLoading || sdLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }

  const hasAny =
    (requests?.length ?? 0) > 0 || (eventRequests?.length ?? 0) > 0 || (demands?.length ?? 0) > 0;

  if (!hasAny) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <RouteIcon className="h-10 w-10 mx-auto mb-3 opacity-20" />
        <p className="font-medium">신청 내역이 없습니다</p>
        <div className="flex gap-2 justify-center mt-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/event-request">이벤트 만들기</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/demand">셔틀 만들기</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 이벤트 신청 (미등록 행사 요청서) */}
      {(eventRequests?.length ?? 0) > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">이벤트 신청</h3>
          <div className="space-y-2">
            {eventRequests!.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.startDate}
                      {r.endDate ? ` ~ ${r.endDate}` : ""} · {r.origin} → {r.destination}
                    </p>
                  </div>
                  {r.status === "done" ? (
                    <Badge variant="outline" className="text-xs border bg-emerald-50 text-emerald-600 border-emerald-200 flex-shrink-0">
                      처리완료
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs border bg-amber-50 text-amber-600 border-amber-200 flex-shrink-0">
                      검토 중
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{formatDate(r.createdAt)} 신청</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 셔틀 신청 (희망 탑승지 수요) */}
      {(demands?.length ?? 0) > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">셔틀 신청</h3>
          <div className="space-y-2">
            {demands!.map((d) => (
              <Link key={d.id} href={`/demand/${d.eventId}`}>
                <div className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{d.eventTitle}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {d.stopLabel}
                        {d.neighborhood ? ` (${d.neighborhood})` : ""} 출발 희망
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs border bg-blue-50 text-blue-600 border-blue-200 flex-shrink-0">
                      수요 접수
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">{formatDate(d.createdAt)} 신청 · 눌러서 변경</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 자동매칭 참가 신청 */}
      {(requests?.length ?? 0) > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">참가 신청 (자동매칭)</h3>
          <div className="space-y-3">
            {requests!.map((req) => (
              <RideRequestCard
                key={req.id}
                request={req}
                onCancel={(id) => cancelRequest.mutate({ id })}
                cancelling={cancelRequest.isPending}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RideRequestCard({ request, onCancel, cancelling }: { request: any; onCancel: (id: number) => void; cancelling: boolean }) {
  const { data: event } = trpc.events.byId.useQuery({ id: request.eventId });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{event?.title ?? "이벤트 로딩 중..."}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            신청 #{request.id} · {request.seats}명
          </p>
        </div>
        <Badge variant="outline" className={`text-xs border flex-shrink-0 ${REQUEST_STATUS_COLORS[request.status] ?? ""}`}>
          {REQUEST_STATUS_LABELS[request.status] ?? request.status}
        </Badge>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDateTime(request.targetArrivalAt)}
          </span>
        </div>
        <span className="font-bold text-primary">{formatPrice(request.totalAmount)}</span>
      </div>

      {request.status === "pending" && (
        <div className="mt-3 pt-3 border-t border-border/60 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/5 text-xs"
            onClick={() => onCancel(request.id)}
            disabled={cancelling}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            신청 취소
          </Button>
        </div>
      )}
    </div>
  );
}

function LikedEventsTab() {
  const { data: events, isLoading } = trpc.events.myLikedList.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Heart className="h-10 w-10 mx-auto mb-3 opacity-20" />
        <p className="font-medium">찜한 이벤트가 없습니다</p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link href="/events">이벤트 보러 가기</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <Link key={event.id} href={`/events/${event.id}`}>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:border-primary/40 transition-colors cursor-pointer">
            <div className="h-14 w-14 rounded-lg overflow-hidden bg-muted flex-shrink-0">
              {event.imageUrl ? (
                <img src={event.imageUrl} alt={event.title} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-primary via-amber-400 to-orange-400">
                  <Bus className="h-6 w-6 text-white/70" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{event.title}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {formatDate(event.eventDate)}
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{event.venue}</span>
              </p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function PointsTab() {
  const { data: balance } = trpc.points.myBalance.useQuery();
  const { data: history, isLoading } = trpc.points.myHistory.useQuery();

  return (
    <div className="space-y-4">
      {/* Balance Card */}
      <div className="rounded-xl bg-gradient-to-br from-primary to-purple-500 p-5 text-white">
        <p className="text-sm text-white/80 mb-1">보유 포인트</p>
        <p className="text-3xl font-bold">{(balance?.balance ?? 0).toLocaleString()}P</p>
        <p className="text-xs text-white/60 mt-2">1P = 1원으로 예약 시 사용 가능</p>
      </div>

      {/* History */}
      <div>
        <h3 className="text-sm font-semibold mb-3">포인트 내역</h3>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : history && history.length > 0 ? (
          <div className="space-y-2">
            {history.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div>
                  <p className="text-sm font-medium">{p.description}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</p>
                </div>
                <span className={`text-sm font-bold ${p.amount > 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {p.amount > 0 ? "+" : ""}{p.amount.toLocaleString()}P
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">포인트 내역이 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function ReferralsTab() {
  const { data: referrals, isLoading: refLoading } = trpc.referrals.myList.useQuery();
  const { data: codeData, isLoading: codeLoading } = trpc.referrals.myCode.useQuery();

  // Only completed referrals count toward stats — cancelled ones (e.g. the
  // referring reservation was cancelled and the bonus clawed back) must not
  // inflate the friend count or the earned-points total.
  const completedReferrals = (referrals ?? []).filter((r) => r.status === "completed");

  const shareUrl = codeData?.code
    ? `${window.location.origin}/events?ref=${codeData.code}`
    : "";

  const copyCode = () => {
    if (!codeData?.code) return;
    navigator.clipboard.writeText(codeData.code);
    toast.success("초대 코드가 복사되었습니다!");
  };

  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    toast.success("초대 링크가 복사되었습니다!");
  };

  return (
    <div className="space-y-5">
      {/* Referral Code Card */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="font-semibold mb-1">내 초대 코드</h3>
          <p className="text-xs text-muted-foreground">
            친구가 내 코드로 예약하면 친구 1,000P, 나 2,000P 적립!
          </p>
        </div>

        {codeLoading ? (
          <Skeleton className="h-12 rounded-lg" />
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-border bg-muted/50 px-4 py-3 font-mono text-lg font-bold tracking-widest text-primary text-center">
              {codeData?.code ?? "—"}
            </div>
            <Button variant="outline" size="icon" onClick={copyCode} className="h-12 w-12 flex-shrink-0">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Button variant="outline" className="w-full gap-2" onClick={copyLink}>
          <Share2 className="h-4 w-4" />
          초대 링크 복사
        </Button>
      </div>

      {/* Referral Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-primary">{completedReferrals.length}</p>
          <p className="text-xs text-muted-foreground mt-1">초대한 친구</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-primary">
            {completedReferrals
              .reduce((sum, r) => sum + r.referrerPoints, 0)
              .toLocaleString()}P
          </p>
          <p className="text-xs text-muted-foreground mt-1">레퍼럴 적립 포인트</p>
        </div>
      </div>

      {/* Referral History */}
      {!refLoading && completedReferrals.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">초대 내역</h3>
          <div className="space-y-2">
            {completedReferrals.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-muted-foreground">친구 초대 완료</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
