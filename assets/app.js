const STORAGE = {
  theme: "chan-reader-theme",
  scale: "chan-reader-scale",
  position: "chan-reader-position",
  keepAwake: "chan-reader-keep-awake",
};

const SCALE_STEPS = [90, 100, 110, 120, 130];
const VIEWER_SCALE_MIN = 1;
const VIEWER_SCALE_MAX = 5;

const elements = {
  article: document.querySelector("#chapter-content"),
  chapterError: document.querySelector("#chapter-error"),
  chapterList: document.querySelector("#chapter-list"),
  availableCount: document.querySelector("#toc-available-count"),
  fontDecrease: document.querySelector("#font-decrease"),
  fontIncrease: document.querySelector("#font-increase"),
  fontReset: document.querySelector("#font-reset"),
  imageViewer: document.querySelector("#image-viewer"),
  imageViewerCaption: document.querySelector("#image-viewer-caption"),
  imageViewerClose: document.querySelector("#image-viewer-close"),
  imageViewerImage: document.querySelector("#image-viewer-image"),
  imageViewerStage: document.querySelector("#image-viewer-stage"),
  imageZoomIn: document.querySelector("#image-zoom-in"),
  imageZoomLevel: document.querySelector("#image-zoom-level"),
  imageZoomOut: document.querySelector("#image-zoom-out"),
  imageZoomReset: document.querySelector("#image-zoom-reset"),
  installApp: document.querySelector("#install-app"),
  installGuide: document.querySelector("#install-guide"),
  installGuideClose: document.querySelector("#install-guide-close"),
  keepAwake: document.querySelector("#keep-awake"),
  nextChapter: document.querySelector("#next-chapter"),
  pagerMark: document.querySelector("#chapter-pager-mark"),
  previousChapter: document.querySelector("#previous-chapter"),
  progress: document.querySelector("#reading-progress-bar"),
  resumeReading: document.querySelector("#resume-reading"),
  resumeReadingLabel: document.querySelector("#resume-reading-label"),
  search: document.querySelector("#toc-search-input"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeColor: document.querySelector("#theme-color"),
  toast: document.querySelector("#toast"),
  tocToggle: document.querySelector("#toc-toggle"),
  topbarChapter: document.querySelector("#topbar-chapter"),
  updateBanner: document.querySelector("#update-banner"),
  updateDismiss: document.querySelector("#update-dismiss"),
  updateNow: document.querySelector("#update-now"),
};

const state = {
  audio: null,
  book: null,
  chapter: null,
  deferredInstallPrompt: null,
  keepAwake: localStorage.getItem(STORAGE.keepAwake) !== "false",
  positionReady: false,
  positionSaveFrame: null,
  scale: normalizeScale(Number(localStorage.getItem(STORAGE.scale)) || 100),
  toastTimer: null,
  updateReloading: false,
  wakeLock: null,
  wakeLockRequest: null,
  viewer: {
    dragOrigin: null,
    lastPinchDistance: 0,
    lastPinchMidpoint: null,
    pointers: new Map(),
    scale: 1,
    x: 0,
    y: 0,
  },
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
  if (state.chapter) window.requestAnimationFrame(updateReadingProgress);
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
  elements.themeColor.content = next === "dark" ? "#151914" : "#f3eee4";
  localStorage.setItem(STORAGE.theme, next);
  showToast(next === "dark" ? "已切换为夜间阅读" : "已切换为日间阅读");
}

function updateKeepAwakeButton() {
  const supported = "wakeLock" in navigator;
  const active = Boolean(state.wakeLock && !state.wakeLock.released);
  elements.keepAwake.disabled = !supported;
  elements.keepAwake.setAttribute("aria-pressed", String(supported && state.keepAwake));
  elements.keepAwake.dataset.active = String(active);

  if (!supported) {
    elements.keepAwake.title = "当前浏览器不支持屏幕常亮";
  } else if (!state.keepAwake) {
    elements.keepAwake.title = "点击开启阅读时屏幕常亮";
  } else if (active) {
    elements.keepAwake.title = "阅读时屏幕将保持常亮，点击可关闭";
  } else if (state.wakeLockRequest) {
    elements.keepAwake.title = "正在申请阅读时屏幕常亮";
  } else {
    elements.keepAwake.title = "屏幕常亮尚未生效，切换开关可重试";
  }
}

async function requestScreenWakeLock({ announceFailure = false } = {}) {
  if (
    !state.keepAwake ||
    !("wakeLock" in navigator) ||
    document.visibilityState !== "visible"
  ) {
    updateKeepAwakeButton();
    return false;
  }
  if (state.wakeLock && !state.wakeLock.released) return true;
  if (state.wakeLockRequest) return state.wakeLockRequest;

  state.wakeLockRequest = navigator.wakeLock.request("screen")
    .then(async (sentinel) => {
      if (!state.keepAwake || document.visibilityState !== "visible") {
        await sentinel.release();
        return false;
      }

      state.wakeLock = sentinel;
      sentinel.addEventListener("release", () => {
        if (state.wakeLock === sentinel) state.wakeLock = null;
        updateKeepAwakeButton();
      });
      updateKeepAwakeButton();
      return true;
    })
    .catch((error) => {
      state.wakeLock = null;
      updateKeepAwakeButton();
      if (announceFailure) showToast("系统未允许屏幕常亮，请检查省电设置");
      console.info("Screen wake lock was not granted", error);
      return false;
    })
    .finally(() => {
      state.wakeLockRequest = null;
      updateKeepAwakeButton();
    });

  return state.wakeLockRequest;
}

async function releaseScreenWakeLock() {
  const sentinel = state.wakeLock;
  state.wakeLock = null;
  updateKeepAwakeButton();
  if (sentinel && !sentinel.released) {
    try {
      await sentinel.release();
    } catch (error) {
      console.info("Screen wake lock could not be released cleanly", error);
    }
  }
}

async function toggleKeepAwake() {
  state.keepAwake = !state.keepAwake;
  localStorage.setItem(STORAGE.keepAwake, String(state.keepAwake));
  updateKeepAwakeButton();

  if (!state.keepAwake) {
    await releaseScreenWakeLock();
    showToast("已关闭阅读时屏幕常亮");
    return;
  }

  const active = await requestScreenWakeLock({ announceFailure: true });
  if (active) showToast("阅读时屏幕将保持常亮");
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
  return params.get("chapter");
}

function readSavedPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE.position));
    if (!saved || typeof saved.chapter !== "string") return null;
    return saved;
  } catch {
    localStorage.removeItem(STORAGE.position);
    return null;
  }
}

