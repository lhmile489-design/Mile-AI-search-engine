// 推荐问题接口不可用时的本地兜底。它只是首屏推荐问题，不是检索结果数据。
export const FALLBACK_SUGGESTIONS: ReadonlyArray<string> = [
  "FlashAttention-3 FP8 内核吞吐基准",
  "NVIDIA Hopper TMA 异步拷贝指令优化",
  "vLLM PagedAttention 原理与实现细节",
];
