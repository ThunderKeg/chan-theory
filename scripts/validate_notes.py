import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTES_ROOT = ROOT / "data" / "notes"
REQUIRED_NOTE_FIELDS = {
    "schemaVersion",
    "id",
    "chapterId",
    "type",
    "title",
    "tags",
    "sourceRefs",
    "content",
}
NOTE_TYPES = {"summary", "decision-tree"}
NATURES = {"原文提炼", "个人理解", "延伸推演"}
LIKELIHOODS = {"少见", "最常见", "概率较大", "概率很大", "方向不明", "需要确认"}
NUMERIC_PROBABILITY = re.compile(r"(?:\d+(?:\.\d+)?\s*%|百分之\s*[零一二三四五六七八九十百\d]+)")


def load_json(path: Path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def validate_source_refs(note: dict, chapters_by_id: dict[str, dict]):
    refs = note["sourceRefs"]
    assert isinstance(refs, list) and refs, f"{note['id']}: sourceRefs must not be empty"
    for index, ref in enumerate(refs):
        location = f"{note['id']}.sourceRefs[{index}]"
        chapter_id = ref.get("chapterId")
        assert chapter_id in chapters_by_id, f"{location}: unknown chapter {chapter_id!r}"
        assert ref.get("description"), f"{location}: description is required"
        pages = ref.get("pages")
        assert isinstance(pages, list) and len(pages) == 2 and pages[0] <= pages[1], (
            f"{location}: pages must be an ordered pair"
        )
        chapter_path = ROOT / "data" / "chapters" / f"{chapter_id}.json"
        assert chapter_path.is_file(), f"{location}: missing chapter data"
        chapter = load_json(chapter_path)
        section_ids = {section["id"] for section in chapter.get("sections", [])}
        assert ref.get("sectionId") in section_ids, f"{location}: unknown section reference"
        source_pages = chapter["sourcePages"]
        assert source_pages[0] <= pages[0] <= pages[1] <= source_pages[1], (
            f"{location}: pages fall outside the chapter source range"
        )


def validate_summary(note: dict):
    content = note["content"]
    assert content.get("lead"), f"{note['id']}: summary lead is required"
    paragraphs = content.get("paragraphs", [])
    items = content.get("items", [])
    assert paragraphs or items, f"{note['id']}: summary content is empty"
    assert all(isinstance(value, str) and value.strip() for value in paragraphs), (
        f"{note['id']}: summary paragraphs must be non-empty strings"
    )
    assert all(isinstance(value, str) and value.strip() for value in items), (
        f"{note['id']}: summary items must be non-empty strings"
    )


def validate_decision_tree(note: dict):
    content = note["content"]
    assert content.get("lead") and content.get("principle"), (
        f"{note['id']}: decision tree lead and principle are required"
    )
    nodes = content.get("nodes")
    assert isinstance(nodes, list) and nodes, f"{note['id']}: decision tree nodes are required"
    nodes_by_id = {node.get("id"): node for node in nodes}
    assert None not in nodes_by_id and len(nodes_by_id) == len(nodes), (
        f"{note['id']}: decision tree node IDs must be present and unique"
    )
    root_id = content.get("rootId")
    assert root_id in nodes_by_id, f"{note['id']}: rootId does not reference a node"

    for node_id, node in nodes_by_id.items():
        location = f"{note['id']}.nodes[{node_id}]"
        assert node.get("kind") in {"question", "result"}, f"{location}: invalid kind"
        assert node.get("title") and node.get("detail"), f"{location}: title and detail are required"
        if node["kind"] == "question":
            branches = node.get("branches")
            assert isinstance(branches, list) and len(branches) >= 2, (
                f"{location}: questions need at least two branches"
            )
            labels = [branch.get("label") for branch in branches]
            assert None not in labels and len(set(labels)) == len(labels), (
                f"{location}: branch labels must be present and unique"
            )
            for branch_index, branch in enumerate(branches):
                branch_location = f"{location}.branches[{branch_index}]"
                assert branch.get("likelihood") in LIKELIHOODS, (
                    f"{branch_location}: invalid likelihood"
                )
                assert branch.get("to") in nodes_by_id, f"{branch_location}: missing target node"
        else:
            assert node.get("likelihood") in LIKELIHOODS, f"{location}: invalid likelihood"
            assert node.get("action"), f"{location}: result action is required"
            assert "branches" not in node, f"{location}: results cannot contain branches"

    visited = set()
    active = set()

    def visit(node_id: str):
        assert node_id not in active, f"{note['id']}: decision tree contains a cycle at {node_id}"
        if node_id in visited:
            return
        active.add(node_id)
        node = nodes_by_id[node_id]
        for branch in node.get("branches", []):
            visit(branch["to"])
        active.remove(node_id)
        visited.add(node_id)

    visit(root_id)
    unreachable = set(nodes_by_id) - visited
    assert not unreachable, f"{note['id']}: unreachable decision tree nodes {sorted(unreachable)}"
    return len(nodes)


def validate_notes():
    book = load_json(ROOT / "data" / "book.json")
    chapters_by_id = {chapter["id"]: chapter for chapter in book["chapters"]}
    index = load_json(NOTES_ROOT / "index.json")
    assert index.get("schemaVersion") == 1, "notes index: unsupported schema version"
    entries = index.get("chapters")
    assert isinstance(entries, list), "notes index: chapters must be a list"
    assert len({entry.get("chapterId") for entry in entries}) == len(entries), (
        "notes index: chapter IDs must be unique"
    )

    all_note_ids = set()
    note_count = 0
    tree_node_count = 0
    for entry in entries:
        chapter_id = entry.get("chapterId")
        assert chapter_id in chapters_by_id, f"notes index: unknown chapter {chapter_id!r}"
        expected_path = f"data/notes/{chapter_id}.json"
        assert entry.get("path") == expected_path, (
            f"notes index {chapter_id}: path must follow the chapter convention"
        )
        note_path = ROOT / entry["path"]
        assert note_path.is_file(), f"notes index {chapter_id}: missing {entry['path']}"
        bundle = load_json(note_path)
        assert bundle.get("schemaVersion") == 1, f"{entry['path']}: unsupported schema version"
        assert bundle.get("chapterId") == chapter_id, f"{entry['path']}: chapterId drift"
        notes = bundle.get("notes")
        assert isinstance(notes, list) and notes, f"{entry['path']}: notes must not be empty"
        assert entry.get("count") == len(notes), f"notes index {chapter_id}: count drift"
        summaries = entry.get("notes")
        assert isinstance(summaries, list) and len(summaries) == len(notes), (
            f"notes index {chapter_id}: note summaries drift"
        )

        for note, summary in zip(notes, summaries):
            assert set(note) == REQUIRED_NOTE_FIELDS, (
                f"{entry['path']}:{note.get('id')}: keep only the supported note fields"
            )
            assert note["schemaVersion"] == 1, f"{note['id']}: unsupported schema version"
            assert note["chapterId"] == chapter_id, f"{note['id']}: chapterId drift"
            assert note["type"] in NOTE_TYPES, f"{note['id']}: unsupported note type"
            assert note["id"] not in all_note_ids, f"duplicate note id {note['id']}"
            all_note_ids.add(note["id"])
            assert note["title"] and isinstance(note["tags"], list), f"{note['id']}: title/tags required"
            assert not NUMERIC_PROBABILITY.search(json.dumps(note, ensure_ascii=False)), (
                f"{note['id']}: numeric probability is not allowed without backtest evidence"
            )
            assert summary == {key: note[key] for key in ("id", "type", "title", "tags")}, (
                f"notes index {chapter_id}: summary does not match {note['id']}"
            )
            nature = note["content"].get("nature")
            assert isinstance(nature, list) and nature and set(nature) <= NATURES, (
                f"{note['id']}: invalid content nature"
            )
            validate_source_refs(note, chapters_by_id)
            if note["type"] == "summary":
                validate_summary(note)
            else:
                tree_node_count += validate_decision_tree(note)
            note_count += 1

    return len(entries), note_count, tree_node_count


def main():
    chapter_count, note_count, tree_node_count = validate_notes()
    print(
        f"OK: {chapter_count} chapter note bundle, {note_count} notes, "
        f"{tree_node_count} complete decision-tree nodes"
    )


if __name__ == "__main__":
    main()
