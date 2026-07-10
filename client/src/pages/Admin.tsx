import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatPrice,
  formatDate,
  formatDateTime,
  CATEGORY_LABELS,
  TRIP_STATUS_LABELS,
  TRIP_STATUS_COLORS,
  RESERVATION_STATUS_LABELS,
} from "@/lib/constants";
import {
  BarChart3,
  Bus,
  Calendar,
  CheckCircle2,
  Route as RouteIcon,
  Shield,
  Ticket,
  Users,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";
import { MatchingTab } from "@/components/admin/MatchingTab";

export default function AdminPage() {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="py-10 container"><Skeleton className="h-64 rounded-2xl" /></div>;
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="py-20 text-center space-y-3">
        <Shield className="h-12 w-12 mx-auto text-muted-foreground/40" />
        <p className="font-semibold">접근 권한이 없습니다</p>
        <p className="text-sm text-muted-foreground">관리자만 접근할 수 있습니다.</p>
        <Button variant="outline" asChild>
          <Link href="/">홈으로</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="container max-w-6xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">관리자 대시보드</h1>
            <p className="text-sm text-muted-foreground">번개GO 플랫폼 관리</p>
          </div>
        </div>

        <StatsCards />

        <Tabs defaultValue="events" className="mt-8">
          <TabsList>
            <TabsTrigger value="events" className="gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              이벤트
            </TabsTrigger>
            <TabsTrigger value="trips" className="gap-1.5">
              <Bus className="h-3.5 w-3.5" />
              셔틀
            </TabsTrigger>
            <TabsTrigger value="reservations" className="gap-1.5">
              <Ticket className="h-3.5 w-3.5" />
              예약
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              사용자
            </TabsTrigger>
            <TabsTrigger value="matching" className="gap-1.5">
              <RouteIcon className="h-3.5 w-3.5" />
              배차 매칭
            </TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-4">
            <EventsTab />
          </TabsContent>
          <TabsContent value="trips" className="mt-4">
            <TripsTab />
          </TabsContent>
          <TabsContent value="reservations" className="mt-4">
            <ReservationsTab />
          </TabsContent>
          <TabsContent value="users" className="mt-4">
            <UsersTab />
          </TabsContent>
          <TabsContent value="matching" className="mt-4">
            <MatchingTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function StatsCards() {
  const { data: stats, isLoading } = trpc.admin.stats.useQuery();

  const cards = [
    { label: "전체 이벤트", value: stats?.totalEvents, sub: `활성 ${stats?.activeEvents ?? 0}개`, icon: <Calendar className="h-5 w-5" />, color: "text-blue-600 bg-blue-50" },
    { label: "전체 셔틀", value: stats?.totalTrips, sub: `확정 ${stats?.confirmedTrips ?? 0}개`, icon: <Bus className="h-5 w-5" />, color: "text-purple-600 bg-purple-50" },
    { label: "전체 예약", value: stats?.totalReservations, sub: `결제 완료 ${stats?.paidReservations ?? 0}건`, icon: <Ticket className="h-5 w-5" />, color: "text-emerald-600 bg-emerald-50" },
    { label: "총 매출", value: stats ? formatPrice(stats.totalRevenue) : "—", sub: `사용자 ${stats?.totalUsers ?? 0}명`, icon: <BarChart3 className="h-5 w-5" />, color: "text-orange-600 bg-orange-50" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-border bg-card p-4">
          <div className={`h-9 w-9 rounded-lg ${card.color} flex items-center justify-center mb-3`}>
            {card.icon}
          </div>
          {isLoading ? (
            <Skeleton className="h-7 w-16 mb-1" />
          ) : (
            <p className="text-2xl font-bold">{card.value ?? "—"}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">{card.label}</p>
          <p className="text-xs text-muted-foreground">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}

function EventsTab() {
  const { data: events, isLoading } = trpc.events.adminList.useQuery();
  const utils = trpc.useUtils();
  const updateStatus = trpc.events.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("이벤트 상태가 업데이트되었습니다.");
      utils.events.adminList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const setAutoMatch = trpc.events.setAutoMatch.useMutation({
    onSuccess: () => {
      toast.success("자동 매칭 설정이 변경되었습니다.");
      utils.events.adminList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이벤트</TableHead>
            <TableHead>카테고리</TableHead>
            <TableHead>날짜</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>배차</TableHead>
            <TableHead className="text-right">관리</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events?.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <div>
                  <p className="font-medium text-sm line-clamp-1">{event.title}</p>
                  <p className="text-xs text-muted-foreground">{event.venue}</p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {CATEGORY_LABELS[event.category] ?? event.category}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(event.eventDate)}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    event.status === "active"
                      ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                      : event.status === "cancelled"
                      ? "bg-red-50 text-red-500 border-red-200"
                      : "bg-gray-50 text-gray-500 border-gray-200"
                  }`}
                >
                  {event.status === "active" ? "활성" : event.status === "cancelled" ? "취소됨" : "완료"}
                </Badge>
              </TableCell>
              <TableCell>
                {event.matchingFrozenAt ? (
                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                    {event.matchingFrozenBy === "auto" ? "자동 동결" : "수동 동결"}
                  </Badge>
                ) : event.autoMatchEnabled ? (
                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-600 border-amber-200">
                    대기중
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {event.status === "active" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 text-destructive border-destructive/30"
                      onClick={() => updateStatus.mutate({ id: event.id, status: "cancelled" })}
                      disabled={updateStatus.isPending}
                    >
                      취소
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className={`text-xs h-7 ${event.autoMatchEnabled ? "text-blue-600 border-blue-300" : ""}`}
                    disabled={setAutoMatch.isPending}
                    onClick={() => {
                      if (event.autoMatchEnabled) {
                        setAutoMatch.mutate({ id: event.id, autoMatchEnabled: false });
                        return;
                      }
                      const priceInput = window.prompt(
                        "자동 매칭 좌석당 가격(원)을 입력하세요.",
                        event.autoMatchPricePerSeat ? String(event.autoMatchPricePerSeat) : ""
                      );
                      if (!priceInput) return;
                      const price = Number(priceInput);
                      if (!Number.isFinite(price) || price < 0) {
                        toast.error("올바른 가격을 입력하세요.");
                        return;
                      }
                      setAutoMatch.mutate({ id: event.id, autoMatchEnabled: true, autoMatchPricePerSeat: price });
                    }}
                  >
                    {event.autoMatchEnabled ? "자동매칭 끄기" : "자동매칭 켜기"}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs h-7" asChild>
                    <Link href={`/events/${event.id}`}>보기</Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TripsTab() {
  const { data: trips, isLoading } = trpc.trips.adminList.useQuery();
  const utils = trpc.useUtils();
  const updateStatus = trpc.trips.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("셔틀 상태가 업데이트되었습니다.");
      utils.trips.adminList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>셔틀 ID</TableHead>
            <TableHead>출발</TableHead>
            <TableHead>인원</TableHead>
            <TableHead>요금</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="text-right">관리</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trips?.map((trip) => (
            <TableRow key={trip.id}>
              <TableCell className="text-sm font-medium">#{trip.id}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(trip.departureAt)}
              </TableCell>
              <TableCell className="text-sm">
                {trip.currentCount}/{trip.maxCount}명
                <span className="text-xs text-muted-foreground ml-1">(최소 {trip.minCount})</span>
              </TableCell>
              <TableCell className="text-sm font-medium">{formatPrice(trip.price)}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-xs border ${TRIP_STATUS_COLORS[trip.status] ?? ""}`}
                >
                  {trip.status === "confirmed" ? "✅ 확정됨!" : TRIP_STATUS_LABELS[trip.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {trip.status === "collecting" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 text-emerald-600 border-emerald-300"
                      onClick={() => updateStatus.mutate({ id: trip.id, status: "confirmed" })}
                      disabled={updateStatus.isPending}
                    >
                      확정
                    </Button>
                  )}
                  {(trip.status === "collecting" || trip.status === "confirmed") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 text-destructive border-destructive/30"
                      onClick={() => updateStatus.mutate({ id: trip.id, status: "cancelled" })}
                      disabled={updateStatus.isPending}
                    >
                      취소
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReservationsTab() {
  const { data: reservations, isLoading } = trpc.reservations.adminList.useQuery();

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>예약 ID</TableHead>
            <TableHead>예약자</TableHead>
            <TableHead>좌석</TableHead>
            <TableHead>금액</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>예약일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reservations?.map((res) => (
            <TableRow key={res.id}>
              <TableCell className="text-sm font-medium">#{res.id}</TableCell>
              <TableCell>
                <div>
                  <p className="text-sm font-medium">{res.passengerName}</p>
                  <p className="text-xs text-muted-foreground">{res.passengerPhone}</p>
                </div>
              </TableCell>
              <TableCell className="text-sm">{res.seats}명</TableCell>
              <TableCell className="text-sm font-medium">{formatPrice(res.totalAmount)}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    res.status === "paid"
                      ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                      : res.status === "cancelled"
                      ? "bg-red-50 text-red-500 border-red-200"
                      : "bg-gray-50 text-gray-500 border-gray-200"
                  }`}
                >
                  {RESERVATION_STATUS_LABELS[res.status] ?? res.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(res.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UsersTab() {
  const { data: users, isLoading } = trpc.admin.users.useQuery();

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>사용자</TableHead>
            <TableHead>이메일</TableHead>
            <TableHead>역할</TableHead>
            <TableHead>포인트</TableHead>
            <TableHead>가입일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users?.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                    {user.name?.[0]?.toUpperCase() ?? "U"}
                  </div>
                  <span className="text-sm font-medium">{user.name ?? "—"}</span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{user.email ?? "—"}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    user.role === "admin"
                      ? "bg-purple-50 text-purple-600 border-purple-200"
                      : "bg-gray-50 text-gray-500 border-gray-200"
                  }`}
                >
                  {user.role === "admin" ? "관리자" : "사용자"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{(user.pointsBalance ?? 0).toLocaleString()}P</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(user.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
