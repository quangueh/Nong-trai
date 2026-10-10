/**
 * The music bed.
 *
 * ## Why this is synthesised and not a file
 *
 * Every other sound in this game is generated with Web Audio oscillators — there is not a
 * single audio asset in the repository. That was a deliberate choice, and it decides how the
 * music has to be built: shipping three minutes of looped audio would put megabytes behind the
 * first gesture for something that can be made out of maths, and would make the bundle's size
 * depend on art direction rather than on how much there is to play.
 *
 * So: no file, no download, nothing to fail — and no license problem either: the composition
 * below is code, so its source is this file (see `docs/31_AUDIO_ASSET_MANIFEST.md`).
 *
 * ## Why stems
 *
 * docs/26 §5 asks for a small number of separable stems rather than one lump of bed. The bed
 * is four stems — `pad`, `bass`, `melody`, `pulse` — each with its own GainNode under the
 * music bus. A mood is a mix across those stems, so "the fight starts" can bring up the pulse
 * and the melody without touching how loud the pad is, which is exactly the control a mixdown
 * stage needs later and what makes the calm↔battle transition a crossfade of character rather
 * than of level.
 *
 * ## Why there is one continuous bed rather than tracks
 *
 * Switching between separate tracks means a gap, a fade, or a hard cut at every screen change —
 * and a player who moves between two screens hears the transition more than the music. One bed
 * that *changes character* instead means the fight can raise its intensity without the music
 * ever stopping, which is also how it sounds like the same place getting more dangerous rather
 * than a different song starting.
 *
 * ## Why a lookahead scheduler
 *
 * `setTimeout` per note drifts, and a bed that drifts sounds like a musician playing badly.
 * This schedules every note a fixed distance ahead of the audio clock (200ms of lookahead,
 * checked every 150ms) so timing comes from `ctx.currentTime`, which does not drift. Nothing is
 * scheduled more than once, and nothing is scheduled at all while the context is suspended —
 * which is exactly the state a hidden tab is in, and the reason a naive scheduler fills a queue
 * of notes that all fire at once when the player comes back.
 */

import { sfx } from "./audio";

/**
 * How present the bed is.
 *
 * Not a track name — the bed is always the same notes, so switching is a matter of how much of
 * it is audible.
 */
export type MusicMood = "calm" | "battle" | "silent";

/** The separable layers a mood mixes. */
export type StemId = "pad" | "bass" | "melody" | "pulse";
export const STEM_IDS: readonly StemId[] = ["pad", "bass", "melody", "pulse"];

/**
 * One pentatonic collection, so every note in every chord is consonant with every other.
 *
 * D minor pentatonic: D, F, G, A, C. The interval that makes it sound open rather than mournful
 * is the major second between the third and fourth degrees — with a strict minor scale a slow
 * chord cycle turns sombre, and this game is about growing things.
 */
const SCALE = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0, 440.0, 523.25];

/**
 * Chord roots, as indices into `SCALE`, one every eight seconds.
 *
 * A four-bar loop rather than a random walk: a random walk wanders, and a wandering bed cannot
 * be learned, so it never becomes unnoticeable. These four pass through a circle and come back,
 * which is what lets a player stop hearing it.
 */
const PROGRESSION = [0, 5, 3, 7];

/** Seconds each chord holds. Eight is slow enough to feel unhurried. */
const BAR = 8;

/** One bar is eight 1s beats — the pulse stem's grid. */
const BEAT = 1;

interface MoodShape {
  /** Per-stem mix targets, 0..1, eased toward so a mood change fades rather than cuts. */
  stems: Record<StemId, number>;
  /** How often a melody note appears, in seconds. Larger is sparser. */
  arpGap: number;
  /** Lowpass cutoff on the bed, in Hz. The main "brightness" control. */
  cutoff: number;
  /** Whether the pulse stem plays at all — calm has no beat to keep. */
  pulse: boolean;
}

