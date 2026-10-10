# Feature inventory S01–S30 — traceability ledger (docs/34 §5, §22.2)

HEAD: `33736c7`. Columns per spec: entry, domain owner, data R/W, state, happy / negative / lifecycle
tests, mobile evidence, acceptance map, status, evidence, remaining risk.
Statuses: `pass` (evidence-backed), `partial` (some sub-paths unverified), `blocked` (external dependency).

| ID | Surface | UI entry / owner | Data owner | Tests (happy·neg·lifecycle) | Mobile ev. | Status | Evidence / remaining risk |
|---|---|---|---|---|---|---|---|
| S01 | First run, guest, sign-in | `signInGate.ts`, `signInGate` screen | `account/sync.ts`, `gate` | `test-gate` 28/28 · `test-auth-gate` · `test-signin-flow` 11 steps (conflict, guest-fork, stale cloud) · gate lifecycle in auth-gate | 390×844 in suites | pass | check-in sheet no longer overlays battle (REL-04 journey); risk: none known |
| S02 | Shell/topbar/nav | `app.ts` TABS + `gardenBar` | `store.ts` | `test-ui` · `test-rel04` (route content), soak 20 route cycles no pile-up | 320–1366 partial | pass | all 7 routes live post redesign; risk: scroll-restore untested per-route |
| S03 | Garden plots | `garden.ts` + `plotCard.ts` | `store.plants`, `plots` | `test-planting` 71/71 (empty/locked/owned, chooser, batch) · `test-ui` | 390×844, F03 24-plot | pass | lazy-SVG keeps offscreen nodes out; risk: none |
| S04 | Seeds/planting | planting chooser sheet | `store.seeds` | `test-planting` (insufficient, empty bag→buy+sow atomic, dedupe) | yes | pass | risk: none |
| S05 | Care actions | plot action bar, gardener | `growth/care.ts` | `test-gardener` 15/15 (cooldown, reject zero-event, eligibility) · `test-economy` | yes | pass | risk: none |
| S06 | Plant detail | detail sheet (badge→sheet) | plant record | gardener-actor badge→detail · `test-ui` long-name F09 | yes | pass | risk: provenance UI thin |
| S07 | Plant mgmt | lock/sell/rename flows | `locks`, `sell()` | `test-economy` · `test-aux-wp08` (manual-lock default, unlock→sell keeps dex) | yes | pass | risk: none |
| S08 | Gardener actor | `gardener.ts` singleton | `autoCare` events via store emit | `test-gardener` queue/unique/expiry · `test-gardener-actor` 11/11 (no duplicate reward, 20 cycles, badge, reduced-motion) | 1366 shots | pass | ACT-03 path video pending; ACT-08/09 blocked-human |
| S09 | Check-in | `checkin.ts` sheet | `core/checkin.ts` | `test-checkin` 39/39 (streak, once, timezone, reload) | yes | pass | risk: none |
| S10 | Breeding | `breeding.ts` + `fusion.ts` | `breed()`, `breedingPreview` | `test-breeding-wp06` 28/28 (odds same-source, 10000bps, parents consumed, atomic fee via ledger, reject paths) | yes | partial | ceremony skip/unmount + fee/pity threshold edges — suite added this round; risk: reviewer UX blocked |
| S11 | Collection/dex | `collection.ts` tabs | `discovery.species` | `test-aux-wp08-view` (dex-gone card, owned≠discovered, search) | yes | pass | risk: none |
| S12 | Lab/genetics | `lab.ts` | `protocols`, `unlockContext` | `test-protocols` · `test-aux-wp08` (pin, unlock req) | yes | pass | risk: none |
| S13 | Arena solo | `arena.ts` | `battle` + `reward` | `test-battle-view` 11/11 (HUD overlap, identity 80 ticks, manual cast, settle-once, reduced motion) | yes | pass | risk: none |
| S14 | Battle runtime | `battleView.ts`, `engine.ts` | engine events | `test-battle-wp07` 19/19 (seed+snapshot→identical log, replay frozen, gates atomic) · `test-juice`, `test-gamefeel` | yes | pass | risk: none |
| S15 | Ascent PvE | `ascent.ts` | `pve/ascent.ts` | `test-ascent` (map/brief/result/unlock/reload, cleared refuse) · `test-ascent-lifecycle` · `test-progression-ui` | yes | pass | risk: none |
| S16 | Room MP | `room` client + arena | `core/room.ts`, Worker DO | `test-room` (state machine) | partial | partial | **F07 harness missing**: reconnect/duplicate/timeout/delay untested vs live DO — building now |
| S17 | Friends/duels | `friends.ts` | `account/social.ts`, Worker | `test-social` 107/107 (inbox/outbox, accept, handle) | yes | partial | risk: expired-duel + replay-fallback paths thin; F07 |
| S18 | Leaderboard | `leaderboard.ts` | Worker D1 | `test-aux-wp08-view` (offline settles to state) · `test-social` | yes | pass | risk: tie ordering unverified |
| S19 | Quests/progression | `quests` + level/exp FX | `quests/*`, `progression` | `test-quests` · `test-experience` · `test-levelup-ui` · `test-exp-animation` (no double celebration, reduced-motion) | yes | pass | risk: none |
| S20 | Shop | `lab.ts` shelf | `economy/shop.ts` | `test-shop-filter` · `test-shop-sort` · `test-aux-wp08` 15/15 (page/sort/search/locked/affordable, atomic failures) | yes | pass | risk: none |
| S21 | Exchange | exchange UI in lab | `economy/exchange.ts` | `test-economy` 214/214 · `test-technical-contracts` BigInt audit · `test-aux-wp08` (cap, ember, same-currency, no partial) | yes | pass | risk: none |
| S22 | Settings | accountSheet settings | `core/prefs.ts` | `test-prefs` (persist/OS-override/clamp/blocked-storage) · `test-aux-wp08-view` (motion/glass/quality/volume effects) | yes | pass | risk: none |
| S23 | Accounts/sync | `accountSheet`, gate | `account/sync.ts` | `test-signin-flow` (local-survives-stale-cloud, guest-fork→conflict, choose-guest→push, delayed-response isolation) | yes | pass | risk: corrupt-save path relies on loader |
| S24 | Rewarded ads | ads call sites | `ads/ads.ts` | `test-ads-contracts` 6/6 (once, no-fill, dismissed, dup-callback, blocked script) | n/a | pass | risk: real network untested (spec forbids) |
| S25 | PWA/offline | `sw.js`, manifest | sw + update flow | `test-service-worker` 8/8 (real sw in VM: nav 500 no-poison, offline shell) · verify-prod 200s live | yes | pass | risk: none |
| S26 | Audio/global FX | `audio.ts`, `music.ts` | sfx engine + 4-stem bed | `test-audio` (cue arc incl. pause/resume) · `test-audio-stems` 15/15 (seam, buses, mood, stats) · soak liveSources bounded | yes | pass | AUD-Q human listening blocked; peak<0.95 measured this round |
| S27 | Crash/error UX | `core/errors.ts` | error reporter | `test-gate` storage-throw paths · error surface in aux suites | partial | partial | risk: dedupe/cap of reporter not stress-tested |
| S28 | Backend/storage | `worker/src/*` | KV/D1/DO/R2 | `test-schema-contracts` 6/6 (SQLite real: idempotent, rollback) · worker typecheck · smoke script exists | n/a | partial | risk: remote apply not run (spec: forbidden without permission) |
| S29 | A11y/device | global | `prefs`, DOM | `test-rel04` 7/7 (zoom allowed, solid, reduced-motion, Space pause) | yes | partial | **blocked**: real iPhone Safari (no device); WCAG contrast audit added this round |
| S30 | Build/CI/release | package.json, workflows | build/deploy | typecheck×3 + build in core profile 41/41 · `test:technical:browser` 18/18 · soak 11/11 | n/a | pass | hosted CI runs on PR — not yet observed on HEAD; rollback record added |

Extra rows discovered in inventory (spec: new features get rows):

| ID | Surface | Owner | Status | Evidence / risk |
|---|---|---|---|---|
| S31 | Lazy-SVG LOD beds | `render/lazySvg.ts` + 3 call sites | pass | DOM 8572→2347 measured; risk: none |
| S32 | Soak harness | `tools/test-soak.ts` | pass | 11/11 ×2 (prod build + dev), counters kept |
| S33 | Check-in sheet vs battle overlay | `maybeAutoOpenCheckIn` | pass | REL-04 journey + gardener-actor dismiss path |
