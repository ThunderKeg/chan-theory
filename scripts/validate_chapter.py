"""Validate one edited chapter against its immutable extracted source events."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from edit_chapter import extract_header, normalize_text


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "source"
CHAPTER_DIR = ROOT / "data" / "chapters"


def comparable(value: str) -> str:
    return re.sub(r"\s+", "", normalize_text(value))


def validate(entry_id: str) -> None:
    source = json.loads((SOURCE_DIR / f"{entry_id}.json").read_text(encoding="utf-8"))
    chapter = json.loads((CHAPTER_DIR / f"{entry_id}.json").read_text(encoding="utf-8"))
    assert chapter["id"] == source["id"]
    assert chapter["title"] == source["title"]
    audit = chapter["sourceAudit"]
    assert audit["start"] == source["start"]
    assert audit["end"] == source["end"]
    assert audit["eventSha256"] == source["eventSha256"]
    assert audit["lineCount"] == source["lineCount"]
    assert audit["imageCount"] == source["imageCount"]

    _, body_events = extract_header(source)
    expected_parts = []
    expected_images = []
    for event in body_events:
        if event["type"] == "line":
            if not re.fullmatch(r"=+", event["text"].strip()):
                expected_parts.append(event["text"])
        else:
            expected_images.append((event["src"], event["sha256"]))

    blocks = [block for section in chapter["sections"] for block in section["blocks"]]
    actual_parts = []
    for block in blocks:
        if not block.get("source"):
            continue
        if block["type"] in {"paragraph", "heading", "annotation", "editor-note", "theorem"}:
            actual_parts.append(block["text"])
        elif block["type"] == "definitions":
            actual_parts.extend(
                f"{item['term']}：{item['text']}" for item in block["items"]
            )
    expected_text = comparable("".join(expected_parts))
    for correction in chapter.get("sourceCorrections", []):
        before = comparable(correction["from"])
        after = comparable(correction["to"])
        assert before in expected_text, f"correction source not found: {correction}"
        expected_text = expected_text.replace(before, after, 1)
    actual_text = comparable("".join(actual_parts))
    assert actual_text == expected_text, (
        f"{entry_id}: edited source text differs from extracted source "
        f"(expected {len(expected_text)} chars, got {len(actual_text)})"
    )

    actual_images = [
        (block["src"], block["source"]["sha256"])
        for block in blocks
        if block["type"] == "image"
    ]
    assert actual_images == expected_images, (
        f"{entry_id}: image sequence differs: expected {expected_images}, got {actual_images}"
    )
    assert "(cid:" not in actual_text, f"{entry_id}: unresolved PDF glyph remains"
    print(
        f"OK {entry_id}: {source['lineCount']} source lines, {len(actual_text)} normalized chars, "
        f"{len(actual_images)} images preserved"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("entry_ids", nargs="+")
    args = parser.parse_args()
    for entry_id in args.entry_ids:
        validate(entry_id)


if __name__ == "__main__":
    main()
