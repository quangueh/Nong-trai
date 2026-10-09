-- Nông trại social layer on D1.
--
-- Friends, duel correspondence, the friend-search indexes and the leaderboard all
-- moved here from KV blobs: they are relational data (one row per friend, one row
-- per duel, one row per ranked player), and KV's whole-blob model paid a full
-- rewrite per mutation plus a list+gets fan-out per leaderboard read. On the free
-- tier D1 allows ~100x the daily writes KV does, and a board read is a SELECT
-- instead of a namespace scan.
--
-- Accounts and garden saves stay in KV — they are single blobs keyed by one id,
-- which is exactly what a key-value store is for.

-- Friend search by email (the identity). One row per account.
CREATE TABLE IF NOT EXISTS handles (
  handle TEXT PRIMARY KEY,
  account_key TEXT NOT NULL
);

-- Friend search by display name. A name can be shared, so `occupants` counts
-- distinct accounts holding it and a lookup refuses ambiguity, same rule as the
-- KV nameIndex + nameCount pair it replaces.
CREATE TABLE IF NOT EXISTS names (
  name TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  occupants INTEGER NOT NULL DEFAULT 1
);

-- One row per friendship. Replaces the whole-book JSON blob: adding or removing
-- a friend is one row, not a rewrite of the list.
CREATE TABLE IF NOT EXISTS friends (
  owner_key TEXT NOT NULL,
  friend_handle TEXT NOT NULL,
  friend_key TEXT NOT NULL,
  friend_name TEXT NOT NULL,
  friend_save_key TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (owner_key, friend_handle)
);

-- One row per challenge — inbox and outbox are two queries over the same row,
-- which is the fix for the KV design keeping the letter in two blobs that had to
-- be written together to stay consistent.
CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  to_handle TEXT NOT NULL,
  to_name TEXT NOT NULL,
  -- The DuelInvite JSON the inbox renders (from/fromName/plant/plantPower/at/
  -- fromKey/fromSaveKey/fromPlantId/state/resultKey...).
  payload TEXT NOT NULL,
  state TEXT NOT NULL,            -- pending | declined | done
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duels_to ON duels (to_key, created_at);
CREATE INDEX IF NOT EXISTS idx_duels_from ON duels (from_key, created_at);

-- Leaderboard index: one ranked row per account. Board reads are ORDER BY …
-- LIMIT queries; no snapshot cache key and no fan-out of gets.
CREATE TABLE IF NOT EXISTS lb (
  account_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  power INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  at INTEGER NOT NULL
);

-- Duel replay payloads when the R2 bucket is not bound (small site fallback).
CREATE TABLE IF NOT EXISTS duel_results (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

-- Per-user marker for the one-time KV → D1 import (friends book, inbox, outbox).
CREATE TABLE IF NOT EXISTS social_migrated (
  owner_key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

-- Tiny flag table (e.g. lb_backfilled) so a one-time backfill runs once.
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Client-side error reports (window.onerror / unhandledrejection). Self-hosted
-- telemetry: enough to know a release broke somebody's garden before they
-- report it, without shipping a third-party SDK in the bundle.
CREATE TABLE IF NOT EXISTS client_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  url TEXT,
  ua TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_errors_at ON client_errors (at);

-- One LLM flavour line per species (Workers AI ~10k free neurons/day).
-- Cached forever: the first request pays the neurons, later ones are a SELECT.
CREATE TABLE IF NOT EXISTS species_whispers (
  id TEXT PRIMARY KEY,            -- species id, e.g. sp0001
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