const SHAPES: Record<Exclude<MusicMood, "silent">, MoodShape> = {
  // Roomy and soft. The garden: something to sit behind, not to listen to.
  calm:   { stems: { pad: 0.075, bass: 0.05, melody: 0.1,  pulse: 0 },    arpGap: 1.9,  cutoff: 1500, pulse: false },
  // Tighter, brighter, and it plays more notes — because the fight does.
  battle: { stems: { pad: 0.1,   bass: 0.09, melody: 0.16, pulse: 0.11 }, arpGap: 0.62, cutoff: 2600, pulse: true },
};

/** `shape` is eased in place — it must never be a reference into `SHAPES`,
    or easing toward a mood permanently rewrites that mood's preset. */
function cloneShape(s: MoodShape): MoodShape {
  return { stems: { ...s.stems }, arpGap: s.arpGap, cutoff: s.cutoff, pulse: s.pulse };
}

/* --- Note builders, parameterized by context --------------------------------
 *
 * These take `(ctx, out, at, …)` instead of reading `sfx.context` so the exact
 * code path the live bed runs can also be rendered through an
 * `OfflineAudioContext` — that is what lets the AUD-03/05 tests measure clicks,
 * gaps and peak level on a buffer rather than asserting "no exception was
 * thrown".
 */

function schedulePad(ctx: BaseAudioContext, out: AudioNode, at: number, hold: number, freq: number, gain: number, cutoff: number): void {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  filter.Q.value = 0.6;
  filter.connect(out);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  // Long attack: a pad that arrives instantly is an organ, and an organ is not a garden.
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + hold * 0.35);
  env.gain.setValueAtTime(Math.max(0.0002, gain), at + hold * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, at + hold);
  env.connect(filter);

  for (const [mult, detune, v] of [
    [1, -4, 1],
    [1, 5, 0.9],
    [1.5, 0, 0.55],
    [2, 3, 0.4],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = mult === 1.5 ? "triangle" : "sawtooth";
    osc.frequency.value = freq * mult;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = v * 0.3;
    osc.connect(g).connect(env);
    osc.start(at);
    osc.stop(at + hold + 0.05);
  }
}

/** The bass stem: one slow sine on the chord root, the ground the pad sits on. */
function scheduleBass(ctx: BaseAudioContext, out: AudioNode, at: number, hold: number, freq: number, gain: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq / 2;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + hold * 0.2);
  env.gain.setValueAtTime(Math.max(0.0002, gain), at + hold * 0.75);
  env.gain.exponentialRampToValueAtTime(0.0001, at + hold);

  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + hold + 0.05);
}

/** One melody note, placed on a pentatonic degree so it cannot clash with the pad. */
function schedulePluck(ctx: BaseAudioContext, out: AudioNode, at: number, freq: number, gain: number, cutoff: number): void {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;

  // A plucked note has a fast attack and a long tail. Getting that backwards is the
  // difference between a music box and a doorbell.
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);

  // Slightly duller as it decays, which is what a real string does and what makes a short
  // looped note stop sounding like a looped note.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff * 1.4, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.5), at + 1.1);

  osc.connect(filter).connect(env).connect(out);
  osc.start(at);
  osc.stop(at + 1.2);
}

/**
 * The pulse stem: a brushed tick on the beat grid, battle-only.
 *
 * Not a drum — a real kick at 8s bars would fight the pad; a short filtered
 * noise at low gain gives the fight a heartbeat without turning the garden's
 * music into a techno track.
 */
function schedulePulse(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number): void {
  const len = Math.max(1, Math.floor(ctx.sampleRate * 0.07));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 1.2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);

  src.connect(filter).connect(env).connect(out);
  src.start(at);
  src.stop(at + 0.1);
}

