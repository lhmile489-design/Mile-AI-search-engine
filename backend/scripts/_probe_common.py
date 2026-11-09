"""M0 探测脚本公共工具：读取 backend/.env、脱敏、保存请求与响应样例。

所有脚本用 `uv run python scripts/probe_<依赖>.py` 运行。
.env 按本文件位置锚定到 backend/.env，与当前工作目录无关。
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROBES_DIR = BACKEND_DIR / "docs" / "probes"

sys.path.insert(0, str(BACKEND_DIR))
from app.config import Settings  # noqa: E402

# 所有外部请求统一超时：连接 10s，整体 60s（流式生成另行控制）
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
# 样例中单个字符串的最大保留长度，超出部分截断并注明
MAX_STR = 600


def load_settings() -> Settings:
    return Settings(_env_file=BACKEND_DIR / ".env")


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {k: ("***" if k.lower() == "authorization" else v) for k, v in headers.items()}


def truncate(value: Any, limit: int = MAX_STR) -> Any:
    """递归截断长字符串与长列表，样例文件只用于看结构。"""
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + f"...[截断，原长 {len(value)} 字符]"
    if isinstance(value, list):
        items = [truncate(v, limit) for v in value[:10]]
        if len(value) > 10:
            items.append(f"...[截断，原有 {len(value)} 项]")
        return items
    if isinstance(value, dict):
        return {k: truncate(v, limit) for k, v in value.items()}
    return value


def describe_fields(obj: dict[str, Any]) -> dict[str, str]:
    """返回字段名到「类型: 示例」的映射，用于整理真实字段表。"""
    out: dict[str, str] = {}
    for k, v in obj.items():
        sample = json.dumps(truncate(v, 80), ensure_ascii=False)
        out[k] = f"{type(v).__name__}: {sample[:120]}"
    return out


def parse_body(res: httpx.Response) -> Any:
    try:
        return res.json()
    except ValueError:
        return res.text


def make_record(
    *,
    label: str,
    method: str,
    url: str,
    headers: dict[str, str],
    body: Any,
    status: int | None,
    elapsed_ms: float,
    response: Any,
    note: str | None = None,
) -> dict[str, Any]:
    return {
        "label": label,
        "request": {
            "method": method,
            "url": url,
            "headers": redact_headers(headers),
            "body": truncate(body),
        },
        "status": status,
        "elapsed_ms": round(elapsed_ms, 1),
        "response": truncate(response),
        "note": note,
    }


def timed_request(
    client: httpx.Client, label: str, method: str, url: str, headers: dict[str, str], body: Any = None
) -> tuple[dict[str, Any], httpx.Response | None]:
    """发送一次非流式请求，网络异常也记录下来而不是直接崩溃。"""
    start = time.perf_counter()
    try:
        res = client.request(method, url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        elapsed = (time.perf_counter() - start) * 1000
        rec = make_record(
            label=label, method=method, url=url, headers=headers, body=body,
            status=None, elapsed_ms=elapsed, response=None, note=f"网络异常：{type(exc).__name__}: {exc}",
        )
        return rec, None
    elapsed = (time.perf_counter() - start) * 1000
    rec = make_record(
        label=label, method=method, url=url, headers=headers, body=body,
        status=res.status_code, elapsed_ms=elapsed, response=parse_body(res),
    )
    return rec, res


def save_samples(name: str, records: list[dict[str, Any]], secrets: list[str | None]) -> Path:
    """写入 docs/probes/<name>.json（UTF-8 无 BOM），写前把密钥原文替换成 ***。"""
    PROBES_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        {"probe": name, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "records": records},
        ensure_ascii=False,
        indent=2,
    )
    for s in secrets:
        if s:
            text = text.replace(s, "***")
    path = PROBES_DIR / f"{name}.json"
    path.write_text(text + "\n", encoding="utf-8")
    return path


def print_record(rec: dict[str, Any]) -> None:
    req = rec["request"]
    print(f"[{rec['label']}] {req['method']} {req['url']} -> status={rec['status']} {rec['elapsed_ms']}ms")
    if rec.get("note"):
        print(f"  note: {rec['note']}")


def secret_value(secret: Any) -> str | None:
    return secret.get_secret_value() if secret is not None else None
