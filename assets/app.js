const STORAGE = {
  theme: "chan-reader-theme",
  scale: "chan-reader-scale",
  position: "chan-reader-position",
};

const SCALE_STEPS = [90, 100, 110, 120, 130];

const elements = {
  article: document.querySelector("#chapter-content"),
  chapterError: document.querySelector("#chapter-error"),
  chapterList: document.querySelector("#chapter-list"),
  fontDecrease: document.querySelector("#font-decrease"),
  fontIncrease: document.querySelector("#font-increase"),
  fontReset: document.querySelector("#font-reset"),
  progress: document.querySelector("#reading-progress-bar"),
  search: document.querySelector("#toc-search-input"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  themeToggle: document.querySelector("#theme-toggle"),
  toast: document.querySelector("#toast"),
  tocToggle: document.querySelector("#toc-toggle"),
  topbarChapter: document.querySelector("#topbar-chapter"),
};

const state = {
  book: null,
  chapter: null,
  scale: normalizeScale(Number(localStorage.getItem(STORAGE.scale)) || 100),
  toastTimer: null,
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalizeScale(scale) {
  return SCALE_STEPS.includes(scale) ? scale : 100;
}

function setScale(nextScale, announce = true) {
  state.scale = normalizeScale(nextScale);
  document.documentElement.style.setProperty("--reader-scale", `${state.scale}%`);
  elements.fontReset.textContent = `${state.scale}%`;
  localStorage.setItem(STORAGE.scale, String(state.scale));
  if (announce) showToast(`正文字号已调整为 ${state.scale}%`);
}

function shiftScale(direction) {
  const currentIndex = SCALE_STEPS.indexOf(state.scale);
  const nextIndex = Math.min(SCALE_STEPS.length - 1, Math.max(0, currentIndex + direction));
  setScale(SCALE_STEPS[nextIndex]);
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE.theme, next);
  showToast(next === "dark" ? "已切换为夜间阅读" : "已切换为日间阅读");
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function setSidebar(open) {
  document.body.classList.toggle("is-sidebar-open", open);
  elements.tocToggle.setAttribute("aria-expanded", String(open));
}

function chapterIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("chapter") || "018";
}

async function fetchJson(path) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`载入失败：${response.status}`);
  return response.json();
}

function renderToc(filter = "") {
  const query = filter.trim().toLocaleLowerCase("zh-CN");
  const chapters = state.book.chapters.filter((chapter) => {
    const haystack = `${chapter.number} ${chapter.title}`.toLocaleLowerCase("zh-CN");
    return !query || haystack.includes(query);
  });

  elements.chapterList.replaceChildren();
  if (!chapters.length) {
    elements.chapterList.append(el("p", "toc-empty", "没有匹配的课程"));
    return;
  }

  const fragment = document.createDocumentFragment();
  chapters.forEach((chapter) => {
    const button = el("button", "chapter-link");
    button.type = "button";
    button.dataset.chapterId = chapter.id;
    button.classList.toggle("is-available", chapter.available);
    button.classList.toggle("is-current", state.chapter?.id === chapter.id);
    button.setAttribute("aria-current", state.chapter?.id === chapter.id ? "page" : "false");

    button.append(
      el(
        "span",
        "chapter-link__number",
        chapter.kind === "preface"
          ? "序"
          : chapter.kind === "appendix"
            ? chapter.label
            : String(chapter.number).padStart(3, "0")
      ),
      el("span", "chapter-link__title", chapter.title),
      el("span", "chapter-link__state")
    );

    button.addEventListener("click", () => {
      if (!chapter.available) {
        const label =
          chapter.kind === "preface"
            ? "“股市闲谈”"
            : chapter.kind === "appendix"
              ? chapter.title
              : `第 ${chapter.number} 课`;
        showToast(`${label}正在逐章编辑与校对`);
        return;
      }
      setSidebar(false);
      elements.article.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    fragment.append(button);
  });
  elements.chapterList.append(fragment);
}

function renderHero(chapter) {
  const hero = el("header", "chapter-hero");
  hero.append(el("div", "chapter-kicker", chapter.kicker || `第 ${chapter.number} 课`));
  hero.append(el("h1", "", chapter.title));

  const meta = el("div", "chapter-meta");
  if (chapter.date) meta.append(el("span", "", `原文发布 ${chapter.date}`));
  meta.append(el("span", "", `PDF 第 ${chapter.sourcePages.join("-")} 页`));
  meta.append(el("span", "", `约 ${chapter.readingMinutes} 分钟`));
  hero.append(meta);
  return hero;
}

function renderNote(block) {
  const note = el("aside", block.type === "annotation" ? "source-annotation" : "editor-note");
  note.append(el("strong", "note-label", block.label));
  note.append(el("p", "", block.text));
  return note;
}

function renderDefinitions(block) {
  const list = el("dl", "definition-list");
  block.items.forEach((item) => {
    const row = el("div", "definition");
    const term = el("dt", "", item.term);
    const description = el("dd", "", item.text);
    if (item.formula) description.append(el("code", "formula", item.formula));
    row.append(term, description);
    list.append(row);
  });
  return list;
}

function renderTheorem(block) {
  const theorem = el("aside", "theorem");
  theorem.append(el("h3", "", block.title));
  theorem.append(el("p", "", block.text));
  return theorem;
}

function renderSourceHeading(block) {
  return el("h3", "source-heading", block.text);
}

function renderImage(block) {
  const figure = el("figure", "book-figure");
  const image = el("img", "");
  image.src = block.src;
  image.alt = block.alt || "原书图示";
  image.loading = "lazy";
  image.decoding = "async";
  figure.append(image);
  if (block.caption) figure.append(el("figcaption", "", block.caption));
  return figure;
}

function renderBlock(block) {
  switch (block.type) {
    case "paragraph":
      return el("p", block.lead ? "chapter-lead" : "", block.text);
    case "annotation":
    case "editor-note":
      return renderNote(block);
    case "definitions":
      return renderDefinitions(block);
    case "theorem":
      return renderTheorem(block);
    case "heading":
      return renderSourceHeading(block);
    case "image":
      return renderImage(block);
    case "divider":
      return el("hr", "source-divider");
    default:
      return el("p", "", block.text || "");
  }
}

function renderChapter(chapter) {
  const chapterLabel = chapter.kicker || `第 ${chapter.number} 课`;
  document.title = `${chapterLabel}：${chapter.title} · 教你炒股票`;
  elements.topbarChapter.textContent = `${chapterLabel} · ${chapter.title}`;
  elements.article.replaceChildren(renderHero(chapter));

  const layout = el("div", "reading-layout");
  const body = el("div", "chapter-body");
  const outline = el("aside", "section-outline");
  outline.setAttribute("aria-label", "本章提纲");
  outline.append(el("strong", "", "本章提纲"));

  chapter.intro.forEach((block) => body.append(renderBlock(block)));

  chapter.sections.forEach((section, index) => {
    const heading = el("header", "chapter-section");
    heading.id = section.id;
    heading.append(el("span", "section-number", `0${index + 1}`.slice(-2)));
    heading.append(el("h2", "", section.title));
    body.append(heading);
    section.blocks.forEach((block) => body.append(renderBlock(block)));

    const link = el("a", "", section.title);
    link.href = `#${section.id}`;
    outline.append(link);
  });

  layout.append(body, outline);
  elements.article.append(layout);
  elements.article.setAttribute("aria-busy", "false");
  observeSections();
}

function observeSections() {
  if (!("IntersectionObserver" in window)) return;
  const links = new Map(
    [...document.querySelectorAll(".section-outline a")].map((link) => [link.hash.slice(1), link])
  );
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      links.forEach((link, id) => link.classList.toggle("is-active", id === visible.target.id));
    },
    { rootMargin: "-18% 0px -68%", threshold: [0, 1] }
  );
  document.querySelectorAll(".chapter-section").forEach((section) => observer.observe(section));
}

