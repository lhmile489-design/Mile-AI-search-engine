
import { RotateCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { UiError } from "@/store/state";

// 提示条：顶层玻璃浮窗（DESIGN.md §7），左侧语义色图标。
// 与 DESIGN 的「3-5 秒自动消失」不同：错误提示承载「原因 + 下一步」，必须停留到用户处理，
// 所以不自动消失，只能手动关闭。可重试的错误带「重试」按钮，重试 = 用同一问题重新发起。

export type ErrorBannerProps = Readonly<{
  error: UiError;
  onRetry: () => void;
  onDismiss: () => void;
}>;

export function ErrorBanner({ error, onRetry, onDismiss }: ErrorBannerProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-toast flex justify-center px-5">
      <div
        role="alert"
        className="glass-float pointer-events-auto flex w-full max-w-pipeline items-start gap-4 rounded-card px-6 py-4"
      >
        <TriangleAlert size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-ui font-semibold text-ink">{error.title}</p>
          <p className="mt-1 text-sm text-ink-soft">{error.hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error.retryable ? (
            <Button variant="secondary" icon={RotateCw} onClick={onRetry}>
              重试
            </Button>
          ) : null}
          <Button variant="ghost" icon={X} aria-label="关闭提示" onClick={onDismiss} />
        </div>
      </div>
    </div>
  );
}
