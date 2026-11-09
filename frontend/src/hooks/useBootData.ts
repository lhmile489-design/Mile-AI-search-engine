"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, getSuggestions } from "@/lib/api";
import { FALLBACK_SUGGESTIONS } from "@/lib/fallback";
import type { AppConfig, ConfigOption } from "@/types";

// 启动拉取：/api/config（引擎、范围类别）与 /api/suggestions（推荐问题）。
// 枚举不硬编码；推荐问题接口失败时才退回本地兜底。

export type BootData = Readonly<{
  config: AppConfig | null;
  configFailed: boolean;
  /** 第一个已配置的引擎；config 没拿到或没有可用引擎时为 null */
  engine: string | null;
  suggestions: ReadonlyArray<string>;
  categoryLabel: (category: string) => string;
  /** 重新拉取配置，返回最新结果（提交时发现 engine 缺失会调用） */
  reloadConfig: () => Promise<AppConfig | null>;
}>;

export function pickEngine(config: AppConfig | null): string | null {
  return config?.engines.find((engine) => engine.available)?.value ?? null;
}

export function useBootData(): BootData {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [suggestions, setSuggestions] = useState<ReadonlyArray<string>>(FALLBACK_SUGGESTIONS);
  const configRef = useRef<AppConfig | null>(null);

  const reloadConfig = useCallback(async (): Promise<AppConfig | null> => {
    try {
      const next = await getConfig();
      configRef.current = next;
      setConfig(next);
      setConfigFailed(false);
      return next;
    } catch {
      setConfigFailed(true);
      return configRef.current;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reloadConfig();
    getSuggestions(controller.signal)
      .then((data) => {
        if (data.items.length > 0) setSuggestions(data.items);
      })
      .catch(() => {
        // 保持本地兜底
      });
    return () => controller.abort();
  }, [reloadConfig]);

  const categoryLabel = useCallback(
    (category: string): string => {
      const found = config?.scopes.find((scope: ConfigOption) => scope.value === category);
      return found?.label ?? category;
    },
    [config],
  );

  return {
    config,
    configFailed,
    engine: pickEngine(config),
    suggestions,
    categoryLabel,
    reloadConfig,
  };
}