function navigateToChapter(chapterId, anchor = "") {
  const url = new URL(window.location.href);
  url.search = `?chapter=${encodeURIComponent(chapterId)}`;
  url.hash = anchor;
  window.location.assign(url);
}

async function fetchJson(path) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`载入失败：${response.status}`);
  return response.json();
}

async function fetchOptionalJson(path) {
  try {
    return await fetchJson(path);
  } catch {
    return null;
  }
}

function audioForChapter(chapterId) {
  return state.audio?.items?.[chapterId] || null;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
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
    const audio = audioForChapter(chapter.id);
    const link = el(chapter.available ? "a" : "button", "chapter-link");
    if (chapter.available) {
      link.href = `?chapter=${encodeURIComponent(chapter.id)}`;
    } else {
      link.type = "button";
    }
    link.dataset.chapterId = chapter.id;
    link.classList.toggle("is-available", chapter.available);
    link.classList.toggle("is-current", state.chapter?.id === chapter.id);
    link.classList.toggle("has-audio", Boolean(audio));
    link.setAttribute("aria-current", state.chapter?.id === chapter.id ? "page" : "false");

    link.append(
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
      el("span", "chapter-link__audio", audio ? "音频" : ""),
      el("span", "chapter-link__state")
    );

    link.addEventListener("click", () => {
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
    });
    fragment.append(link);
  });
  elements.chapterList.append(fragment);
}

function updateResumeReading() {
  const saved = readSavedPosition();
  const chapter = saved && state.book.chapters.find((item) => item.id === saved.chapter);
  if (!chapter?.available) {
    elements.resumeReading.hidden = true;
    return;
  }
  const chapterLabel = chapter.kind === "preface" ? "序章" : chapter.kind === "appendix" ? chapter.label : `第 ${chapter.number} 课`;
  elements.resumeReadingLabel.textContent = `${chapterLabel} · ${Math.round((saved.progress || 0) * 100)}%`;
  elements.resumeReading.dataset.chapterId = chapter.id;
  elements.resumeReading.hidden = false;
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

  const audio = renderAudioPlayer(chapter);
  if (audio) hero.append(audio);
  return hero;
}

