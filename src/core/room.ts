/**
 * Multiplayer room (docs/04). Server-authoritative battle.
 *
 * MVP transport is BroadcastChannel (real-time across two browser tabs on the
 * same machine). One tab is elected host and runs the authoritative simulation;
 * the guest sends intents and receives state. The message contract is
 * transport-agnostic, so swapping BroadcastChannel for a WebSocket worker is a
 * drop-in (see docs/11).
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

export type RoomMessage =
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
  | { kind: "req_state"; code: string; playerId: string };

export function generateRoomCode(rng: Rng): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(rng.next() * CODE_ALPHABET.length)];
  return code;
}

function randomCode(): string {
  return generateRoomCode(new Rng(`${Date.now()}:${Math.random()}`));
}

export class RoomClient {
  private channel: BroadcastChannel | null = null;
  private code: string | null = null;
  private isHostRole = false;
  private messageHandlers = new Set<(m: RoomMessage) => void>();
  private stateHandlers = new Set<(s: RoomSnapshot) => void>();
  private intentHandlers = new Set<(i: RoomIntent) => void>();

  constructor(
    private readonly playerId: string,
    private readonly playerName: string,
  ) {}

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

  private handle(m: RoomMessage) {
    for (const h of this.messageHandlers) h(m);
    if (m.kind === "state") for (const h of this.stateHandlers) h(m.snapshot);
    if (m.kind === "input" && m.playerId !== this.playerId) {
      for (const h of this.intentHandlers) h(m.intent);
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
    const msg: RoomMessage = { kind: "create", code, hostId: this.playerId, hostName: this.playerName };
    this.ensureChannel()?.postMessage(msg);
    this.handle(msg);
    return code;
  }

  join(code: string) {
    this.code = code.toUpperCase();
    this.isHostRole = false;
    this.ensureChannel()?.postMessage({ kind: "join", code: this.code, playerId: this.playerId, name: this.playerName } satisfies RoomMessage);
  }

  broadcastState(snapshot: RoomSnapshot) {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "state", code, snapshot } satisfies RoomMessage);
  }

  requestState() {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "req_state", code, playerId: this.playerId } satisfies RoomMessage);
  }

  sendPlant(plant: Plant) {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "plant_data", code, playerId: this.playerId, plant } satisfies RoomMessage);
  }

  sendSelect(plantId: string) {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "select", code, playerId: this.playerId, plantId } satisfies RoomMessage);
  }

  sendReady(ready: boolean) {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "ready", code, playerId: this.playerId, ready } satisfies RoomMessage);
  }

  sendStance(stance: Stance) {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "stance", code, playerId: this.playerId, stance } satisfies RoomMessage);
  }

  sendIntent(intent: RoomIntent) {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "input", code, playerId: this.playerId, intent } satisfies RoomMessage);
  }

  /** Host-only: the authoritative result, fanned out to the guest. */
  sendResult(winner: string, mine: SideResult, theirs: SideResult) {
    const code = this.code;
    if (!code) return;
    this.ensureChannel()?.postMessage({ kind: "result", code, playerId: this.playerId, winner, mine, theirs } satisfies RoomMessage);
  }

  leave() {
    const code = this.code;
    if (code) this.ensureChannel()?.postMessage({ kind: "leave", code, playerId: this.playerId } satisfies RoomMessage);
    this.code = null;
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

  addGuest(playerId: string, name: string) {
    if (this.snapshot.players.some((p) => p.playerId === playerId)) return;
    this.snapshot.players.push({ playerId, name, isHost: false, plantId: null, ready: false, connected: true, stance: "aggressive" });
    this.refreshState();
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
