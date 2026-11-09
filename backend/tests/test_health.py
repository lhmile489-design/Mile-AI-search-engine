from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_up_and_hides_secrets() -> None:
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["code"] == 200
    assert body["data"]["status"] == "up"
    # 依赖状态只能是布尔值，不能泄露密钥
    assert all(isinstance(v, bool) for v in body["data"]["dependencies"].values())


def test_empty_env_value_counts_as_unconfigured(monkeypatch) -> None:
    from app.config import Settings

    monkeypatch.setenv("LLM_API_KEY", "")
    assert Settings(_env_file=None).llm_api_key is None
