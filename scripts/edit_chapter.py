"""Create a conservative, source-linked chapter draft from extracted events.

This is the editing baseline, not the final fidelity decision. Every generated
chapter must still receive an independent Agent Review against the PDF.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "source"
CHAPTER_DIR = ROOT / "data" / "chapters"

CID_REPLACEMENTS = {
    "6655": "描",
    "6656": "提",
    "15359": "藏",
    "766": "b",
}

SENTENCE_END = set("。！？；：”’）】…")
HEADING_PREFIXES = (
    "书蘅：",
    "附录：",
    "附：",
    "每日解盘",
    "经典回放：",
    "回复：",
    "当日回复",
)


def normalize_text(value: str) -> str:
    for code, replacement in CID_REPLACEMENTS.items():
        value = value.replace(f"(cid:{code})", replacement)
    value = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", value)
    value = re.sub(r"\s+([，。！？；：、）】》])", r"\1", value)
    value = re.sub(r"([（【《])\s+", r"\1", value)
    value = re.sub(r"([，。！？；：、])\s+(?=\S)", r"\1", value)
    value = re.sub(r"\s+([“‘])", r"\1", value)
    value = re.sub(r"(?<=[\u3400-\u9fff])(?=[A-Za-z])", " ", value)
    value = re.sub(r"(?<=[A-Za-z])(?=[\u3400-\u9fff])", " ", value)
    value = re.sub(r"\s{2,}", " ", value)
    return value.strip()


def join_lines(parts: list[str]) -> str:
    result = ""
    for part in parts:
        part = normalize_text(part)
        if not part:
            continue
        separator = ""
        if result and result[-1].isascii() and result[-1].isalnum() and part[0].isascii() and part[0].isalnum():
            separator = " "
        result += separator + part
    return normalize_text(result)


def is_heading(text: str) -> bool:
    clean = normalize_text(text)
    return clean.startswith(HEADING_PREFIXES)


def starts_new_item(text: str) -> bool:
    clean = normalize_text(text)
    return bool(
        re.match(r"^(?:\[.+?\]|【.+?】|\d{1,3}[、．.]|[一二三四五六七八九十]+、|==)", clean)
    )


def extract_header(source: dict) -> tuple[str | None, list[dict]]:
    events = list(source["events"])
    if not events or events[0]["type"] != "line":
        raise ValueError(f"{source['id']}: first source event is not the chapter heading")

    if source["kind"] == "appendix":
        return None, events[1:]

    header_parts = []
    consumed = 0
    date = None
    title_compact = re.sub(r"\s+", "", source["title"])
    for index, event in enumerate(events):
        if event["type"] != "line":
            break
        header_parts.append(event["text"])
        consumed += 1
        compact = re.sub(r"\s+", "", "".join(header_parts))
        match = re.search(r"\((\d{4}-\d{2}-\d{2}\d{2}:\d{2}:\d{2})\)", compact)
        if match:
            raw = match.group(1)
            date = f"{raw[:10]} {raw[10:]}"
            break
        title_complete = title_compact in compact
        date_started = bool(re.search(r"\(\d{4}-", compact))
        if title_complete and not date_started:
            next_event = events[index + 1] if index + 1 < len(events) else None
            next_text = next_event.get("text", "") if next_event else ""
            if not re.match(r"^\s*\(\d{4}-", next_text):
                return None, events[consumed:]
        if consumed >= 5:
            raise ValueError(f"{source['id']}: could not parse publication date from heading")
    return date, events[consumed:]


def source_ref(first: dict, last: dict) -> dict:
    return {
        "start": {"page": first["page"], "top": first["top"]},
        "end": {"page": last["page"], "top": last["bottom"]},
    }


def build_blocks(source: dict, events: list[dict]) -> list[dict]:
    blocks: list[dict] = []
    paragraph_events: list[dict] = []
    previous_line: dict | None = None

    def flush_paragraph() -> None:
        nonlocal paragraph_events
        if not paragraph_events:
            return
        text = join_lines([event["text"] for event in paragraph_events])
        if text:
            blocks.append(
                {
                    "type": "paragraph",
                    "text": text,
                    "source": source_ref(paragraph_events[0], paragraph_events[-1]),
                }
            )
        paragraph_events = []

    for event in events:
        if event["type"] == "image":
            flush_paragraph()
            blocks.append(
                {
                    "type": "image",
                    "src": event["src"],
                    "alt": f"原书图示，PDF 第 {event['page']} 页",
                    "caption": f"原书图示 · PDF 第 {event['page']} 页",
                    "source": {
                        "page": event["page"],
                        "top": event["top"],
                        "bottom": event["bottom"],
                        "sha256": event["sha256"],
                    },
                }
            )
            previous_line = None
            continue

        text = normalize_text(event["text"])
        if not text:
            continue
        if re.fullmatch(r"=+", text):
            flush_paragraph()
            blocks.append({"type": "divider", "source": source_ref(event, event)})
            previous_line = None
            continue
        if is_heading(text):
            flush_paragraph()
            blocks.append(
                {
                    "type": "heading",
                    "text": text,
                    "source": source_ref(event, event),
                }
            )
            previous_line = event
            continue

        new_paragraph = False
        if paragraph_events and previous_line:
            if event["page"] == previous_line["page"]:
                gap = event["top"] - previous_line["bottom"]
                new_paragraph = gap > 9 or event["x0"] >= 104 or starts_new_item(text)
            else:
                previous_text = normalize_text(previous_line["text"])
                new_paragraph = event["x0"] >= 104 or (
                    bool(previous_text) and previous_text[-1] in SENTENCE_END
                )
        if new_paragraph:
            flush_paragraph()
        paragraph_events.append(event)
        previous_line = event

    flush_paragraph()
    return blocks


def build_chapter(source: dict) -> dict:
    date, body_events = extract_header(source)
    blocks = build_blocks(source, body_events)
    text_chars = sum(len(block.get("text", "")) for block in blocks)
    kind = source["kind"]
    if kind == "preface":
        kicker = "开篇闲谈"
    elif kind == "appendix":
        kicker = f"附录 {source['number']}"
    else:
        kicker = f"第 {source['number']} 课"
    end_page = min(source["end"]["page"], 1262)
    return {
        "schemaVersion": 2,
        "id": source["id"],
        "number": source["number"],
        "kind": kind,
        "kicker": kicker,
        "title": source["title"],
        "date": date,
        "sourcePages": [source["start"]["page"], end_page],
        "readingMinutes": max(1, math.ceil(text_chars / 500)),
        "sourceAudit": {
            "start": source["start"],
            "end": source["end"],
            "eventSha256": source["eventSha256"],
            "lineCount": source["lineCount"],
            "imageCount": source["imageCount"],
        },
        "intro": [],
        "sections": [
            {
                "id": "source-text",
                "title": "原文",
                "blocks": blocks,
            }
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("entry_ids", nargs="+")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="replace an existing edited chapter draft",
    )
    args = parser.parse_args()
    CHAPTER_DIR.mkdir(parents=True, exist_ok=True)

    for entry_id in args.entry_ids:
        source_path = SOURCE_DIR / f"{entry_id}.json"
        if not source_path.is_file():
            raise FileNotFoundError(f"extract source first: {source_path}")
        output_path = CHAPTER_DIR / f"{entry_id}.json"
        if output_path.exists() and not args.overwrite:
            raise FileExistsError(f"refusing to overwrite edited chapter: {output_path}")
        source = json.loads(source_path.read_text(encoding="utf-8"))
        chapter = build_chapter(source)
        output_path.write_text(
            json.dumps(chapter, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        block_count = sum(len(section["blocks"]) for section in chapter["sections"])
        print(
            f"OK {entry_id}: {block_count} blocks, {chapter['readingMinutes']} min draft -> "
            f"{output_path.relative_to(ROOT)}"
        )


if __name__ == "__main__":
    main()