function renderAudioPlayer(chapter) {
  const audioInfo = audioForChapter(chapter.id);
  if (!audioInfo) return null;

  const panel = el("section", "chapter-audio");
  panel.setAttribute("aria-label", "本课音频");

  const copy = el("div", "chapter-audio__copy");
  copy.append(el("span", "chapter-audio__eyebrow", "本课音频"));
  copy.append(el("strong", "", audioInfo.label || "正文朗读"));
  const details = [formatDuration(audioInfo.durationSeconds), "不含回复与发布时间"].filter(Boolean).join(" · ");
  copy.append(el("span", "chapter-audio__details", details));

  const player = document.createElement("audio");
  player.controls = true;
  player.preload = "metadata";
  const source = document.createElement("source");
  source.src = audioInfo.src;
  if (audioInfo.mimeType) source.type = audioInfo.mimeType;
  player.append(source);

  const download = el("a", "chapter-audio__download", "下载");
  download.href = audioInfo.src;
  download.download = "";

  panel.append(copy, player, download);
  return panel;
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
  image.tabIndex = 0;
  image.setAttribute("role", "button");
  image.setAttribute("aria-label", `${image.alt}，点击放大查看`);
  const open = () => openImageViewer(image, block.caption || image.alt);
  image.addEventListener("click", open);
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  figure.append(image);
  if (block.caption) figure.append(el("figcaption", "", block.caption));
  return figure;
}

function applyViewerTransform() {
  const viewer = state.viewer;
  elements.imageViewerImage.style.transform = `translate3d(${viewer.x}px, ${viewer.y}px, 0) scale(${viewer.scale})`;
  elements.imageZoomLevel.value = `${Math.round(viewer.scale * 100)}%`;
  elements.imageZoomLevel.textContent = elements.imageZoomLevel.value;
  elements.imageViewerStage.classList.toggle("is-zoomed", viewer.scale > 1.01);
}

function resetImageViewer() {
  Object.assign(state.viewer, { scale: 1, x: 0, y: 0, lastPinchDistance: 0, lastPinchMidpoint: null });
  applyViewerTransform();
}

function setViewerScale(nextScale, focalPoint = null) {
  const viewer = state.viewer;
  const scale = Math.min(VIEWER_SCALE_MAX, Math.max(VIEWER_SCALE_MIN, nextScale));
  if (focalPoint && viewer.scale) {
    const rect = elements.imageViewerStage.getBoundingClientRect();
    const focalX = focalPoint.x - rect.left - rect.width / 2;
    const focalY = focalPoint.y - rect.top - rect.height / 2;
    const ratio = scale / viewer.scale;
    viewer.x = focalX - (focalX - viewer.x) * ratio;
    viewer.y = focalY - (focalY - viewer.y) * ratio;
  }
  viewer.scale = scale;
  if (scale === 1) {
    viewer.x = 0;
    viewer.y = 0;
  }
  applyViewerTransform();
}

function openImageViewer(sourceImage, caption) {
  elements.imageViewerImage.src = sourceImage.currentSrc || sourceImage.src;
  elements.imageViewerImage.alt = sourceImage.alt;
  elements.imageViewerCaption.textContent = caption;
  resetImageViewer();
  elements.imageViewer.showModal();
}

function closeImageViewer() {
  state.viewer.pointers.clear();
  elements.imageViewer.close();
  elements.imageViewerImage.removeAttribute("src");
}

function pointerMidpoint(pointers) {
  const [first, second] = pointers;
  return { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 };
}

function pointerDistance(pointers) {
  const [first, second] = pointers;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function handleViewerPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  elements.imageViewerStage.setPointerCapture(event.pointerId);
  state.viewer.pointers.set(event.pointerId, event);
  if (state.viewer.pointers.size === 1) {
    state.viewer.dragOrigin = { clientX: event.clientX, clientY: event.clientY, x: state.viewer.x, y: state.viewer.y };
  }
}

function handleViewerPointerMove(event) {
  if (!state.viewer.pointers.has(event.pointerId)) return;
  state.viewer.pointers.set(event.pointerId, event);
  const pointers = [...state.viewer.pointers.values()];
  if (pointers.length >= 2) {
    const distance = pointerDistance(pointers);
    const midpoint = pointerMidpoint(pointers);
    if (state.viewer.lastPinchDistance) {
      setViewerScale(state.viewer.scale * (distance / state.viewer.lastPinchDistance), midpoint);
    }
    state.viewer.lastPinchDistance = distance;
    state.viewer.lastPinchMidpoint = midpoint;
    return;
  }
  if (state.viewer.scale > 1 && state.viewer.dragOrigin) {
    state.viewer.x = state.viewer.dragOrigin.x + event.clientX - state.viewer.dragOrigin.clientX;
    state.viewer.y = state.viewer.dragOrigin.y + event.clientY - state.viewer.dragOrigin.clientY;
    applyViewerTransform();
  }
}

