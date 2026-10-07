/**
 * Multiplayer room (docs/04). Server-authoritative battle.
 *
 * Two transports carry the same message contract:
 *
 *   BroadcastChannel — instant, but only between tabs of one browser on one machine.
 *   The Worker relay (`/api/room`, worker/src/room.ts) — a KV mailbox polled by both
 *   sides, which is what lets two different devices share a room at all.
 *
 * Every outgoing message is published to both, and `mid` dedupe means whichever copy
 * arrives second is dropped. Without the relay the room still works — it just cannot
 * reach past the browser it is open in. One tab is elected host and runs the
 * authoritative simulation; the guest sends intents and receives state.
 */

import { Rng, seedToken } from "./rng";
import type { Plant } from "./types";
import { ELEMENTS } from "../config/elements";
import { BattleSession, type BattleEvent, type Stance } from "../battle/engine";

/**
 * Room-code alphabet (docs/04 §3): 6 characters, uppercase letters and digits,
 * excluding the visually ambiguous 0, O, 1, I and L so codes can be read aloud
 * and typed without mistakes.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CHANNEL = "mutant-sprout-room-v1";

/**
 * The relay shares the account Worker's address rather than taking a second variable —
 * one `VITE_ACCOUNT_API` turns on friends, cloud saves and remote rooms together.
 */
const RELAY_BASE =
  (import.meta.env?.VITE_ACCOUNT_API as string | undefined)?.replace(/\/$/, "") ?? "";

/** Whether rooms can reach another device. BroadcastChannel alone covers one browser. */
export const roomRelayAvailable = RELAY_BASE !== "";

/**
 * How far below the newest key seen a poll still accepts. Two devices' clocks can sit
 * seconds apart, and a strict "newer than the last message" cursor would then skip a
 * message written by the slower clock — permanently. The window returns a little
 * history on every poll and the client dedupes by key name instead.
 */
const RELAY_SKEW_MS = 10_000;

export type RoomState =
  | "waiting"
  | "selecting_plants"
  | "ready_check"
  | "countdown"
  | "in_battle"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "expired";

export interface RoomPlayer {
  playerId: string;
  name: string;
  isHost: boolean;
  plantId: string | null;
  ready: boolean;
  connected: boolean;
  stance: Stance;
}

export interface PlantPublic {
  name: string;
  power: number;
  elements: string[];
  rarity: string;
  traits: string[];
}

export interface RoomSnapshot {
  code: string;
  state: RoomState;
  hostId: string;
  players: RoomPlayer[];
  battleSeed: string | null;
  countdownAt: number | null;
  plants: Record<string, PlantPublic>;
}

export interface RoomIntent {
  kind: "cast" | "stance" | "focus";
  value?: string;
  stance?: Stance;
}

export interface SideResult {
  hp: number;
  hpPct: number;
  damageDealt: number;
  damageTaken: number;
  shields: number;
  heals: number;
  skillUses: number;
  energyPeak: number;
}

/**
 * Re-express a result for one of the two players.
 *
 * The host settles the fight with its own plant as side `a`, and broadcasts the raw
 * `{ winner, mine, theirs }` from that orientation. A guest that reads it directly sees the
 * host's summary as its own and the host's winner token as its own — so a guest whose plant was
 * killed is told it won, and a guest that killed the host is told it lost. That is the whole
 * bug this function exists to make impossible: orientation is applied once, in one place, and
 * both peers call the same function.
 */
export function resultForPlayer(
  m: { winner: string; mine: SideResult; theirs: SideResult },
  mySide: "a" | "b",
): { won: boolean; draw: boolean; mine: SideResult; theirs: SideResult } {
  const draw = m.winner === "draw";
  const won = !draw && m.winner === mySide;
  return { won, draw, mine: mySide === "a" ? m.mine : m.theirs, theirs: mySide === "a" ? m.theirs : m.mine };
}

export type RoomMessage = {
  /**
   * Sender-minted dedupe id. A message travels on BroadcastChannel and the relay at
   * once, so the second copy has to be droppable — and a relayed copy of a client's
   * own send has to be too. Absent on hand-forged messages, which are let through so
   * tests can inject them.
   */
  mid?: string;
} & (
  | { kind: "create"; code: string; hostId: string; hostName: string }
  | { kind: "join"; code: string; playerId: string; name: string }
  | { kind: "state"; code: string; snapshot: RoomSnapshot }
  | { kind: "plant_data"; code: string; playerId: string; plant: Plant }
  | { kind: "select"; code: string; playerId: string; plantId: string }
  | { kind: "ready"; code: string; playerId: string; ready: boolean }
  | { kind: "stance"; code: string; playerId: string; stance: Stance }
  | { kind: "start"; code: string; playerId: string }
  | { kind: "input"; code: string; playerId: string; intent: RoomIntent }
  | { kind: "result"; code: string; playerId: string; winner: string; mine: SideResult; theirs: SideResult }
  | { kind: "leave"; code: string; playerId: string }
  | { kind: "req_state"; code: string; playerId: string }
);

