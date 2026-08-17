import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const readText = (path) => readFile(new URL(path, root), "utf8");

const [
  indexHtml,
  appSource,
  stylesSource,
  workerSource,
  manifestSource,
  chapterSource,
  noteChapterSource,
  notesIndexSource,
  noteBundleSource,
] = await Promise.all([
  readText("index.html"),
  readText("assets/app.js"),
  readText("assets/styles.css"),
  readText("service-worker.js"),
  readText("manifest.webmanifest"),
  readText("data/chapters/001.json"),
  readText("data/chapters/011.json"),
  readText("data/notes/index.json"),
  readText("data/notes/011.json"),
]);
const manifest = JSON.parse(manifestSource);
const chapter = JSON.parse(chapterSource);
const noteChapter = JSON.parse(noteChapterSource);

assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./?resume=1");
assert.equal(manifest.display_override[0], "window-controls-overlay");
assert.match(indexHtml, /rel="manifest"/);
assert.match(indexHtml, /id="theme-color"/);
assert.match(indexHtml, /id="install-app"/);
assert.match(indexHtml, /id="keep-awake"/);
assert.match(indexHtml, /id="resume-reading"/);
assert.match(indexHtml, /id="image-viewer"/);
assert.match(indexHtml, /id="chapter-notes"/);
assert.match(indexHtml, /id="all-notes"/);
assert.match(indexHtml, /id="notes-dialog"/);
assert.match(indexHtml, /id="update-banner"/);
assert.match(appSource, /beforeinstallprompt/);
assert.match(appSource, /elements\.themeColor\.content/);
assert.match(indexHtml, /20260817-decision-tree-hierarchy/);
assert.match(workerSource, /20260817-decision-tree-hierarchy-v1/);
assert.match(stylesSource, /display-mode:\s*window-controls-overlay/);
assert.match(stylesSource, /env\(titlebar-area-x/);
assert.match(stylesSource, /env\(titlebar-area-width/);
assert.match(stylesSource, /app-region:\s*drag/);
assert.match(appSource, /navigator\.wakeLock\.request\("screen"\)/);
assert.match(appSource, /visibilitychange/);
assert.match(appSource, /chan-reader-keep-awake/);
assert.match(appSource, /controllerchange/);
assert.match(appSource, /showUpdateBanner/);
assert.match(appSource, /updateViaCache:\s*"none"/);
assert.match(appSource, /registration\.update\(\)/);
assert.match(appSource, /worker\.state === "installed"/);
assert.match(appSource, /SERVICE_WORKER_UPDATE_INTERVAL/);
assert.match(appSource, /window\.addEventListener\("focus", checkForServiceWorkerUpdate\)/);
assert.match(appSource, /window\.addEventListener\("online", checkForServiceWorkerUpdate\)/);
assert.match(appSource, /window\.addEventListener\("pageshow", checkForServiceWorkerUpdate\)/);
assert.match(appSource, /isIosDevice/);
assert.match(appSource, /anchor: current\?\.dataset\.readingAnchor/);
assert.match(appSource, /handleViewerPointerMove/);
assert.match(appSource, /setViewerScale/);
assert.match(appSource, /audioForChapter/);
assert.match(appSource, /renderAudioPlayer/);
assert.match(appSource, /mimeType/);
assert.match(appSource, /data\/notes\/index\.json/);
assert.match(appSource, /renderDecisionTreeContent/);
assert.match(appSource, /openAllNotes/);
assert.match(appSource, /heading\.tabIndex = -1/);
assert.match(appSource, /返回上一步/);
assert.match(appSource, /重新开始/);
assert.match(appSource, /当前判断路径/);
assert.match(appSource, /查看树状总览/);
assert.match(appSource, /el\(node\.kind === "question" \? "details" : "div"/);
assert.match(appSource, /展开全部/);
assert.match(appSource, /收起到一级/);
assert.match(appSource, /querySelectorAll\("details"\)/);
assert.match(appSource, /seen\.has\(branch\.to\)/);
assert.match(stylesSource, /\.notes-dialog/);
assert.match(stylesSource, /\.decision-path__list/);
assert.match(stylesSource, /\.decision-tree-full__node\.is-question\[open\]/);
assert.match(stylesSource, /@media \(max-width: 380px\)/);
assert.match(stylesSource, /\.notes-panel__body\s*\{[^}]*overflow-x:\s*hidden/s);
assert.match(stylesSource, /\.note-view\s*\{[^}]*overflow-wrap:\s*anywhere/s);
assert.match(stylesSource, /\.topbar__brand \.wordmark\s*\{\s*display:\s*none/s);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.open = false;
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, `${value}`);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  click() {
    if (this.disabled) return;
    (this.listeners.get("click") || []).forEach((listener) => listener());
  }

  focus() {
    this.focused = true;
  }

  querySelectorAll(selector) {
    const matches = [];
    const matchesSelector = (element) => {
      if (selector.startsWith(".")) return element.className.split(/\s+/).includes(selector.slice(1));
      return element.tagName.toLowerCase() === selector.toLowerCase();
    };
    const visit = (element) => {
      element.children.forEach((child) => {
        if (matchesSelector(child)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }
}

const noteBundle = JSON.parse(noteBundleSource);
const decisionNote = noteBundle.notes.find((note) => note.type === "decision-tree");
const decisionContext = vm.createContext({
  Map,
  Set,
  note: decisionNote,
  document: { createElement: (tagName) => new TestElement(tagName) },
  window: { requestAnimationFrame: (callback) => callback() },
});
vm.runInContext([
  extractFunction(appSource, "el"),
  extractFunction(appSource, "renderFullDecisionNode"),
  extractFunction(appSource, "renderDecisionTreeContent"),
].join("\n"), decisionContext);

const renderedDecisionTree = vm.runInContext("renderDecisionTreeContent(note)", decisionContext);
const decisionControls = renderedDecisionTree.children[0];
const decisionStage = renderedDecisionTree.children[1];
assert.equal(decisionStage.querySelectorAll(".decision-path__step").length, 1);
assert.equal(decisionStage.querySelectorAll(".decision-choice").length, 2);
decisionStage.querySelectorAll(".decision-choice")[0].click();
assert.equal(decisionStage.querySelectorAll(".decision-path__step").length, 2);
assert.equal(decisionStage.querySelectorAll(".decision-choice").length, 3);
decisionStage.querySelectorAll(".decision-path__step")[0].click();
assert.equal(decisionStage.querySelectorAll(".decision-path__step").length, 1);

decisionControls.children[2].click();
assert.equal(decisionControls.children[0].hidden, true);
assert.equal(decisionControls.children[1].hidden, true);
assert.equal(decisionStage.querySelectorAll(".decision-tree-full__node").length, decisionNote.content.nodes.length);
assert.equal(decisionStage.querySelectorAll(".decision-tree-full__shared").length, 3);
const decisionDetails = decisionStage.querySelectorAll("details");
decisionStage.querySelectorAll(".decision-tree-full__controls")[0].children[0].click();
assert.ok(decisionDetails.every((details) => details.open));
decisionStage.querySelectorAll(".decision-tree-full__controls")[0].children[1].click();
assert.equal(decisionDetails.filter((details) => details.open).length, 1);

const updateElements = { updateBanner: { hidden: true } };
const updateState = {
  serviceWorkerRegistration: null,
  serviceWorkerUpdateCheck: null,
};
const updateNavigator = {
  onLine: true,
  serviceWorker: { controller: {} },
};
const updateDocument = { visibilityState: "visible" };
const updateContext = vm.createContext({
  Promise,
  console: { warn() {} },
  document: updateDocument,
  elements: updateElements,
  navigator: updateNavigator,
  state: updateState,
});
vm.runInContext([
  extractFunction(appSource, "watchInstallingServiceWorker"),
  extractFunction(appSource, "checkForServiceWorkerUpdate"),
  extractFunction(appSource, "showUpdateBanner"),
].join("\n"), updateContext);

let stateChangeListener;
const installingWorker = {
  state: "installing",
  addEventListener(type, listener) {
    if (type === "statechange") stateChangeListener = listener;
  },
};
updateContext.watchInstallingServiceWorker(installingWorker);
assert.equal(updateElements.updateBanner.hidden, true);
installingWorker.state = "installed";
stateChangeListener();
assert.equal(updateElements.updateBanner.hidden, false);

updateElements.updateBanner.hidden = true;
updateNavigator.serviceWorker.controller = null;
updateContext.watchInstallingServiceWorker({ state: "installed", addEventListener() {} });
assert.equal(updateElements.updateBanner.hidden, true);
updateNavigator.serviceWorker.controller = {};

let finishUpdate;
let updateCalls = 0;
const pendingUpdate = new Promise((resolve) => {
  finishUpdate = resolve;
});
updateState.serviceWorkerRegistration = {
  update() {
    updateCalls += 1;
    return pendingUpdate;
  },
};
const firstUpdateCheck = updateContext.checkForServiceWorkerUpdate();
const duplicateUpdateCheck = updateContext.checkForServiceWorkerUpdate();
assert.equal(updateCalls, 1);
assert.equal(firstUpdateCheck, duplicateUpdateCheck);
finishUpdate();
await firstUpdateCheck;
assert.equal(updateState.serviceWorkerUpdateCheck, null);
updateDocument.visibilityState = "hidden";
updateContext.checkForServiceWorkerUpdate();
assert.equal(updateCalls, 1);

const listeners = new Map();
const cacheStores = new Map();
const scope = "https://thunderkeg.github.io/chan-theory/";
let offline = false;

function requestKey(request) {
  return typeof request === "string" ? new URL(request, scope).href : request.url;
}

const cachesStub = {
  async open(name) {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map());
    const store = cacheStores.get(name);
    return {
      async addAll(urls) {
        for (const url of urls) store.set(new URL(url, scope).href, new Response("shell"));
      },
      async match(request) {
        return store.get(requestKey(request))?.clone();
      },
      async put(request, response) {
        store.set(requestKey(request), response.clone());
      },
    };
  },
  async keys() {
    return [...cacheStores.keys()];
  },
  async delete(name) {
    return cacheStores.delete(name);
  },
};

async function fetchStub(request) {
  if (offline) throw new TypeError("offline");
  const url = requestKey(request);
  if (url.endsWith("/data/chapters/001.json")) {
    return new Response(chapterSource, { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/data/chapters/011.json")) {
    return new Response(noteChapterSource, { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/assets/book-images/001/")) {
    return new Response("image-bytes", { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  if (url.includes("/assets/book-images/011/")) {
    return new Response("note-image-bytes", { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  if (url.endsWith("/data/notes/index.json")) {
    return new Response(notesIndexSource, { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/data/notes/011.json")) {
    return new Response(noteBundleSource, { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/data/notes/001.json")) {
    return new Response("missing", { status: 404 });
  }
  if (url.endsWith("/data/audio.json")) {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/assets/audio/")) {
    return new Response("audio-bytes", { status: 200, headers: { "content-type": "audio/mp4" } });
  }
  return new Response("shell", { status: 200 });
}

const context = vm.createContext({
  URL,
  Request,
  Response,
  Promise,
  Set,
  caches: cachesStub,
  fetch: fetchStub,
  self: {
    registration: { scope },
    location: new URL(scope),
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  },
});
vm.runInContext(workerSource, context, { filename: "service-worker.js" });

assert.equal(context.chapterIdFromUrl(new URL(`${scope}data/chapters/001.json`)), "001");
assert.equal(context.chapterIdFromUrl(new URL(`${scope}assets/book-images/001/page-0008-Im4.jpg`)), "001");
assert.equal(context.chapterIdFromUrl(new URL(`${scope}data/notes/011.json`)), "011");
assert.notEqual(context.chapterCacheName("001"), context.chapterCacheName("002"));

const expectedImages = chapter.sections
  .flatMap((section) => section.blocks)
  .filter((block) => block.type === "image");
const imageUrls = context.chapterImageUrls(chapter);
assert.equal(imageUrls.length, expectedImages.length);
assert.ok(imageUrls.every((url) => url.startsWith(`${scope}assets/book-images/001/`)));

let cachePromise;
listeners.get("message")({
  data: {
    type: "CACHE_CHAPTER",
    url: `${scope}data/chapters/001.json`,
    noteUrl: `${scope}data/notes/001.json`,
  },
  waitUntil(promise) {
    cachePromise = promise;
  },
});
await cachePromise;

const chapterCacheName = context.chapterCacheName("001");
assert.ok(cacheStores.has(chapterCacheName));
assert.equal(cacheStores.get(chapterCacheName).size, 1 + expectedImages.length);
assert.ok(!cacheStores.has(context.chapterCacheName("002")));

const noteImages = noteChapter.sections
  .flatMap((section) => section.blocks)
  .filter((block) => block.type === "image");
listeners.get("message")({
  data: {
    type: "CACHE_CHAPTER",
    url: `${scope}data/chapters/011.json`,
    noteUrl: `${scope}data/notes/011.json`,
  },
  waitUntil(promise) {
    cachePromise = promise;
  },
});
await cachePromise;
const noteChapterCacheName = context.chapterCacheName("011");
assert.equal(cacheStores.get(noteChapterCacheName).size, 2 + noteImages.length);
assert.ok(cacheStores.get(noteChapterCacheName).has(`${scope}data/notes/011.json`));

offline = true;
const offlineChapter = await context.chapterNetworkFirst(new Request(`${scope}data/chapters/001.json`));
assert.equal((await offlineChapter.json()).id, "001");
const offlineImage = await context.cacheFirst(
  new Request(imageUrls[0]),
  chapterCacheName,
);
assert.equal(await offlineImage.text(), "image-bytes");
const offlineNotes = await context.chapterNetworkFirst(new Request(`${scope}data/notes/011.json`));
assert.equal((await offlineNotes.json()).chapterId, "011");

const shellAssetsMatch = workerSource.match(/const SHELL_ASSETS = \[(.*?)\];/s);
assert.ok(shellAssetsMatch);
assert.doesNotMatch(shellAssetsMatch[1], /data\/chapters|assets\/book-images/);
assert.match(shellAssetsMatch[1], /data\/audio\.json/);
assert.match(shellAssetsMatch[1], /data\/notes\/index\.json/);
assert.doesNotMatch(shellAssetsMatch[1], /data\/notes\/[0-9]{3}\.json/);
assert.doesNotMatch(shellAssetsMatch[1], /assets\/audio/);
assert.match(workerSource, /isAudioRequest/);

console.log(
  `OK: install manifest, decision-tree hierarchy, precise progress contract, image zoom contract, ` +
  `per-chapter cache (${1 + expectedImages.length} entries), optional note cache ` +
  `(${2 + noteImages.length} entries) and offline fallback`,
);
