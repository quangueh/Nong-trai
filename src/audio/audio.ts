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
  | "lose"
  // --- added for a full pass over the game's feedback ---
  // Interface states that were previously silent.
  | "hover"
  | "start"
  | "pause"
  | "resume"
  // Progression. \`levelUp\` already existed; these are the moments around it.
  | "expGain"
  | "unlock"
  | "reward"
  | "powerUp"
  // Combat, distinguished from \`hit\`/\`crit\` which describe an attack landing.
  | "combo"
  | "enemy"
  // Something taken.
  | "collect"
  // A quest's progress moving. Softer than \`reward\`: it fires mid-action, not at a payout.
  | "questProgress";

export interface PlayOpts {
  /** Scales the whole effect. */
  gain?: number;
  /** Detune in semitones, for pitch families that share a voice. */
  pitch?: number;
}

import {
  clampVolume,
  musicVolume as musicPrefVolume,
  setMusicVolume as setMusicPref,
  setVolume as setPrefVolume,
  volume as prefsVolume,
} from "../core/prefs";

const STORAGE_KEY = "nongtrai.muted";

/**
 * Re-exported rather than redefined.
 *
 * This was a second, independent reading of the OS preference, alongside copies in
 * `battle/juice.ts` and inline in `battle/battleFx.ts`. Three answers to one question meant
 * a player could not turn motion off without also losing it in places nobody had visited yet.
 * `core/prefs` owns the answer; everyone asks it there.
 */
