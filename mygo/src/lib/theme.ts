// 主题色引擎：预设色板 + 自定义色。对齐 docs/ui-redesign-preview.html 的 THEME ENGINE。
// 机制：把一组 --accent* 变量写到 <html> 的内联样式上，覆盖 globals.css :root 里的默认橙。
// 选择持久化到 localStorage（键 mile-accent）。

export type PresetName = "orange" | "blue" | "emerald" | "violet" | "rose" | "slate";
/** 预设名，或 "custom:#RRGGBB" */
export type ThemeId = PresetName | `custom:#${string}`;

export const THEME_STORAGE_KEY = "mile-accent";
export const DEFAULT_THEME: PresetName = "orange";

export const PRESETS: ReadonlyArray<Readonly<{ id: PresetName; label: string; hex: string }>> = [
  { id: "orange", label: "品牌橙", hex: "#FA7B29" },
  { id: "blue", label: "蓝色", hex: "#2563EB" },
  { id: "emerald", label: "绿色", hex: "#059669" },
  { id: "violet", label: "紫色", hex: "#7C3AED" },
  { id: "rose", label: "红色", hex: "#E11D48" },
  { id: "slate", label: "石墨", hex: "#475569" },
];

type Palette = Readonly<{
  accent: string;
  deep: string;
  soft: string;
  softInk: string;
}>;

// 预设的深色/浅色衍生值取自设计稿，保证与稿面一比一
const PRESET_PALETTES: Readonly<Record<PresetName, Palette>> = {
  orange: { accent: "#FA7B29", deep: "#D96110", soft: "#FFF3EB", softInk: "#B4480A" },
  blue: { accent: "#2563EB", deep: "#1D4ED8", soft: "#EFF6FF", softInk: "#1E40AF" },
  emerald: { accent: "#059669", deep: "#047857", soft: "#ECFDF5", softInk: "#065F46" },
  violet: { accent: "#7C3AED", deep: "#6D28D9", soft: "#F5F3FF", softInk: "#5B21B6" },
  rose: { accent: "#E11D48", deep: "#BE123C", soft: "#FFF1F2", softInk: "#9F1239" },
  slate: { accent: "#475569", deep: "#334155", soft: "#F1F5F9", softInk: "#1E293B" },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 相对亮度 */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** amount > 0 向白靠近，< 0 向黑靠近 */
export function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  const [r, g, b] = parseHex(hex).map((v) => Math.round(v + (target - v) * p));
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 主色过暗时承载不了白字：提亮直到亮度 >= 0.30（最多 3 次，每次 12%）。注意：这里是「过亮」不适用的反向规则，保持设计稿行为。 */
export function accessibleAccent(hex: string): string {
  let c = hex.toUpperCase();
  for (let i = 0; i < 3 && luminance(c) < 0.3; i++) c = shade(c, 0.12);
  return c;
}

export function isThemeId(value: string | null): value is ThemeId {
  if (!value) return false;
  if (value.startsWith("custom:")) return HEX_RE.test(value.slice(7));
  return PRESETS.some((p) => p.id === value);
}

export function customHexOf(id: ThemeId): string | null {
  return id.startsWith("custom:") ? id.slice(7) : null;
}

function buildPalette(id: ThemeId): Palette {
  const custom = customHexOf(id);
  if (custom === null) return PRESET_PALETTES[id as PresetName];
  const accent = accessibleAccent(custom);
  return {
    accent,
    deep: shade(accent, -0.18),
    soft: shade(accent, 0.92),
    softInk: shade(accent, -0.35),
  };
}

/** 当前主题的触发器圆点色 */
export function swatchOf(id: ThemeId): string {
  return buildPalette(id).accent;
}

export function applyTheme(id: ThemeId): void {
  const p = buildPalette(id);
  const s = document.documentElement.style;
  s.setProperty("--accent", p.accent);
  s.setProperty("--accent-deep", p.deep);
  s.setProperty("--accent-soft", p.soft);
  s.setProperty("--accent-soft-ink", p.softInk);
  s.setProperty("--accent-tint-hover", rgba(p.accent, 0.08));
  s.setProperty("--accent-tint-press", rgba(p.accent, 0.16));
  s.setProperty("--accent-glow", rgba(p.accent, 0.2));
  s.setProperty("--accent-row-tint", rgba(p.accent, 0.04));
  s.setProperty("--shadow-accent-rest", `0 6px 16px ${rgba(p.accent, 0.35)}`);
  s.setProperty("--shadow-accent-hover", `0 12px 26px ${rgba(p.accent, 0.4)}`);
  s.setProperty("--shadow-accent-press", `0 3px 8px ${rgba(p.accent, 0.35)}`);
  s.setProperty("--ring-focus-soft", `0 0 0 3px ${rgba(p.accent, 0.25)}`);
}

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // WebView 禁用存储时只是不持久化，不影响当次使用
  }
}
