import { chromium } from "playwright-core";

async function main() {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await p.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await p.waitForTimeout(700);
  await p.evaluate(`(() => {
    const g = (window).__game, s = g.store;
    s.state.breederLevel = 24;
    s.state.leafCoin = 48000;
    for (const pl of s.state.plants) { pl.growth.stage = "mature"; pl.growth.level = 20; }
    s.state.ascent.highest = 21;
    if (!s.state.ascent.day) s.state.ascent.day = new Date().toISOString().slice(0, 10);
    g.navigate("ascent");
  })()`);
  await p.waitForTimeout(1100);
  await p.evaluate(`(() => { document.querySelector("[data-stage-fight]")?.click(); })()`);
  await p.waitForTimeout(700);
  await p.evaluate(`(() => {
    const b = [...document.querySelectorAll(".overlay button, .stagebrief button")].find((x) => /^Bắt đầu/.test((x.textContent || "").trim()));
    if (b) b.click();
  })()`);
  await p.waitForTimeout(2600);
  await p.screenshot({ path: "shots/probe-side.png" });
  const order = await p.evaluate(() =>
    Array.from(document.querySelectorAll(".battlefield .battler")).map((n) => (n.className.includes("enemy") ? "enemy" : "mine")),
  );
  console.log("battler order:", JSON.stringify(order));
  await b.close();
}
main();
