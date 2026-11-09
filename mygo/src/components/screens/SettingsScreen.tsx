import { useState, type FormEvent } from "react";
import { KeyRound, TriangleAlert, X } from "lucide-react";
import { saveSettings } from "@/lib/api";
import { Button } from "@/components/ui/Button";

// 首次运行设置页（PRODUCT.md §8）：没有可用引擎时引导填写密钥。
// 界面只做表单与校验，密钥用密码型输入、不回显明文、不写日志。
// 保存调 SearchService.SaveSettings；G3 前 Go 返回「未实现」，界面把原因展示出来。

export type SettingsScreenProps = Readonly<{
  onClose: () => void;
  /** 保存成功后调用（G3 接好 SaveSettings 后用于刷新 config） */
  onSaved?: () => void;
}>;

export function SettingsScreen({ onClose, onSaved }: SettingsScreenProps) {
  const [llmKey, setLlmKey] = useState("");
  const [tavilyKey, setTavilyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canSubmit = llmKey.trim() !== "" || tavilyKey.trim() !== "";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 空字符串字段不下发：Go 侧 omitempty，留空表示不修改该项
      await saveSettings({
        llmApiKey: llmKey.trim() || undefined,
        tavilyApiKey: tavilyKey.trim() || undefined,
      });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      // 不回显密钥；只显示 Go 返回的原因（G3 前是「未实现」）
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink opacity-30" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="首次运行设置"
        className="absolute inset-0 flex items-center justify-center p-4"
      >
      <div
        className="w-full max-w-md rounded-card bg-surface p-6 shadow-e4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-accent-soft-ink">
              <KeyRound size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-ink">首次运行设置</h2>
              <p className="text-sm text-ink-muted">配置检索所需的密钥</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-xs p-1 text-ink-faint hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-4 text-ui text-ink-soft">
          没有可用的检索引擎。请至少填入一个密钥，保存后即可开始检索。
        </p>

        <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
          <label className="grid gap-1">
            <span className="text-label text-ink">LLM_API_KEY</span>
            <input
              type="password"
              autoComplete="off"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              placeholder="sk-..."
              className="rounded-md border border-line-input bg-surface px-3 py-2 text-ui text-ink shadow-inset-input focus:shadow-focus-soft focus:outline-none"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-label text-ink">TAVILY_API_KEY</span>
            <input
              type="password"
              autoComplete="off"
              value={tavilyKey}
              onChange={(e) => setTavilyKey(e.target.value)}
              placeholder="tvly-..."
              className="rounded-md border border-line-input bg-surface px-3 py-2 text-ui text-ink shadow-inset-input focus:shadow-focus-soft focus:outline-none"
            />
          </label>

          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
              已保存，可以开始检索。
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              稍后再说
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
