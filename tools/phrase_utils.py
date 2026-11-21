"""Shared phrase-record normalization and duplicate detection helpers."""

from __future__ import annotations

import re
import unicodedata
from typing import Any


COLLECTIONS = {
    "idioms": {"prefix": "idm", "title": "Thành ngữ tiếng Anh", "target": 1000},
    "proverbs": {"prefix": "prv", "title": "Tục ngữ tiếng Anh", "target": 400},
    "quotes": {"prefix": "qte", "title": "Danh ngôn tiếng Anh", "target": 300},
}

REQUIRED_FIELDS = {
    "id", "text", "vi", "ex", "exVi", "level", "topics", "reg", "equiv", "ielts", "reviewed"
}
OPTIONAL_FIELDS = {"src", "note"}
LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2", "general", "unrated"}
REGISTERS = {"neutral", "informal", "formal", "not-applicable", None}

_WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)
_LEADING_ARTICLES = {"a", "an", "the"}
_RESTORE_E = {"mak", "tak", "giv", "hav", "writ", "rid", "us", "clos", "danc", "mov", "smil", "lov", "lik", "driv", "hop", "nam", "sav", "com"}
_IRREGULAR_ING = {"going": "go", "doing": "do", "lying": "lie", "dying": "die", "tying": "tie", "using": "use"}
_IRREGULAR_WORDS = {
    "got": "get", "went": "go", "spilled": "spill", "had": "have", "lost": "lose",
    "lent": "lend", "laid": "lay", "stood": "stand", "left": "leave", "bit": "bite",
    "took": "take", "kept": "keep", "made": "make", "held": "hold", "thought": "think",
    "wore": "wear", "ran": "run", "won": "win", "broke": "break", "brought": "bring",
    "caught": "catch", "felt": "feel", "found": "find", "paid": "pay", "said": "say", "fell": "fall",
    "sent": "send", "spent": "spend", "told": "tell", "wrote": "write", "came": "come",
    "threw": "throw", "drew": "draw", "struck": "strike", "rose": "rise", "saw": "see",
    "heard": "hear", "goes": "go", "does": "do",
    "was": "be", "were": "be", "am": "be", "is": "be", "are": "be",
    "has": "have", "gave": "give",
    "myself": "yourself", "himself": "yourself", "herself": "yourself", "itself": "yourself",
    "ourselves": "yourself", "yourselves": "yourself", "themselves": "yourself", "oneself": "yourself",
}
_WORD_ALIASES = {"glister": "glitter"}
_PHRASE_WILDCARDS = {"something", "someone", "somebody", "somewhere", "anything", "anyone"}
_POSSESSIVE_FORMS = {"my", "your", "his", "her", "its", "our", "their", "one's"}
_REFLEXIVE_FORMS = {"myself", "yourself", "himself", "herself", "itself", "ourselves", "yourselves", "themselves", "oneself"}


def stable_id(collection: str, position: int) -> str:
    if collection not in COLLECTIONS:
        raise ValueError(f"Unknown phrase collection: {collection}")
    if position < 1:
        raise ValueError("Phrase positions start at one")
    return f"{COLLECTIONS[collection]['prefix']}-{position:04d}"


def _stem_word(word: str) -> str:
    word = word.casefold().replace("’", "'")
    if word.endswith("'s") and len(word) > 3:
        word = word[:-2]
    if word in _PHRASE_WILDCARDS:
        return word
    if word in _IRREGULAR_WORDS:
        return _IRREGULAR_WORDS[word]
    if word == "being":
        return "be"
    if word in _IRREGULAR_ING:
        return _IRREGULAR_ING[word]
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("ing") and len(word) > 5:
        stem = word[:-3]
        if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in {"l", "s"}:
            stem = stem[:-1]
        if stem in _RESTORE_E:
            stem += "e"
        return stem
    if word.endswith("ed") and len(word) > 5:
        stem = word[:-2]
        if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in {"l", "s"}:
            stem = stem[:-1]
        if stem in _RESTORE_E:
            stem += "e"
        return stem
    if word.endswith("es") and len(word) > 5 and word[:-2].endswith(("ch", "sh", "ss", "x", "z", "o")):
        return word[:-2]
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        word = word[:-1]
    return _WORD_ALIASES.get(word, word)


