"""Build self-contained, offline-friendly phrase data scripts and index."""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from phrase_utils import COLLECTIONS, normalize_item
from validate_phrases import collect_source_records, load_misattributed, validate_records


ROOT = Path(__file__).resolve().parents[1]
PHRASE_ROOT = ROOT / "assets" / "phrases"
PROGRESS_PATH = PHRASE_ROOT / "_progress.json"


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _read_source_data() -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
    raw_records, errors = collect_source_records()
    normalized: dict[str, list[dict[str, Any]]] = {}
    for collection, items in raw_records.items():
        normalized[collection] = [normalize_item(item, collection, position) for position, item in enumerate(items, start=1)]
    return normalized, errors


def _write_pack(collection: str, items: list[dict[str, Any]]) -> None:
    payload = {
        "schemaVersion": 1,
        "collection": collection,
        "title": COLLECTIONS[collection]["title"],
        "count": len(items),
        "items": items,
    }
    output = PHRASE_ROOT / f"{collection}.js"
    output.write_text(f"globalThis.TF_PHRASE_DATA=globalThis.TF_PHRASE_DATA||{{}};globalThis.TF_PHRASE_DATA[{_json(collection)}]={_json(payload)};\n", encoding="utf-8")


def _build_index(records: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    collections: dict[str, Any] = {}
    for collection, spec in COLLECTIONS.items():
        items = records[collection]
        topics = sorted({topic for item in items for topic in item.get("topics", [])}, key=str.casefold)
        levels: dict[str, int] = {}
        for item in items:
            level = str(item.get("level", "unrated"))
            levels[level] = levels.get(level, 0) + 1
        collections[collection] = {
            "title": spec["title"],
            "target": spec["target"],
            "count": len(items),
            "topics": topics,
            "levels": levels,
            "status": "ready" if items else "empty",
        }
    return {"schemaVersion": 1, "updated": date.today().isoformat(), "collections": collections}


def _update_progress(records: dict[str, list[dict[str, Any]]]) -> None:
    if PROGRESS_PATH.exists():
        progress = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
    else:
        progress = {"schemaVersion": 1, "phase": 0, "targets": {}, "existingInHtml": {}}
    progress.setdefault("targets", {key: spec["target"] for key, spec in COLLECTIONS.items()})
    existing = progress.setdefault("existingInHtml", {key: 0 for key in COLLECTIONS})
    progress.setdefault("migratedExisting", {key: 0 for key in COLLECTIONS})
    progress.setdefault("authoredNew", {key: 0 for key in COLLECTIONS})
    asset_items: dict[str, int] = {}
    completed: dict[str, int] = {}
    for collection, items in records.items():
        count = len(items)
        baseline = int(existing.get(collection, 0))
        asset_items[collection] = count
        completed[collection] = max(baseline, count)
        progress["migratedExisting"][collection] = min(baseline, count)
        progress["authoredNew"][collection] = max(0, count - baseline)
    progress["assetItems"] = asset_items
    progress["completed"] = completed
    progress["updated"] = date.today().isoformat()
    PROGRESS_PATH.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    records, source_errors = _read_source_data()
    validation_errors, warnings = validate_records(records, load_misattributed())
    errors = source_errors + validation_errors
    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"Build stopped: {len(errors)} validation error(s)")
        return 1

    PHRASE_ROOT.mkdir(parents=True, exist_ok=True)
    for collection, items in records.items():
        _write_pack(collection, items)
    manifest = _build_index(records)
    (PHRASE_ROOT / "index.js").write_text(f"globalThis.TF_PHRASE_INDEX={_json(manifest)};\n", encoding="utf-8")
    _update_progress(records)

    for collection, items in records.items():
        print(f"{collection}: {len(items)} / {COLLECTIONS[collection]['target']}")
    print("Built assets/phrases/index.js and all three phrase data scripts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
