"""GET /api/config 接口（§13.5）。"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import get_settings

router = APIRouter()

_FOCUS_MODES = [
    {"value": "web",      "label": "通用网络",   "description": "综合搜索，适合大多数问题"},
    {"value": "academic", "label": "学术研究",   "description": "偏重预印本、会议论文、权威来源"},
    {"value": "code",     "label": "代码实现",   "description": "偏重代码仓库、文档、包仓库"},
]

_SCOPES = [
    {"value": "preprint", "label": "学术预印本", "description": "arXiv、OpenReview 等"},
    {"value": "code",     "label": "代码仓库",   "description": "GitHub、GitLab 等"},
    {"value": "spec",     "label": "规范与协议", "description": "RFC、W3C、WHATWG 等"},
    {"value": "docs",     "label": "官方文档",   "description": "框架与产品官方文档站"},
    {"value": "blog",     "label": "技术博客",   "description": "博客、评测、社区讨论"},
]


@router.get("/config")
async def get_config() -> JSONResponse:
    settings = get_settings()

    engines = []
    if settings.tavily_api_key:
        engines.append({"value": "tavily",   "label": "Tavily",   "available": True})
    if settings.llm_api_key:
        engines.append({"value": "deepseek", "label": "DeepSeek", "available": True})

    return JSONResponse({
        "code": 200,
        "msg": "ok",
        "data": {
            "focusModes": _FOCUS_MODES,
            "engines": engines,
            "scopes": _SCOPES,
            "version": "0.1.0",
        },
    })
