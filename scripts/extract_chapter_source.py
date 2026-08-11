"""Extract auditable line/image events for one or more manifest entries."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "教你炒股票--阿娇版.pdf"
MANIFEST_PATH = ROOT / "data" / "source_manifest.json"
SOURCE_DIR = ROOT / "data" / "source"
IMAGE_ROOT = ROOT / "assets" / "book-images"
CONTENT_LEFT = 80.0
CONTENT_RIGHT = 525.0
HEADER_BOTTOM = 65.0
FOOTER_TOP = 780.0


def event_hash(events: list[dict]) -> str:
    digest = hashlib.sha256()
    for event in events:
        stable = {
            key: event[key]
            for key in ("type", "page", "top", "bottom", "x0", "text", "name", "sha256")
            if key in event
        }
        digest.update(
            json.dumps(stable, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n"
        )
    return digest.hexdigest()


def line_events(page, page_number: int, lower: float, upper: float) -> list[dict]:
    events = []
    for line in page.extract_text_lines(
        layout=False,
        strip=True,
        return_chars=False,
        x_tolerance=2,
        y_tolerance=3,
    ):
        if line["top"] < lower - 0.5 or line["top"] >= upper - 0.5:
            continue
        if line["x1"] < CONTENT_LEFT or line["x0"] > CONTENT_RIGHT:
            continue
        text = line["text"].strip()
        if not text:
            continue
        events.append(
            {
                "type": "line",
                "page": page_number,
                "top": round(float(line["top"]), 1),
                "bottom": round(float(line["bottom"]), 1),
                "x0": round(float(line["x0"]), 1),
                "x1": round(float(line["x1"]), 1),
                "text": text,
            }
        )
    return events


def image_events(
    plumber_page,
    pypdf_page,
    entry_id: str,
    page_number: int,
    lower: float,
    upper: float,
) -> list[dict]:
    pypdf_images = {Path(image.name).stem: image for image in pypdf_page.images}
    events = []
    for image in plumber_page.images:
        center = (float(image["top"]) + float(image["bottom"])) / 2
        if center < lower or center >= upper:
            continue
        name = image["name"]
        source = pypdf_images.get(name)
        if source is None:
            raise KeyError(f"page {page_number}: cannot map image object {name}")

        extension = Path(source.name).suffix.lower() or ".png"
        relative_path = Path("assets") / "book-images" / entry_id / f"page-{page_number:04d}-{name}{extension}"
        output_path = ROOT / relative_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(source.data)
        digest = hashlib.sha256(source.data).hexdigest()

        events.append(
            {
                "type": "image",
                "page": page_number,
                "top": round(float(image["top"]), 1),
                "bottom": round(float(image["bottom"]), 1),
                "x0": round(float(image["x0"]), 1),
                "x1": round(float(image["x1"]), 1),
                "name": name,
                "src": relative_path.as_posix(),
                "pixelWidth": int(source.image.width),
                "pixelHeight": int(source.image.height),
                "sha256": digest,
            }
        )
    return events


def extract_entry(entry: dict, plumber_pdf, pypdf_reader) -> dict:
    start = entry["start"]
    end = entry["end"]
    last_physical_page = min(end["page"], len(plumber_pdf.pages))
    events = []

    for page_number in range(start["page"], last_physical_page + 1):
        lower = start["top"] if page_number == start["page"] else HEADER_BOTTOM
        upper = end["top"] if page_number == end["page"] else FOOTER_TOP
        if upper <= lower:
            continue
        plumber_page = plumber_pdf.pages[page_number - 1]
        pypdf_page = pypdf_reader.pages[page_number - 1]
        page_events = line_events(plumber_page, page_number, lower, upper)
        page_events += image_events(
            plumber_page,
            pypdf_page,
            entry["id"],
            page_number,
            lower,
            upper,
        )
        page_events.sort(key=lambda item: (item["top"], 0 if item["type"] == "line" else 1))
        events.extend(page_events)

    result = {
        "schemaVersion": 1,
        "id": entry["id"],
        "number": entry["number"],
        "kind": entry["kind"],
        "title": entry["title"],
        "start": start,
        "end": end,
        "eventCount": len(events),
        "lineCount": sum(event["type"] == "line" for event in events),
        "imageCount": sum(event["type"] == "image" for event in events),
        "eventSha256": event_hash(events),
        "events": events,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "entry_ids",
        nargs="+",
        help="manifest entry IDs such as 000, 001, 018, 901, or 'all'",
    )
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    entries = {entry["id"]: entry for entry in manifest["entries"]}
    requested = list(entries) if args.entry_ids == ["all"] else args.entry_ids
    unknown = [entry_id for entry_id in requested if entry_id not in entries]
    if unknown:
        raise SystemExit(f"unknown entry IDs: {unknown}")

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    pypdf_reader = PdfReader(PDF_PATH)
    with pdfplumber.open(PDF_PATH) as plumber_pdf:
        for entry_id in requested:
            result = extract_entry(entries[entry_id], plumber_pdf, pypdf_reader)
            output = SOURCE_DIR / f"{entry_id}.json"
            output.write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            print(
                f"OK {entry_id}: {result['lineCount']} lines, {result['imageCount']} images, "
                f"sha256={result['eventSha256'][:12]}"
            )


if __name__ == "__main__":
    main()
