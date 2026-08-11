"""Build exact PDF heading boundaries and the persistent editing tracker.

The PDF often starts a new lesson midway through a page. Printed TOC page
numbers also drift from physical PDF pages in the latter half of the book, so
every entry is anchored by both physical page number and vertical position.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "教你炒股票--阿娇版.pdf"
BOOK_PATH = ROOT / "data" / "book.json"
MANIFEST_PATH = ROOT / "data" / "source_manifest.json"
TRACKER_PATH = ROOT / "docs" / "editing-progress.md"
HEADER_BOTTOM = 65.0
FOOTER_TOP = 780.0


def compact(value: str) -> str:
    value = value.translate(str.maketrans({"：": ":", "，": ",", "！": "!", "？": "?"}))
    value = re.sub(r"\(cid:\d+\)", "", value)
    return re.sub(r"\s+", "", value)


def grouped_lines(page) -> list[dict]:
    words = page.extract_words(
        x_tolerance=2,
        y_tolerance=3,
        use_text_flow=False,
        extra_attrs=["fontname", "size"],
    )
    groups: dict[float, list[dict]] = defaultdict(list)
    for word in words:
        if word["top"] < HEADER_BOTTOM or word["top"] > FOOTER_TOP:
            continue
        key = round(word["top"], 1)
        groups[key].append(word)

    lines = []
    for top, items in sorted(groups.items()):
        items.sort(key=lambda item: item["x0"])
        lines.append(
            {
                "top": top,
                "text": "".join(item["text"] for item in items),
                "max_size": max(float(item["size"]) for item in items),
            }
        )
    return lines


def find_anchors(pdf) -> dict[str, dict]:
    candidates: dict[int, list[dict]] = defaultdict(list)
    preface_candidates: list[dict] = []
    appendix_candidates: dict[str, list[dict]] = {"901": [], "902": []}

    # Pages 1-3 are the printed TOC and must never become content anchors.
    for page_number, page in enumerate(pdf.pages[3:], start=4):
        for line in grouped_lines(page):
            normalized = compact(line["text"])
            if normalized.startswith("股市闲谈:G股是G点,大牛不用套!"):
                preface_candidates.append(
                    {"page": page_number, "top": line["top"], "text": line["text"]}
                )
                continue
            if normalized == "缠师心法荟萃":
                appendix_candidates["901"].append(
                    {"page": page_number, "top": line["top"], "text": line["text"]}
                )
                continue
            if normalized == "缠论经典":
                appendix_candidates["902"].append(
                    {"page": page_number, "top": line["top"], "text": line["text"]}
                )
                continue

            match = re.match(r"^(?:\(cid:\d+\))*教你炒股票(\d{1,3})(?::|：)?", normalized)
            if not match:
                continue
            number = int(match.group(1))
            if 1 <= number <= 108:
                candidates[number].append(
                    {
                        "page": page_number,
                        "top": line["top"],
                        "text": line["text"],
                        "max_size": line["max_size"],
                    }
                )

    # Lesson 76's visible number is encoded into a separate malformed text
    # fragment ("762") in this PDF, so the title line itself has no parseable
    # lesson number. Keep the audited physical anchor explicit.
    if not candidates[76]:
        candidates[76].append(
            {
                "page": 755,
                "top": 344.8,
                "text": "教你炒股票 76：逗庄家玩的一些杂史 2",
                "max_size": 16.0,
            }
        )

    assert preface_candidates, "missing preface anchor"
    missing = [number for number in range(1, 109) if not candidates[number]]
    assert not missing, f"missing lesson anchors: {missing}"

    anchors = {
        "000": min(preface_candidates, key=lambda item: (item["page"], item["top"]))
    }
    for number in range(1, 109):
        # Some lessons are quoted again later with title-sized text. The first
        # title-starting occurrence after the TOC is the actual chapter anchor.
        chosen = min(candidates[number], key=lambda item: (item["page"], item["top"]))
        chosen.pop("max_size", None)
        anchors[f"{number:03d}"] = chosen
    for entry_id, items in appendix_candidates.items():
        assert items, f"missing appendix anchor: {entry_id}"
        anchors[entry_id] = min(items, key=lambda item: (item["page"], item["top"]))
    return anchors


def source_sha256() -> str:
    digest = hashlib.sha256()
    with PDF_PATH.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest() -> dict:
    assert PDF_PATH.is_file(), f"missing source PDF: {PDF_PATH}"
    book = json.loads(BOOK_PATH.read_text(encoding="utf-8"))
    metadata = {chapter["id"]: chapter for chapter in book["chapters"]}
    expected_ids = ["000", *[f"{number:03d}" for number in range(1, 109)], "901", "902"]
    assert list(metadata) == expected_ids, (
        "book.json must contain preface, lessons 1-108, and both appendices in source order"
    )

    with pdfplumber.open(PDF_PATH) as pdf:
        anchors = find_anchors(pdf)
        page_count = len(pdf.pages)

    entries = []
    for index, entry_id in enumerate(expected_ids):
        item = metadata[entry_id]
        anchor = anchors[entry_id]
        next_anchor = anchors[expected_ids[index + 1]] if index + 1 < len(expected_ids) else None
        entries.append(
            {
                "id": entry_id,
                "number": item["number"],
                "kind": item.get("kind", "lesson"),
                "title": item["title"],
                "start": {"page": anchor["page"], "top": anchor["top"]},
                "end": (
                    {"page": next_anchor["page"], "top": next_anchor["top"]}
                    if next_anchor
                    else {"page": page_count + 1, "top": HEADER_BOTTOM}
                ),
            }
        )

    return {
        "schemaVersion": 1,
        "source": {
            "filename": PDF_PATH.name,
            "sha256": source_sha256(),
            "pageCount": page_count,
        },
        "entryCount": len(entries),
        "lessonCount": 108,
        "appendixCount": 2,
        "entries": entries,
    }


def boundary_label(entry: dict) -> str:
    start = entry["start"]
    end = entry["end"]
    return f"{start['page']}@{start['top']:.1f} → {end['page']}@{end['top']:.1f}"


def write_tracker(manifest: dict, *, overwrite: bool = False) -> None:
    if TRACKER_PATH.exists() and not overwrite:
        raise FileExistsError(f"refusing to overwrite persistent tracker: {TRACKER_PATH}")

    rows = []
    for entry in manifest["entries"]:
        if entry["kind"] == "preface":
            label = "股市闲谈"
        elif entry["kind"] == "appendix":
            label = f"附录 {entry['number']}"
        else:
            label = f"第 {entry['number']} 课"
        edit_status = "需补全（当前仅样章正文）" if entry["id"] == "018" else "待编辑"
        rows.append(
            f"| {entry['id']} | {label}｜{entry['title']} | `{boundary_label(entry)}` | "
            f"{edit_status} | 待安排 | 待处理 | 未通过 |"
        )

    sha = manifest["source"]["sha256"]
    content = f"""# 《教你炒股票--阿娇版》逐章编辑台账

