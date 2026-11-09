"""信源分类器（§8，§4.5）。

P0 实现：LocalRuleClassifier — 本地域名规则，无外部调用。
P1 预留：JevClassifier 接口位，接入时实测后填写。
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# 规则表（§4.5）authority 值也在此定义，供 ranker 使用
# ---------------------------------------------------------------------------

# (精确域名或子域后缀, category, authority, rule_id)
# 匹配规则：host == d 或 host 以 ".d" 结尾
_DOMAIN_RULES: list[tuple[str, str, float, str]] = [
    # preprint
    ("arxiv.org",               "preprint", 0.8, "domain:arxiv.org"),
    ("alphaxiv.org",            "preprint", 0.8, "domain:alphaxiv.org"),
    ("ar5iv.labs.arxiv.org",    "preprint", 0.8, "domain:ar5iv.labs.arxiv.org"),
    ("openreview.net",          "preprint", 0.8, "domain:openreview.net"),
    ("neurips.cc",              "preprint", 0.8, "domain:neurips.cc"),
    ("proceedings.neurips.cc",  "preprint", 0.8, "domain:proceedings.neurips.cc"),
    ("aclanthology.org",        "preprint", 0.8, "domain:aclanthology.org"),
    ("proceedings.mlr.press",   "preprint", 0.8, "domain:proceedings.mlr.press"),
    # code
    ("github.com",              "code",     0.7, "domain:github.com"),
    ("githubusercontent.com",   "code",     0.7, "domain:githubusercontent.com"),
    ("gitlab.com",              "code",     0.7, "domain:gitlab.com"),
    ("gitee.com",               "code",     0.7, "domain:gitee.com"),
    ("gitcode.com",             "code",     0.7, "domain:gitcode.com"),
    ("bitbucket.org",           "code",     0.7, "domain:bitbucket.org"),
    ("pypi.org",                "code",     0.7, "domain:pypi.org"),
    ("npmjs.com",               "code",     0.7, "domain:npmjs.com"),
    # spec
    ("rfc-editor.org",          "spec",     0.9, "domain:rfc-editor.org"),
    ("datatracker.ietf.org",    "spec",     0.9, "domain:datatracker.ietf.org"),
    ("w3.org",                  "spec",     0.9, "domain:w3.org"),
    ("whatwg.org",              "spec",     0.9, "domain:whatwg.org"),
    ("ecma-international.org",  "spec",     0.9, "domain:ecma-international.org"),
    ("khronos.org",             "spec",     0.9, "domain:khronos.org"),
    # docs（精确域名放在前缀规则之前）
    ("readthedocs.io",          "docs",     0.85, "domain:readthedocs.io"),
    ("developer.mozilla.org",   "docs",     0.85, "domain:developer.mozilla.org"),
    ("learn.microsoft.com",     "docs",     0.85, "domain:learn.microsoft.com"),
    ("docs.python.org",         "docs",     0.85, "domain:docs.python.org"),
]

# host 以 "docs." 开头 → docs（放在精确域名规则之后）
_DOCS_PREFIX = "docs."
_DOCS_AUTHORITY = 0.85

# 兜底
_BLOG_AUTHORITY = 0.5


def classify_source(domain: str) -> tuple[str, str]:
    """根据域名返回 (category, category_rule)（§4.5）。

    domain 已经是小写且去掉了 www. 前缀（由 extract_domain 保证）。
    """
    for d, cat, _, rule_id in _DOMAIN_RULES:
        if domain == d or domain.endswith("." + d):
            return cat, rule_id

    if domain.startswith(_DOCS_PREFIX):
        return "docs", "host-prefix:docs."

    return "blog", "default"


def get_authority(domain: str) -> float:
    """根据域名返回 authority 值（§4.5，§5.1）。"""
    for d, _, auth, _ in _DOMAIN_RULES:
        if domain == d or domain.endswith("." + d):
            return auth

    if domain.startswith(_DOCS_PREFIX):
        return _DOCS_AUTHORITY

    return _BLOG_AUTHORITY
