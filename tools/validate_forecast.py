"""Validate TaylorFlow forecast source packages without touching learner data.

Source package schema, version 1:
- pack.json: schemaVersion, id, title, label, validFrom, validTo, updated, sourceLabel.
- content JSON: part1Topics and part2CueCards arrays.
- Part 1 topics contain five questions; each question has id, type, part, q, aid, reviewed.
- Part 2 cue cards contain a task, four bullets, a conclusion, an aid and four Part 3 questions.
- Every aid has up to three Vietnamese ideas, six EN-VI vocabulary pairs, one grammar tip,
  an English sample of the part-specific length and reviewed=false.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FORECAST_ROOT = ROOT / "assets" / "forecast"
SOURCE_ROOT = FORECAST_ROOT / "src"
TARGETS = {
    "part1Topics": 12,
    "part1Questions": 60,
    "part2CueCards": 24,
    "part3Questions": 96,
}
SAMPLE_RANGES = {1: (35, 70), 2: (170, 250), 3: (60, 110)}
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
WORD_PATTERN = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*(?:-[A-Za-z0-9]+)*")


class ForecastValidationError(ValueError):
    """Raised for malformed package metadata or content."""


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ForecastValidationError(f"JSON contains duplicate key: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> Any:
    try:
        return json.loads(
            path.read_text(encoding="utf-8-sig"),
            object_pairs_hook=_object_without_duplicate_keys,
        )
    except (OSError, json.JSONDecodeError, UnicodeError) as error:
        raise ForecastValidationError(f"Cannot read {path}: {error}") from error


def _require_text(value: Any, field: str, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ForecastValidationError(f"{context}: {field} must be a non-empty string")
    return value.strip()


def _require_reviewed_false(value: Any, context: str) -> None:
    if value is not False:
        raise ForecastValidationError(f"{context}: reviewed must be false")


def _walk_text(value: Any, context: str) -> None:
    if isinstance(value, str):
        if ("." * 3) in value or chr(0x2026) in value:
            raise ForecastValidationError(f"{context}: ellipsis is not allowed")
        if ("TO" + "DO").casefold() in value.casefold():
            raise ForecastValidationError(f"{context}: unfinished marker is not allowed")
    elif isinstance(value, dict):
        for key, child in value.items():
            _walk_text(child, f"{context}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _walk_text(child, f"{context}[{index}]")


def normalized_prompt(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return " ".join("".join(char if char.isalnum() else " " for char in normalized).split())


def _validate_iso_date(value: Any, field: str, context: str) -> date:
    text = _require_text(value, field, context)
    try:
        parsed = date.fromisoformat(text)
    except ValueError as error:
        raise ForecastValidationError(f"{context}: {field} must use YYYY-MM-DD") from error
    if parsed.isoformat() != text:
        raise ForecastValidationError(f"{context}: {field} must use YYYY-MM-DD")
    return parsed


def _validate_id(value: Any, context: str) -> str:
    item_id = _require_text(value, "id", context)
    if not ID_PATTERN.fullmatch(item_id):
        raise ForecastValidationError(f"{context}: id may contain lowercase letters, digits and hyphens")
    return item_id


def _validate_aid(aid: Any, part: int, context: str) -> None:
    if not isinstance(aid, dict):
        raise ForecastValidationError(f"{context}: aid must be an object")
    for field in ("idea", "vocab", "grammar", "sample", "reviewed"):
        if field not in aid:
            raise ForecastValidationError(f"{context}: aid.{field} is required")
    ideas = aid["idea"]
    if not isinstance(ideas, list) or not 1 <= len(ideas) <= 3:
        raise ForecastValidationError(f"{context}: aid.idea must contain one to three ideas")
    for index, idea in enumerate(ideas):
        _require_text(idea, f"aid.idea[{index}]", context)
    vocabulary = aid["vocab"]
    if not isinstance(vocabulary, list) or len(vocabulary) != 6:
        raise ForecastValidationError(f"{context}: aid.vocab must contain exactly six EN-VI pairs")
    for index, entry in enumerate(vocabulary):
        if not isinstance(entry, dict):
            raise ForecastValidationError(f"{context}: aid.vocab[{index}] must be an object")
        _require_text(entry.get("en"), "en", f"{context}.aid.vocab[{index}]")
        _require_text(entry.get("vi"), "vi", f"{context}.aid.vocab[{index}]")
    _require_text(aid["grammar"], "aid.grammar", context)
    sample = _require_text(aid["sample"], "aid.sample", context)
    words = WORD_PATTERN.findall(sample)
    low, high = SAMPLE_RANGES[part]
    if not low <= len(words) <= high:
        raise ForecastValidationError(
            f"{context}: Part {part} sample has {len(words)} words; expected {low}-{high}"
        )
    letters = [char for char in sample if char.isalpha()]
    if not letters or sum(char.isascii() for char in letters) / len(letters) < 0.88:
        raise ForecastValidationError(f"{context}: sample must be written in English")
    _require_reviewed_false(aid["reviewed"], f"{context}.aid")


def merge_source_files(source_dir: Path) -> tuple[dict[str, Any], dict[str, list[Any]]]:
    metadata_path = source_dir / "pack.json"
    if not metadata_path.is_file():
        raise ForecastValidationError(f"Missing package metadata: {metadata_path}")
    metadata = read_json(metadata_path)
    if not isinstance(metadata, dict):
        raise ForecastValidationError(f"{metadata_path}: root must be an object")
    merged: dict[str, list[Any]] = {"part1Topics": [], "part2CueCards": []}
    for path in sorted(source_dir.glob("*.json")):
        if path.name == "pack.json":
            continue
        document = read_json(path)
        if not isinstance(document, dict):
            raise ForecastValidationError(f"{path}: root must be an object")
        if document.get("schemaVersion", 1) != 1:
            raise ForecastValidationError(f"{path}: unsupported schemaVersion")
        unknown = set(document) - {"schemaVersion", "part1Topics", "part2CueCards"}
        if unknown:
            raise ForecastValidationError(f"{path}: unsupported fields: {', '.join(sorted(unknown))}")
        for field in merged:
            values = document.get(field, [])
            if not isinstance(values, list):
                raise ForecastValidationError(f"{path}: {field} must be an array")
            merged[field].extend(values)
    return metadata, merged


def validate_package(
    metadata: dict[str, Any], content: dict[str, list[Any]], allow_partial: bool = False
) -> dict[str, int]:
    context = f"package {metadata.get('id', '<missing id>')}"
    if metadata.get("schemaVersion") != 1:
        raise ForecastValidationError(f"{context}: schemaVersion must be 1")
    package_id = _validate_id(metadata.get("id"), context)
    _require_text(metadata.get("title"), "title", context)
    _require_text(metadata.get("label"), "label", context)
    start = _validate_iso_date(metadata.get("validFrom"), "validFrom", context)
    end = _validate_iso_date(metadata.get("validTo"), "validTo", context)
    _validate_iso_date(metadata.get("updated"), "updated", context)
    if end < start:
        raise ForecastValidationError(f"{context}: validTo is earlier than validFrom")
    source_label = _require_text(metadata.get("sourceLabel"), "sourceLabel", context).casefold()
    if "đề luyện tập theo chủ đề" not in source_label or "taylorflow soạn" not in source_label:
        raise ForecastValidationError(f"{context}: sourceLabel must identify TaylorFlow-authored topic practice")
    _walk_text(metadata, context)

    topics = content.get("part1Topics", [])
    cue_cards = content.get("part2CueCards", [])
    if not isinstance(topics, list) or not isinstance(cue_cards, list):
        raise ForecastValidationError(f"{context}: content collections must be arrays")
    if not allow_partial and (len(topics) != TARGETS["part1Topics"] or len(cue_cards) != TARGETS["part2CueCards"]):
        raise ForecastValidationError(
            f"{context}: expected {TARGETS['part1Topics']} Part 1 topics and "
            f"{TARGETS['part2CueCards']} Part 2 cue cards"
        )
    if len(topics) > TARGETS["part1Topics"] or len(cue_cards) > TARGETS["part2CueCards"]:
        raise ForecastValidationError(f"{context}: content exceeds the package limits")

    identifiers: set[str] = set()
    prompts: dict[str, str] = {}

    def register_id(value: Any, where: str) -> str:
        item_id = _validate_id(value, where)
        if item_id in identifiers:
            raise ForecastValidationError(f"{where}: duplicate id {item_id}")
        identifiers.add(item_id)
        return item_id

    def register_prompt(value: Any, where: str) -> None:
        text = _require_text(value, "q", where)
        key = normalized_prompt(text)
        if not key:
            raise ForecastValidationError(f"{where}: prompt is empty after normalization")
        if key in prompts:
            raise ForecastValidationError(f"{where}: duplicate prompt matches {prompts[key]}")
        prompts[key] = where

    for topic_index, topic in enumerate(topics):
        where = f"{context}.part1Topics[{topic_index}]"
        if not isinstance(topic, dict):
            raise ForecastValidationError(f"{where}: topic must be an object")
        register_id(topic.get("id"), where)
        _require_text(topic.get("title"), "title", where)
        _require_reviewed_false(topic.get("reviewed"), where)
        questions = topic.get("questions")
        if not isinstance(questions, list) or len(questions) != 5:
            raise ForecastValidationError(f"{where}: each topic must contain exactly five questions")
        for question_index, question in enumerate(questions):
            qwhere = f"{where}.questions[{question_index}]"
            if not isinstance(question, dict):
                raise ForecastValidationError(f"{qwhere}: question must be an object")
            register_id(question.get("id"), qwhere)
            if question.get("type") != "part1-question" or question.get("part") != 1:
                raise ForecastValidationError(f"{qwhere}: type and part must identify Part 1")
            _require_reviewed_false(question.get("reviewed"), qwhere)
            register_prompt(question.get("q"), qwhere)
            _validate_aid(question.get("aid"), 1, qwhere)
            _walk_text(question, qwhere)

    for card_index, card in enumerate(cue_cards):
        where = f"{context}.part2CueCards[{card_index}]"
        if not isinstance(card, dict):
            raise ForecastValidationError(f"{where}: cue card must be an object")
        register_id(card.get("id"), where)
        if card.get("type") != "part2-cue-card" or card.get("part") != 2:
            raise ForecastValidationError(f"{where}: type and part must identify Part 2")
        _require_text(card.get("topic"), "topic", where)
        _require_text(card.get("title"), "title", where)
        _require_text(card.get("task"), "task", where)
        register_prompt(card.get("task"), where)
        bullets = card.get("bullets")
        if not isinstance(bullets, list) or len(bullets) != 4:
            raise ForecastValidationError(f"{where}: cue card must contain exactly four bullets")
        for bullet_index, bullet in enumerate(bullets):
            _require_text(bullet, f"bullets[{bullet_index}]", where)
        _require_text(card.get("conclusion"), "conclusion", where)
        _require_reviewed_false(card.get("reviewed"), where)
        _validate_aid(card.get("aid"), 2, where)
        questions = card.get("part3Questions")
        if not isinstance(questions, list) or len(questions) != 4:
            raise ForecastValidationError(f"{where}: each cue card must have exactly four Part 3 questions")
        for question_index, question in enumerate(questions):
            qwhere = f"{where}.part3Questions[{question_index}]"
            if not isinstance(question, dict):
                raise ForecastValidationError(f"{qwhere}: question must be an object")
            register_id(question.get("id"), qwhere)
            if question.get("type") != "part3-question" or question.get("part") != 3:
                raise ForecastValidationError(f"{qwhere}: type and part must identify Part 3")
            _require_reviewed_false(question.get("reviewed"), qwhere)
            register_prompt(question.get("q"), qwhere)
            _validate_aid(question.get("aid"), 3, qwhere)
            _walk_text(question, qwhere)
        _walk_text(card, where)

    counts = {
        "part1Topics": len(topics),
        "part1Questions": sum(len(topic["questions"]) for topic in topics),
        "part2CueCards": len(cue_cards),
        "part3Questions": sum(len(card["part3Questions"]) for card in cue_cards),
    }
    if not allow_partial:
        for key, target in TARGETS.items():
            if counts[key] != target:
                raise ForecastValidationError(f"{context}: {key} is {counts[key]}, expected {target}")
    return counts


def validate_source_dir(source_dir: Path, allow_partial: bool = False) -> tuple[dict[str, Any], dict[str, list[Any]], dict[str, int]]:
    metadata, content = merge_source_files(source_dir)
    counts = validate_package(metadata, content, allow_partial=allow_partial)
    return metadata, content, counts


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate locally authored TaylorFlow forecast packages")
    parser.add_argument("package_id", nargs="?", help="Package id under assets/forecast/src")
    parser.add_argument("--all", action="store_true", help="Validate each source package")
    parser.add_argument("--allow-partial", action="store_true", help="Allow lotted packages below full target counts")
    args = parser.parse_args()

    if args.package_id and args.all:
        parser.error("Choose a package id or --all")
    if args.package_id:
        directories = [SOURCE_ROOT / args.package_id]
    else:
        directories = sorted(path for path in SOURCE_ROOT.glob("*") if path.is_dir() and (path / "pack.json").is_file()) if SOURCE_ROOT.exists() else []
    if not directories:
        print("Schema ready. No forecast source packages exist yet; no content was validated.")
        return 0 if args.all or not args.package_id else 1

    failed = False
    for source_dir in directories:
        try:
            metadata, _, counts = validate_source_dir(source_dir, allow_partial=args.allow_partial)
            print(f"PASS {metadata['id']}: " + ", ".join(f"{key}={value}" for key, value in counts.items()))
        except ForecastValidationError as error:
            failed = True
            print(f"FAIL {source_dir.name}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
