// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #1094, stated once over every call site rather than per route.
//
// The origin check answers "which browser PAGE may drive this server". A browser sends NO Origin
// on a same-origin GET, so a GET judged by it can only refuse the honest page — which is why the
// rule (routes/same-origin-guard.ts) exempts safe methods. The exemption lived in the middleware
// only, so the two routes that kept a guard of their own on a GET asked the predicate directly
// and answered 403 to every page served from an operator-named LAN origin. The other eight
// per-route guards happened to sit on a POST, which is the only reason they were fine.
//
// So: an Express route may not ask the predicate itself. `requestOriginAllowed` is the per-route
// form, and it carries the exemption with it.
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../server");

// The three callers that are NOT Express routes, and cannot use the helper:
//   same-origin-guard.ts  defines it
//   ws-routes.ts          a WebSocket upgrade is a raw IncomingMessage — no route, no method to
//                         exempt, and a browser always sends Origin on a handshake
//   pubsub.ts             socket.io's own handshake/CORS hooks, one of which is handed no request
const DIRECT_CALLERS = new Set(["routes/same-origin-guard.ts", "routes/ws-routes.ts", "infra/pubsub.ts"]);

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(full);
    else if (entry.name.endsWith(".ts")) yield full;
  }
}

/** Files handing a request's Origin header straight to the predicate. Matched on the whole
 *  argument rather than the exact `req.headers.origin` spelling, so renaming the parameter or
 *  wrapping the line does not slip past. */
function directPredicateCallers(): string[] {
  const files: string[] = [];
  for (const file of tsFiles(SERVER_DIR)) {
    if (/isAllowedOrigin\([^)]*headers\.origin/.test(readFileSync(file, "utf-8"))) {
      files.push(path.relative(SERVER_DIR, file).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

const usesHelper = (file: string): boolean => /requestOriginAllowed\(/.test(readFileSync(path.join(SERVER_DIR, file), "utf-8"));

describe("per-route origin guards", () => {
  it("go through requestOriginAllowed, not the predicate directly", () => {
    expect(directPredicateCallers()).toEqual([...DIRECT_CALLERS].sort());
  });

  // The allowlist above would also be satisfied by a route that dropped its guard entirely, so
  // the two #1094 routes are named: theirs is the GET that must stay reachable AND the POST that
  // must stay gated, which is exactly what the helper decides between.
  it("are what the two routes from #1094 use", () => {
    expect(usesHelper("backends/remoteHost/routes.ts")).toBe(true);
    expect(usesHelper("backends/google.ts")).toBe(true);
  });
});
