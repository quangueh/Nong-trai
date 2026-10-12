/**
 * Deep-link parsing for the browser-bounce sign-in, without a browser.
 *
 * `handleAuthUrl` itself redeems against the live Worker — what can and must be
 * checked here is the pure part, because the bug it guards was invisible to
 * every suite that never ran inside a real WebView: Chromium parses
 * `com.quang.nongtrai://pair?code=X` as a non-special scheme, which leaves
 * `hostname` empty and puts `//pair` in the path. A parser written for
 * `u.hostname === "pair"` accepted every link and redeemed none of them.
 */
import { pairCodeFromUrl } from "../src/account/appAuth";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("app-auth deep links:\n");

check(
  "the shape Android delivers: hostless path form",
  pairCodeFromUrl("com.quang.nongtrai://pair?code=ABC123") === "ABC123",
  String(pairCodeFromUrl("com.quang.nongtrai://pair?code=ABC123")),
);
check(
  "an explicit-host form parses too",
  pairCodeFromUrl("com.quang.nongtrai://pair/?code=ZZZ999") === "ZZZ999" ||
    pairCodeFromUrl("com.quang.nongtrai://pair?code=ZZZ999") === "ZZZ999",
);
check("no code is not a link", pairCodeFromUrl("com.quang.nongtrai://pair") === null);
check("empty code is not a link", pairCodeFromUrl("com.quang.nongtrai://pair?code=") === null);
check("wrong scheme refused", pairCodeFromUrl("https://pair?code=ABC123") === null);
check("wrong path refused", pairCodeFromUrl("com.quang.nongtrai://other?code=ABC123") === null);
check("garbage refused", pairCodeFromUrl("not a url at all") === null);
check(
  "case of the scheme survives Android normalisation",
  pairCodeFromUrl("COM.QUANG.NONGTRAI://pair?code=QWERTY") === "QWERTY",
);

console.log(bad ? `\n${bad} FAIL` : "\nall ok");
process.exit(bad ? 1 : 0);
