"""收尾模块（§7）。

- 引用解析（§7.1）：正则 \\[\\d+\\]，越界标记为幻觉
- 高亮定位（§7.2）：UTF-16 偏移，词重叠算法
- takeaways + related + consensus（§7.3，§10.3）
- 共识度实算（§6.6）
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import httpx

from app.pipeline.providers import FullSource

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 引用解析（§7.1）
# ---------------------------------------------------------------------------

_MARKER_RE = re.compile(r"\[(\d+)\]")
_ABBREVS = frozenset([
    "e.g", "i.e", "vs", "et al", "etc", "fig", "eq", "sec",
    "ref", "approx", "dept", "mr", "dr", "prof", "no",
])
# 候选断句位置：英文句号后跟空白/行尾/引号/括号；中文句末；感叹/问号
# 小数（1.3）/版本号（v1.0.2）/缩写（e.g.）在 split_sentences 里通过上下文过滤
_SENT_PUNCT_RE = re.compile(r"""[.!?。！？]""")
# 中文及通用感叹/问号直接算句末，不需要额外检查
_ZH_PUNCT = frozenset("。！？")
_EN_QUESTION_EXCLAIM = frozenset("!?")


def _to_utf16_len(text: str) -> int:
    """计算字符串的 UTF-16 码元数（JS String.length 口径）。"""
    count = 0
    for ch in text:
        cp = ord(ch)
        count += 2 if cp > 0xFFFF else 1
    return count


def _utf16_offsets(text: str) -> list[int]:
    """计算每个 Python 字符位置对应的 UTF-16 码元起始偏移列表，长度 = len(text)+1。"""
    offsets = [0]
    cur = 0
    for ch in text:
        cp = ord(ch)
        cur += 2 if cp > 0xFFFF else 1
        offsets.append(cur)
    return offsets


def _is_en_sentence_end(text: str, dot_pos: int) -> bool:
    """判断 text[dot_pos] 处的英文句号是否为句末（任务 4）。

    排除小数（1.3）、版本号（v1.0.2）、常见缩写（e.g. i.e. vs. 等）。
    允许：H100.、result. 等字母或数字序列后跟句末句号。
    """
    ch_before = text[dot_pos - 1] if dot_pos > 0 else ""
    ch_after = text[dot_pos + 1] if dot_pos + 1 < len(text) else ""

    # 小数/版本号：前是数字且后是数字（1.3、1.0.2 中的每个点）
    if ch_before.isdigit() and ch_after.isdigit():
        return False

    # 句号后是数字（如 v1.0 中的 .0）
    if ch_after.isdigit():
        return False

    # 缩写检测：取句号前（去掉末尾空格）最后 8 个字符检查是否以缩写词结尾
    context_before = text[max(0, dot_pos - 8):dot_pos].rstrip()
    for abbr in _ABBREVS:
        if context_before.lower().endswith(abbr):
            return False

    # 句号后面必须是空白、行尾、引号、括号才算句末
    if ch_after and ch_after not in " \t\n\"')]}":
        return False

    return True


def split_sentences(text: str) -> list[tuple[int, int]]:
    """将文本切成句子，返回每句的 (start_char_idx, end_char_idx)（Python 索引，含末尾标点）。

    规则（任务 4）：
    - 中文句末标点（。！？）和英文感叹/问号（!?）直接算句末。
    - 英文句号（.）通过 _is_en_sentence_end 判断，排除小数、版本号、缩写。
    """
    if not text:
        return []

    break_points: list[int] = []
    i = 0
    while i < len(text):
        ch = text[i]
        is_sent_end = False
        if ch in _ZH_PUNCT or ch in _EN_QUESTION_EXCLAIM:
            is_sent_end = True
        elif ch == ".":
            is_sent_end = _is_en_sentence_end(text, i)

        if is_sent_end:
            j = i + 1
            # 跳过连续标点
            while j < len(text) and text[j] in ".!?。！？":
                j += 1
            break_points.append(j)
            i = j
        else:
            i += 1

    if not break_points:
        return [(0, len(text))]

    sentences: list[tuple[int, int]] = []
    start = 0
    for bp in break_points:
        if bp > start:
            sentences.append((start, bp))
        next_start = bp
        while next_start < len(text) and text[next_start] in " \t\n":
            next_start += 1
        start = next_start

    if start < len(text):
        sentences.append((start, len(text)))

    return sentences


def parse_citations(
    report: str,
    sources: list[FullSource],
) -> tuple[list[dict[str, Any]], list[int]]:
    """解析研报正文中的 [n] 引用标记。

    返回 (citations_list, hallucinated_indices)。
    citations_list 每条：
    {index, markerStart, markerEnd, sentenceStart, sentenceEnd, highlight}
    偏移均为 UTF-16 码元（§7.2）。
    """
    source_count = len(sources)
    source_by_index = {s.index: s for s in sources}

    # UTF-16 偏移映射
    utf16 = _utf16_offsets(report)
    sentences = split_sentences(report)

    # 建立每个 Python 字符索引属于哪个句子
    char_to_sent: list[int] = [-1] * len(report)
    for si, (s, e) in enumerate(sentences):
        for ci in range(s, e):
            char_to_sent[ci] = si

    citations: list[dict[str, Any]] = []
    hallucinated: list[int] = []

    for m in _MARKER_RE.finditer(report):
        n = int(m.group(1))
        char_start = m.start()
        char_end = m.end()

        if n > source_count or n < 1:
            hallucinated.append(n)
            continue

        # UTF-16 偏移
        marker_start = utf16[char_start]
        marker_end = utf16[char_end]

        # 找所在句子
        si = char_to_sent[char_start] if char_start < len(report) else -1
        if si >= 0:
            sent_s, sent_e = sentences[si]
            sentence_start = utf16[sent_s]
            sentence_end = utf16[sent_e]
        else:
            sentence_start = marker_start
            sentence_end = marker_end

        # 高亮定位
        src = source_by_index.get(n)
        highlight = None
        if src and src.passage:
            # 取引用所在句子文本
            if si >= 0:
                sent_text = report[sentences[si][0]:sentences[si][1]]
            else:
                sent_text = m.group()
            highlight = _find_highlight(sent_text, src.passage)

        citations.append({
            "index": n,
            "markerStart": marker_start,
            "markerEnd": marker_end,
            "sentenceStart": sentence_start,
            "sentenceEnd": sentence_end,
            "highlight": highlight,
        })

    return citations, hallucinated


# ---------------------------------------------------------------------------
# 高亮定位（§7.2）：词重叠算法
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> list[str]:
    """ASCII 单词 + CJK 二元组。"""
    tokens: list[str] = []
    # ASCII 词
    tokens.extend(re.findall(r"[a-zA-Z0-9]+", text.lower()))
    # CJK 二元组
    cjk_chars = re.findall(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", text)
    for i in range(len(cjk_chars) - 1):
        tokens.append(cjk_chars[i] + cjk_chars[i + 1])
    return tokens


def _overlap_score(a: str, b: str) -> float:
    """|A∩B| / |A|（§7.2，以 a 为分母）。"""
    ta = set(_tokenize(a))
    tb = set(_tokenize(b))
    if not ta:
        return 0.0
    return len(ta & tb) / len(ta)


def _find_highlight(
    query_sentence: str,
    passage: str,
    threshold: float = 0.1,
) -> dict[str, Any] | None:
    """在 passage 中找与 query_sentence 词重叠最高的句子，返回 UTF-16 偏移（§7.2）。"""
    passage_sents = split_sentences(passage)
    if not passage_sents:
        return None

    utf16_p = _utf16_offsets(passage)
    best_score = threshold
    best_sent: tuple[int, int] | None = None

    for s, e in passage_sents:
        sent_text = passage[s:e]
        score = _overlap_score(query_sentence, sent_text)
        if score > best_score:
            best_score = score
            best_sent = (s, e)

    if best_sent is None:
        return None

    return {
        "start": utf16_p[best_sent[0]],
        "end": utf16_p[best_sent[1]],
        "score": round(best_score, 4),
    }


# ---------------------------------------------------------------------------
# 共识度（§6.6，§7.3）
# ---------------------------------------------------------------------------

def compute_consensus(
    report: str,
    citations: list[dict[str, Any]],
    sources: list[FullSource],
) -> dict[str, Any] | None:
    """计算共识度：cited_sentences、supported_sentences、score。

    supported = 同时引用 ≥2 个不同域名的句子。
    """
    source_by_index = {s.index: s for s in sources}
    sentences = split_sentences(report)
    utf16 = _utf16_offsets(report)

    if not sentences:
        return None

    # 建立每个句子（UTF-16 start）引用的域名集合
    sent_domains: dict[int, set[str]] = {}
    for cit in citations:
        ss = cit["sentenceStart"]
        n = cit["index"]
        src = source_by_index.get(n)
        if src:
            sent_domains.setdefault(ss, set()).add(src.domain)

    cited_sentences = len(sent_domains)
    if cited_sentences == 0:
        return None

    supported_sentences = sum(
        1 for domains in sent_domains.values() if len(domains) >= 2
    )
    score = supported_sentences / cited_sentences

    return {
        "score": round(score, 4),
        "supportedSentences": supported_sentences,
        "citedSentences": cited_sentences,
    }


# ---------------------------------------------------------------------------
# finalization：takeaways + related（§10.3）
# ---------------------------------------------------------------------------

_FINALIZE_SYSTEM = """你是一个技术研报分析助手。请基于研报内容，完成以下任务，以 JSON 格式输出。