export function generateRoomCode(rng: Rng): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(rng.next() * CODE_ALPHABET.length)];
  return code;
}

function randomCode(): string {
  return generateRoomCode(new Rng(`${Date.now()}:${Math.random()}`));
}

/** Knobs a test can turn; production callers never pass this. */
export interface RoomClientOptions {
  /** Override the relay base URL. Empty string disables the relay. */
  relay?: string;
  /** Poll interval in ms. The default suits a human-speed lobby and a relayed intent. */
  pollMs?: number;
}

export class RoomClient {
  private channel: BroadcastChannel | null = null;
  private code: string | null = null;
  private isHostRole = false;
  private messageHandlers = new Set<(m: RoomMessage) => void>();
  private stateHandlers = new Set<(s: RoomSnapshot) => void>();
  private intentHandlers = new Set<(i: RoomIntent) => void>();
  /** mids already dispatched — second copies and own relayed sends stop here. */
  private seen = new Set<string>();
  /** Relay key names already delivered, for the skew-window overlap. */
  private seenKeys = new Set<string>();
  private relayTimer: ReturnType<typeof setInterval> | null = null;
  /** Highest message timestamp seen, for the `afterTs` cursor. */
  private relayTs = 0;
  private seq = 0;
  private readonly relay: string;
  private readonly pollMs: number;
  /**
   * A guest keeps announcing itself until the host's snapshot names it — a join can be
   * lost to a race on the wire, and the state snapshot is the only proof the host saw it.
   * Bounded so a dead room stops costing requests; a host that comes back late still gets
   * a few announcements before the guest gives up.
   */
  private acked = false;
  private announces = 0;
  private announceTick = 0;

  constructor(
    private readonly playerId: string,
    private readonly playerName: string,
    options: RoomClientOptions = {},
  ) {
    this.relay = (options.relay ?? RELAY_BASE).replace(/\/$/, "");
    this.pollMs = options.pollMs ?? 650;
  }

  get host(): boolean {
    return this.isHostRole;
  }
  get currentCode(): string | null {
    return this.code;
  }

  private ensureChannel(): BroadcastChannel | null {
    if (this.channel) return this.channel;
    if (typeof BroadcastChannel === "undefined") return null;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (ev: MessageEvent) => this.handle(ev.data as RoomMessage);
    return this.channel;
  }

  private dispatch(m: RoomMessage) {
    for (const h of this.messageHandlers) h(m);
    if (m.kind === "state") for (const h of this.stateHandlers) h(m.snapshot);
    if (m.kind === "input" && m.playerId !== this.playerId) {
      for (const h of this.intentHandlers) h(m.intent);
    }
  }

  private handle(m: RoomMessage) {
    if (m.mid) {
      if (this.seen.has(m.mid)) return;
      this.remember(m.mid);
    }
    // The host's own snapshot is the acknowledgement: once it lists this guest, the
    // join landed and the announce loop can stop.
    if (m.kind === "state" && m.snapshot.players.some((p) => p.playerId === this.playerId)) {
      this.acked = true;
    }
    this.dispatch(m);
  }

  private remember(mid: string) {
    this.seen.add(mid);
    // Set order is insertion order; a room lives for minutes, so a cap and a trim of
    // the oldest half is all the bound this needs.
    if (this.seen.size > 400) {
      let n = 200;
      for (const k of this.seen) {
        this.seen.delete(k);
        if (--n <= 0) break;
      }
    }
  }

  /**
   * One send, both wires. BroadcastChannel is free and instant when the other player
   * is a second tab; the relay is the only path that reaches another device. The mid
   * is marked seen up front so the relayed copy of our own message is dropped on poll.
   */
  private publish(m: RoomMessage) {
    m.mid = `${this.playerId}:${++this.seq}:${Math.random().toString(36).slice(2, 6)}`;
    this.remember(m.mid);
    this.ensureChannel()?.postMessage(m);
    this.relaySend(m);
  }