def normalized_tokens(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", str(value)).casefold()
    words = [_stem_word(word) for word in _WORD_RE.findall(normalized)]
    while words and words[0] in _LEADING_ARTICLES:
        words.pop(0)
    return words


def normalize_phrase(value: str) -> str:
    """Normalize punctuation, initial articles, and simple inflected variants."""
    return " ".join(normalized_tokens(value))


def contains_phrase(example: str, phrase: str) -> bool:
    example_words = normalized_tokens(example)
    phrase_words = normalized_tokens(phrase)
    if not phrase_words or len(phrase_words) > len(example_words):
        if phrase_words[:3] != ["cost", "an", "arm"]:
            return False

    def matches(example_index: int, phrase_index: int) -> bool:
        if phrase_index >= len(phrase_words):
            return True
        if example_index >= len(example_words):
            return False
        target = phrase_words[phrase_index]
        if target in {"your", "their"} and example_words[example_index] in _POSSESSIVE_FORMS:
            return matches(example_index + 1, phrase_index + 1)
        if target == "yourself" and example_words[example_index] in _REFLEXIVE_FORMS:
            return matches(example_index + 1, phrase_index + 1)
        if target in _PHRASE_WILDCARDS:
            return any(matches(next_index, phrase_index + 1) for next_index in range(example_index + 1, len(example_words) + 1))
        return example_words[example_index] == target and matches(example_index + 1, phrase_index + 1)

    if any(matches(start, 0) for start in range(len(example_words))):
        return True

    # Speakers often place an object pronoun between "cost" and the idiom.
    if phrase_words[:3] == ["cost", "an", "arm"]:
        tail = phrase_words[1:]
        return any(
            example_words[start] == "cost"
            and example_words[start + 2:start + 2 + len(tail)] == tail
            for start in range(len(example_words) - len(tail) - 1)
        )
    return False


def normalize_item(value: Any, collection: str, position: int) -> dict[str, Any]:
    """Read a legacy 4/5-field array or a canonical object into the new shape.

    Existing array data receives deterministic IDs based on its original order.
    Missing legacy metadata is represented honestly with ``unrated``/``None``.
    """
    if collection not in COLLECTIONS:
        raise ValueError(f"Unknown phrase collection: {collection}")
    if isinstance(value, (list, tuple)):
        if len(value) not in (4, 5):
            raise ValueError(f"Legacy phrase arrays require four or five fields, got {len(value)}")
        text, vi, ex, ex_vi = value[:4]
        src = value[4] if len(value) == 5 else None
        raw: dict[str, Any] = {
            "id": stable_id(collection, position), "text": text, "vi": vi, "ex": ex, "exVi": ex_vi,
            "src": src, "level": "unrated", "topics": ["general"], "reg": None,
            "equiv": None, "ielts": 0, "reviewed": False,
        }
    elif isinstance(value, dict):
        topics = value.get("topics", ["general"])
        if isinstance(topics, str):
            topics = [topics]
        if not isinstance(topics, list):
            topics = []
        ielts_value = value.get("ielts", 0)
        try:
            ielts = 1 if int(ielts_value) == 1 else 0
        except (TypeError, ValueError):
            ielts = 0
        raw = {
            "id": value.get("id") or stable_id(collection, position),
            "text": value.get("text", ""), "vi": value.get("vi", ""),
            "ex": value.get("ex", ""), "exVi": value.get("exVi", ""),
            "src": value.get("src"), "level": value.get("level", "unrated"),
            "topics": topics, "reg": value.get("reg"), "equiv": value.get("equiv"),
            "ielts": ielts, "reviewed": False,
        }
        if "note" in value:
            raw["note"] = value["note"]
    else:
        raise ValueError("Phrase entries must be legacy arrays or objects")

    for key in ("id", "text", "vi", "ex", "exVi", "src", "level", "reg", "equiv"):
        if raw.get(key) is not None:
            raw[key] = str(raw[key]).strip()
    raw["topics"] = [str(topic).strip() for topic in raw["topics"] if str(topic).strip()]
    raw["ielts"] = 1 if raw["ielts"] == 1 else 0
    raw["reviewed"] = False
    return raw
