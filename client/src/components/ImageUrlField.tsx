import { useEffect, useState } from "react";
import { ImageOff, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ImageUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

/**
 * 이벤트 이미지 URL 입력 + 라이브 미리보기. 파일 업로드(R2)로 승격하기
 * 전까지의 URL 입력 UX: 300ms 디바운스로 16:9 썸네일을 미리 보여주고,
 * 로드 실패·비https는 경고만 하고 저장은 막지 않는다.
 */
export function ImageUrlField({ value, onChange, label = "이미지 URL (선택)" }: ImageUrlFieldProps) {
  const [previewUrl, setPreviewUrl] = useState(value.trim());
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(value.trim() ? "loading" : "idle");

  // status는 URL과 같은 배치에서 리셋한다. 별도 effect로 리셋하면 캐시된
  // 이미지의 onLoad("ok")가 effect보다 먼저 발화해 "loading"으로 덮이는
  // 레이스가 생긴다.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = value.trim();
      setPreviewUrl((prev) => {
        // 같은 URL이면 remount가 없어 onLoad가 다시 안 오므로 상태를 건드리지 않는다.
        if (prev !== next) setStatus(next ? "loading" : "idle");
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [value]);

  const isInsecureHttp = /^http:\/\//i.test(previewUrl);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://..."
        inputMode="url"
      />
      <p className="text-xs text-muted-foreground">
        이미지 주소(URL)를 붙여넣으세요. 공연 포스터 이미지에 우클릭 → 이미지 주소 복사
      </p>

      {isInsecureHttp && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600">
          <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          http:// 주소는 보안 연결(https)이 아니어서 실제 사이트에서 표시되지 않을 수 있어요.
        </p>
      )}

      {previewUrl && (
        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted">
          {status === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImageOff className="h-6 w-6 opacity-40" />
              <p className="text-xs">이미지를 불러올 수 없어요 - 주소를 확인해주세요</p>
            </div>
          ) : (
            // key로 URL 변경 시 재시도. 로드 전에는 투명 처리해 깨진 아이콘 노출 방지.
            <img
              key={previewUrl}
              src={previewUrl}
              alt="이미지 미리보기"
              onLoad={() => setStatus("ok")}
              onError={() => setStatus("error")}
              className={`h-full w-full object-cover transition-opacity ${status === "ok" ? "opacity-100" : "opacity-0"}`}
            />
          )}
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs text-muted-foreground animate-pulse">미리보기 불러오는 중...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
