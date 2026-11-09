"""历史记录接口（§13.2–13.4）。"""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.db import delete_history_by_id, get_history_by_id, get_history_list

router = APIRouter()


@router.get("/history")
async def list_history(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=20, ge=1, le=50),
    q: str | None = Query(default=None),
) -> JSONResponse:
    result = await get_history_list(page=page, page_size=pageSize, q=q)
    return JSONResponse({"code": 200, "msg": "ok", "data": result})


@router.get("/history/{history_id}")
async def get_history(history_id: str) -> JSONResponse:
    row = await get_history_by_id(history_id)
    if row is None:
        return JSONResponse(
            status_code=404,
            content={"code": 40401, "msg": f"历史记录 {history_id} 不存在", "data": None},
        )
    return JSONResponse({"code": 200, "msg": "ok", "data": row})


@router.delete("/history/{history_id}")
async def delete_history(history_id: str) -> JSONResponse:
    deleted = await delete_history_by_id(history_id)
    if not deleted:
        return JSONResponse(
            status_code=404,
            content={"code": 40401, "msg": f"历史记录 {history_id} 不存在", "data": None},
        )
    return JSONResponse({"code": 200, "msg": "ok", "data": {"deleted": True}})
