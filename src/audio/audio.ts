/**
 * Procedural audio (docs/07).
 *
 * The game had no sound at all, which research on game feel puts at roughly half
 * of what makes an impact feel like an impact. This synthesises everything at
 * runtime: oscillators, noise and filters, no audio files, so there is nothing to
 * download and nothing to 404.
 *
 * Three decisions worth knowing about:
 *
 *   Nothing is created until `unlock()`. Browsers block audio before a user
 *   gesture, and an AudioContext constructed at module load starts `suspended`
 *   and stays there — so the engine builds the whole graph lazily on first tap.
 *
 *   Every effect is layered and pitch-randomised. Two identical hits in a row
 *   sounding identical is what makes an effect read as a UI beep rather than as a
 *   physical event; a few percent of pitch jitter is enough to stop that.
 *
 *   The graph ends in a DynamicsCompressor. In a battle several effects overlap by
 *   design, and summed oscillators clip into a harsh buzz exactly when the game
 *   is trying to sound loud.
 *
 * Every entry point is safe to call when Web Audio is missing — the test suite
 * runs in jsdom, which has no AudioContext at all.
 */

export type SfxName =
  | "tap"
  | "back"
  | "error"
  | "buy"
  | "dig"
  | "plant"
  | "sprout"
  | "bloom"
  | "breed"
  | "levelUp"
  | "hit"
  | "crit"
  | "miss"
  | "heal"
  | "shield"
  | "cast"
  | "death"
  | "win"
  | "lose";

export interface PlayOpts {
  /** Scales the whole effect. */
  gain?: number;
  /** Detune in semitones, for pitch families that share a voice. */
  pitch?: number;
}

const STORAGE_KEY = "nongtrai.muted";

/** True when the player asked for less motion; also the right default for volume. */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private built = false;

  muted = false;
  /** 0..1, exposed so the settings screen can drive it without touching Web Audio. */
  volume = 0.75;

  constructor() {
    if (typeof localStorage === "undefined") return;
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private mode throws on access; silence is the right default here.
    }
  }

  get available(): boolean {
    return typeof window !== "undefined" && typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) !== "undefined";
  }

  /**
   * Build the graph and resume the context. Must be called from a user gesture.
   *
   * Idempotent: a second call only resumes, so it is safe to wire to every tap.
   */
  unlock(): void {
    if (!this.available) return;
    try {
      if (!this.built) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        this.ctx = ctx;

        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : this.volume;

        // Last node before the speakers. Overlapping battle effects sum well past
        // full scale, and clipping is most audible exactly when it matters most.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.18;

        master.connect(limiter);
        limiter.connect(ctx.destination);

        // A gentle top-end cut on effects: game SFX are all transients, and an
        // unshaped mix gets piercing fast.
        const tone = ctx.createBiquadFilter();
        tone.type = "highshelf";
        tone.frequency.value = 6500;
        tone.gain.value = -5;
        tone.connect(master);

        const bus = ctx.createGain();
        bus.connect(tone);

        this.master = master;
        this.sfxBus = bus;
        this.built = true;
      }
      // Read through a local: `built` and `ctx` are separate fields, so the
      // narrowing from the block above does not carry here.
      const ctx = this.ctx;
      if (ctx && ctx.state === "suspended") void ctx.resume();
    } catch {
      this.ctx = null;
      this.master = null;
      this.sfxBus = null;
      this.built = false;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
      } catch {
        // Non-fatal: the setting just will not persist.
      }
    }
    if (this.master && this.ctx) {
      const ctx = this.ctx;
      const master = this.master;
      // Ramp rather than jump, so toggling does not click.
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : this.volume, ctx.currentTime, 0.02);
    }
  }

  /** Play an effect. A no-op when audio is unavailable, muted, or still locked. */
  play(name: SfxName, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.built || this.muted || ctx.state !== "running") return;
    try {
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.value = opts.gain ?? 1;
      out.connect(bus);
      const detune = Math.pow(2, (opts.pitch ?? 0) / 12);
      // +-3% pitch. Enough that consecutive shots are not identical, small enough
      // that the effect still reads as "the same sound".
      const jitter = 1 + (Math.random() - 0.5) * 0.06;
      build(ctx, out, t, name, detune * jitter);
    } catch {
      // A dropped sound is never worth breaking a frame over.
    }
  }

  /** Stop everything; for when the tab is hidden. */
  suspend(): void {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }
}

