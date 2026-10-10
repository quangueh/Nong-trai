/**
 * The visible gardener — the character that walks the garden and acts out the
 * hired-gardener buff (docs/26 §5, docs/27 §7, docs/28 §9).
 *
 * Presentation only. The domain (`store.autoCareTick`) settles care with or
 * without this module; the actor listens to `store.onGardenerWork` events that
 * fire strictly after a successful action, and replays them as work clips. It
 * never calls `care`, never grants XP, never writes the save (ACT-02).
 *
 * Lifecycle is self-healing because the garden repaints by rebuilding its DOM:
 * `mountGardener(scene)` runs inside every `paintPlots`; the element survives
 * by being re-parented into the new scene, and when no scene claims it the
 * driver notices `!isConnected` and destroys itself (ACT-06).
 */

import { el } from "./components";
import { sfx } from "../audio/audio";
import type { GameStore } from "../core/store";
import type { GardenerWorkEvent } from "../core/types";
import { createQueue, drainQueue, enqueueWork, nextJob, pruneQueue, type GardenerJob, type GardenerQueue } from "./gardenerQueue";

type ActorState = "hidden" | "arrive" | "idle" | "walk" | "face" | "work" | "ack" | "leave";

interface Anchor {
  x: number;
  y: number;
}

/** Per-action clip lengths — the work marker cues the FX/sound, the domain
    already paid for the action (docs/28 §9 work markers). */
const WORK_MS: Record<string, number> = { water: 650, fertilizer: 550, pruning: 450, music: 600, sunlight: 600 };
const ACTION_LABEL: Record<string, string> = {
  water: "Tưới nước",
  fertilizer: "Bón phân",
  pruning: "Tỉa cành",
  music: "Chăm bằng nhạc",
  sunlight: "Phơi nắng",
};

const WALK_PX_S = 105;
const ARRIVE_MS = 550;
const FACE_MS = 100;
const ACK_MS = 220;
const LEAVE_MS = 600;
const REST_AFTER_MS = 4_000;
const DONE_LOG = 8;

const ACTION_ICON: Record<string, string> = { water: "💧", fertilizer: "🌾", pruning: "✂️", music: "🎵", sunlight: "☀️" };

const svg = `
<svg viewBox="0 0 44 58" width="44" height="58" aria-hidden="true">
  <ellipse class="gd-shadow" cx="22" cy="54" rx="10" ry="2.6"/>
  <g class="gd-fig">
    <g class="gd-legs">
      <rect class="gd-leg l" x="16" y="44" width="4.6" height="8" rx="2.2"/>
      <rect class="gd-leg r" x="23.4" y="44" width="4.6" height="8" rx="2.2"/>
    </g>
    <rect class="gd-apron" x="13.4" y="26" width="17.2" height="20" rx="6"/>
    <path class="gd-shirt" d="M13 30a9 9 0 0 1 18 0v6a9 6.5 0 0 1-18 0z"/>
    <circle class="gd-head" cx="22" cy="17.5" r="7.6"/>
    <g class="gd-hat">
      <ellipse cx="22" cy="13.5" rx="11.5" ry="3.4"/>
      <path d="M15 13.5a7 6.4 0 0 1 14 0z"/>
    </g>
    <g class="gd-arm">
      <rect x="27.6" y="28" width="4.2" height="11" rx="2.1" transform="rotate(-24 29.7 28)"/>
      <g class="gd-can">
        <rect x="30" y="34" width="9" height="8.5" rx="2.4"/>
        <path class="gd-spout" d="M30 36.5l-6.4 3.2" stroke-width="2.6" stroke-linecap="round"/>
        <path class="gd-handle" d="M38.6 35.4c3.4-1.4 3.4 5.6 0 6.6" fill="none" stroke-width="1.8"/>
      </g>
    </g>
  </g>
  <g class="gd-fx">
    <g class="fx-drops"><circle cx="24" cy="42" r="1.5"/><circle cx="27" cy="45" r="1.3"/><circle cx="21.5" cy="46" r="1.2"/></g>
    <g class="fx-feed"><circle cx="24" cy="44" r="1.2"/><circle cx="20" cy="47" r="1"/><circle cx="28" cy="47.5" r="1.1"/></g>
    <g class="fx-snip"><path d="M18 38l8 5" /><path d="M26 38l-8 5"/></g>
    <text class="fx-note" x="30" y="30">♪</text>
    <g class="fx-sun"><path d="M22 30v-5M16 32l-3.4-3.4M28 32l3.4-3.4"/></g>
  </g>
</svg>`;

