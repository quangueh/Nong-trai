import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Transform only the Vite env expression, preserving the real ad lifecycle code.
function load(client: string, provider?: (callbacks: Record<string, unknown>) => void) {
  const source = readFileSync(new URL("../src/ads/ads.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [context => {
      const visit: ts.Visitor = node => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === "env" && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
          return ts.factory.createObjectLiteralExpression([
            ts.factory.createPropertyAssignment("VITE_ADSENSE_CLIENT", ts.factory.createStringLiteral(client)),
            ts.factory.createPropertyAssignment("DEV", ts.factory.createFalse()),
          ]);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return file => ts.visitNode(file, visit) as ts.SourceFile;
    }] },
  }).outputText;
  const exports: Record<string, unknown> = {};
  let scriptLoads = 0;
  runInNewContext(output, {
    exports,
    window: { adBreak: provider },
    document: {
      createElement: () => ({}),
      head: { appendChild: (script: { onerror: () => void }) => { scriptLoads++; script.onerror(); } },
    },
  });
  return { show: exports.showRewardedAd as () => Promise<boolean>, configured: exports.adsConfigured, loads: () => scriptLoads };
}
let passed = 0;
let failed = 0;
async function test(name: string, work: () => Promise<void>) {
  try { await work(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
const invoke = (callbacks: Record<string, unknown>, name: string, value?: unknown) => (callbacks[name] as (value?: unknown) => void)(value);
await test("unconfigured production ads grant no reward and load no script", async () => {
  const ad = load("");
  assert.equal(ad.configured, false);
  assert.equal(await ad.show(), false);
  assert.equal(ad.loads(), 0);
});
await test("completed video grants reward", async () => {
  const ad = load("ca-pub-test", callbacks => invoke(callbacks, "adViewed"));
  assert.equal(await ad.show(), true);
});
await test("dismissed video never grants reward", async () => {
  const ad = load("ca-pub-test", callbacks => invoke(callbacks, "adDismissed"));
  assert.equal(await ad.show(), false);
});
await test("no-fill ends without granting reward", async () => {
  const ad = load("ca-pub-test", callbacks => invoke(callbacks, "adBreakDone", { breakStatus: "noAdPreloaded" }));
  assert.equal(await ad.show(), false);
});
await test("duplicate callbacks cannot change an already settled outcome", async () => {
  const ad = load("ca-pub-test", callbacks => {
    invoke(callbacks, "adDismissed");
    invoke(callbacks, "adViewed");
    invoke(callbacks, "adBreakDone", { breakStatus: "viewed" });
  });
  assert.equal(await ad.show(), false);
});
await test("blocked ad script returns false instead of throwing", async () => {
  const ad = load("ca-pub-test");
  assert.equal(await ad.show(), false);
  assert.equal(ad.loads(), 1);
});
console.log(`Ads contracts: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
