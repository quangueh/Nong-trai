import { chromium } from "playwright-core";
import { applyFixture } from "./fixtures";

const URL = "http://localhost:5173";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const fails: string[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) fails.push(`${name}: ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}  ${detail}`);
};

for (const id of ["F01", "F02", "F03", "F04", "F05", "F09"] as const) {
  // Fresh state per fixture — seeds also self-reset, but this mirrors a true
  // first-run profile like the spec intends.
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto(URL);
  await applyFixture(page, id);
  const info = await page.evaluate(() => {
    const s = (window as any).__game.store.state;
    return {
      plants: s.plants.length,
      cap: s.nurseryCap,
      coins: s.leafCoin,
      level: s.breederLevel,
      autoCareLeft: Math.max(0, (s.autoCareUntil ?? 0) - Date.now()),
      battleLocked: s.plants.filter((p: any) => p.locks.battle).length,
      careReady: s.plants.filter((p: any) => !p.careMemory.lastUse?.water).length,
      stages: [...new Set(s.plants.map((p: any) => p.growth.stage))].sort(),
      maxName: Math.max(0, ...s.plants.map((p: any) => p.name.length)),
    };
  });
  console.log(`-- ${id}`, JSON.stringify(info));
  if (id === "F01") check("F01 small garden", info.plants <= 4 && info.careReady > 0 && info.autoCareLeft === 0, JSON.stringify(info));
  if (id === "F02") {
    check("F02 12 plants", info.plants === 12, `${info.plants}`);
    check("F02 2 care-ready", info.careReady === 2, `${info.careReady}`);
    check("F02 helper ~10min", info.autoCareLeft > 9 * 60_000 && info.autoCareLeft <= 10 * 60_000, `${Math.round(info.autoCareLeft / 1000)}s`);
    check("F02 mixed stages", info.stages.length >= 4, info.stages.join(","));
  }
  if (id === "F03") {
    check("F03 24 plants", info.plants >= 24, `${info.plants}`);
    check("F03 one battle-locked", info.battleLocked === 1, `${info.battleLocked}`);
  }
  if (id === "F04") check("F04 2 mature parents", info.plants === 2 && info.stages.join() === "mature", JSON.stringify(info));
  if (id === "F05") check("F05 broke+full", info.coins === 5 && info.plants === info.cap, JSON.stringify(info));
  if (id === "F09") check("F09 long names", info.maxName >= 40, `${info.maxName}`);
}

await page.goto(URL);
await applyFixture(page, "F02");
await page.waitForTimeout(800);
await page.screenshot({ path: "shots/wp00-f02-garden-mobile.png" });
await browser.close();
if (fails.length) { console.error(`\n${fails.length} FAILURES`); process.exit(1); }
console.log("\nAll fixture checks passed.");