export { reducedMotion } from "../core/prefs";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicOut: GainNode | null = null;
  private built = false;

  /**
   * The live context and the music bus, for \`audio/music\` to schedule into.
   *
   * Read-only on purpose. The music bed needs to reach the audio clock and somewhere to send
   * notes; it does not need to be able to rebuild the graph, and an engine whose internals are
   * writable from another module is an engine that can be broken from another module.
   */
  get context(): AudioContext | null {
    return this.ctx;
  }

  get musicBus(): GainNode | null {
    return this.musicOut;
  }

  muted = false;
  /**
   * 0..1.
   *
   * Seeded from the player's saved preference and always written through `setVolume`, which
   * persists it and ramps the master gain. Assigning this field directly still works but skips
   * both, so the settings screen goes through the setter — that is what the original comment
   * on this line promised and what never happened.
   */
  volume = prefsVolume();

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

        /*
         * Music, on its own bus.
         *
         * Two reasons it does not join the effects bus. A player who finds the fight effects
         * loud needs to turn those down without losing the bed; and the high-shelf cut above
         * exists because effects are all transients, which a pad has none of — routed through
         * it the music loses its top and sounds like it is playing through a wall.
         *
         * Both buses still meet at the same limiter, so a loud moment cannot clip whether it
         * came from a note or a hit.
         */
        const musicTone = ctx.createBiquadFilter();
        musicTone.type = "lowpass";
        musicTone.frequency.value = 5200;
        musicTone.Q.value = 0.4;
        musicTone.connect(master);

        const musicOut = ctx.createGain();
        // A GainNode is born at 1.0. Without this the bed plays at full level until somebody
        // happens to move the slider — and "the music is too loud until you open settings" is
        // not a default anyone should have to discover.
        musicOut.gain.value = this.muted ? 0 : this.musicVolume;
        musicOut.connect(musicTone);

        this.master = master;
        this.sfxBus = bus;
        this.musicOut = musicOut;
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

  /**
   * Set the volume, persist it, and hear it change now.
   *
   * The three halves are the point. Persisting without applying would leave the slider showing
   * a number the game is not playing at; applying without persisting would forget it on
   * reload; neither together would make the control feel connected to anything, which is how a
   * volume slider ends up looking broken even when it "works".
   *
   * Ramps like `setMuted` does, because a gain that jumps is a click, and a click every time
   * someone drags the slider is the fastest way to make them stop dragging it.
   */
  /**
   * Music volume, kept separate from effects.
   *
   * Its own persisted key, so turning the effects down does not silently take the music with
   * them. Defaults lower than effects: a bed is continuous and an effect is a moment, and at
   * equal volume the continuous thing is always the tiring one.
   */
  musicVolume = musicPrefVolume();

  setMusicVolume(v: number): void {
    this.musicVolume = clampVolume(v);
    setMusicPref(this.musicVolume);
    if (this.musicOut && this.ctx) {
      const ctx = this.ctx;
      const g = this.musicOut.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setTargetAtTime(this.muted ? 0 : this.musicVolume, ctx.currentTime, 0.05);
    }
  }

  setVolume(v: number): void {
    this.volume = clampVolume(v);
    setPrefVolume(this.volume);
    if (this.master && this.ctx) {
      const ctx = this.ctx;
      const master = this.master;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 0.03);
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

      /*
       * Sidechain-style duck: an effect dips the music bus for a beat so a hit
       * reads over the bed instead of on top of it. The dip is a ramp both ways
       * — a stepped gain is a click — and an effect landing inside the window
       * re-arms the same dip rather than stacking a deeper one, so machine-gun
       * effects keep one constant duck level instead of pumping the bed.
       *
       * `setMusicVolume` cancels this schedule when it runs, so a volume change
       * mid-duck lands at the right level rather than the ducked one.
       */
      if (this.musicOut && this.musicVolume > 0) {
        const g = this.musicOut.gain;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(this.musicVolume * 0.55, t, 0.02);
        g.setTargetAtTime(this.musicVolume, t + 0.35, 0.25);
      }
    } catch {
      // A dropped sound is never worth breaking a frame over.
    }
  }

  /**
   * Test/ops introspection: the live music-bus gain as the AudioParam reports
   * it. Dips below `musicVolume` while an effect ducks the bed, and returns to
   * it after — a duck that never came back would show up here as a wrong number.
   */
  get musicGain(): number | null {
    return this.musicOut?.gain.value ?? null;
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
    // --- interface states, previously silent -------------------------------------
    case "hover": {
      /*
       * Quieter than \`tap\`, and shorter.
       *
       * This one fires every time a pointer crosses a button, which is dozens of times a
       * minute and more on a screen of plot cards. At \`tap\`'s level it becomes a hiss.
       * It is also nearly pure top end so it reads as "you are over something" rather than as
       * a click you can mistake for a press.
       */
      tone(ctx, out, t, { type: "sine", from: 1750 * p, peak: 0.022, attack: 0.001, decay: 0.035 });
      break;
    }
    case "start": {
      // A three-note rise: the sound of something beginning rather than something arriving.
      [0, 4, 7].forEach((semi, i) => {
        tone(ctx, out, t, {
          type: "triangle",
          from: 330 * p * Math.pow(2, semi / 12),
          peak: 0.1 - i * 0.012,
          attack: 0.006,
          decay: 0.34,
          at: i * 0.085,
        });
      });
      // A breath of air under it, so it has a body on headphones.
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.05, attack: 0.02, decay: 0.3, filter: { type: "bandpass", from: 900, q: 0.7 } });
      break;
    }
    case "pause": {
      // Down and settling. Mirrored by \`resume\` so the pair is legible as a pair.
      tone(ctx, out, t, { type: "triangle", from: 520 * p, to: 340 * p, peak: 0.075, attack: 0.006, decay: 0.2 });
      tone(ctx, out, t, { type: "sine", from: 260 * p, to: 170 * p, peak: 0.06, attack: 0.008, decay: 0.26, at: 0.06 });
      break;
    }
    case "resume": {
      tone(ctx, out, t, { type: "triangle", from: 340 * p, to: 520 * p, peak: 0.075, attack: 0.006, decay: 0.2 });
      tone(ctx, out, t, { type: "sine", from: 170 * p, to: 260 * p, peak: 0.06, attack: 0.008, decay: 0.26, at: 0.05 });
      break;
    }

    // --- progression, and the loudest moments in the game -------------------------
    case "expGain": {
      /*
       * Deliberately tiny.
       *
       * This plays once per flying number, so a large stage payout fires it a dozen times
       * inside a second. It is a soft high blip with no low end at all: high frequencies mask
       * against everything else, which is what lets something this often stay out of the way
       * of the sound you are actually listening to.
       */
      tone(ctx, out, t, { type: "sine", from: 2100 * p, peak: 0.028, attack: 0.001, decay: 0.06 });
      break;
    }
    case "unlock": {
      /*
       * Something opening.
       *
       * A rising sparkle plus a soft mechanical click underneath — a lock has two halves to it
       * and a pure chime only has one, which reads as "here is a prize" rather than "here is a
       * gate that has opened".
       */
      [0, 7, 12, 16].forEach((semi, i) => {
        tone(ctx, out, t, {
          type: "triangle",
          from: 660 * p * Math.pow(2, semi / 12),
          peak: 0.085 - i * 0.012,
          attack: 0.004,
          decay: 0.42,
          at: 0.05 + i * 0.062,
        });
      });
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.06, attack: 0.001, decay: 0.05, filter: { type: "highpass", from: 2600 } });
      break;
    }
    case "reward": {
      /*
       * A warm major triad, held.
       *
       * The one cue with a long decay and no noise under it. Rewards are announced by the
       * animation, so this only has to make the moment feel given rather than earned — and a
       * percussive edge would turn a payout into an impact.
       */
      [0, 4, 7, 12].forEach((semi, i) => {
        tone(ctx, out, t, {
          type: "sine",
          from: 523.25 * p * Math.pow(2, semi / 12),
          peak: 0.1 - i * 0.014,
          attack: 0.014,
          decay: 1.05,
          at: i * 0.075,
        });
      });
      break;
    }
    case "powerUp": {
      /*
       * A sweep, where \`levelUp\` is a statement.
       *
       * Distinct on purpose: \`levelUp\` marks the thing that happened, this one marks the
       * power going into the plant. A rising pitch bend over a shimmering fifth reads as growth
       * in a way a chord does not.
       */
      tone(ctx, out, t, { type: "sawtooth", from: 200 * p, to: 640 * p, peak: 0.075, attack: 0.02, decay: 0.5, filter: { type: "lowpass", from: 700, to: 3200, q: 2 } });
      tone(ctx, out, t, { type: "triangle", from: 400 * p, to: 1200 * p, peak: 0.06, attack: 0.03, decay: 0.55, at: 0.03 });
      tone(ctx, out, t, { type: "sine", from: 800 * p, to: 2400 * p, peak: 0.04, attack: 0.05, decay: 0.6, at: 0.08 });
      break;
    }

    // --- combat ------------------------------------------------------------------
    case "combo": {
      /*
       * A bright ping that climbs with the run.
       *
       * The caller passes \`pitch\` in semitones as the combo grows, so the pitch *is* the
       * number — the ear learns the scale of the run without reading the digits. Square wave
       * for definition at low volume, so it punches through a fight without being loud.
       */
      tone(ctx, out, t, { type: "square", from: 880 * p, peak: 0.05, attack: 0.002, decay: 0.12, filter: { type: "lowpass", from: 4200 } });
      tone(ctx, out, t, { type: "sine", from: 1760 * p, peak: 0.035, attack: 0.002, decay: 0.2, at: 0.015 });
      break;
    }
    case "enemy": {
      /*
       * Darker and heavier than \`hit\`.
       *
       * \`hit\` describes something landing on the enemy. This one is for the enemy's own
       * turn, and it is filtered down an octave because being hit should feel like the room
       * changing rather than like another attack.
       */
      noiseHit(ctx, out, t, noiseOf(ctx), { peak: 0.13, attack: 0.004, decay: 0.22, filter: { type: "lowpass", from: 620, to: 180, q: 1.1 } });
      tone(ctx, out, t, { type: "sine", from: 120 * p, to: 58 * p, peak: 0.13, attack: 0.004, decay: 0.24 });
      tone(ctx, out, t, { type: "triangle", from: 196 * p, to: 150 * p, peak: 0.05, attack: 0.006, decay: 0.18, at: 0.02 });
      break;
    }
    case "collect": {
      // Taken, not earned. A short bright blip that a caller can pitch per item.
      tone(ctx, out, t, { type: "triangle", from: 1320 * p, peak: 0.07, attack: 0.002, decay: 0.09 });
      tone(ctx, out, t, { type: "sine", from: 2640 * p, peak: 0.03, attack: 0.002, decay: 0.12, at: 0.022 });
      break;
    }
    case "questProgress": {
      /*
       * A quest ticked upward.
       *
       * Sits between `hover` and `collect` in weight: this fires inside another action's
       * moment — the plant was just watered, the hit just landed — so it has to register as
       * "the tracker moved" without competing with the sound of the action itself. Two short
       * rising thirds, sine only, no noise.
       */
      tone(ctx, out, t, { type: "sine", from: 880 * p, peak: 0.05, attack: 0.002, decay: 0.09 });
      tone(ctx, out, t, { type: "sine", from: 1174 * p, peak: 0.045, attack: 0.002, decay: 0.12, at: 0.055 });
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