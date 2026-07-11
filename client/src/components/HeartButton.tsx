import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";

interface HeartButtonProps {
  eventId: number;
  liked: boolean;
  count: number;
  /** Path to return to after a login prompt (defaults to the current URL). */
  returnTo?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Heart/favorite toggle with optimistic UI: the fill + count flip instantly on
 * tap and roll back if the mutation fails. A tap while logged out sends the
 * user through the normal Kakao login flow and returns them to this event.
 */
export function HeartButton({ eventId, liked, count, returnTo, size = "md", className }: HeartButtonProps) {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [optimistic, setOptimistic] = useState({ liked, count });

  // Keep in sync when the server-provided props change (e.g. list refetch).
  useEffect(() => {
    setOptimistic({ liked, count });
  }, [liked, count]);

  const toggle = trpc.events.toggleLike.useMutation({
    onSuccess: (data) => {
      setOptimistic(data);
      utils.events.list.invalidate();
      utils.events.byId.invalidate({ id: eventId });
      utils.events.myLikedList.invalidate();
    },
    onError: (err) => {
      // Roll back to the last known-good props.
      setOptimistic({ liked, count });
      toast.error(err.message || "잠시 후 다시 시도해주세요.");
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    // These buttons live inside clickable cards — never trigger the card's link.
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      const back = returnTo ?? window.location.pathname + window.location.search;
      window.location.href = getLoginUrl(back);
      return;
    }

    // Optimistic flip.
    setOptimistic((prev) => ({
      liked: !prev.liked,
      count: Math.max(0, prev.count + (prev.liked ? -1 : 1)),
    }));
    toggle.mutate({ eventId });
  };

  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={optimistic.liked}
      aria-label={optimistic.liked ? "찜 해제" : "찜하기"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-sm font-medium shadow-sm border border-black/5 transition-colors hover:bg-white",
        size === "sm" && "px-2 py-0.5 text-xs",
        className
      )}
    >
      <Heart
        className={cn(
          iconSize,
          "transition-all",
          optimistic.liked ? "fill-rose-500 text-rose-500 scale-110" : "text-gray-500"
        )}
      />
      {optimistic.count > 0 && <span className="tabular-nums text-gray-700">{optimistic.count}</span>}
    </button>
  );
}
