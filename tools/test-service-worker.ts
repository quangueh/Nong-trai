import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

type FetchEvent = { request: { url: string; method: string; mode: string }; respondWith: (promise: Promise<Response | undefined>) => void };
type LifecycleEvent = { waitUntil: (promise: Promise<unknown>) => void };
function harness() {
  const handlers = new Map<string, (event: FetchEvent | LifecycleEvent) => void>();
  const records = new Map<string, Response>();
  const deleted: string[] = [];
  let network: () => Promise<Response> = async () => new Response("fresh");
  let claimed = 0;
  let skipped = 0;
  const key = (request: string | { url: string }) => typeof request === "string" ? request : request.url;
  const cache = {
    match: async (request: string | { url: string }) => records.get(key(request))?.clone(),
    put: async (request: string | { url: string }, response: Response) => { records.set(key(request), response.clone()); },
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL,
    fetch: () => network(),
    caches: { open: async () => cache, match: cache.match, keys: async () => ["nongtrai-v0", "nongtrai-v1"], delete: async (name: string) => { deleted.push(name); return true; } },
    self: { location: { origin: "https://game.test" }, addEventListener: (name: string, fn: (event: FetchEvent | LifecycleEvent) => void) => handlers.set(name, fn), skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claimed++; } } },
  });
  return {
    records, deleted,
    network(fn: () => Promise<Response>) { network = fn; },
    async fetch(url: string, method = "GET", mode = "cors") {
      let response: Promise<Response | undefined> | undefined;
      handlers.get("fetch")!({ request: { url, method, mode }, respondWith: promise => { response = promise; } });
      const value = response ? await response : undefined;
      // Flush cache-write continuations that production currently does not waitUntil.
      await new Promise(resolve => setImmediate(resolve));
      return { handled: Boolean(response), value };
    },
    async lifecycle(name: string) {
      let work: Promise<unknown> | undefined;
      handlers.get(name)!({ waitUntil: promise => { work = promise; } });
      await work;
      return { claimed, skipped };
    },
  };
}
let passed = 0;
let failed = 0;
async function test(name: string, work: () => Promise<void>) {
  try { await work(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
await test("install and activation take control and delete obsolete cache", async () => {
  const h = harness();
  assert.equal((await h.lifecycle("install")).skipped, 1);
  assert.equal((await h.lifecycle("activate")).claimed, 1);
  assert.deepEqual(h.deleted, ["nongtrai-v0"]);
});
await test("cross-origin API and non-GET requests never enter cache", async () => {
  const h = harness();
  assert.equal((await h.fetch("https://account.test/api/save")).handled, false);
  assert.equal((await h.fetch("https://game.test/api/save", "PUT")).handled, false);
  assert.equal(h.records.size, 0);
});
await test("asset online cache miss fetches and stores successful response", async () => {
  const h = harness();
  assert.equal(await (await h.fetch("https://game.test/assets/game.js")).value!.text(), "fresh");
  assert.ok(h.records.has("https://game.test/assets/game.js"));
});
await test("asset cache hit returns stale then refreshes cache", async () => {
  const h = harness();
  h.records.set("https://game.test/assets/game.js", new Response("old"));
  assert.equal(await (await h.fetch("https://game.test/assets/game.js")).value!.text(), "old");
  assert.equal(await h.records.get("https://game.test/assets/game.js")!.clone().text(), "fresh");
});
await test("offline asset hit remains usable", async () => {
  const h = harness();
  h.records.set("https://game.test/assets/game.js", new Response("cached"));
  h.network(async () => { throw new TypeError("offline"); });
  assert.equal(await (await h.fetch("https://game.test/assets/game.js")).value!.text(), "cached");
});
await test("asset 500 never overwrites last successful cached copy", async () => {
  const h = harness();
  h.records.set("https://game.test/assets/game.js", new Response("cached"));
  h.network(async () => new Response("outage", { status: 500 }));
  await h.fetch("https://game.test/assets/game.js");
  assert.equal(await h.records.get("https://game.test/assets/game.js")!.clone().text(), "cached");
});
await test("navigation network-first then offline shell fallback", async () => {
  const h = harness();
  assert.equal(await (await h.fetch("https://game.test/", "GET", "navigate")).value!.text(), "fresh");
  h.network(async () => { throw new TypeError("offline"); });
  assert.equal(await (await h.fetch("https://game.test/route", "GET", "navigate")).value!.text(), "fresh");
});
await test("navigation 500 must not poison the cached offline shell", async () => {
  const h = harness();
  h.records.set("/index.html", new Response("working shell"));
  h.network(async () => new Response("outage", { status: 500 }));
  await h.fetch("https://game.test/", "GET", "navigate");
  assert.equal(await h.records.get("/index.html")!.clone().text(), "working shell");
});
console.log(`Service worker: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