function handleViewerPointerUp(event) {
  state.viewer.pointers.delete(event.pointerId);
  state.viewer.lastPinchDistance = 0;
  state.viewer.lastPinchMidpoint = null;
  const remaining = [...state.viewer.pointers.values()][0];
  state.viewer.dragOrigin = remaining
    ? { clientX: remaining.clientX, clientY: remaining.clientY, x: state.viewer.x, y: state.viewer.y }
    : null;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function updateInstallButton() {
  elements.installApp.hidden = isStandalone() || (!state.deferredInstallPrompt && !isIosDevice());
}

async function installApp() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  if (isIosDevice()) elements.installGuide.showModal();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !state.updateReloading) showUpdateBanner();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("service-worker.js", document.baseURI), { scope: "./" })
      .then((registration) => {
        if (registration.waiting && hadController) showUpdateBanner();
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "activated" && hadController) showUpdateBanner();
          });
        });
      })
      .catch((error) => {
        console.warn("Service Worker 注册失败", error);
      });
  });
}

function showUpdateBanner() {
  elements.updateBanner.hidden = false;
}

function applyPreparedUpdate() {
  state.updateReloading = true;
  window.location.reload();
}

function cacheCurrentChapter() {
  if (!("serviceWorker" in navigator) || !state.chapter) return;
  navigator.serviceWorker.ready.then((registration) => {
    const worker = navigator.serviceWorker.controller || registration.active;
    worker?.postMessage({
      type: "CACHE_CHAPTER",
      url: new URL(`data/chapters/${state.chapter.id}.json`, document.baseURI).href,
    });
  }).catch(() => {});
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
  [...body.children].forEach((node, index) => {
    node.dataset.readingAnchor = `${chapter.id}-${index}`;
  });
  elements.article.append(layout);
  elements.article.setAttribute("aria-busy", "false");
  observeSections();
}

function updatePager() {
  const available = state.book.chapters.filter((chapter) => chapter.available);
  const currentIndex = available.findIndex((chapter) => chapter.id === state.chapter.id);
  const previous = currentIndex > 0 ? available[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < available.length - 1 ? available[currentIndex + 1] : null;

  elements.previousChapter.disabled = !previous;
  elements.previousChapter.dataset.chapterId = previous?.id || "";
  elements.previousChapter.querySelector("strong").textContent = previous?.title || "已经是开篇";

  elements.nextChapter.disabled = !next;
  elements.nextChapter.dataset.chapterId = next?.id || "";
  elements.nextChapter.querySelector("strong").textContent = next?.title || "后续章节校订中";

  elements.pagerMark.textContent =
    state.chapter.kind === "preface" ? "序" : String(state.chapter.number).padStart(2, "0");
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
  if (!state.positionReady || state.positionSaveFrame) return;
  state.positionSaveFrame = window.requestAnimationFrame(() => {
    state.positionSaveFrame = null;
    const candidates = [...elements.article.querySelectorAll("[data-reading-anchor]")];
    const current = candidates
      .filter((node) => node.getBoundingClientRect().top <= window.innerHeight * 0.28)
      .at(-1) || candidates[0];
    const position = {
      chapter: state.chapter.id,
      progress,
      anchor: current?.dataset.readingAnchor || "",
      offset: current ? window.scrollY - (window.scrollY + current.getBoundingClientRect().top) : 0,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE.position, JSON.stringify(position));
    updateResumeReading();
  });
}

function restoreReadingPosition() {
  const saved = readSavedPosition();
  if (window.location.hash || !saved || saved.chapter !== state.chapter.id || saved.progress < 0.02) {
    state.positionReady = true;
    window.requestAnimationFrame(updateReadingProgress);
    return;
  }
  window.requestAnimationFrame(() => {
    const anchor = saved.anchor && elements.article.querySelector(`[data-reading-anchor="${CSS.escape(saved.anchor)}"]`);
    if (anchor) {
      const anchorTop = window.scrollY + anchor.getBoundingClientRect().top;
      window.scrollTo({ top: Math.max(0, anchorTop + (Number(saved.offset) || 0)), behavior: "auto" });
    } else {
      const articleTop = window.scrollY + elements.article.getBoundingClientRect().top;
      const available = Math.max(1, elements.article.offsetHeight - window.innerHeight * 0.72);
      window.scrollTo({ top: articleTop + available * saved.progress, behavior: "auto" });
    }
    state.positionReady = true;
    updateReadingProgress();
    showToast(`已回到上次阅读位置 · ${Math.round(saved.progress * 100)}%`);
  });
}

function bindEvents() {
  elements.fontDecrease.addEventListener("click", () => shiftScale(-1));
  elements.fontIncrease.addEventListener("click", () => shiftScale(1));
  elements.fontReset.addEventListener("click", () => setScale(100));
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.keepAwake.addEventListener("click", toggleKeepAwake);
  elements.installApp.addEventListener("click", installApp);
  elements.updateNow.addEventListener("click", applyPreparedUpdate);
  elements.updateDismiss.addEventListener("click", () => {
    elements.updateBanner.hidden = true;
  });
  elements.installGuideClose.addEventListener("click", () => elements.installGuide.close());
  elements.resumeReading.addEventListener("click", () => {
    if (elements.resumeReading.dataset.chapterId) navigateToChapter(elements.resumeReading.dataset.chapterId);
  });
  elements.imageViewerClose.addEventListener("click", closeImageViewer);
  elements.imageZoomIn.addEventListener("click", () => setViewerScale(state.viewer.scale + 0.5));
  elements.imageZoomOut.addEventListener("click", () => setViewerScale(state.viewer.scale - 0.5));
  elements.imageZoomReset.addEventListener("click", resetImageViewer);
  elements.imageViewer.addEventListener("click", (event) => {
    if (event.target === elements.imageViewer) closeImageViewer();
  });
  elements.imageViewer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImageViewer();
  });
  elements.imageViewerStage.addEventListener("dblclick", (event) => {
    setViewerScale(state.viewer.scale > 1 ? 1 : 2, { x: event.clientX, y: event.clientY });
  });
  elements.imageViewerStage.addEventListener("wheel", (event) => {
    event.preventDefault();
    setViewerScale(state.viewer.scale * (event.deltaY > 0 ? 0.88 : 1.12), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  elements.imageViewerStage.addEventListener("pointerdown", handleViewerPointerDown);
  elements.imageViewerStage.addEventListener("pointermove", handleViewerPointerMove);
  elements.imageViewerStage.addEventListener("pointerup", handleViewerPointerUp);
  elements.imageViewerStage.addEventListener("pointercancel", handleViewerPointerUp);
  [elements.previousChapter, elements.nextChapter].forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.chapterId) navigateToChapter(button.dataset.chapterId);
    });
  });
  elements.tocToggle.addEventListener("click", () => {
    setSidebar(!document.body.classList.contains("is-sidebar-open"));
  });
  elements.sidebarScrim.addEventListener("click", () => setSidebar(false));
  elements.search.addEventListener("input", (event) => renderToc(event.target.value));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestScreenWakeLock();
    else releaseScreenWakeLock();
  });
  document.addEventListener("pointerdown", () => requestScreenWakeLock(), {
    once: true,
    passive: true,
  });
  window.addEventListener("scroll", updateReadingProgress, { passive: true });
  window.addEventListener("resize", updateReadingProgress, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.imageViewer.open) setSidebar(false);
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    updateInstallButton();
    showToast("已安装到桌面");
  });
}

