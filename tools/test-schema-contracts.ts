import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
let passed = 0;
let failed = 0;
function test(name: string, work: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(":memory:");
  try { db.exec(schema); work(db); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
  finally { db.close(); }
}
test("schema can be applied twice without losing records", db => {
  db.prepare("INSERT INTO meta (k, v) VALUES (?, ?)").run("version", "1");
  db.exec(schema);
  assert.equal(db.prepare("SELECT v FROM meta WHERE k = ?").get("version")!.v, "1");
});
test("friend key prevents duplicate edges but isolates different owners", db => {
  const insert = db.prepare("INSERT INTO friends VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("owner-a", "friend@test", "account-f", "Friend", "save-f", 1);
  assert.throws(() => insert.run("owner-a", "friend@test", "account-f", "Friend", "save-f", 2));
  insert.run("owner-b", "friend@test", "account-f", "Friend", "save-f", 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM friends").get()!.n, 2);
});
test("duel identifier cannot produce two inbox/outbox records", db => {
  const insert = db.prepare("INSERT INTO duels VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("duel-1", "a", "b", "b@test", "B", "{}", "pending", 1);
  assert.throws(() => insert.run("duel-1", "a", "b", "b@test", "B", "{}", "done", 2));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM duels WHERE from_key = ?").get("a")!.n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM duels WHERE to_key = ?").get("b")!.n, 1);
});
test("inbox/outbox lookup uses indexed owner and timestamp", db => {
  for (const field of ["to_key", "from_key"]) {
    const rows = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM duels WHERE ${field} = ? AND created_at > ? ORDER BY created_at DESC`).all("a", 0);
    assert.ok(rows.some(row => /USING INDEX idx_duels_/.test(String(row.detail))), JSON.stringify(rows));
  }
});
test("replay and whisper identifiers stay unique under retries", db => {
  for (let retry = 0; retry < 3; retry++) {
    db.prepare("INSERT OR IGNORE INTO species_whispers VALUES (?, ?, ?)").run("sp0001", "first", retry);
    db.prepare("INSERT OR IGNORE INTO duel_results VALUES (?, ?)").run("duel-1", "{}");
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM species_whispers").get()!.n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM duel_results").get()!.n, 1);
});
test("transaction rollback preserves migration marker and relational records", db => {
  db.exec("BEGIN");
  db.prepare("INSERT INTO social_migrated VALUES (?, ?)").run("owner", 1);
  db.prepare("INSERT INTO handles VALUES (?, ?)").run("owner@test", "owner");
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM social_migrated").get()!.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM handles").get()!.n, 0);
});
console.log(`Schema contracts: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
