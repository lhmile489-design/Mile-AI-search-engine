"""两层进程内 LRU+TTL 缓存（F20，PRD §6.7，契约 §11）。

L1：单个子检索词的原始搜索结果，键为 engine+scopeFilters+sub_query 的 sha256。
L2：整次成功流水线的完整产物，键为 normalize(query)+focusMode+engine+sorted(scopeFilters) 的 sha256。

线程/协程安全：读写通过 asyncio.Lock（L2）和 threading.Lock（L1，search_one 在 asyncio 中调用但
本身是同步代码）。实际上 asyncio 单线程执行，两把锁都能保证正确性。

TTL、maxsize、enabled 开关均从 config 读取，方便测试里设小值。
"""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Any

from app.config import get_settings

# ---------------------------------------------------------------------------
# 通用 LRU+TTL 容器
# ---------------------------------------------------------------------------


class _LruCache:
    """有序字典实现的 LRU+TTL 缓存。非线程安全，由调用方加锁。"""

    def __init__(self, max_size: int, ttl_s: int) -> None:
        self._max_size = max_size
        self._ttl_s = ttl_s
        # (value, expire_at)
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()

    def get(self, key: str) -> Any | None:
        if key not in self._store:
            return None
        value, expire_at = self._store[key]
        if time.monotonic() > expire_at:
            del self._store[key]
            return None
        # 命中：移到末尾（最近使用）
        self._store.move_to_end(key)
        return value

    def set(self, key: str, value: Any) -> None:
        expire_at = time.monotonic() + self._ttl_s
        if key in self._store:
            self._store.move_to_end(key)
            self._store[key] = (value, expire_at)
        else:
            if len(self._store) >= self._max_size:
                # 淘汰最久未使用的（队首）
                self._store.popitem(last=False)
            self._store[key] = (value, expire_at)

    def __len__(self) -> int:
        return len(self._store)


# ---------------------------------------------------------------------------
# 模块级单例（懒初始化，避免测试时 settings 还没 mock）
# ---------------------------------------------------------------------------

_l1: _LruCache | None = None
_l2: _LruCache | None = None

import threading

_l1_lock = threading.Lock()
_l2_lock = threading.Lock()


def _get_l1() -> _LruCache:
    global _l1
    if _l1 is None:
        s = get_settings()
        _l1 = _LruCache(max_size=s.cache_max_size, ttl_s=s.cache_l1_ttl_s)
    return _l1


def _get_l2() -> _LruCache:
    global _l2
    if _l2 is None:
        s = get_settings()
        _l2 = _LruCache(max_size=s.cache_max_size, ttl_s=s.cache_l2_ttl_s)
    return _l2


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------


def get_l1_cached(key: str) -> Any | None:
    """获取 L1 缓存（子检索词结果）。未命中或未开启时返回 None。"""
    if not get_settings().cache_enabled:
        return None
    with _l1_lock:
        return _get_l1().get(key)


def set_l1_cache(key: str, value: Any) -> None:
    """写入 L1 缓存。未开启时忽略。"""
    if not get_settings().cache_enabled:
        return
    with _l1_lock:
        _get_l1().set(key, value)


def get_l2_cached(key: str) -> Any | None:
    """获取 L2 缓存（整次产物）。未命中或未开启时返回 None。"""
    if not get_settings().cache_enabled:
        return None
    with _l2_lock:
        return _get_l2().get(key)


def set_l2_cache(key: str, value: Any) -> None:
    """写入 L2 缓存。未开启时忽略。"""
    if not get_settings().cache_enabled:
        return
    with _l2_lock:
        _get_l2().set(key, value)


def reset_caches() -> None:
    """清空所有缓存（测试用）。"""
    global _l1, _l2
    with _l1_lock:
        _l1 = None
    with _l2_lock:
        _l2 = None
