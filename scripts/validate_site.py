import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def validate_block(block: dict, location: str):
    block_type = block.get("type")
    assert block_type in {
        "paragraph",
        "annotation",
        "editor-note",
        "definitions",
        "theorem",
        "heading",
        "image",
        "divider",
    }, (
        f"{location}: unsupported block type {block_type!r}"
    )
    if block_type == "divider":
        return
    if block_type == "image":
        assert block.get("src") and block.get("alt"), f"{location}: image metadata is required"
        return
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
    manifest = load_json(ROOT / "data" / "source_manifest.json")
    chapters = book["chapters"]
    assert len(chapters) == book["totalEntries"] == 111
    assert book["lessonCount"] == 108
    assert book["appendixCount"] == 2
    assert chapters[0]["id"] == "000" and chapters[0]["kind"] == "preface"
    lessons = [chapter for chapter in chapters if chapter.get("kind", "lesson") == "lesson"]
    appendices = [chapter for chapter in chapters if chapter.get("kind") == "appendix"]
    assert [chapter["number"] for chapter in lessons] == list(range(1, 109))
    assert [chapter["number"] for chapter in appendices] == [1, 2]
    assert len({chapter["id"] for chapter in chapters}) == len(chapters)

    manifest_entries = manifest["entries"]
    assert manifest["entryCount"] == len(manifest_entries) == len(chapters)
    assert manifest["lessonCount"] == book["lessonCount"]
    assert manifest["appendixCount"] == book["appendixCount"]
    assert manifest["source"]["pageCount"] == 1262
    assert len(manifest["source"]["sha256"]) == 64
    for index, (metadata, source_entry) in enumerate(zip(chapters, manifest_entries)):
        expected_kind = metadata.get("kind", "lesson")
        assert source_entry["id"] == metadata["id"], f"entry {index}: id drift"
        assert source_entry["number"] == metadata["number"], f"{metadata['id']}: number drift"
        assert source_entry.get("kind", "lesson") == expected_kind, f"{metadata['id']}: kind drift"
        assert source_entry["title"] == metadata["title"], f"{metadata['id']}: title drift"
        if index + 1 < len(manifest_entries):
            assert source_entry["end"] == manifest_entries[index + 1]["start"], (
                f"{metadata['id']}: boundary does not meet next chapter"
            )

    available = [chapter for chapter in chapters if chapter["available"]]
    assert any(chapter["id"] == book["sampleChapter"] for chapter in available)

    for metadata in available:
        chapter_path = ROOT / "data" / "chapters" / f"{metadata['id']}.json"
        assert chapter_path.is_file(), f"missing {chapter_path.relative_to(ROOT)}"
        chapter = load_json(chapter_path)
        assert chapter["id"] == metadata["id"]
        assert chapter["number"] == metadata["number"]
        assert chapter["title"] == metadata["title"]
        assert chapter.get("kind", "lesson") == metadata.get("kind", "lesson")
        assert len(chapter["sourcePages"]) == 2
        assert chapter["sourcePages"][0] <= chapter["sourcePages"][1]
        source_entry = manifest_entries[[item["id"] for item in manifest_entries].index(metadata["id"])]
        if chapter.get("schemaVersion") == 2:
            audit = chapter["sourceAudit"]
            assert audit["start"] == source_entry["start"], f"{metadata['id']}: start boundary drift"
            assert audit["end"] == source_entry["end"], f"{metadata['id']}: end boundary drift"
            source_path = ROOT / "data" / "source" / f"{metadata['id']}.json"
            assert source_path.is_file(), f"missing {source_path.relative_to(ROOT)}"
            source = load_json(source_path)
            assert source["start"] == audit["start"] and source["end"] == audit["end"]
            assert source["eventSha256"] == audit["eventSha256"]
            assert source["lineCount"] == audit["lineCount"]
            assert source["imageCount"] == audit["imageCount"]
        for index, block in enumerate(chapter["intro"]):
            validate_block(block, f"{metadata['id']}.intro[{index}]")
            if block.get("type") == "image":
                assert block["src"].startswith(f"assets/book-images/{metadata['id']}/"), (
                    f"{metadata['id']}.intro[{index}]: image must stay inside its chapter cache boundary"
                )
        section_ids = set()
        for section_index, section in enumerate(chapter["sections"]):
            assert section.get("id") and section.get("title") and section.get("blocks")
            assert section["id"] not in section_ids, f"duplicate section id {section['id']}"
            section_ids.add(section["id"])
            for block_index, block in enumerate(section["blocks"]):
                validate_block(block, f"{metadata['id']}.sections[{section_index}].blocks[{block_index}]")
                if block.get("type") == "image":
                    assert block["src"].startswith(f"assets/book-images/{metadata['id']}/"), (
                        f"{metadata['id']}.sections[{section_index}].blocks[{block_index}]: "
                        "image must stay inside its chapter cache boundary"
                    )

    manifest_path = ROOT / "manifest.webmanifest"
    service_worker_path = ROOT / "service-worker.js"
    app_path = ROOT / "assets" / "app.js"
    styles_path = ROOT / "assets" / "styles.css"
    index_path = ROOT / "index.html"
    pwa_manifest = load_json(manifest_path)
    assert pwa_manifest["start_url"] == "./?resume=1"
    assert pwa_manifest["scope"] == "./"
    assert pwa_manifest["display"] == "standalone"
    icon_sizes = {icon["sizes"] for icon in pwa_manifest["icons"]}
    assert {"192x192", "512x512"}.issubset(icon_sizes)
    for icon in pwa_manifest["icons"]:
        assert (ROOT / icon["src"]).is_file(), f"missing PWA icon {icon['src']}"
    assert (ROOT / "assets" / "icons" / "icon-180.png").is_file()

    index_text = index_path.read_text(encoding="utf-8")
    app_text = app_path.read_text(encoding="utf-8")
    styles_text = styles_path.read_text(encoding="utf-8")
    worker_text = service_worker_path.read_text(encoding="utf-8")
    assert 'rel="manifest" href="manifest.webmanifest"' in index_text
    assert 'rel="apple-touch-icon"' in index_text
    assert 'id="install-app"' in index_text
    assert 'id="resume-reading"' in index_text
    assert 'id="image-viewer"' in index_text
    assert 'id="update-banner"' in index_text and 'id="update-now"' in index_text
    assert "viewport-fit=cover" in index_text
    assert "beforeinstallprompt" in app_text and "registerServiceWorker" in app_text
    assert "controllerchange" in app_text and "showUpdateBanner" in app_text
    assert "CACHE_CHAPTER" in app_text and "CACHE_CHAPTER" in worker_text
    assert "CHAPTER_CACHE_PREFIX" in worker_text and "chapterCacheName" in worker_text
    assert "data-reading-anchor" in app_text and "updatedAt" in app_text
    assert "openImageViewer" in app_text and "handleViewerPointerMove" in app_text
    assert "touch-action: none" in styles_text and "env(safe-area-inset" in styles_text
    shell_match = re.search(r"const SHELL_ASSETS = \[(.*?)\];", worker_text, re.DOTALL)
    assert shell_match, "service worker shell assets are missing"
    shell_assets = shell_match.group(1)
    assert "data/chapters/" not in shell_assets, "chapters must not be precached as a full book"
    assert "assets/book-images/" not in shell_assets, "book images must be cached per visited chapter"

    print(
        f"OK: {len(chapters)} TOC entries (108 lessons + preface + 2 appendices), "
        f"{len(available)} available chapter, structured content and PWA contracts valid"
    )


if __name__ == "__main__":
    main()
