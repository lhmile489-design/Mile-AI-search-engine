"""GET /api/suggestions 接口（§13.6）。"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

_BUILTIN_SUGGESTIONS = [
    "FlashAttention-3 FP8 内核在 Hopper GPU 上的吞吐基准与优化",
    "NVIDIA TMA 异步拷贝指令在 CUDA 内核中的使用方式",
    "大语言模型量化方法 GPTQ、AWQ、SmoothQuant 对比",
    "vLLM PagedAttention 原理与实现细节",
    "Transformer 推理加速：Speculative Decoding 原理与效果",
]


@router.get("/suggestions")
async def get_suggestions() -> JSONResponse:
    return JSONResponse({
        "code": 200,
        "msg": "ok",
        "data": {"items": _BUILTIN_SUGGESTIONS},
    })
