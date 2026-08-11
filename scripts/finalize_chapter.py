"""Apply repeatable editorial structure without changing source wording.

This step runs after ``edit_chapter.py`` and before independent Agent Review.
Every removal of a visible source marker is recorded in ``sourceCorrections``
so ``validate_chapter.py`` can still prove text completeness.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from edit_chapter import normalize_text


ROOT = Path(__file__).resolve().parents[1]
CHAPTER_DIR = ROOT / "data" / "chapters"


def add_correction(chapter: dict, before: str, after: str, reason: str) -> None:
    corrections = chapter.setdefault("sourceCorrections", [])
    corrections.append({"from": before, "to": after, "reason": reason})


def structure_block(chapter: dict, block: dict) -> None:
    if block["type"] not in {"paragraph", "heading", "annotation", "editor-note"}:
        return

    original = block["text"]
    text = normalize_text(original)

    marker_match = re.match(r"^(={2,})(.*)$", text, flags=re.DOTALL)
    if marker_match:
        text = marker_match.group(2).lstrip()
        add_correction(chapter, original, text, "移除原书问答排版标记")

    note_match = re.match(r"^[（(](娇(?:注)?)[：:；;](.*)[）)]$", text, flags=re.DOTALL)
    if note_match is None:
        note_match = re.match(r"^(娇注)[：:；;](.+)$", text, flags=re.DOTALL)
    if note_match:
        note_label = note_match.group(1)
        note_text = note_match.group(2).strip()
        add_correction(chapter, text, note_text, "将原书娇注前缀转为结构化标签")
        block["type"] = "editor-note"
        block["label"] = note_label
        text = note_text
    elif text in {"回复：", "公告"}:
        block["type"] = "heading"

    block["text"] = text


def finalize(entry_id: str) -> None:
    path = CHAPTER_DIR / f"{entry_id}.json"
    chapter = json.loads(path.read_text(encoding="utf-8"))
    for section in chapter["sections"]:
        blocks = section["blocks"]
        index = 0
        while index < len(blocks):
            block = blocks[index]
            if (
                block["type"] == "paragraph"
                and re.match(r"^[（(]娇(?:注)?[：:；;]", block.get("text", ""))
                and not re.search(r"[）)]$", block["text"])
                and index + 1 < len(blocks)
                and blocks[index + 1]["type"] == "paragraph"
                and re.search(r"[）)]$", blocks[index + 1].get("text", ""))
            ):
                continuation = blocks.pop(index + 1)
                block["text"] = normalize_text(block["text"] + continuation["text"])
                block["source"]["end"] = continuation["source"]["end"]
            structure_block(chapter, block)
            index += 1
    if not chapter.get("sourceCorrections"):
        chapter.pop("sourceCorrections", None)
    path.write_text(
        json.dumps(chapter, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        f"OK {entry_id}: editorial structure finalized, "
        f"{len(chapter.get('sourceCorrections', []))} auditable corrections"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("entry_ids", nargs="+")
    args = parser.parse_args()
    for entry_id in args.entry_ids:
        finalize(entry_id)


if __name__ == "__main__":
    main()
