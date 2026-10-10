/**
 * The visible gardener's bounded work queue (docs/27 §7.4).
 *
 * The domain settles every auto-care action in one tick — often several
 * plants at once — so the queue is a *presentation replay* buffer, not a
 * simulation. It must:
 *
 * - dedupe by event id (the same action must never be acted out twice),
 * - stay bounded: `MAX_JOBS` detailed jobs, and jobs older than `MAX_AGE_MS`
 *   fold into the summary counter instead of a minutes-long replay,
 * - fold `catchup` events into the summary — except at most one marked
 *   illustration, per spec "catch-up chỉ summary + tối đa một minh họa",
 * - never hold a Plant reference; the actor resolves plantId → element each
 *   job so a plant that was sold/bred/locked mid-queue simply cancels its
 *   visual.
 *
 * Pure module — the DOM actor feeds it events and reads jobs; the tests feed
 * it arrays.
 */

import type { GardenerWorkEvent } from "../core/types";

export const MAX_JOBS = 4;
export const MAX_AGE_MS = 8_000;

export interface GardenerJob {
  event: GardenerWorkEvent;
  enqueuedAt: number;
  /** True when this job is the single allowed catch-up illustration. */
  illustration: boolean;
}

export interface GardenerQueue {
  jobs: GardenerJob[];
  /** Live events folded away because the queue was full or too old. */
  summarized: number;
  /** Catch-up events folded away (all but the illustration). */
  catchupSummarized: number;
  /** Set once the single catch-up illustration slot is spent. */
  illustrationUsed: boolean;
  /** Event ids already seen — dedupe must survive repaints. */
  seen: Set<string>;
}

export function createQueue(): GardenerQueue {
  return { jobs: [], summarized: 0, catchupSummarized: 0, illustrationUsed: false, seen: new Set() };
}

/**
 * Feed one domain event. Returns the job the actor should perform, or null
 * when the event folded into the summary.
 */
export function enqueueWork(q: GardenerQueue, ev: GardenerWorkEvent, now: number, maxJobs = MAX_JOBS, maxAgeMs = MAX_AGE_MS): GardenerJob | null {
  if (q.seen.has(ev.id)) return null;
  q.seen.add(ev.id);

  // Age out anything stale before the new arrival is judged — a job that sat
  // unperformed past its window becomes a number, not a replay.
  pruneQueue(q, now, maxAgeMs);

  if (ev.source === "catchup") {
    // Offline work already settled long ago: the summary tells the truth,
    // and at most one job gets acted out so the player sees the gardener was
    // here — not a ten-minute replay of everything that happened overnight.
    if (q.illustrationUsed) {
      q.catchupSummarized++;
      return null;
    }
    q.illustrationUsed = true;
  }

  if (q.jobs.length >= maxJobs) {
    if (ev.source === "catchup") q.catchupSummarized++;
    else q.summarized++;
    return null;
  }

  const job: GardenerJob = { event: ev, enqueuedAt: now, illustration: ev.source === "catchup" };
  q.jobs.push(job);
  return job;
}

/** Drop jobs that aged out before being performed, folding them into the summary. */
export function pruneQueue(q: GardenerQueue, now: number, maxAgeMs = MAX_AGE_MS): number {
  let folded = 0;
  q.jobs = q.jobs.filter((job) => {
    const stale = now - job.enqueuedAt > maxAgeMs;
    if (stale) {
      folded++;
      if (job.event.source === "catchup") q.catchupSummarized++;
      else q.summarized++;
    }
    return !stale;
  });
  return folded;
}

/** Take the next job to perform. */
export function nextJob(q: GardenerQueue): GardenerJob | undefined {
  return q.jobs.shift();
}

/**
 * Fold every pending job into the summary — buff expiry or unmount. Work
 * already done stays done; only the unperformed remainder collapses.
 */
export function drainQueue(q: GardenerQueue): number {
  let folded = 0;
  for (const job of q.jobs.splice(0)) {
    folded++;
    if (job.event.source === "catchup") q.catchupSummarized++;
    else q.summarized++;
  }
  return folded;
}
