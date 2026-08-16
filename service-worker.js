const CACHE_VERSION = "20260816-note-tree-folding-v1";
const SHELL_CACHE = `chan-reader-shell-${CACHE_VERSION}`;
const CHAPTER_CACHE_PREFIX = `chan-reader-chapter-${CACHE_VERSION}-`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./assets/styles.css?v=20260816-note-tree-folding",
  "./assets/app.js?v=20260816-note-tree-folding",
  "./data/book.json",
  "./data/audio.json",
  "./data/notes/index.json",
  "./manifest.webmanifest",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
];

const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => {
        const belongsToReader = key.startsWith("chan-reader-");
        const isCurrent = key === SHELL_CACHE || key.startsWith(CHAPTER_CACHE_PREFIX);
        return belongsToReader && !isCurrent;
      }).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function chapterIdFromUrl(url) {
  const relativePath = url.pathname.slice(scopePath.length);
  const match = relativePath.match(/^(?:data\/(?:chapters|notes)|assets\/book-images)\/([0-9]{3})(?:\.json|\/)/);
  return match?.[1] || null;
}

function chapterCacheName(chapterId) {
  return `${CHAPTER_CACHE_PREFIX}${chapterId}`;
}

function isChapterRequest(url) {
  return url.pathname.startsWith(`${scopePath}data/chapters/`) && url.pathname.endsWith(".json");
}

function isChapterNoteRequest(url) {
  return /^\d{3}\.json$/.test(url.pathname.slice(`${scopePath}data/notes/`.length))
    && url.pathname.startsWith(`${scopePath}data/notes/`);
}

function isBookImageRequest(url) {
  return url.pathname.startsWith(`${scopePath}assets/book-images/`);
}

function isAudioRequest(url) {
  return url.pathname.startsWith(`${scopePath}assets/audio/`);
}

function isShellDataRequest(url) {
  return url.pathname === `${scopePath}data/book.json`
    || url.pathname === `${scopePath}data/audio.json`
    || url.pathname === `${scopePath}data/notes/index.json`;
}

function chapterImageUrls(chapter) {
  const urls = [];
  const collect = (block) => {
    if (block?.type === "image" && block.src) urls.push(new URL(block.src, scopeUrl).href);
  };
  (chapter.intro || []).forEach(collect);
  (chapter.sections || []).forEach((section) => (section.blocks || []).forEach(collect));
  return [...new Set(urls)];
}

async function cacheChapterImages(response, chapterId) {
  try {
    const chapter = await response.json();
    const urls = chapterImageUrls(chapter);
    if (!urls.length) return;
    const cache = await caches.open(chapterCacheName(chapterId));
    await Promise.all(urls.map(async (url) => {
      if (await cache.match(url)) return;
      try {
        const imageResponse = await fetch(url);
        if (imageResponse.ok) await cache.put(url, imageResponse);
      } catch {
        // A chapter remains readable even if an individual illustration is temporarily unavailable.
      }
    }));
  } catch {
    // Invalid chapter data is handled by the reader's normal error state.
  }
}

async function chapterNetworkFirst(request) {
  const chapterId = chapterIdFromUrl(new URL(request.url));
  const cache = await caches.open(chapterCacheName(chapterId));
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function cacheOptionalChapterNote(noteUrl, chapterId) {
  if (!noteUrl) return;
  const url = new URL(noteUrl);
  if (
    url.origin !== self.location.origin
    || !isChapterNoteRequest(url)
    || chapterIdFromUrl(url) !== chapterId
  ) return;
  const request = new Request(url.href, { credentials: "same-origin" });
  const cache = await caches.open(chapterCacheName(chapterId));
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
  } catch {
    // A missing or temporarily unavailable note must never block chapter reading.
  }
}

async function cacheChapterByUrl(chapterUrl, noteUrl = null) {
  const url = new URL(chapterUrl);
  if (url.origin !== self.location.origin || !isChapterRequest(url)) return;
  const request = new Request(url.href, { credentials: "same-origin" });
  const chapterId = chapterIdFromUrl(url);
  const cache = await caches.open(chapterCacheName(chapterId));
  let response;
  try {
    response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
  } catch {
    response = await cache.match(request);
  }
  if (response?.ok) {
    await Promise.all([
      cacheChapterImages(response.clone(), chapterId),
      cacheOptionalChapterNote(noteUrl, chapterId),
    ]);
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function navigationNetworkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match("./index.html")) || (await shell.match("./")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationNetworkFirst(request));
  } else if (isChapterRequest(url) || isChapterNoteRequest(url)) {
    event.respondWith(chapterNetworkFirst(request));
  } else if (isBookImageRequest(url)) {
    event.respondWith(cacheFirst(request, chapterCacheName(chapterIdFromUrl(url))));
  } else if (isAudioRequest(url)) {
    return;
  } else if (isShellDataRequest(url)) {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) (await caches.open(SHELL_CACHE)).put(request, response.clone());
      return response;
    }).catch(async () => (await caches.open(SHELL_CACHE)).match(request) || Response.error()));
  } else if (url.pathname.startsWith(scopePath)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_CHAPTER" || !event.data.url) return;
  event.waitUntil(cacheChapterByUrl(event.data.url, event.data.noteUrl));
});