输出格式：
{
  "takeaways": [
    {"text": "核心要点1（≤60字）", "citations": [1, 2]},
    ...
  ],
  "followUps": ["追问1", "追问2", "追问3"]
}

要求：
- takeaways：3-5条，每条附上来自研报的引用编号（整数数组）
- followUps：3-5条追问，每条≤100字，无引用编号
- 不用 emoji，只输出 JSON"""


async def finalize(
    report: str,
    citations: list[dict[str, Any]],
    sources: list[FullSource],
    llm_base_url: str,
    llm_api_key: str,
    llm_model: str,
    client: httpx.AsyncClient,
    timeout: float = 10.0,
) -> tuple[list[dict] | None, list[str] | None]:
    """调用 LLM 生成 takeaways 和 followUps。失败返回 (None, None)。"""
    # 截断研报避免超长
    report_snippet = report[:3000] + ("..." if len(report) > 3000 else "")

    payload = {
        "model": llm_model,
        "messages": [
            {"role": "system", "content": _FINALIZE_SYSTEM},
            {"role": "user", "content": f"研报内容：\n{report_snippet}"},
        ],
        "thinking": {"type": "disabled"},
        "max_tokens": 1000,
        "stream": False,
    }

    try:
        resp = await client.post(
            f"{llm_base_url.rstrip('/')}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {llm_api_key}"},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"].strip()

        # 尝试解析 JSON
        parsed = _parse_finalize_json(content)
        if parsed is None:
            logger.warning("finalization JSON 解析失败: %r", content[:200])
            return None, None

        takeaways = parsed.get("takeaways")
        follow_ups = parsed.get("followUps")

        # 校验最少数量
        if not takeaways or len(takeaways) < 3:
            takeaways = None
        if not follow_ups or len(follow_ups) < 3:
            follow_ups = None

        return takeaways, follow_ups

    except Exception as exc:
        logger.warning("finalization 失败: %s", exc)
        return None, None


def _parse_finalize_json(text: str) -> dict | None:
    text = text.strip()
    # 直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 提取代码块
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 提取花括号
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return None
