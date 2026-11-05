// 脚手架占位页：只用于验证设计令牌与 Tailwind 映射已生效。
// M3 由前端 session 替换为三态状态机页面。
export default function Home() {
  return (
    <main className="mx-auto max-w-command px-5 py-20">
      <h1 className="text-display font-bold leading-tight">Mile AI Search</h1>
      <p className="mt-4 max-w-lead text-base text-ink-soft">
        前端脚手架已就绪。设计令牌来自 DESIGN.md，本页将在 M3 替换为首屏命令台。
      </p>
      <div className="mt-8 rounded-card bg-surface p-6 shadow-e3">
        <span className="inline-flex items-center rounded-pill bg-accent-soft px-3 py-1 text-sm font-semibold text-accent-soft-ink shadow-e1">
          elevation-3 面板
        </span>
        <p className="mt-4 font-mono text-sm text-ink-muted">scaffold · v0.1.0</p>
      </div>
    </main>
  );
}
