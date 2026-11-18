"""Build static, offline-first TaylorFlow forecast packages from source JSON.

Each directory assets/forecast/src/<id>/ contains pack.json and any number of
JSON shards. A build validates source, writes assets/forecast/<id>.js, then
rebuilds assets/forecast/index.js with date-derived package statuses.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

from validate_forecast import FORECAST_ROOT, SOURCE_ROOT, ForecastValidationError, validate_source_dir


PACKAGE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(content, encoding="utf-8", newline="\n")
    os.replace(temp, path)


def build_metadata(
    source_dir: Path,
    allow_partial: bool,
    updated_override: str | None,
) -> tuple[dict[str, Any], dict[str, list[Any]], dict[str, int]]:
    if not PACKAGE_ID_PATTERN.fullmatch(source_dir.name):
        raise ForecastValidationError(f"Invalid package directory name: {source_dir.name}")
    metadata, content, counts = validate_source_dir(source_dir, allow_partial=allow_partial)
    if metadata["id"] != source_dir.name:
        raise ForecastValidationError(f"{source_dir}: directory name must match pack.json id")
    generated = dict(metadata)
    generated["updated"] = updated_override or datetime.now().astimezone().date().isoformat()
    try:
        if date.fromisoformat(generated["updated"]).isoformat() != generated["updated"]:
            raise ValueError("updated must use YYYY-MM-DD")
    except ValueError as error:
        raise ForecastValidationError(f"Invalid update date: {generated['updated']}") from error
    generated["counts"] = counts
    return generated, content, counts


def package_script(metadata: dict[str, Any], content: dict[str, list[Any]]) -> str:
    package = dict(metadata)
    package.update(content)
    package["readOnly"] = True
    return (
        "(function(root){\n"
        "  root.TF_FORECAST_PACKS = root.TF_FORECAST_PACKS || Object.create(null);\n"
        f"  root.TF_FORECAST_PACKS[{json.dumps(package['id'])}] = {json_text(package)};\n"
        "})(window);\n"
    )


def manifest_script(packages: list[dict[str, Any]], generated_on: str) -> str:
    payload = json_text(packages)
    return (
        "(function(root){\n"
        f"  const source = {payload};\n"
        "  const localDate = value => { const parts=value.split('-').map(Number); return new Date(parts[0],parts[1]-1,parts[2]); };\n"
        "  const today = new Date(); today.setHours(0,0,0,0);\n"
        "  const packs = source.map(pack => { const from=localDate(pack.validFrom); const to=localDate(pack.validTo); const status=today<from?'sắp tới':today>to?'đã qua':'hiện tại'; return Object.assign({},pack,{status}); });\n"
        "  packs.sort((a,b)=>a.validFrom.localeCompare(b.validFrom));\n"
        f"  root.TF_FORECAST_MANIFEST = {{schemaVersion:1,generatedOn:{json.dumps(generated_on)},packs}};\n"
        "})(window);\n"
    )


def source_directories(package_id: str | None) -> list[Path]:
    if package_id:
        target = SOURCE_ROOT / package_id
        if not target.is_dir():
            raise ForecastValidationError(f"Source package not found: {target}")
        return [target]
    if not SOURCE_ROOT.exists():
        return []
    return sorted(path for path in SOURCE_ROOT.iterdir() if path.is_dir() and (path / "pack.json").is_file())


def main() -> int:
    parser = argparse.ArgumentParser(description="Build static TaylorFlow forecast JavaScript assets")
    parser.add_argument("package_id", nargs="?", help="Build one package; otherwise build all package source folders")
    parser.add_argument("--allow-partial", action="store_true", help="Permit a package that is still being authored in batches")
    parser.add_argument("--validate-only", action="store_true", help="Validate packages without writing JavaScript")
    parser.add_argument("--updated", help="Set generated package update dates in YYYY-MM-DD form")
    args = parser.parse_args()
    try:
        directories = source_directories(args.package_id)
        if not directories:
            if args.validate_only:
                print("Schema ready. No forecast source packages exist yet; no files were generated.")
                return 0
            raise ForecastValidationError(f"No source packages found under {SOURCE_ROOT}")
        packages: list[dict[str, Any]] = []
        counts_by_dir: list[tuple[Path, dict[str, Any], dict[str, list[Any]], dict[str, int]]] = []
        for source_dir in directories:
            metadata, content, counts = build_metadata(source_dir, args.allow_partial, args.updated)
            packages.append(metadata)
            counts_by_dir.append((source_dir, metadata, content, counts))
        if args.validate_only:
            for _, metadata, _, counts in counts_by_dir:
                print(f"PASS {metadata['id']}: " + ", ".join(f"{key}={value}" for key, value in counts.items()))
            return 0

        for _, metadata, content, counts in counts_by_dir:
            package_path = FORECAST_ROOT / f"{metadata['id']}.js"
            atomic_write(package_path, package_script(metadata, content))
            print(f"WROTE {package_path.relative_to(FORECAST_ROOT.parent.parent)}: " + ", ".join(f"{key}={value}" for key, value in counts.items()))

        if args.package_id:
            all_directories = source_directories(None)
            packages = [build_metadata(path, args.allow_partial, args.updated)[0] for path in all_directories]
        generated_on = args.updated or datetime.now().astimezone().date().isoformat()
        try:
            if date.fromisoformat(generated_on).isoformat() != generated_on:
                raise ValueError("updated must use YYYY-MM-DD")
        except ValueError as error:
            raise ForecastValidationError(f"Invalid update date: {generated_on}") from error
        index_path = FORECAST_ROOT / "index.js"
        atomic_write(index_path, manifest_script(packages, generated_on))
        print(f"WROTE {index_path.relative_to(FORECAST_ROOT.parent.parent)} with {len(packages)} package entries")
        return 0
    except ForecastValidationError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
