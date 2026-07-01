import { Bus } from "lucide-react";
import { Link } from "wouter";

export default function Footer() {
  return (
    <footer className="border-t border-border/60 bg-muted/30 mt-auto">
      <div className="container py-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <Link href="/" className="flex items-center gap-2">
              <img src="/manus-storage/logo-beonggaego_ed3e311f.png" alt="번개GO" className="h-7 w-7 rounded-lg" />
              <span className="font-bold text-base">
                <span className="text-primary">번개</span>GO
              </span>
            </Link>
            <p className="text-xs text-muted-foreground max-w-xs">
              이벤트 셔틀 크라우드소싱 플랫폼 — 함께 타면 더 저렴하고, 더 빠르게.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <Link href="/events" className="hover:text-foreground transition-colors">이벤트</Link>
            <Link href="/create" className="hover:text-foreground transition-colors">셔틀 만들기</Link>
            <Link href="/mypage" className="hover:text-foreground transition-colors">마이페이지</Link>
            <span>© 2026 번개GO</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
