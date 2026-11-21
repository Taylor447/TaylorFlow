"""Validate TaylorFlow phrase source batches and their generated manifest."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from phrase_utils import (
    COLLECTIONS,
    LEVELS,
    REGISTERS,
    REQUIRED_FIELDS,
    OPTIONAL_FIELDS,
    contains_phrase,
    normalize_item,
    normalize_phrase,
)


ROOT = Path(__file__).resolve().parents[1]
PHRASE_ROOT = ROOT / "assets" / "phrases"
SOURCE_ROOT = PHRASE_ROOT / "src"
BLACKLIST = Path(__file__).with_name("misattributed.txt")
BATCH_NAME = re.compile(r"^(idioms|proverbs|quotes)-([0-9]{2,})\.json$")
PLACEHOLDER = re.compile(r"(?:\.\.\.|\bTODO\b|\bTBD\b)", re.IGNORECASE)
WORD_COUNT = re.compile(r"\b[\w]+(?:['’][\w]+)?(?:-[\w]+)?\b", re.UNICODE)
PROGRESS_PATH = PHRASE_ROOT / "_progress.json"


def load_misattributed(path: Path = BLACKLIST) -> set[str]:
    blocked: set[str] = set()
    if not path.exists():
        return blocked
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        value = line.split("|", 1)[0].strip()
        if value and not value.startswith("#"):
            blocked.add(normalize_phrase(value))
    return blocked


def _legacy_limits() -> dict[str, int]:
    """Return the preserved pre-migration item counts for compatibility checks."""
    try:
        progress = json.loads(PROGRESS_PATH.read_text(encoding="utf-8-sig"))
        counts = progress.get("existingInHtml", {})
        return {name: int(counts.get(name, 0)) for name in COLLECTIONS}
    except (OSError, ValueError, TypeError):
        return {name: 0 for name in COLLECTIONS}


def _is_legacy(item: dict[str, Any], collection: str, limits: dict[str, int]) -> bool:
    prefix = COLLECTIONS[collection]["prefix"] + "-"
    phrase_id = str(item.get("id", ""))
    if not phrase_id.startswith(prefix):
        return False
    try:
        return 1 <= int(phrase_id[len(prefix):]) <= limits.get(collection, 0)
    except ValueError:
        return False


def _strict_object_errors(item: dict[str, Any], file_name: str, position: int) -> list[str]:
    errors: list[str] = []
    missing = sorted(REQUIRED_FIELDS - item.keys())
    extra = sorted(item.keys() - REQUIRED_FIELDS - OPTIONAL_FIELDS)
    if missing:
        errors.append(f"{file_name} item {position}: missing fields: {', '.join(missing)}")
    if extra:
        errors.append(f"{file_name} item {position}: unknown fields: {', '.join(extra)}")
    if item.get("reviewed") is not False:
        errors.append(f"{file_name} item {position}: reviewed must be false")
    return errors


def collect_source_records(source_root: Path = SOURCE_ROOT) -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
    records: dict[str, list[dict[str, Any]]] = {name: [] for name in COLLECTIONS}
    errors: list[str] = []
    batch_numbers: dict[str, set[int]] = {name: set() for name in COLLECTIONS}

    if not source_root.exists():
        return records, errors

    for path in sorted(source_root.glob("*.json"), key=lambda item: item.name.casefold()):
        match = BATCH_NAME.fullmatch(path.name)
        if not match:
            errors.append(f"Unexpected source filename: {path.name}")
            continue
        collection, batch_text = match.groups()
        batch_number = int(batch_text)
        if batch_number in batch_numbers[collection]:
            errors.append(f"Duplicate batch number: {path.name}")
            continue
        batch_numbers[collection].add(batch_number)

        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"{path.name}: invalid JSON: {error}")
            continue
        if not isinstance(payload, dict):
            errors.append(f"{path.name}: expected an object with schemaVersion, collection, and items")
            continue
        if payload.get("schemaVersion") != 1:
            errors.append(f"{path.name}: schemaVersion must be 1")
        if payload.get("collection") != collection:
            errors.append(f"{path.name}: collection must match its filename ({collection})")
        if set(payload) - {"schemaVersion", "collection", "batch", "items"}:
            errors.append(f"{path.name}: contains unknown pack fields")
        if "batch" in payload and str(payload["batch"]) != batch_text:
            errors.append(f"{path.name}: batch must match its filename ({batch_text})")
        items = payload.get("items")
        if not isinstance(items, list):
            errors.append(f"{path.name}: items must be an array")
            continue
        if len(items) > 40:
            errors.append(f"{path.name}: batch has {len(items)} items; maximum is 40")

        start_position = len(records[collection])
        for offset, raw in enumerate(items, start=1):
            position = start_position + offset
            if isinstance(raw, dict):
                errors.extend(_strict_object_errors(raw, path.name, offset))
            elif isinstance(raw, (list, tuple)):
                expected_fields = 5 if collection == "quotes" else 4
                if len(raw) != expected_fields:
                    errors.append(f"{path.name} item {offset}: legacy {collection} arrays require exactly {expected_fields} fields")
            try:
                records[collection].append(normalize_item(raw, collection, position))
            except (TypeError, ValueError) as error:
                errors.append(f"{path.name} item {offset}: {error}")
    return records, errors


def validate_records(records: dict[str, list[dict[str, Any]]], blocked: set[str] | None = None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    blocked = blocked if blocked is not None else load_misattributed()
    legacy_limits = _legacy_limits()
    seen_text: dict[str, tuple[str, str, bool]] = {}
    seen_ids: dict[str, tuple[str, str]] = {}

    for collection in COLLECTIONS:
        items = records.get(collection, [])
        topic_counts: Counter[str] = Counter()
        level_counts: Counter[str] = Counter()
        for position, item in enumerate(items, start=1):
            label = f"{collection} item {position} ({item.get('id', 'no-id')})"
            legacy = _is_legacy(item, collection, legacy_limits)
            for field in ("id", "text", "vi", "ex", "exVi"):
                if not isinstance(item.get(field), str) or not item[field].strip():
                    errors.append(f"{label}: {field} must be a non-empty string")
            if PLACEHOLDER.search(" ".join(str(item.get(field, "")) for field in ("text", "vi", "ex", "exVi", "src", "note"))):
                errors.append(f"{label}: contains a placeholder")

            phrase_id = str(item.get("id", ""))
            expected_prefix = COLLECTIONS[collection]["prefix"] + "-"
            if not re.fullmatch(re.escape(expected_prefix) + r"[0-9]{4,}", phrase_id):
                errors.append(f"{label}: id must start with {expected_prefix} and end with digits")
            if phrase_id in seen_ids:
                errors.append(f"{label}: duplicate id also used by {seen_ids[phrase_id][0]} {seen_ids[phrase_id][1]}")
            else:
                seen_ids[phrase_id] = (collection, phrase_id)

            text = str(item.get("text", ""))
            normalized = normalize_phrase(text)
            if not normalized:
                errors.append(f"{label}: text has no searchable words")
            elif normalized in seen_text:
                prior_collection, prior_text, prior_legacy = seen_text[normalized]
                message = f"{label}: duplicate or inflected variant of {prior_collection}: {prior_text}"
                if legacy or prior_legacy:
                    warnings.append("Preserved legacy duplicate: " + message)
                else:
                    errors.append(message)
            else:
                seen_text[normalized] = (collection, text, legacy)

            level = item.get("level")
            if level not in LEVELS:
                errors.append(f"{label}: unsupported level {level!r}")
            else:
                level_counts[str(level)] += 1
            if item.get("reg") not in REGISTERS:
                errors.append(f"{label}: reg must be neutral, informal, formal, not-applicable, or null")
            if not isinstance(item.get("equiv"), (str, type(None))):
                errors.append(f"{label}: equiv must be a string or null")
            if item.get("ielts") not in (0, 1):
                errors.append(f"{label}: ielts must be 0 or 1")
            if item.get("reviewed") is not False:
                errors.append(f"{label}: reviewed must be false")

            topics = item.get("topics")
            if not isinstance(topics, list) or not topics or any(not isinstance(topic, str) or not topic.strip() for topic in topics):
                errors.append(f"{label}: topics must contain at least one non-empty name")
            else:
                if len(set(topics)) != len(topics):
                    errors.append(f"{label}: topics cannot repeat")
                topic_counts.update(topic.casefold().strip() for topic in topics)

            example = str(item.get("ex", ""))
            example_words = WORD_COUNT.findall(example)
            if len(example_words) > 18:
                message = f"{label}: English example has {len(example_words)} words; maximum is 18"
                (warnings if legacy else errors).append(("Preserved legacy item: " if legacy else "") + message)
            if text and example and not contains_phrase(example, text):
                message = f"{label}: English example does not contain the target phrase"
                (warnings if legacy else errors).append(("Preserved legacy item: " if legacy else "") + message)

            source = item.get("src")
            if source is not None and not isinstance(source, str):
                errors.append(f"{label}: src must be a string or null")
            if collection == "quotes":
                if not isinstance(source, str) or not source.strip():
                    errors.append(f"{label}: quotes require an author and source in src")
                elif "·" not in source or not re.search(r"\b[12][0-9]{3}\b", source):
                    message = f"{label}: src format must include 'Author · Work (year)'"
                    (warnings if legacy else errors).append(("Preserved legacy source: " if legacy else "") + message)
                if len(WORD_COUNT.findall(text)) > 25:
                    errors.append(f"{label}: quote exceeds 25 words")
                if normalized in blocked:
                    errors.append(f"{label}: quote appears in tools/misattributed.txt")

        total_tags = sum(topic_counts.values())
        if total_tags >= 20 and topic_counts:
            topic, count = topic_counts.most_common(1)[0]
            if count / total_tags > 0.6:
                errors.append(f"{collection}: topic distribution is too concentrated on {topic} ({count}/{total_tags})")
            elif count / total_tags > 0.42:
                warnings.append(f"{collection}: topic {topic} is {count / total_tags:.0%} of all topic tags")

        if collection == "idioms" and len(items) >= 40:
            rated = sum(level_counts[level] for level in ("B1", "B2", "C1"))
            if rated:
                desired = {"B1": 0.30, "B2": 0.45, "C1": 0.25}
                for level, ratio in desired.items():
                    actual = level_counts[level] / rated
                    if abs(actual - ratio) > 0.12:
                        warnings.append(f"idioms: {level} share is {actual:.0%}; target is about {ratio:.0%}")

    return errors, warnings


def read_generated_index(index_path: Path) -> tuple[dict[str, Any] | None, str | None]:
    if not index_path.exists():
        return None, None
    source = index_path.read_text(encoding="utf-8")
    match = re.search(r"globalThis\.TF_PHRASE_INDEX\s*=\s*(\{[\s\S]*?\})\s*;\s*$", source)
    if not match:
        return None, f"{index_path.name}: cannot parse generated TF_PHRASE_INDEX JSON"
    try:
        return json.loads(match.group(1)), None
    except json.JSONDecodeError as error:
        return None, f"{index_path.name}: invalid generated JSON: {error}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-missing-index", action="store_true", help="Validate source batches before build")
    args = parser.parse_args()

    records, errors = collect_source_records()
    record_errors, warnings = validate_records(records)
    errors.extend(record_errors)

    index_path = PHRASE_ROOT / "index.js"
    manifest, manifest_error = read_generated_index(index_path)
    if manifest_error:
        errors.append(manifest_error)
    elif manifest is None and not args.allow_missing_index:
        errors.append("assets/phrases/index.js is missing; run tools/build_phrases.py")
    elif manifest is not None:
        counts = manifest.get("collections", {})
        for collection in COLLECTIONS:
            expected = len(records[collection])
            actual = counts.get(collection, {}).get("count") if isinstance(counts.get(collection), dict) else None
            if actual != expected:
                errors.append(f"index.js count mismatch for {collection}: manifest={actual}, sources={expected}")

    total = sum(len(items) for items in records.values())
    print(f"Phrase validation: {total} source items")
    for collection in COLLECTIONS:
        print(f"  {collection}: {len(records[collection])}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"FAILED: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"PASS: {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
