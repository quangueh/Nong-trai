/**
 * The game shell's service worker — stale-while-revalidate for same-origin GETs.
 *
 * What it buys, in order:
 *
 *   1. Repeat opens are instant. The bundle, css and fonts land from the cache
 *      before the network is even asked, and the network copy still refreshes
 *      the cache in the background so a deploy is picked up next open — not
 *      three deploys later, and never mid-run.
 *
 *   2. The game works offline. A navigation with no connection gets the cached
 *      index.html; local save play (guest mode) needs nothing else. Account
 *      calls fail the way they already do offline — the sync layer treats a dead
 *      fetch as "try later", which is the designed behaviour.
 *
 *   3. Nothing cross-origin is touched. The Worker API, Google sign-in and the
 *      fonts all go straight to the network — an API response cached here would
 *      be a save-file bug, not a speedup.
 *
 * The cache name is versioned so an old worker's cache is dropped on activate
 * rather than growing forever.
 */

const CACHE = "nongtrai-v1";

self.addEventListener("install", (e) => {
  // Take over immediately — a visitor's next navigation uses this worker rather
  // than waiting for every old tab to close.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first (a fresh deploy matters most here), falling back
  // to the cached shell when offline — that is the whole offline story.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Only a working shell may replace the cached one — storing an error
          // page here would serve the outage again on the next offline open,
          // the same permanent-outage bug the asset branch below guards. The
          // write rides waitUntil so the worker cannot be killed mid-put.
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then((c) => c.put("/index.html", copy)));
          }
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Everything else same-origin: cached copy instantly, network refreshes behind.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          // Opaque/errored responses are never stored — a 500 in the cache is a
          // permanent outage the user can't clear.
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit ?? net;
    }),
  );
});