> 本文件是全书编辑的唯一状态台账。每完成“编辑、Agent Review、修订、最终确认”中的任一步，必须立即更新对应行，不能事后集中补记。

## 源文件基线

- 源文件：`教你炒股票--阿娇版.pdf`
- PDF 页数：{manifest['source']['pageCount']}
- SHA256：`{sha}`
- 内容范围：108 课 + 1 篇“股市闲谈” + 2 篇附录，共 {manifest['entryCount']} 篇
- 精确边界：`data/source_manifest.json`，格式为 `PDF物理页@页内纵坐标`

## 单章完成标准

1. 编辑：从本章标题锚点到下一章标题锚点，正文、解盘、问答、原书批注和图片全部落地；只规范断行、空格与明显 OCR 字形，不擅自改写原意。
2. Agent Review：独立 Agent 对照原 PDF 页面和页内边界，核对标题、日期、段落顺序、数字、公式、问答归属、图片数量及图注，并留下可审计结论。
3. 修订：逐项处理 Review 发现的问题；若无问题也要标记“无需修改”。
4. 最终确认：章节数据校验通过，站点可载入，台账状态改为“通过”。

## 全书状态

- [x] 建立 111 篇目录与精确 PDF 边界
- [ ] 111 篇全部编辑完成
- [ ] 111 篇全部完成 Agent Review
- [ ] 111 篇全部完成 Review 修订
- [ ] 全书跨章边界与章节数量终审通过
- [ ] GitHub Pages 全量部署与线上核验通过

## 逐章任务

| ID | 篇目 | PDF 精确范围 | 编辑 | Agent Review | 修订 | 最终 |
|---:|---|---|---|---|---|---|
{chr(10).join(rows)}
"""
    TRACKER_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRACKER_PATH.write_text(content, encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh-tracker",
        action="store_true",
        help="replace the tracker only while establishing the initial source baseline",
    )
    args = parser.parse_args()
    manifest = build_manifest()
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    write_tracker(manifest, overwrite=args.refresh_tracker)
    print(
        f"OK: wrote {manifest['entryCount']} exact boundaries to "
        f"{MANIFEST_PATH.relative_to(ROOT)} and initialized {TRACKER_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
