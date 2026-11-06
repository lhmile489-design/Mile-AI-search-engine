import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UiPreview } from "./UiPreview";

// 基础组件预览页，只在开发环境可访问。
// 生产构建时 NODE_ENV 为 production，预渲染直接走 notFound()，线上访问是 404。
export const metadata: Metadata = {
  title: "UI 预览 · 仅开发环境",
  robots: { index: false, follow: false },
};

export default function UiPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiPreview />;
}
