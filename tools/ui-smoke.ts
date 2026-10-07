/**
 * Browser UI smoke test.
 *
 * Paste into the devtools console while `npm run dev` is running, or drive it
 * with Playwright. It walks every screen, opens every sheet, and reports any
 * thrown error or empty render — the fastest way to catch a broken screen.
 */

export async function uiSmokeTest(): Promise<string[]> {
  const log: string[] = [];
  const errors: string[] = [];
  const g = (window as unknown as { __game?: { store: any; navigate: (s: string, p?: unknown) => void } }).__game;
  if (!g) return ["FATAL: window.__game missing — run `npm run dev` and reload"];

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const screen = () => document.querySelector(".screen") as HTMLElement;
  const text = () => screen()?.innerText ?? "";

  const step = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      await wait(60);
      const t = text().trim();
      if (!t) errors.push(`${name}: rendered nothing`);
      else log.push(`OK   ${name} (${t.length} chars)`);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  };

  // Seed a playable state: two mature plants so breeding/battle are reachable.
  g.store.state.leafCoin = 50000;
  g.store.state.geneCrystal = 40;
  g.store.state.items = 200;
  while (g.store.state.plants.length < 4) g.store.plantSeed(["thornroot", "emberleaf", "voltvine", "gloomcap"][g.store.state.plants.length % 4]);
  for (const p of g.store.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 20;
    p.locks.manual = false;
  }
  g.store.save();

  await step("garden", () => g.navigate("garden"));
  await step("collection", () => g.navigate("collection"));
  await step("breeding", () => g.navigate("breeding"));
  await step("arena", () => g.navigate("arena"));
  await step("lab", () => g.navigate("lab"));

  // Lab tabs.
  for (const tab of ["Vật tư", "Vườn", "Đơn hàng", "Hạt cơ bản"]) {
    await step(`lab/${tab}`, () => {
      const b = [...document.querySelectorAll(".screen .btn")].find((x) => x.textContent?.trim() === tab) as HTMLButtonElement | undefined;
      b?.click();
    });
  }

  // Plant detail sheet.
  await step("plant detail sheet", () => {
    g.navigate("garden");
    (document.querySelector(".screen .plantcard") as HTMLElement)?.click();
  });
  await step("care sheet", () => {
    const b = [...document.querySelectorAll(".sheet .btn")].find((x) => x.textContent?.includes("Chăm cây")) as HTMLButtonElement | undefined;
    b?.click();
  });
  await step("perform a care action", () => {
    const b = [...document.querySelectorAll(".sheet .btn")].find((x) => x.textContent?.includes("Tưới nước")) as HTMLButtonElement | undefined;
    b?.click();
  });

  // Breeding with two parents.
  await step("breeding: pick parent A", () => {
    g.navigate("breeding");
    (document.querySelectorAll(".screen .slot")[0] as HTMLElement)?.click();
    const card = document.querySelector(".sheet .pickrow") as HTMLElement;
    card?.click();
  });
  await step("breeding: pick parent B", () => {
    (document.querySelectorAll(".screen .slot")[1] as HTMLElement)?.click();
    (document.querySelector(".sheet .pickrow") as HTMLElement)?.click();
  });
  await step("breeding: run", () => {
    const b = [...document.querySelectorAll(".screen .btn")].find(
      (x) => x.textContent?.includes("Lai tạo") && !(x as HTMLButtonElement).disabled,
    ) as HTMLButtonElement | undefined;
    b?.click();
  });
  await step("mutation report", () => {
    const b = [...document.querySelectorAll(".sheet .btn")].find((x) => x.textContent?.includes("vườn")) as HTMLButtonElement | undefined;
    b?.click();
  });

  // Battle.
  const plantId = g.store.state.plants[0].plantId;
  await step("arena: pick plant", () => {
    g.navigate("arena", { plantId });
  });
  await step("arena: start battle", () => {
    const b = [...document.querySelectorAll(".screen .btn")].find((x) => x.textContent?.includes("Bắt đầu trận")) as HTMLButtonElement | undefined;
    b?.click();
  });
  await step("battle renders controls", () => {
    const ok = !!document.querySelector(".battlefield") && document.querySelectorAll(".skillbtn, .stancebtn").length > 0;
    if (!ok) throw new Error("battlefield or controls missing");
  });

  // Room creation.
  await step("room: create", () => {
    g.navigate("arena");
    const b = [...document.querySelectorAll(".screen .btn")].find((x) => x.textContent?.includes("Tạo phòng")) as HTMLButtonElement | undefined;
    b?.click();
    (document.querySelector(".sheet .pickrow") as HTMLElement)?.click();
  });

  return [...log.map((l) => `  ${l}`), ...errors.map((e) => `  \x1b[31mFAIL\x1b[0m ${e}`)];
}

// Auto-run in the browser.
(window as unknown as { __runSmoke?: () => Promise<void> }).__runSmoke = async () => {
  const out = await uiSmokeTest();
  const line = out.join("\n");
  console.log(line);
  (window as unknown as { __smokeResult?: string }).__smokeResult = line;
};