export class Gardener {
  /** Presentation-state read-out for tests and the detail sheet. */
  state: ActorState = "hidden";
  /** Completed performances — what the detail sheet lists (capped). */
  readonly done: { action: string; at: number; plantId: string }[] = [];
  /** True after destroy() — the mount hook checks it before re-attaching. */
  destroyed = false;
  readonly store: GameStore;
  private scene: HTMLElement | null = null;
  private el: HTMLElement;
  private badge: HTMLButtonElement;
  private statusEl: HTMLElement;
  private queue: GardenerQueue = createQueue();
  private job: GardenerJob | null = null;
  private target: Anchor | null = null;
  private x = 24;
  private y = 0;
  private dir = 1;
  private phase = 0;
  private idleFor = 0;
  private raf = 0;
  private lastT = 0;
  private unsubs: (() => void)[] = [];
  private ro: ResizeObserver | null = null;
  private onScroll = () => this.reAnchor();
  private rm = window.matchMedia("(prefers-reduced-motion: reduce)");
  private fig: SVGSVGElement | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: GameStore) {
    this.store = store;
    this.el = el("div", { class: "gdr", "data-state": "hidden" });
    this.el.innerHTML = svg;
    this.fig = this.el.querySelector("svg");
    this.badge = el("button", { class: "gdr-badge", type: "button", "aria-label": "Người làm vườn — xem chi tiết" }, ["🤖"]) as HTMLButtonElement;
    this.badge.addEventListener("click", () => this.openSheet());
    this.statusEl = el("div", { class: "gdr-status", "aria-hidden": "true" });
    this.el.append(this.badge, this.statusEl);

    this.unsubs.push(
      store.onGardenerWork((ev) => this.onWork(ev)),
      // The repaint watcher is the actor's alarm clock: a new buff granted
      // while hidden, a removed scene and buff expiry all surface here.
      store.subscribe(() => this.onRepaint()),
    );

    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.reAnchor());
    }
  }

  /**
   * Claim a scene — idempotent. `paintPlots` calls this every repaint; the
   * element just re-parents into the fresh DOM.
   */
  attach(scene: HTMLElement): void {
    if (this.destroyed) return;
    if (this.scene !== scene) {
      // Scene is rebuilt every repaint — stop listening on the dead one
      // before it is garbage-collected with our listener attached.
      this.scene?.removeEventListener("scroll", this.onScroll);
      this.ro?.disconnect();
      this.scene = scene;
      this.ro?.observe(scene);
      scene.addEventListener("scroll", this.onScroll, { passive: true });
    }
    this.scene.appendChild(this.el);
    if (this.state === "hidden" && this.store.autoCareLeft() > 0) this.enter("arrive");
    this.kick();
  }

  /** Detach detection + buff-watch on every store commit. */
  private onRepaint(): void {
    if (this.destroyed) return;
    if (!this.el.isConnected) {
      this.destroy();
      return;
    }
    const left = this.store.autoCareLeft();
    if (this.state === "hidden" && left > 0) this.enter("arrive");
    this.kick();
  }

  private onWork(ev: GardenerWorkEvent): void {
    if (this.destroyed) return;
    enqueueWork(this.queue, ev, performance.now());
    if (this.state === "hidden" || this.state === "idle" || this.state === "arrive") {
      if (this.state === "idle") this.pick();
    }
    this.kick();
  }

  private enter(s: ActorState): void {
    this.state = s;
    this.phase = 0;
    this.el.dataset.state = s;
    this.el.classList.toggle("rm", this.rm.matches);
    /*
     * Buff expiry is a wall-clock edge, not a repaint — while parked idle the
     * driver sleeps, so the moment has to be armed as a timer or the gardener
     * would stand mid-garden forever instead of walking off.
     */
    if (s === "idle") {
      this.armExpiry();
      // Parked idle needs no RAF — timers carry the status text and the
      // expiry edge, and the next work event or repaint wakes the machine.
      this.restTimer = setTimeout(() => {
        this.restTimer = null;
        if (this.destroyed || this.state !== "idle") return;
        const total = this.queue.summarized + this.queue.catchupSummarized;
        this.statusEl.textContent = total > 0 ? `Đã chăm thêm ${total} lượt` : "Đang chờ cây có thể chăm";
      }, REST_AFTER_MS);
      // A second job may already be queued — chain it without waiting for a
      // new event.
      this.pick();
    } else {
      if (this.expiryTimer) {
        clearTimeout(this.expiryTimer);
        this.expiryTimer = null;
      }
      if (this.restTimer) {
        clearTimeout(this.restTimer);
        this.restTimer = null;
      }
      // Motion states need the driver — a pick() chained out of a parked
      // idle lands here with no RAF running.
      this.kick();
    }
    if (s === "arrive") {
      // Walk in from the left garden edge rather than popping in.
      const entry = this.entryAnchor();
      this.x = entry.x - 30;
      this.y = entry.y;
      this.place();
    }
    if (s === "leave") drainQueue(this.queue);
    if (s === "hidden") {
      this.queue = createQueue();
      this.job = null;
    }
  }

  /** Wake once, at the buff's expiry edge, so a parked actor still walks off. */
  private armExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const left = this.store.autoCareLeft();
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = null;
        if (this.destroyed || this.state !== "idle") return;
        if (this.store.autoCareLeft() <= 0) {
          this.enter("leave");
          this.kick();
        } else {
          // A grant landed before the old timer fired — re-arm the new edge.
          this.armExpiry();
        }
      },
      Math.min(Math.max(left + 80, 200), 2_147_000_000),
    );
  }

  private kick(): void {
    if (this.raf || this.destroyed) return;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number): void => {
    this.raf = 0;
    if (this.destroyed) return;
    if (!this.el.isConnected) {
      this.destroy();
      return;
    }
    const dt = Math.min(64, t - this.lastT);
    this.lastT = t;
    this.step(dt);
    // The driver only sleeps when the gardener has nothing to do — parked
    // hidden or parked idle wakes on the next work event, repaint or the
    // armed expiry timer.
    if (this.state !== "hidden" && this.state !== "idle") this.kick();
  };

  private step(dt: number): void {
    const now = performance.now();
    pruneQueue(this.queue, now);
    const left = this.store.autoCareLeft();
    this.badge.textContent = `🤖 ${Math.max(1, Math.ceil(left / 60000))}p`;

    switch (this.state) {
      case "arrive": {
        this.phase += dt;
        const k = Math.min(1, this.phase / (this.rm.matches ? 120 : ARRIVE_MS));
        this.x += (this.entryAnchor().x - this.x) * Math.min(1, dt / 90);
        this.place();
        if (k >= 1) this.enter("idle");
        break;
      }
      case "idle": {
        this.idleFor += dt;
        if (left <= 0) {
          this.statusEl.textContent = "";
          this.enter("leave");
          break;
        }
        this.pick();
        break;
      }
      case "walk": {
        if (!this.target) {
          this.enter("idle");
          break;
        }
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 4) {
          this.enter("face");
          break;
        }
        // Long hauls become a soft transition at the scene edge instead of a
        // multi-second trek (docs/27 §7.4 — one visual job stays ≲3s).
        const maxWalk = Math.max(this.scene?.clientWidth ?? 360, 300) * 0.9;
        if (!this.rm.matches && dist > maxWalk * 2) {
          this.fadeJump();
          break;
        }
        const step = this.rm.matches ? dist : Math.min(dist, (WALK_PX_S * dt) / 1000);
        this.dir = dx === 0 ? this.dir : Math.sign(dx);
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.place();
        break;
      }
      case "face":
        this.phase += dt;
        if (this.phase >= (this.rm.matches ? 40 : FACE_MS)) this.enter("work");
        break;
      case "work": {
        this.phase += dt;
        const ms = this.rm.matches ? 300 : (WORK_MS[this.job?.event.action ?? ""] ?? 600);
        if (this.phase >= ms) this.enter("ack");
        break;
      }
      case "ack":
        this.phase += dt;
        if (this.phase >= (this.rm.matches ? 80 : ACK_MS)) {
          if (this.job) this.done.unshift({ action: this.job.event.action, at: this.job.event.occurredAt, plantId: this.job.event.plantId });
          if (this.done.length > DONE_LOG) this.done.length = DONE_LOG;
          this.job = null;
          this.el.classList.remove(...Object.keys(WORK_MS).map((a) => `w-${a}`));
          this.enter("idle");
        }
        break;
      case "leave": {
        this.phase += dt;
        if (left > 0) {
          // Buff extended mid-exit (stacked grant) — turn around and work.
          this.enter("arrive");
          break;
        }
        const exit = -40;
        this.x -= (WALK_PX_S * dt) / 1000;
        this.place();
        if (this.phase > LEAVE_MS || this.x <= exit) this.enter("hidden");
        break;
      }
    }
  }

  private pick(): void {
    const job = nextJob(this.queue);
    if (!job) return;
    const anchor = this.anchorFor(job.event.plantId);
    if (!anchor) {
      // Plant sold/bred/locked between event and performance — the visual
      // job cancels; the settled care itself is untouched.
      return;
    }
    this.job = job;
    this.target = anchor;
    this.idleFor = 0;
    this.statusEl.textContent = "";
    this.el.classList.add(`w-${job.event.action}`);
    this.enter("walk");
  }

  /** The work anchor: below the plant card's soil edge, off the label. */
  private anchorFor(plantId: string): Anchor | null {
    const scene = this.scene;
    if (!scene) return null;
    const card = scene.querySelector<HTMLElement>(`[data-plant-id="${plantId}"]`);
    if (!card) return null;
    const sr = scene.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return { x: cr.left - sr.left + cr.width / 2, y: cr.bottom - sr.top + 12 };
  }

  private entryAnchor(): Anchor {
    const scene = this.scene;
    const grid = scene?.querySelector<HTMLElement>(".plots");
    if (scene && grid) {
      const sr = scene.getBoundingClientRect();
      const gr = grid.getBoundingClientRect();
      return { x: 26, y: gr.top - sr.top + 20 };
    }
    return { x: 26, y: (scene?.clientHeight ?? 300) * 0.4 };
  }

  /** Re-resolve the in-flight job's anchor after resize/scroll. */
  private reAnchor(): void {
    if (this.job) this.target = this.anchorFor(this.job.event.plantId);
  }

  /** Long-jump policy: fade at the edge, reappear near the new target. */
  private fadeJump(): void {
    if (!this.target) return;
    this.el.classList.add("gd-fade");
    setTimeout(() => {
      if (this.destroyed || !this.target) return;
      this.x = this.target.x;
      this.y = this.target.y;
      this.place();
      this.el.classList.remove("gd-fade");
      this.enter("face");
    }, 160);
  }

  private place(): void {
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    // Facing flips the figure only — the badge would mirror its own glyph.
    if (this.fig) this.fig.style.transform = `scaleX(${this.dir})`;
  }

  private openSheet(): void {
    sfx.play("tap");
    const shell = document.querySelector(".shell") ?? document.body;
    shell.querySelectorAll(".overlay.gdr-sheet-overlay, .sheet.gdr-sheet").forEach((n) => n.remove());

    const left = this.store.autoCareLeft();
    const total = this.queue.summarized + this.queue.catchupSummarized;

    const rows: (Node | string)[] = [];
    if (this.done.length === 0 && total === 0) {
      rows.push(el("div", { class: "empty" }, [el("div", {}, ["Người làm vườn chưa chăm cây nào trong phiên này."])]));
    }
    for (const d of this.done) {
      const plant = this.store.state.plants.find((p) => p.plantId === d.plantId);
      rows.push(
        el("div", { class: "gdr-log-row" }, [
          el("span", { class: "gdr-log-ico" }, [ACTION_ICON[d.action] ?? "🌿"]),
          el("span", { class: "gdr-log-txt" }, [`${ACTION_LABEL[d.action] ?? d.action}${plant ? ` — ${plant.name}` : ""}`]),
          el("span", { class: "tiny mono" }, [new Date(d.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })]),
        ]),
      );
    }
    if (total > 0) {
      rows.push(el("div", { class: "tiny", style: "margin-top:6px;opacity:.75" }, [`…và ${total} lượt chăm khác đã gộp vào tổng.`]));
    }

    const overlay = el("div", { class: "overlay gdr-sheet-overlay" });
    const sheet = el("div", { class: "sheet gdr-sheet" }, [
      el("div", { class: "sheet-head" }, [
        el("div", { class: "sheet-title" }, ["🤖 Người làm vườn"]),
        el("div", { class: "tiny mono" }, [`còn ${Math.max(1, Math.ceil(left / 60000))} phút`]),
      ]),
      el("div", { class: "tiny", style: "opacity:.75;margin-bottom:8px" }, [
        `Thuê bằng quảng cáo hoặc quà điểm danh — chăm tự động một lượt mỗi cây mỗi nhịp, không dùng tài nguyên của bạn.`,
      ]),
      ...rows,
      el("button", { class: "btn primary", style: "margin-top:10px" }, ["Đóng"]),
    ]);
    const close = () => {
      overlay.remove();
      sheet.remove();
    };
    sheet.querySelector("button")?.addEventListener("click", close);
    overlay.addEventListener("click", close);
    shell.append(overlay, sheet);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.restTimer) {
      clearTimeout(this.restTimer);
      this.restTimer = null;
    }
    for (const u of this.unsubs.splice(0)) u();
    this.ro?.disconnect();
    this.scene?.removeEventListener("scroll", this.onScroll);
    this.el.remove();
    if (live === this) {
      live = null;
      delete (window as unknown as { __gardener?: Gardener }).__gardener;
    }
    drainQueue(this.queue);
  }
}

/* ------------------------------------------------------------------ mount */

let live: Gardener | null = null;

/**
 * Called by `paintPlots` on every garden repaint. Creates the actor once, then
 * re-attaches it into each fresh scene. Safe to call on every paint.
 */
export function mountGardener(scene: HTMLElement, store: GameStore): Gardener {
  if (!live || live.destroyed || live.store !== store) {
    live = new Gardener(store);
    // Test/debug handle, same convention as `window.__game`.
    (window as unknown as { __gardener?: Gardener }).__gardener = live;
  }
  live.attach(scene);
  return live;
}

/** Test hook — fully tear the actor down outside the paint cycle. */
export function destroyGardener(): void {
  live?.destroy();
  live = null;
  delete (window as unknown as { __gardener?: Gardener }).__gardener;
}