  private relaySend(m: RoomMessage) {
    const code = this.code;
    if (!this.relay || !code) return;
    // Fire and forget: if the relay is unreachable the BroadcastChannel copy still
    // stands, which is exactly the same-browser case it covers.
    void fetch(`${this.relay}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "send", code, msg: m }),
    }).catch(() => {});
  }

  /**
   * Clear a recycled code's mailbox. Codes are six characters and live fifteen
   * minutes, so two matches can share one — the reset means the new lobby cannot trip
   * over the last one's leftovers. The worker keeps anything newer than the reset
   * moment, so a join that landed already is safe.
   */
  /**
   * Clear a recycled code's mailbox — atomically with the room's first message.
   *
   * Codes are six characters and live fifteen minutes, so two matches can share one.
   * The reset carries the `create` message in the same request and the worker writes
   * it before wiping anything older: a request that deletes "everything before now"
   * can arrive *after* a guest's join and eat it, while one that deletes "everything
   * before this create" cannot, because a join can only ever be sent by someone who
   * was already shown the code.
   */
  private relayReset(marker: RoomMessage) {
    const code = this.code;
    if (!this.relay || !code) return;
    void fetch(`${this.relay}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset", code, msg: marker }),
    }).catch(() => {});
  }

  private startRelay() {
    if (!this.relay || this.relayTimer !== null) return;
    const tick = async () => {
      const code = this.code;
      if (!code) return;
      try {
        const res = await fetch(`${this.relay}/api/room`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The cursor asks for "newer than the newest I have seen, minus a clock-skew
          // window" — see RELAY_SKEW_MS for why the window exists.
          body: JSON.stringify({ action: "poll", code, afterTs: Math.max(0, this.relayTs - RELAY_SKEW_MS) }),
        });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as { msgs?: { k: string; m: RoomMessage }[] } | null;
        for (const row of body?.msgs ?? []) {
          if (this.seenKeys.has(row.k)) continue;
          this.seenKeys.add(row.k);
          const ts = Number(row.k.slice(`room:${code}:m:`.length, `room:${code}:m:`.length + 13));
          if (Number.isFinite(ts) && ts > this.relayTs) this.relayTs = ts;
          this.handle(row.m);
        }
      } catch {
        // A dead relay costs the remote half of the room, not the local one.
      }
      this.maybeReannounce();
    };
    void tick();
    this.relayTimer = setInterval(tick, this.pollMs);
  }

  /**
   * Re-send the join until the host's snapshot proves it arrived.
   *
   * A join can die on the wire — a reset still in flight, a dropped request, a host
   * tab that was mid-navigation — and nothing else retries it, so the guest used to
   * sit on "đang kết nối" forever while the host waited in an empty lobby. Every
   * fourth poll the guest says "I am here" again, for about a minute and a half;
   * the host dedupes on `playerId`, so repeats are cheap, and the first snapshot
   * that names this player flips `acked` and stops the loop.
   */
  private maybeReannounce() {
    if (this.isHostRole || this.acked || !this.code) return;
    if (++this.announceTick % 4 !== 0) return;
    if (this.announces >= 40) return;
    this.announces++;
    this.publish({ kind: "join", code: this.code, playerId: this.playerId, name: this.playerName });
    this.publish({ kind: "req_state", code: this.code, playerId: this.playerId });
  }

  private stopRelay() {
    if (this.relayTimer !== null) {
      clearInterval(this.relayTimer);
      this.relayTimer = null;
    }
  }

  onMessage(fn: (m: RoomMessage) => void): () => void {
    this.messageHandlers.add(fn);
    return () => this.messageHandlers.delete(fn);
  }
  onState(fn: (s: RoomSnapshot) => void): () => void {
    this.stateHandlers.add(fn);
    return () => this.stateHandlers.delete(fn);
  }
  onIntent(fn: (i: RoomIntent) => void): () => void {
    this.intentHandlers.add(fn);
    return () => this.intentHandlers.delete(fn);
  }

  create(): string {
    const code = randomCode();
    this.code = code;
    this.isHostRole = true;
    this.acked = true;
    const msg: RoomMessage = { kind: "create", code, hostId: this.playerId, hostName: this.playerName };
    msg.mid = `${this.playerId}:${++this.seq}:${Math.random().toString(36).slice(2, 6)}`;
    this.remember(msg.mid);
    this.ensureChannel()?.postMessage(msg);
    // The create goes out inside the reset, so the mailbox wipe and the message that
    // opens the room are one atomic request — see relayReset for why that ordering
    // has to be atomic rather than two requests.
    this.relayReset(msg);
    // Local echo, bypassing dedupe — the mid is already marked, and the host's own
    // listeners still expect to see the room they just made.
    this.dispatch(msg);
    this.startRelay();
    return code;
  }

  join(code: string) {
    this.code = code.toUpperCase();
    this.isHostRole = false;
    this.acked = false;
    this.announces = 0;
    this.announceTick = 0;
    this.publish({ kind: "join", code: this.code, playerId: this.playerId, name: this.playerName });
    this.startRelay();
  }

  broadcastState(snapshot: RoomSnapshot) {
    if (!this.code) return;
    this.publish({ kind: "state", code: this.code, snapshot });
  }

  requestState() {
    if (!this.code) return;
    this.publish({ kind: "req_state", code: this.code, playerId: this.playerId });
  }

  sendPlant(plant: Plant) {
    if (!this.code) return;
    this.publish({ kind: "plant_data", code: this.code, playerId: this.playerId, plant });
  }

  sendSelect(plantId: string) {
    if (!this.code) return;
    this.publish({ kind: "select", code: this.code, playerId: this.playerId, plantId });
  }

  sendReady(ready: boolean) {
    if (!this.code) return;
    this.publish({ kind: "ready", code: this.code, playerId: this.playerId, ready });
  }

  sendStance(stance: Stance) {
    if (!this.code) return;
    this.publish({ kind: "stance", code: this.code, playerId: this.playerId, stance });
  }

  sendIntent(intent: RoomIntent) {
    if (!this.code) return;
    this.publish({ kind: "input", code: this.code, playerId: this.playerId, intent });
  }

  /** Host-only: the authoritative result, fanned out to the guest. */
  sendResult(winner: string, mine: SideResult, theirs: SideResult) {
    if (!this.code) return;
    this.publish({ kind: "result", code: this.code, playerId: this.playerId, winner, mine, theirs });
  }

  leave() {
    if (this.code) this.publish({ kind: "leave", code: this.code, playerId: this.playerId });
    this.code = null;
    this.stopRelay();
  }

  destroy() {
    this.leave();
    this.channel?.close();
    this.channel = null;
  }
}