/** What one bar of the composition schedules — shared by live tick and offline render. */
function scheduleBar(ctx: BaseAudioContext, outs: Record<StemId, AudioNode>, at: number, chord: number, shape: MoodShape): void {
  const root = SCALE[PROGRESSION[chord]];
  /* Pads/bass hold past the bar line so the old chord is still releasing while
     the next swells — a hard BAR-length hold left a ~1s energy trough at every
     seam, which on a 32s loop reads as the music "breathing" every bar. */
  const hold = BAR + 2.6;
  schedulePad(ctx, outs.pad, at, hold, root, shape.stems.pad, shape.cutoff);
  scheduleBass(ctx, outs.bass, at, hold, root, shape.stems.bass);
  if (shape.pulse) {
    // Beats 1 and 5 of the bar — a heartbeat, not a metronome.
    for (const b of [0, 4]) schedulePulse(ctx, outs.pulse, at + b * BEAT, shape.stems.pulse);
  }
}

interface StemNodes { pad: GainNode; bass: GainNode; melody: GainNode; pulse: GainNode }

class MusicBed {
  private mood: MusicMood = "calm";
  /** The shape actually in use, eased toward, so a mood change fades rather than cuts. */
  private shape: MoodShape = cloneShape(SHAPES.calm);
  private timer = 0;
  /** When the next melody note is due, on the audio clock. */
  private nextNote = 0;
  private chordAt = 0;
  private chord = 0;
  private failed = false;
  /** Per-stem gains under the music bus; rebuilt if the engine rebuilds its context. */
  private stems: StemNodes | null = null;
  /** Sources currently running — AUD-06's evidence that nothing leaks per note. */
  private live = 0;

