"""单元测试：/api/search/stream 路由校验逻辑（不调外部 API）。"""

import pytest
from fastapi.testclient import TestClient
from app.main import app


def test_search_missing_query():
    client = TestClient(app)
    res = client.post("/api/search/stream", json={
        "focusMode": "web", "engine": "tavily", "scopeFilters": []
    })
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == 40001


def test_search_empty_query():
    client = TestClient(app)
    res = client.post("/api/search/stream", json={
        "query": "   ", "focusMode": "web", "engine": "tavily"
    })
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == 40001
    assert body["data"]["field"] == "query"


def test_search_invalid_focus_mode():
    client = TestClient(app)
    res = client.post("/api/search/stream", json={
        "query": "test", "focusMode": "invalid", "engine": "tavily"
    })
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == 40001


def test_search_invalid_engine():
    client = TestClient(app)
    res = client.post("/api/search/stream", json={
        "query": "test", "focusMode": "web", "engine": "bing"
    })
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == 40001


def test_search_invalid_scope_filter():
    client = TestClient(app)
    res = client.post("/api/search/stream", json={
        "query": "test", "focusMode": "web", "engine": "tavily",
        "scopeFilters": ["unknown_scope"]
    })
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == 40001


def test_search_engine_not_configured():
    """未配置密钥的引擎应返回 40002。"""
    import os
    # 临时清除密钥（如果有）
    from app.config import get_settings
    settings = get_settings()

    # 如果 tavily 未配置，直接测试
    if not settings.tavily_api_key:
        client = TestClient(app)
        res = client.post("/api/search/stream", json={
            "query": "test", "focusMode": "web", "engine": "tavily"
        })
        assert res.status_code == 400
        assert res.json()["code"] == 40002


def test_search_invalid_json():
    client = TestClient(app)
    res = client.post(
        "/api/search/stream",
        content="not json",
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == 40001


def test_suggestions_endpoint():
    client = TestClient(app)
    res = client.get("/api/suggestions")
    assert res.status_code == 200
    body = res.json()
    assert body["code"] == 200
    assert "items" in body["data"]
    assert len(body["data"]["items"]) >= 3


def test_config_endpoint():
    client = TestClient(app)
    res = client.get("/api/config")
    assert res.status_code == 200
    body = res.json()
    data = body["data"]
    assert "focusModes" in data
    assert "scopes" in data
    assert "engines" in data


def test_history_list_empty():
    with TestClient(app) as client:
        res = client.get("/api/history")
    assert res.status_code == 200
    body = res.json()
    assert body["code"] == 200
    assert "total" in body["data"]
    assert "records" in body["data"]


def test_history_not_found():
    with TestClient(app) as client:
        res = client.get("/api/history/hist_nonexistent")
    assert res.status_code == 404
    body = res.json()
    assert body["code"] == 40401


def test_history_delete_not_found():
    with TestClient(app) as client:
        res = client.delete("/api/history/hist_nonexistent")
    assert res.status_code == 404
    body = res.json()
    assert body["code"] == 40401
