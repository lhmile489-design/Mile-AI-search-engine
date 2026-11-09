
import { useState } from "react";
import { Globe } from "lucide-react";

// 信源 favicon：16px。没有地址或加载失败时显示占位图标，不出现破图。

export type FaviconProps = Readonly<{ url: string | null }>;

export function Favicon({ url }: FaviconProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) {
    return <Globe size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />;
  }
  return (
    // 外部站点图标，域名不可预知，无法走 next/image 的 remotePatterns
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-4 w-4 shrink-0 rounded-xs"
      onError={() => setFailedUrl(url)}
    />
  );
}