// ---------------------------------------------------------------------------
// Voice helpers
// ---------------------------------------------------------------------------

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface ToneOpts {
  type: OscillatorType;
  from: number;
  to?: number;
  /** Peak gain. */
  peak: number;
  attack: number;
  decay: number;
  /** Start offset from `t`. */
  at?: number;
  filter?: { type: BiquadFilterType; from: number; to?: number; q?: number };
}

/** One enveloped oscillator, optionally swept and filtered. */
function tone(ctx: AudioContext, out: AudioNode, t: number, o: ToneOpts): void {
  const at = t + (o.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, at);
  if (o.to !== undefined && o.to !== o.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), at + o.decay);
  }

  let head: AudioNode = osc;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(o.filter.from, at);
    if (o.filter.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.to), at + o.decay);
    if (o.filter.q) f.Q.value = o.filter.q;
    osc.connect(f);
    head = f;
  }

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.peak), at + o.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.attack + o.decay);
  head.connect(g);
  g.connect(out);

  osc.start(at);
  osc.stop(at + o.attack + o.decay + 0.02);
}

interface NoiseOpts {
  peak: number;
  attack: number;
  decay: number;
  at?: number;
  filter: { type: BiquadFilterType; from: number; to?: number; q?: number };
}

/** One enveloped burst of the shared noise buffer. */
function noiseHit(ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer, o: NoiseOpts): void {
  const at = t + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  // Start from a random offset so repeated bursts are not identical.
  const offset = Math.random() * (noise.duration - o.attack - o.decay - 0.05);

  const f = ctx.createBiquadFilter();
  f.type = o.filter.type;
  f.frequency.setValueAtTime(o.filter.from, at);
  if (o.filter.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.to), at + o.decay);
  if (o.filter.q) f.Q.value = o.filter.q;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.peak), at + o.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.attack + o.decay);

  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(at, offset, o.attack + o.decay + 0.02);
}

// ---------------------------------------------------------------------------
// The effects
// ---------------------------------------------------------------------------

/**
 * Pentatonic degrees. The pickup sound walks up this as a combo builds, so a
 * player planting several in a row hears a consonant run rather than the same
 * blip four times.
 */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

