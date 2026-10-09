/**
 * Client error reporting — a self-hosted "Sentry" on the free tier.
 *
 * `window.onerror` and `unhandledrejection` POST a truncated report to the
 * Worker's `/api/error`, which lands it in the D1 `client_errors` table. No SDK,
 * no third party, no PII beyond the UA string — just enough to learn that a
 * release broke somebody's garden before they say so.
 *
 * Bound hard on purpose: at most a handful of reports per page load, deduped by
 * content, and never a report when no API is configured. A crashing page that
 * tried to report every error would itself be a traffic storm.
 */

const BASE =
  (import.meta.env?.VITE_ACCOUNT_API as string | undefined)?.replace(/\/$/, "") ?? "";

const MAX_REPORTS = 4;

export function initErrorReporting(): void {
  if (!BASE || typeof window === "undefined") return;

  let sent = 0;
  const seen = new Set<string>();

  const post = (kind: string, detail: string): void => {
    const trimmed = detail.slice(0, 2000);
    if (sent >= MAX_REPORTS || seen.has(trimmed)) return;
    seen.add(trimmed);
    sent++;
    void fetch(`${BASE}/api/error`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        detail: trimmed,
        url: location.pathname + location.search.slice(0, 100),
        ua: navigator.userAgent.slice(0, 200),
        at: Date.now(),
      }),
    }).catch(() => {
      /* a report that cannot leave is dropped — never retried into a loop */
    });
  };

  window.addEventListener("error", (e) => {
    const where = e.filename ? `\n${e.filename}:${e.lineno ?? 0}` : "";
    post("error", `${e.message ?? "unknown"}${where}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack ?? ""}` : String(e.reason);
    post("rejection", reason);
  });
}