async function init() {
  bindEvents();
  setScale(state.scale, false);
  updateKeepAwakeButton();
  requestScreenWakeLock();
  try {
    const [book, audio] = await Promise.all([fetchJson("data/book.json"), fetchOptionalJson("data/audio.json")]);
    state.book = book;
    state.audio = audio;
    const requestedId = chapterIdFromUrl();
    const saved = readSavedPosition();
    const shouldResume = !requestedId || new URLSearchParams(window.location.search).get("resume") === "1";
    const targetId = shouldResume && saved?.chapter ? saved.chapter : requestedId;
    const metadata = state.book.chapters.find((chapter) => chapter.id === targetId);
    const target = metadata?.available ? metadata : state.book.chapters.find((chapter) => chapter.available);
    if (!target) throw new Error("没有可阅读的章节数据");
    if (metadata && !metadata.available) showToast(`第 ${metadata.number} 课尚未制作，先为你打开已校订章节`);

    const availableTotal = state.book.chapters.filter((chapter) => chapter.available).length;
    const audioTotal = Object.keys(state.audio?.items || {}).length;
    elements.availableCount.textContent = audioTotal
      ? `当前开放 ${availableTotal} 篇 · 音频 ${audioTotal} 课`
      : `当前开放 ${availableTotal} 篇`;

    state.chapter = await fetchJson(`data/chapters/${target.id}.json`);
    renderToc();
    updateResumeReading();
    renderChapter(state.chapter);
    updatePager();
    cacheCurrentChapter();
    window.setTimeout(restoreReadingPosition, 160);
    updateReadingProgress();
  } catch (error) {
    elements.article.hidden = true;
    elements.chapterError.hidden = false;
    elements.chapterError.textContent = `章节载入失败。请通过本地 HTTP 服务打开网站，不要直接双击 HTML 文件。${error.message}`;
    console.error(error);
  }
}

registerServiceWorker();
updateInstallButton();
init();