/** Host-side authoritative room controller. */
export class HostRoom {
  snapshot: RoomSnapshot;
  private plants = new Map<string, Plant>();

  constructor(code: string, hostId: string, hostName: string) {
    this.snapshot = {
      code,
      state: "waiting",
      hostId,
      players: [{ playerId: hostId, name: hostName, isHost: true, plantId: null, ready: false, connected: true, stance: "aggressive" }],
      battleSeed: null,
      countdownAt: null,
      plants: {},
    };
  }

  registerPlant(plant: Plant) {
    this.plants.set(plant.plantId, plant);
    this.snapshot.plants[plant.plantId] = {
      name: plant.name,
      power: Math.round(plant.powerRating),
      elements: ELEMENTS.filter((el) => (plant.dna.elementGenes[el] ?? 0) > 0.18),
      rarity: plant.rarity,
      traits: plant.traits,
    };
  }

  plant(plantId: string): Plant | undefined {
    return this.plants.get(plantId);
  }

  /**
   * Add a joining player. Returns true only when the roster actually grew — a guest
   * re-announcing an already-known join must not spam the lobby with repeats of
   * "đã vào phòng", so the caller needs to be able to tell a fresh arrival from an
   * echo.
   */
  addGuest(playerId: string, name: string): boolean {
    if (this.snapshot.players.some((p) => p.playerId === playerId)) return false;
    // A room is a 1v1. Without a cap a third tab would join, never pick a plant the
    // battle knows about, and block `canStart` for the two who are actually playing.
    if (this.snapshot.players.length >= 2) return false;
    this.snapshot.players.push({ playerId, name, isHost: false, plantId: null, ready: false, connected: true, stance: "aggressive" });
    this.refreshState();
    return true;
  }

  removePlayer(playerId: string) {
    this.snapshot.players = this.snapshot.players.filter((p) => p.playerId !== playerId);
  }

  setPlant(playerId: string, plantId: string) {
    const p = this.snapshot.players.find((x) => x.playerId === playerId);
    if (!p) return;
    p.plantId = plantId;
    p.ready = false;
    this.refreshState();
  }

  setReady(playerId: string, ready: boolean) {
    const p = this.snapshot.players.find((x) => x.playerId === playerId);
    if (p) p.ready = ready;
    this.refreshState();
  }

  setStance(playerId: string, stance: Stance) {
    const p = this.snapshot.players.find((x) => x.playerId === playerId);
    if (p) p.stance = stance;
  }

  private refreshState() {
    if (this.snapshot.state === "in_battle" || this.snapshot.state === "completed") return;
    const players = this.snapshot.players;
    if (players.length < 2) this.snapshot.state = "waiting";
    else if (!players.every((p) => p.plantId)) this.snapshot.state = "selecting_plants";
    else this.snapshot.state = "ready_check";
  }

  canStart(): boolean {
    const players = this.snapshot.players;
    return players.length >= 2 && players.every((p) => p.plantId && p.ready);
  }

  makeBattleSeed(plantAId: string, plantBId: string): string {
    return seedToken(this.snapshot.code, plantAId, plantBId, Date.now());
  }

  markInBattle() {
    this.snapshot.state = "in_battle";
  }

  finishBattle() {
    this.snapshot.state = "completed";
  }

  resetToLobby() {
    this.snapshot.state = "selecting_plants";
    this.snapshot.battleSeed = null;
    for (const p of this.snapshot.players) p.ready = false;
  }
}

export type { BattleEvent, BattleSession };
