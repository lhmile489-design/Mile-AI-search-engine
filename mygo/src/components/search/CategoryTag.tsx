// 信源分类标签。分类展示名来自 /api/config 的 scopes，未知分类原样显示。

export type CategoryTagProps = Readonly<{ label: string }>;

export function CategoryTag({ label }: CategoryTagProps) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-soft-ink">
      {label}
    </span>
  );
}
