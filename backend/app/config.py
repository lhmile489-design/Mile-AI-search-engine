"""应用配置：从环境变量与 backend/.env 读取。

密钥字段只在这里定义，日志与接口响应中只暴露「是否已配置」，不暴露值。
外部依赖的模型名、接口地址在 M0 实测后填写，见 .env.example。
"""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # env_ignore_empty：.env 里写成 `KEY=` 的空值按未配置处理，避免健康检查误报
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", env_ignore_empty=True
    )

    app_host: str = "127.0.0.1"
    app_port: int = 8000

    # LLM（OpenAI 兼容接口）。模型名 M0 实测确认为 deepseek-flash。
    llm_api_key: SecretStr | None = None
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-flash"

    # 搜索引擎
    tavily_api_key: SecretStr | None = None

    # 信源分类服务（教程中的 Jev，未确认；留空时 P0 使用本地域名规则）
    classifier_api_key: SecretStr | None = None
    classifier_endpoint: str | None = None

    # SQLite 文件路径
    database_path: str = "data/mile_search.db"

    # 流水线超时（秒）PRD §9.2
    rewrite_timeout_s: float = 15.0
    search_timeout_s: float = 10.0
    classifier_timeout_s: float = 2.5
    generate_first_token_timeout_s: float = 30.0
    finalize_timeout_s: float = 10.0

    # 重排取前 K 个信源
    ranking_top_k: int = 10

    # SSE 心跳间隔（秒）。每隔此时间发 `: ping` 注释行防代理空闲断开。测试时可设小值。
    heartbeat_interval_s: float = 10.0

    # 结果缓存
    cache_enabled: bool = True
    # L2 整次结果 TTL（秒）
    cache_l2_ttl_s: int = 600
    # L1 子检索词结果 TTL（秒）
    cache_l1_ttl_s: int = 600
    # 缓存最大条目数（LRU 淘汰）
    cache_max_size: int = 128


@lru_cache
def get_settings() -> Settings:
    return Settings()
