// Generated asset list is inserted after every build. API responses and OAuth callbacks are never cached.
const CACHE = "ycs-shell-__VERSION__";
const FILES = /*__FILES__*/ [];
const CORE = "ycs-ffmpeg-v1";
const CORE_URL = self.location.origin + "/ffmpeg/";
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("ycs-") && key !== CACHE && key !== CORE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.method !== "GET" ||
    req.headers.has("Authorization") ||
    req.cache === "no-store"
  )
    return;
  const own = url.origin === self.location.origin;
  if (
    own &&
    (url.pathname.startsWith("/api/") ||
      url.searchParams.has("code") ||
      url.searchParams.has("error"))
  )
    return;
  const core =
    url.href === CORE_URL + "ffmpeg-core.js" ||
    url.href === CORE_URL + "ffmpeg-core.wasm";
  if (!own && !core) return;
  if (own && req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/index.html").then((hit) => hit || Response.error()),
      ),
    );
    return;
  }
  if (!core && (!FILES.includes(url.pathname) || url.search)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(core ? CORE : CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const response = await fetch(req);
      if (response.ok) await cache.put(req, response.clone());
      return response;
    })(),
  );
});
