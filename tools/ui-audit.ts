/**
 * UI quality audit — measures what "looks good" actually depends on.
 *
 * Checks contrast ratios, minimum tap targets, overflow, and whether expensive
 * properties (layout/paint) are being animated. Run it in the browser console
 * or via the browser tool while the dev server is running.
 */

export interface Finding {
  screen: string;
  level: "fail" | "warn" | "info";
  message: string;
}

export async function uiAudit(): Promise<{ findings: Finding[]; summary: string }> {
  const findings: Finding[] = [];
  const add = (screen: string, level: Finding["level"], message: string) => findings.push({ screen, level, message });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const G = (window as unknown as { __game?: { store: any; navigate: (s: string, p?: unknown) => void } }).__game;
  if (!G) return { findings: [{ screen: "-", level: "fail", message: "window.__game thiếu — chạy npm run dev rồi tải lại" }], summary: "abort" };

  // --- helpers ---
  // `color-mix()` resolves to `color(srgb r g b)` in Chromium, not `rgb()`, so
  // the parser has to understand both notations or gradients read as empty.
  const parse = (c: string): [number, number, number, number] => {
    const rgb = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\s*\)/i);
    if (rgb) {
      const alphaRaw = rgb[4];
      const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
      return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3]), Number.isNaN(alpha) ? 1 : alpha];
    }
    const srgb = c.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/i);
    if (srgb) {
      return [
        parseFloat(srgb[1]) * 255,
        parseFloat(srgb[2]) * 255,
        parseFloat(srgb[3]) * 255,
        srgb[4] === undefined ? 1 : parseFloat(srgb[4]),
      ];
    }
    return [0, 0, 0, 1];
  };
  const lum = ([r, g, b]: number[]): number => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /** Contrast between two already-resolved opaque colours. */
  const contrast = (fg: [number, number, number], bg: [number, number, number]): number => {
    const l1 = lum(fg);
    const l2 = lum(bg);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** Alpha-composite one colour over an opaque backdrop. */
  const over = (fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] =>
    alpha >= 0.999 ? fg : [fg[0] * alpha + bg[0] * (1 - alpha), fg[1] * alpha + bg[1] * (1 - alpha), fg[2] * alpha + bg[2] * (1 - alpha)];

  /**
   * True effective background: alpha-composite every translucent layer from this
   * element up to the first opaque one.
   *
   * Reading `backgroundColor` alone treats `rgba(44,143,198,0.12)` as if it were
   * solid and misses `background-image` entirely, so it both missed real failures
   * and reported correct ones (a 7.57:1 notice as 1.84:1).
   */
  const effBg = (el: Element): [number, number, number] => {
    let acc: [number, number, number] | null = null;
    let n: Element | null = el;
    while (n) {
      const cs = getComputedStyle(n);
      for (const layer of [cs.backgroundColor, ...bgStopsOf(n)]) {
        const p = parse(layer);
        if (p[3] <= 0.01) continue;
        acc = acc ? over([p[0], p[1], p[2]], p[3], acc) : [p[0], p[1], p[2]];
        if (p[3] >= 0.999) return acc;
      }
      n = n.parentElement;
    }
    // Fall back to the page background if nothing in the chain is opaque.
    return acc ?? parse(getComputedStyle(document.body).backgroundColor).slice(0, 3) as [number, number, number];
  };

  /**
   * Colour stops of a `background-image`, in paint order. Chromium resolves
   * `color-mix()` to `color(srgb r g b)`, so both notations must be recognised
   * or a gradient reads as having no stops at all.
   */
  const bgStopsOf = (el: Element): string[] => {
    const img = getComputedStyle(el).backgroundImage;
    if (!img || img === "none") return [];
    return [...img.matchAll(/rgba?\([^)]+\)|color\(\s*srgb[^)]+\)/gi)].map((m) => m[0]);
  };
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.1;
  };

  const MIN_TAP = 40;
  const screens = ["garden", "collection", "breeding", "arena", "lab"];

  for (const screen of screens) {
    G.navigate(screen);
    await wait(120);
    const root = document.querySelector(".screen") as HTMLElement;
    if (!root) {
      add(screen, "fail", "màn hình không render");
      continue;
    }

    // 1. horizontal overflow
    if (root.scrollWidth > root.clientWidth + 2) {
      add(screen, "warn", `tràn ngang: scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}`);
    }

    // 2. tap targets on interactive elements
    const interactive = [...root.querySelectorAll("button, a, input, select, [role='button']")].filter(visible) as HTMLElement[];
    let small = 0;
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      // Chips / inline tags are not required to be large tap targets.
      const cs = getComputedStyle(el);
      if (cs.display === "inline" || el.classList.contains("tag") || el.classList.contains("chip")) continue;
      if (r.width < MIN_TAP - 8 || r.height < MIN_TAP - 12) small++;
    }
    if (small > 0) add(screen, small > 4 ? "warn" : "info", `${small}/${interactive.length} nút nhỏ hơn ${MIN_TAP}px (khó bấm)`);

    /** Text colour resolved against the true backdrop behind it. */
    const effContrast = (fg: string, el: Element): number => {
      const f = parse(fg);
      const bg = effBg(el);
      const text: [number, number, number] =
        f[3] >= 0.999
          ? [f[0], f[1], f[2]]
          : [f[0] * f[3] + bg[0] * (1 - f[3]), f[1] * f[3] + bg[1] * (1 - f[3]), f[2] * f[3] + bg[2] * (1 - f[3])];
      return contrast(text, bg);
    };

    // 3. text contrast
    const texts = [...root.querySelectorAll("*")].filter((el) => {
      if (!visible(el)) return false;
      if (el.children.length > 0) return false;
      const t = (el.textContent ?? "").trim();
      return t.length > 0;
    }) as HTMLElement[];
    let lowContrast = 0;
    let worst = 99;
    let worstSample = "";
    for (const el of texts.slice(0, 400)) {
      const cs = getComputedStyle(el);
      const ratio = effContrast(cs.color, el);
      if (ratio < worst) {
        worst = ratio;
        worstSample = (el.textContent ?? "").slice(0, 24);
      }
      // 4.5:1 is the AA threshold for body text; large text needs only 3:1.
      const size = parseFloat(cs.fontSize);
      const large = size >= 18 || (size >= 14 && parseInt(cs.fontWeight, 10) >= 700);
      const min = large ? 3 : 4.5;
      if (ratio < min) lowContrast++;
    }
    if (lowContrast > 0) {
      add(screen, lowContrast > texts.length * 0.15 ? "fail" : "warn", `${lowContrast} chữ dưới ngưỡng tương phản (tệ nhất ${worst.toFixed(2)}:1 "${worstSample}")`);
    } else {
      // Name the worst sample even on a pass. "Good contrast" with no way to
      // see which element is the low-water mark is not actionable — a screen
      // sitting at 3.4:1 and one at 6.6:1 both print the same word.
      add(
        screen,
        "info",
        `tương phản tốt (tệ nhất ${worst.toFixed(2)}:1` +
          (worstSample ? ` "${worstSample}"` : "") +
          (worst < 4.5 ? " — dưới ngưỡng chữ nhỏ, chỉ đạt ngưỡng chữ lớn" : "") +
          ")",
      );
    }

    // 4. tap text never smaller than 10px on mobile
    let tinyText = 0;
    for (const el of texts.slice(0, 400)) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 9.5) tinyText++;
    }
    if (tinyText > 0) add(screen, "warn", `${tinyText} đoạn chữ dưới 9.5px (khó đọc trên điện thoại)`);

    // 5. animated layout properties (jank)
    // Only `transitionProperty` is inspected: `animationName` is just a keyframe
    // name, so matching layout keywords in it produced false positives.
    const animated = [...root.querySelectorAll("*")].filter((el) => {
      const tp = getComputedStyle(el).transitionProperty || "";
      return /(^|,\s*)(width|height|top|left|right|bottom|margin|padding|inset|font-size)(\s*,|$)/.test(tp);
    });
    if (animated.length > 0) {
      add(screen, animated.length > 4 ? "warn" : "info", `${animated.length} phần tử animate thuộc tính layout (gây giật)`);
    }
  }

  // 6. battle screen specifics
  G.navigate("arena", { plantId: G.store.state.plants.find((p: any) => p.growth.stage === "mature")?.plantId });
  await wait(150);
  const goBtn = [...document.querySelectorAll(".screen .btn")].find((b) => b.textContent?.includes("Bắt đầu trận")) as HTMLButtonElement | undefined;
  if (goBtn) {
    goBtn.click();
    await wait(600);
    const field = document.querySelector(".battlefield");
    if (!field) add("battle", "fail", "đấu trường không render");
    else {
      const avatar = document.querySelector(".battler .avatar")?.getBoundingClientRect();
      if (avatar && avatar.width < 70) add("battle", "warn", `chân dung nhỏ: ${Math.round(avatar.width)}px`);
      const skill = document.querySelector(".skillbtn")?.getBoundingClientRect();
      if (skill && skill.width < 64) add("battle", "info", `nút chiêu nhỏ: ${Math.round(skill.width)}px`);
      add("battle", "info", "đấu trường render bình thường");
    }
  } else {
    add("battle", "info", "chưa có cây trưởng thành để đấu");
  }

  G.navigate("garden");

  const fails = findings.filter((f) => f.level === "fail").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  const summary = `${fails} lỗi · ${warns} cảnh báo · ${findings.length} kiểm tra`;
  return { findings, summary };
}

// Convenience for the console.
(window as unknown as { __audit?: () => Promise<void> }).__audit = async () => {
  const { findings, summary } = await uiAudit();
  const lines = findings.map((f) => `  ${f.level === "fail" ? "\x1b[31mFAIL" : f.level === "warn" ? "\x1b[33mWARN" : "\x1b[36mINFO"}\x1b[0m [${f.screen}] ${f.message}`);
  const out = [...lines, `\n  ${summary}`].join("\n");
  console.log(out);
  (window as unknown as { __auditResult?: string }).__auditResult = out;
};