function updateReadingProgress() {
  if (!state.chapter) return;
  const articleRect = elements.article.getBoundingClientRect();
  const articleTop = window.scrollY + articleRect.top;
  const available = Math.max(1, elements.article.offsetHeight - window.innerHeight * 0.72);
  const progress = Math.min(1, Math.max(0, (window.scrollY - articleTop) / available));
  elements.progress.style.width = `${progress * 100}%`;
  localStorage.setItem(STORAGE.position, JSON.stringify({ chapter: state.chapter.id, progress }));
}

function restoreReadingPosition() {
  if (window.location.hash) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE.position));
    if (!saved || saved.chapter !== state.chapter.id || saved.progress < 0.08) return;
    const articleTop = window.scrollY + elements.article.getBoundingClientRect().top;
    const available = Math.max(1, elements.article.offsetHeight - window.innerHeight * 0.72);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: articleTop + available * saved.progress, behavior: "auto" });
      showToast(`已回到上次阅读位置 · ${Math.round(saved.progress * 100)}%`);
    });
  } catch {
    localStorage.removeItem(STORAGE.position);
  }
}

function bindEvents() {
  elements.fontDecrease.addEventListener("click", () => shiftScale(-1));
  elements.fontIncrease.addEventListener("click", () => shiftScale(1));
  elements.fontReset.addEventListener("click", () => setScale(100));
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.tocToggle.addEventListener("click", () => {
    setSidebar(!document.body.classList.contains("is-sidebar-open"));
  });
  elements.sidebarScrim.addEventListener("click", () => setSidebar(false));
  elements.search.addEventListener("input", (event) => renderToc(event.target.value));
  window.addEventListener("scroll", updateReadingProgress, { passive: true });
  window.addEventListener("resize", updateReadingProgress, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSidebar(false);
  });
}

async function init() {
  bindEvents();
  setScale(state.scale, false);
  try {
    state.book = await fetchJson("data/book.json");
    const requestedId = chapterIdFromUrl();
    const metadata = state.book.chapters.find((chapter) => chapter.id === requestedId);
    const target = metadata?.available ? metadata : state.book.chapters.find((chapter) => chapter.available);
    if (!target) throw new Error("没有可阅读的样章数据");
    if (metadata && !metadata.available) showToast(`第 ${metadata.number} 课尚未制作，先为你打开样章`);

    state.chapter = await fetchJson(`data/chapters/${target.id}.json`);
    renderToc();
    renderChapter(state.chapter);
    window.setTimeout(restoreReadingPosition, 160);
    updateReadingProgress();
  } catch (error) {
    elements.article.hidden = true;
    elements.chapterError.hidden = false;
    elements.chapterError.textContent = `样章载入失败。请通过本地 HTTP 服务打开网站，不要直接双击 HTML 文件。${error.message}`;
    console.error(error);
  }
}

init();
