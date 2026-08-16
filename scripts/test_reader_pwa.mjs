import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const readText = (path) => readFile(new URL(path, root), "utf8");

const [indexHtml, appSource, stylesSource, workerSource, manifestSource, chapterSource] = await Promise.all([
  readText("index.html"),
  readText("assets/app.js"),
  readText("assets/styles.css"),
  readText("service-worker.js"),
  readText("manifest.webmanifest"),
  readText("data/chapters/001.json"),
]);
const manifest = JSON.parse(manifestSource);
const chapter = JSON.parse(chapterSource);

assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./?resume=1");
assert.equal(manifest.display_override[0], "window-controls-overlay");
assert.match(indexHtml, /rel="manifest"/);
assert.match(indexHtml, /id="theme-color"/);
assert.match(indexHtml, /id="install-app"/);
assert.match(indexHtml, /id="keep-awake"/);
assert.match(indexHtml, /id="resume-reading"/);
assert.match(indexHtml, /id="image-viewer"/);
assert.match(indexHtml, /id="update-banner"/);
assert.match(appSource, /beforeinstallprompt/);
assert.match(appSource, /elements\.themeColor\.content/);
assert.match(indexHtml, /20260816-windows-titlebar/);
assert.match(workerSource, /20260816-windows-titlebar-v1/);
assert.match(stylesSource, /display-mode:\s*window-controls-overlay/);
assert.match(stylesSource, /env\(titlebar-area-x/);
assert.match(stylesSource, /env\(titlebar-area-width/);
assert.match(stylesSource, /app-region:\s*drag/);
assert.match(appSource, /navigator\.wakeLock\.request\("screen"\)/);
assert.match(appSource, /visibilitychange/);
assert.match(appSource, /chan-reader-keep-awake/);
assert.match(appSource, /controllerchange/);
assert.match(appSource, /showUpdateBanner/);
assert.match(appSource, /isIosDevice/);
assert.match(appSource, /anchor: current\?\.dataset\.readingAnchor/);
assert.match(appSource, /handleViewerPointerMove/);
assert.match(appSource, /setViewerScale/);
assert.match(appSource, /audioForChapter/);
assert.match(appSource, /renderAudioPlayer/);
assert.match(appSource, /mimeType/);

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
  if (url.includes("/assets/book-images/001/")) {
    return new Response("image-bytes", { status: 200, headers: { "content-type": "image/jpeg" } });
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
assert.notEqual(context.chapterCacheName("001"), context.chapterCacheName("002"));

const expectedImages = chapter.sections
  .flatMap((section) => section.blocks)
  .filter((block) => block.type === "image");
const imageUrls = context.chapterImageUrls(chapter);
assert.equal(imageUrls.length, expectedImages.length);
assert.ok(imageUrls.every((url) => url.startsWith(`${scope}assets/book-images/001/`)));

let cachePromise;
listeners.get("message")({
  data: { type: "CACHE_CHAPTER", url: `${scope}data/chapters/001.json` },
  waitUntil(promise) {
    cachePromise = promise;
  },
});
await cachePromise;

const chapterCacheName = context.chapterCacheName("001");
assert.ok(cacheStores.has(chapterCacheName));
assert.equal(cacheStores.get(chapterCacheName).size, 1 + expectedImages.length);
assert.ok(!cacheStores.has(context.chapterCacheName("002")));

offline = true;
const offlineChapter = await context.chapterNetworkFirst(new Request(`${scope}data/chapters/001.json`));
assert.equal((await offlineChapter.json()).id, "001");
const offlineImage = await context.cacheFirst(
  new Request(imageUrls[0]),
  chapterCacheName,
);
assert.equal(await offlineImage.text(), "image-bytes");

const shellAssetsMatch = workerSource.match(/const SHELL_ASSETS = \[(.*?)\];/s);
assert.ok(shellAssetsMatch);
assert.doesNotMatch(shellAssetsMatch[1], /data\/chapters|assets\/book-images/);
assert.match(shellAssetsMatch[1], /data\/audio\.json/);
assert.doesNotMatch(shellAssetsMatch[1], /assets\/audio/);
assert.match(workerSource, /isAudioRequest/);

console.log(
  `OK: install manifest, precise progress contract, image zoom contract, ` +
  `per-chapter cache (${1 + expectedImages.length} entries) and offline fallback`,
);
