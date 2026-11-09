import type { ErrorEvent } from "@/types";
import type { StreamFailure } from "@/lib/sse";
import type { UiError } from "./state";

// 把各类失败翻成「原因 + 下一步」的提示（PRODUCT.md §8 文案规则）。纯函数，reducer 直接调用。

const RETRY_HINT = "请点击「重试」重新发起检索。";

export function describeStreamFailure(failure: StreamFailure): UiError {
  switch (failure.kind) {
    case "network":
      return {
        title: "检索服务连接失败",
        hint: "请检查网络，并确认后端服务已启动，然后点击「重试」。",
        retryable: true,
        code: null,
        step: null,
      };
    case "timeout":
      return {
        title: `连接超时：${failure.message}`,
        hint: RETRY_HINT,
        retryable: true,
        code: null,
        step: null,
      };
    case "api": {
      const retryable = failure.code !== null && failure.code >= 50000;
      return {
        title: failure.message,
        hint: retryable ? RETRY_HINT : "请修改问题或检索设置后重新提交。",
        retryable,
        code: failure.code,
        step: null,
      };
    }
    case "http":
      return {
        title: `检索服务暂时不可用（HTTP ${failure.status ?? "未知"}）`,
        hint: "请确认后端服务已启动，然后点击「重试」。",
        retryable: true,
        code: null,
        step: null,
      };
    case "protocol":
      return {
        title: "检索服务返回了无法识别的响应",
        hint: RETRY_HINT,
        retryable: true,
        code: null,
        step: null,
      };
  }
}

export function describeErrorEvent(event: ErrorEvent): UiError {
  return {
    title: event.message,
    hint: event.retryable ? RETRY_HINT : "请修改问题后重新提交。",
    retryable: event.retryable,
    code: event.code,
    step: event.step,
  };
}

export function describeStreamClosed(): UiError {
  return {
    title: "检索连接意外中断，结果可能不完整",
    hint: RETRY_HINT,
    retryable: true,
    code: null,
    step: null,
  };
}
