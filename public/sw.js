// Service worker: makes the app installable and fast to open.
// The game itself needs the network (scores come from the server); only static things are cached.
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const PRECACHE = ["/", "/installer/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheFirst = async (req) => {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(STATIC)).put(req, res.clone());
  return res;
};

const networkFirst = async (req, fallback) => {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(fallback ?? req, res.clone());
    return res;
  } catch {
    return (await caches.match(fallback ?? req)) ?? Response.error();
  }
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // versioned dictionary files and hashed build assets never change
    if ((url.pathname.includes("/public/") && url.searchParams.has("v")) || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"))
      return e.respondWith(cacheFirst(req));
    if (url.pathname.startsWith("/api/")) return; // live game data: always network
    if (req.mode === "navigate")
      return e.respondWith(networkFirst(req, url.pathname.startsWith("/installer") ? "/installer/" : "/"));
  } else if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    return e.respondWith(cacheFirst(req));
  }
});
