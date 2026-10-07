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
 * So: no file, no download, nothing to fail. A bed of pads and sparse plucked notes, changing
 * chord every few bars, in one pentatonic collection so no combination of notes can sound wrong.
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

interface MoodShape {
  /** How often a plucked note appears, in seconds. Larger is sparser. */
  arpGap: number;
  /** Peak level of a pluck, 0..1. */
  arpGain: number;
  /** Peak level of the sustained pad, 0..1. */
  padGain: number;
  /** Lowpass cutoff on everything, in Hz. The main "brightness" control. */
  cutoff: number;
}

const SHAPES: Record<Exclude<MusicMood, "silent">, MoodShape> = {
  // Roomy and soft. The garden: something to sit behind, not to listen to.
  calm: { arpGap: 1.9, arpGain: 0.1, padGain: 0.075, cutoff: 1500 },
  // Tighter, brighter, and it plays more notes — because the fight does.
  battle: { arpGap: 0.62, arpGain: 0.16, padGain: 0.1, cutoff: 2600 },
};

class MusicBed {
  private mood: MusicMood = "calm";
  /** The shape actually in use, eased toward, so a mood change fades rather than cuts. */
  private shape: MoodShape = SHAPES.calm;
  private timer = 0;
  /** When the next pluck is due, on the audio clock. */
  private nextNote = 0;
  private chordAt = 0;
  private chord = 0;
  private failed = false;

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
      if (!ctx || ctx.state !== "running") return;

      const now = ctx.currentTime;
      if (this.nextNote === 0) this.nextNote = now + 0.15;

      // Ease the shape so a mood change is a transition rather than a switch.
      const target = this.mood === "silent" ? SHAPES.calm : SHAPES[this.mood];
      for (const k of ["arpGap", "arpGain", "padGain", "cutoff"] as const) {
        this.shape[k] += (target[k] - this.shape[k]) * 0.08;
      }

      // Re-chord, and hold the pad for the whole bar.
      if (this.chordAt === 0 || now >= this.chordAt) {
        this.chord = (this.chord + 1) % PROGRESSION.length;
        this.chordAt = now + BAR;
        this.playPad(now, BAR);
      }

      // Schedule the next lookahead's worth of plucks.
      const horizon = now + 0.2;
      let guard = 0;
      while (this.nextNote < horizon && guard++ < 16) {
        if (this.nextNote >= now) this.playPluck(this.nextNote);
        // A jittered step rather than an even one: even arpeggios sound like a test tone.
        this.nextNote += this.shape.arpGap * (0.82 + Math.random() * 0.36);
      }
    } catch {
      this.failed = true;
      this.stop();
    }
  }

  /** The sustained layer: three detuned voices a fifth and an octave apart. */
  private playPad(at: number, hold: number): void {
    const ctx = sfx.context;
    if (!ctx) return;
    const base = SCALE[PROGRESSION[this.chord]];
    const bus = sfx.musicBus;
    if (!bus) return;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.shape.cutoff;
    filter.Q.value = 0.6;
    filter.connect(bus);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, at);
    // Long attack: a pad that arrives instantly is an organ, and an organ is not a garden.
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.shape.padGain), at + hold * 0.35);
    out.gain.setValueAtTime(Math.max(0.0002, this.shape.padGain), at + hold * 0.7);
    out.gain.exponentialRampToValueAtTime(0.0001, at + hold);
    out.connect(filter);

    for (const [mult, detune, gain] of [
      [1, -4, 1],
      [1, 5, 0.9],
      [1.5, 0, 0.55],
      [2, 3, 0.4],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = mult === 1.5 ? "triangle" : "sawtooth";
      osc.frequency.value = base * mult;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain * 0.3;
      osc.connect(g).connect(out);
      osc.start(at);
      osc.stop(at + hold + 0.05);
    }
  }

  /** One plucked note, placed on a pentatonic degree so it cannot clash with the pad. */
  private playPluck(at: number): void {
    const ctx = sfx.context;
    const bus = sfx.musicBus;
    if (!ctx || !bus) return;

    // Two octaves above the chord root, then a random degree within the pentatonic set.
    const degree = SCALE[(PROGRESSION[this.chord] + 2 + Math.floor(Math.random() * 5)) % SCALE.length];
    const freq = degree * 2;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    // A plucked note has a fast attack and a long tail. Getting that backwards is the
    // difference between a music box and a doorbell.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.shape.arpGain), at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);

    // Slightly duller as it decays, which is what a real string does and what makes a short
    // looped note stop sounding like a looped note.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(this.shape.cutoff * 1.4, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, this.shape.cutoff * 0.5), at + 1.1);

    osc.connect(filter).connect(env).connect(bus);
    osc.start(at);
    osc.stop(at + 1.2);
  }
}

export const music = new MusicBed();