function build(ctx: AudioContext, out: AudioNode, t: number, name: SfxName, p: number): void {
  switch (name) {
    // --- interface --------------------------------------------------------
    case "tap": {
      // Short, mid, woody. Every interface press lands on this one, so it is
      // deliberately quiet — a sound that repeats 200 times a session must not
      // be the loudest thing in the game.
      tone(ctx, out, t, { type: "triangle", from: 620 * p, to: 480 * p, peak: 0.1, attack: 0.002, decay: 0.05 });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.03, attack: 0.001, decay: 0.03, filter: { type: "highpass", from: 2200 } });
      break;
    }
    case "back": {
      tone(ctx, out, t, { type: "triangle", from: 480 * p, to: 330 * p, peak: 0.09, attack: 0.003, decay: 0.08 });
      break;
    }
    case "error": {
      // Two descending notes a semitone apart. Reads as "no" without a word.
      tone(ctx, out, t, { type: "square", from: 300 * p, to: 250 * p, peak: 0.08, attack: 0.004, decay: 0.09, filter: { type: "lowpass", from: 1800, to: 900 } });
      tone(ctx, out, t, { type: "square", from: 266 * p, to: 220 * p, peak: 0.07, attack: 0.004, decay: 0.11, at: 0.09, filter: { type: "lowpass", from: 1800, to: 800 } });
      break;
    }

    // --- economy and planting ---------------------------------------------
    case "buy": {
      // Coins: a metallic pair, high and bright.
      tone(ctx, out, t, { type: "triangle", from: 1180 * p, peak: 0.11, attack: 0.002, decay: 0.1 });
      tone(ctx, out, t, { type: "triangle", from: 1770 * p, peak: 0.07, attack: 0.002, decay: 0.14, at: 0.035 });
      tone(ctx, out, t, { type: "sine", from: 2360 * p, peak: 0.04, attack: 0.002, decay: 0.16, at: 0.06 });
      break;
    }
    case "dig": {
      // Soil: filtered noise falling in pitch, with grit on top.
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.16, attack: 0.006, decay: 0.19, filter: { type: "lowpass", from: 1400, to: 320, q: 1.4 } });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.07, attack: 0.002, decay: 0.1, at: 0.03, filter: { type: "highpass", from: 3000 } });
      tone(ctx, out, t, { type: "sine", from: 150 * p, to: 70 * p, peak: 0.12, attack: 0.004, decay: 0.16 });
      break;
    }
    case "plant": {
      // A seed landing: a soft tap plus a small wooden body.
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.09, attack: 0.001, decay: 0.05, filter: { type: "bandpass", from: 1100, q: 1.2 } });
      tone(ctx, out, t, { type: "sine", from: 300 * p, to: 180 * p, peak: 0.1, attack: 0.003, decay: 0.12 });
      break;
    }
    case "sprout": {
      // Growing: a rising fifth with a little air on top. The ladder walks up
      // each time so repeated growth does not sound like a stuck sample.
      const step = LADDER[Math.min(LADDER.length - 1, comboLevel++)];
      const root = 330 * p * Math.pow(2, step / 12);
      tone(ctx, out, t, { type: "triangle", from: root, to: root * 1.5, peak: 0.11, attack: 0.01, decay: 0.26 });
      tone(ctx, out, t, { type: "sine", from: root * 2, peak: 0.05, attack: 0.02, decay: 0.3, at: 0.05 });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.03, attack: 0.03, decay: 0.22, filter: { type: "highpass", from: 4200 } });
      break;
    }
    case "bloom": {
      // A major chord blooming outward. The payoff sound for growth.
      [0, 4, 7, 12].forEach((semi, i) => {
        tone(ctx, out, t, {
          type: "triangle",
          from: 392 * p * Math.pow(2, semi / 12),
          peak: 0.1 - i * 0.015,
          attack: 0.012 + i * 0.02,
          decay: 0.6 - i * 0.05,
          at: i * 0.045,
        });
      });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.035, attack: 0.06, decay: 0.4, filter: { type: "highpass", from: 5200 } });
      break;
    }
    case "breed": {
      // Two voices converging into one: the sound of two plants becoming one.
      tone(ctx, out, t, { type: "sawtooth", from: 220 * p, to: 330 * p, peak: 0.07, attack: 0.02, decay: 0.3, filter: { type: "lowpass", from: 700, to: 2400 } });
      tone(ctx, out, t, { type: "sawtooth", from: 330 * p, to: 220 * p, peak: 0.07, attack: 0.02, decay: 0.3, filter: { type: "lowpass", from: 700, to: 2400 } });
      tone(ctx, out, t, { type: "sine", from: 660 * p, to: 990 * p, peak: 0.09, attack: 0.01, decay: 0.45, at: 0.28 });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.05, attack: 0.24, decay: 0.3, filter: { type: "bandpass", from: 1800, to: 4200, q: 0.9 } });
      break;
    }
    case "levelUp": {
      // An ascending run. Reserved — the only other sound allowed to be this
      // bright is `win`.
      [0, 4, 7, 12, 16].forEach((semi, i) => {
        tone(ctx, out, t, { type: "triangle", from: 440 * p * Math.pow(2, semi / 12), peak: 0.11, attack: 0.006, decay: 0.22, at: i * 0.075 });
      });
      break;
    }

    // --- combat ----------------------------------------------------------
    case "cast": {
      // A short upward whoosh: air moving, not an impact.
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.09, attack: 0.02, decay: 0.2, filter: { type: "bandpass", from: 500, to: 2800, q: 1.1 } });
      break;
    }
    case "hit": {
      // Noise crack for the surface, a low sine for the mass underneath. Two
      // channels so it survives on laptop speakers, where the low end is thin.
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.2, attack: 0.001, decay: 0.1, filter: { type: "bandpass", from: 1500, to: 600, q: 0.8 } });
      tone(ctx, out, t, { type: "sine", from: 190 * p, to: 78 * p, peak: 0.2, attack: 0.002, decay: 0.14 });
      break;
    }
    case "crit": {
      // Same family as `hit` so a crit reads as *more of the same thing*, with a
      // brighter crack and a longer tail rather than a different sound entirely.
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.26, attack: 0.001, decay: 0.16, filter: { type: "bandpass", from: 2600, to: 700, q: 0.7 } });
      tone(ctx, out, t, { type: "sine", from: 240 * p, to: 62 * p, peak: 0.26, attack: 0.002, decay: 0.26 });
      tone(ctx, out, t, { type: "triangle", from: 880 * p, to: 440 * p, peak: 0.08, attack: 0.002, decay: 0.18, at: 0.01 });
      break;
    }
    case "miss": {
      // Air only. A miss should feel like nothing connected.
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.07, attack: 0.006, decay: 0.16, filter: { type: "bandpass", from: 3200, to: 1200, q: 0.6 } });
      break;
    }
    case "heal": {
      [0, 5, 9].forEach((semi, i) => {
        tone(ctx, out, t, { type: "sine", from: 523 * p * Math.pow(2, semi / 12), peak: 0.09, attack: 0.02, decay: 0.5, at: i * 0.06 });
      });
      break;
    }
    case "shield": {
      // A struck bell: two partials with an inharmonic ratio, which is what makes
      // metal sound like metal rather than like a sine.
      tone(ctx, out, t, { type: "sine", from: 740 * p, peak: 0.11, attack: 0.003, decay: 0.42 });
      tone(ctx, out, t, { type: "sine", from: 740 * p * 2.76, peak: 0.05, attack: 0.003, decay: 0.26 });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.05, attack: 0.002, decay: 0.09, filter: { type: "highpass", from: 4000 } });
      break;
    }
    case "death": {
      // Falling, not stopping. A long downward slide with the noise thinning out.
      tone(ctx, out, t, { type: "sawtooth", from: 420 * p, to: 48 * p, peak: 0.15, attack: 0.006, decay: 0.9, filter: { type: "lowpass", from: 2600, to: 260, q: 1.2 } });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.08, attack: 0.01, decay: 0.7, filter: { type: "lowpass", from: 1600, to: 200 } });
      break;
    }
    case "win": {
      [0, 4, 7, 12, 16, 19].forEach((semi, i) => {
        tone(ctx, out, t, { type: "triangle", from: 392 * p * Math.pow(2, semi / 12), peak: 0.12, attack: 0.01, decay: 0.8, at: i * 0.085 });
      });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.04, attack: 0.1, decay: 0.7, filter: { type: "highpass", from: 4600 } });
      break;
    }
    case "lose": {
      [0, -3, -7].forEach((semi, i) => {
        tone(ctx, out, t, { type: "sine", from: 330 * p * Math.pow(2, semi / 12), peak: 0.11, attack: 0.02, decay: 0.9, at: i * 0.13 });
      });
      break;
    }
    default:
      break;
  }
}

/** The engine's shared noise buffer, reachable from the voice builders. */
let sharedNoise: AudioBuffer | null = null;
function noiseOf(ctx: AudioContext): AudioBuffer {
  if (!sharedNoise || sharedNoise.sampleRate !== ctx.sampleRate) sharedNoise = makeNoise(ctx, 1.2);
  return sharedNoise;
}

/** How many growth sounds have fired in a row; drives the pentatonic ladder. */
let comboLevel = 0;

/** Reset the ladder — call when the player does something other than grow. */
export function resetAudioCombo(): void {
  comboLevel = 0;
}

export const sfx = new AudioEngine();