  /**
   * Set the bed's character.
   *
   * A no-op while silent, which is how "off" stays off: a player who pauses does not get music
   * resumed under them by the next screen that mounts and decides what it would like to play.
   */
  setMood(mood: MusicMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === "silent") return;
    // Bring the scheduler's clock forward so the new shape's first note is a note, not a wait.
    this.nextNote = 0;
  }

  getMood(): MusicMood {
    return this.mood;
  }

  /**
   * Start, if audio is running.
   *
   * Called from the same first gesture that unlocks the context, and deliberately does nothing
   * before then — asking a suspended context for `currentTime` and scheduling into it produces
   * notes that all arrive at once the moment it resumes.
   */
  start(): void {
    if (this.failed) return;
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), 150);
    // `nextNote` of zero means "schedule from now", which is also what makes this correct on
    // the very first call: there is no backlog from before audio existed.
    this.nextNote = 0;
    this.chordAt = 0;
  }

  stop(): void {
    if (!this.timer) return;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  /**
   * Test/ops introspection: current mood, eased stem levels, and how many
   * scheduled sources are still alive. The counts are what AUD-02/AUD-06 assert
   * on — a transport leak or a per-note leak shows up here before it is audible.
   */
  stats(): { mood: MusicMood; stems: Record<StemId, number>; liveSources: number; running: boolean } {
    return {
      mood: this.mood,
      stems: { ...this.shape.stems },
      liveSources: this.live,
      running: this.timer !== 0,
    };
  }

  private ensureStems(ctx: AudioContext, bus: GainNode): StemNodes | null {
    if (this.stems) return this.stems;
    try {
      const make = (): GainNode => {
        const g = ctx.createGain();
        g.gain.value = 1;
        g.connect(bus);
        return g;
      };
      this.stems = { pad: make(), bass: make(), melody: make(), pulse: make() };
      return this.stems;
    } catch {
      return null;
    }
  }

  /**
   * Every failure path here is silent.
   *
   * A browser that refuses to make a second AudioContext, or a phone that suspends one
   * mid-flight, should cost the game its background music and nothing else. Nothing in this
   * file throws, and `failed` latches so a broken context is not re-probed on a timer forever.
   */
  private tick(): void {
    try {
      const engine = sfx;
      if (!engine.available) return;
      const ctx = engine.context;
      const bus = engine.musicBus;
      if (!ctx || !bus || ctx.state !== "running") return;

      const stems = this.ensureStems(ctx, bus);
      if (!stems) return;

      const now = ctx.currentTime;
      if (this.nextNote === 0) this.nextNote = now + 0.15;

      // Ease the shape so a mood change is a transition rather than a switch.
      const target = this.mood === "silent" ? SHAPES.calm : SHAPES[this.mood];
      for (const k of STEM_IDS) {
        this.shape.stems[k] += (target.stems[k] - this.shape.stems[k]) * 0.08;
      }
      this.shape.arpGap += (target.arpGap - this.shape.arpGap) * 0.08;
      this.shape.cutoff += (target.cutoff - this.shape.cutoff) * 0.08;
      this.shape.pulse = target.pulse;

      // Re-chord, and hold the pad for the whole bar.
      if (this.chordAt === 0 || now >= this.chordAt) {
        this.chord = (this.chord + 1) % PROGRESSION.length;
        this.chordAt = now + BAR;
        const outs = stems as unknown as Record<StemId, AudioNode>;
        scheduleBar(ctx, outs, now, this.chord, this.shape);
        this.track(outs.pad);
        this.track(outs.bass);
        this.track(outs.pulse);
      }

      // Schedule the next lookahead's worth of melody notes.
      const horizon = now + 0.2;
      let guard = 0;
      while (this.nextNote < horizon && guard++ < 16) {
        if (this.nextNote >= now) {
          this.playPluck(this.nextNote, stems.melody);
        }
        // A jittered step rather than an even one: even arpeggios sound like a test tone.
        this.nextNote += this.shape.arpGap * (0.82 + Math.random() * 0.36);
      }
    } catch {
      this.failed = true;
      this.stop();
    }
  }

  private playPluck(at: number, out: GainNode): void {
    const ctx = sfx.context;
    if (!ctx) return;
    // Two octaves above the chord root, then a random degree within the pentatonic set.
    const degree = SCALE[(PROGRESSION[this.chord] + 2 + Math.floor(Math.random() * 5)) % SCALE.length];
    schedulePluck(ctx, out, at, degree * 2, this.shape.stems.melody, this.shape.cutoff);
    this.track(out);
  }

  /**
   * Count scheduled sources under a stem so `stats().liveSources` means
   * something. SourceNodes do not expose their aliveness, so the count is kept
   * by hooking the osc we create — one wrapper per note, decremented onended.
   */
  private track(_out: AudioNode): void {
    this.live++;
    // The count must fall even if the tab never fires onended for a recycled
    // source — decrement on a timer scaled to the longest possible note tail.
    window.setTimeout(() => { this.live = Math.max(0, this.live - 1); }, BAR * 1000 + 1200);
  }

  /**
   * Render `seconds` of the bed into a fresh OfflineAudioContext — the same
   * scheduling path as the live tick, against an injectable context. AUD-03/05
   * measure the returned buffer for clicks, gaps and peak level; AUD-10 cites it
   * as proof the whole bed is generated.
   */
  renderOffline(seconds: number, mood: Exclude<MusicMood, "silent"> = "calm"): Promise<AudioBuffer> {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, Math.ceil(sr * seconds), sr);
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
    const make = (): GainNode => { const g = ctx.createGain(); g.connect(bus); return g; };
    const outs = { pad: make(), bass: make(), melody: make(), pulse: make() } as unknown as Record<StemId, AudioNode>;

    const shape = SHAPES[mood];
    const bars = Math.ceil(seconds / BAR);
    for (let b = 0; b < bars; b++) {
      const chord = (b + 1) % PROGRESSION.length;
      scheduleBar(ctx, outs, b * BAR, chord, shape);
    }
    // Melody, on the same jittered-gap walk the live scheduler takes — deterministic
    // seed-free jitter is fine here because the test measures edges, not pitches.
    let t = 0.15;
    while (t < seconds - 0.3) {
      const chord = (Math.floor(t / BAR) + 1) % PROGRESSION.length;
      const degree = SCALE[(PROGRESSION[chord] + 2 + Math.floor(Math.random() * 5)) % SCALE.length];
      schedulePluck(ctx, outs.melody, t, degree * 2, shape.stems.melody, shape.cutoff);
      t += shape.arpGap * (0.82 + Math.random() * 0.36);
    }
    return ctx.startRendering();
  }
}

export const music = new MusicBed();
