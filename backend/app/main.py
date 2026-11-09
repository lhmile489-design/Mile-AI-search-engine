"""FastAPI 入口。

lifespan：启动时初始化数据库（执行待执行的迁移脚本）；关闭时关闭连接。
路由：注册所有 /api/* 路由。
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    from app.db import init_db, close_db
    init_db(settings.database_path)
    logger.info("应用启动，数据库: %s", settings.database_path)
    yield
    close_db()
    logger.info("应用关闭")


app = FastAPI(title="Mile AI Search", version="0.1.0", lifespan=lifespan)

# 注册路由
from app.api.search import router as search_router
from app.api.history import router as history_router
from app.api.config import router as config_router
from app.api.suggestions import router as suggestions_router

app.include_router(search_router, prefix="/api")
app.include_router(history_router, prefix="/api")
app.include_router(config_router, prefix="/api")
app.include_router(suggestions_router, prefix="/api")


@app.get("/api/health")
async def health() -> dict:
    settings = get_settings()
    return {
        "code": 200,
        "msg": "ok",
        "data": {
            "status": "up",
            # 只报告是否已配置，不返回任何密钥内容
            "dependencies": {
                "llm": settings.llm_api_key is not None,
                "tavily": settings.tavily_api_key is not None,
                "classifier": settings.classifier_api_key is not None,
            },
        },
    }
