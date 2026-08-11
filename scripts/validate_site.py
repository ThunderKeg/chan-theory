import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def validate_block(block: dict, location: str):
    block_type = block.get("type")
    assert block_type in {"paragraph", "annotation", "editor-note", "definitions", "theorem"}, (
        f"{location}: unsupported block type {block_type!r}"
    )
    if block_type == "definitions":
        assert block.get("items"), f"{location}: definitions must contain items"
        for index, item in enumerate(block["items"]):
            assert item.get("term") and item.get("text"), f"{location}.items[{index}]: incomplete definition"
    else:
        assert block.get("text"), f"{location}: text is required"
    if block_type in {"annotation", "editor-note"}:
        assert block.get("label"), f"{location}: note label is required"
    if block_type == "theorem":
        assert block.get("title"), f"{location}: theorem title is required"


def main():
    book = load_json(ROOT / "data" / "book.json")
    chapters = book["chapters"]
    assert len(chapters) == book["totalChapters"] == 108
    assert [chapter["number"] for chapter in chapters] == list(range(1, 109))
    assert len({chapter["id"] for chapter in chapters}) == len(chapters)

    available = [chapter for chapter in chapters if chapter["available"]]
    assert [chapter["id"] for chapter in available] == [book["sampleChapter"]]

    for metadata in available:
        chapter_path = ROOT / "data" / "chapters" / f"{metadata['id']}.json"
        assert chapter_path.is_file(), f"missing {chapter_path.relative_to(ROOT)}"
        chapter = load_json(chapter_path)
        assert chapter["id"] == metadata["id"]
        assert chapter["number"] == metadata["number"]
        assert chapter["title"] == metadata["title"]
        assert len(chapter["sourcePages"]) == 2
        assert chapter["sourcePages"][0] <= chapter["sourcePages"][1]
        for index, block in enumerate(chapter["intro"]):
            validate_block(block, f"{metadata['id']}.intro[{index}]")
        section_ids = set()
        for section_index, section in enumerate(chapter["sections"]):
            assert section.get("id") and section.get("title") and section.get("blocks")
            assert section["id"] not in section_ids, f"duplicate section id {section['id']}"
            section_ids.add(section["id"])
            for block_index, block in enumerate(section["blocks"]):
                validate_block(block, f"{metadata['id']}.sections[{section_index}].blocks[{block_index}]")

    print(f"OK: {len(chapters)} TOC entries, {len(available)} sample chapter, structured content valid")


if __name__ == "__main__":
    main()
