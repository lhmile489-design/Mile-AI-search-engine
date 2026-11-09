"""POST /api/search/stream 路由（§2）。

校验在建立 SSE 之前完成，失败直接返回 400（§2.2）。
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator, model_validator

from app.config import get_settings
from app.pipeline.stream import run_pipeline

router = APIRouter()

_VALID_FOCUS_MODES = {"academic", "code", "web"}
_VALID_ENGINES = {"tavily", "deepseek"}
_VALID_SCOPES = {"preprint", "code", "spec", "docs", "blog"}


class SearchRequest(BaseModel):
    query: str
    focusMode: str
    engine: str
    scopeFilters: list[str] = []

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 500:
            raise ValueError("query 去掉首尾空白后长度必须在 1 到 500 之间")
        return v

    @field_validator("focusMode")
    @classmethod
    def validate_focus_mode(cls, v: str) -> str:
        if v not in _VALID_FOCUS_MODES:
            raise ValueError(f"focusMode 必须是 {sorted(_VALID_FOCUS_MODES)} 之一")
        return v

    @field_validator("engine")
    @classmethod
    def validate_engine(cls, v: str) -> str:
        if v not in _VALID_ENGINES:
            raise ValueError(f"engine 必须是 {sorted(_VALID_ENGINES)} 之一")
        return v

    @field_validator("scopeFilters")
    @classmethod
    def validate_scope_filters(cls, v: list[str]) -> list[str]:
        unknown = set(v) - _VALID_SCOPES
        if unknown:
            raise ValueError(f"scopeFilters 含未知类别: {sorted(unknown)}")
        return list(set(v))[:5]  # 去重，最多 5 项


def _err(code: int, msg: str, field: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"code": code, "msg": msg, "data": {"field": field}},
    )


@router.post("/search/stream", response_model=None)
async def search_stream(request: Request) -> StreamingResponse | JSONResponse:
    """发起检索，返回 SSE 流。"""
    # 尝试解析请求体
    try:
        body = await request.json()
    except Exception:
        return _err(40001, "请求体不是合法 JSON", None)

    # Pydantic 校验
    try:
        req = SearchRequest.model_validate(body)
    except Exception as exc:
        # 提取第一个错误的字段
        field = None
        try:
            errors = exc.errors()
            if errors:
                loc = errors[0].get("loc", ())
                field = loc[-1] if loc else None
                msg = errors[0].get("msg", str(exc))
            else:
                msg = str(exc)
        except Exception:
            msg = str(exc)
        return _err(40001, msg, field)

    # 检查引擎密钥是否已配置
    settings = get_settings()
    if req.engine == "tavily" and not settings.tavily_api_key:
        return _err(40002, "引擎 tavily 未配置密钥", "engine")
    if req.engine == "deepseek" and not settings.llm_api_key:
        return _err(40002, "引擎 deepseek 未配置密钥", "engine")

    async def _stream():
        async for frame in run_pipeline(
            request=request,
            query=req.query,
            focus_mode=req.focusMode,
            engine=req.engine,
            scope_filters=req.scopeFilters,
        ):
            yield frame

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
