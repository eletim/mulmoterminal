// Which browser origins may open this server's sockets and reach its privileged routes.
//
// Loopback always, so a malicious website the user happens to visit can't drive the local Claude
// PTY (a cross-site WebSocket hijack). A MISSING Origin is allowed when the peer is on this
// machine — that is a non-browser local client (CLI, MCP tool, curl), which cannot be a
// cross-site request. Any localhost host on any port is allowed, which is what covers the Vite
// dev proxy.
//
// The peer check matters because "it must be local" used to be inferred from the bind address
// alone. Nothing enforced that, and the server in fact listened on every interface, so a remote
// client sending no Origin was trusted outright.
//
// Beyond loopback, the allowed origins are the ones the OPERATOR NAMED — the bind address when
// `MULMOTERMINAL_HOST` gives a specific one, plus `MULMOTERMINAL_ALLOWED_ORIGINS` (#956). Until
// that, widening the bind refused the browser the same operator had just pointed at the same
// address, while a non-browser sending `Origin: http://localhost` was waved through: the honest
// user was the only one stopped. Origin is a header only BROWSERS are held to, so once the
// operator has decided to trust whoever can reach the port, refusing their browser protects
// nobody.
//
// Deliberately NOT "reflect whatever Host the request carried", which is the obvious shortcut and
// is wrong: a DNS-rebinding page sends `Origin: http://evil.com` with a Host that agrees with it,
// so the two match and the check passes. A list the operator wrote cannot be rebound onto.
//
// Out of index.ts because every route module and the pub/sub socket take this as a
// dependency and every one of their tests passes a stub, so the real predicate — the single
// thing standing between a visited page and the user's terminal — was the one piece nothing
// exercised (#548).
//
// `hostname` is what `new URL()` normalises to, so an IPv6 literal arrives bracketed
// (`[::1]`) however it was written, and a host is already lower-cased and punycoded.
import { isLoopbackAddress } from "./loopback.js";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// A wildcard bind names every interface rather than one address, so there is no hostname a
// browser would ever show for it — nobody opens `http://0.0.0.0:34567`. Nothing can be inferred
// from it, so the operator has to name the origin themselves.
const WILDCARD_BIND_HOSTNAMES = new Set(["0.0.0.0", "[::]"]);

// The hostname a browser would display for `entry`, written either as a bare host (`nuc.local`,
// `192.168.11.6`, `[fe80::1]`) or as a whole origin (`http://nuc.local:34567`) — both are what
// someone reaches for, and accepting only one spelling drops the setting silently. null when it
// is neither.
function hostnameOf(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  for (const candidate of [trimmed, `http://${trimmed}`]) {
    try {
      const { hostname } = new URL(candidate);
      if (hostname) return hostname;
    } catch {
      // not this spelling; try the other
    }
  }
  return null;
}

/**
 * The non-loopback hostnames a browser may use, from what the operator configured. Loopback is
 * deliberately absent: it is unconditional, and including it would make "the operator named
 * nothing" indistinguishable from "something is configured" to a caller reporting the state —
 * which is exactly what bindSecurityWarning has to tell apart.
 */
export function browserOriginHostnames(bindHost: string, allowedOrigins: string | undefined): Set<string> {
  const bind = hostnameOf(bindHost);
  const fromBind = bind !== null && !WILDCARD_BIND_HOSTNAMES.has(bind) && !LOOPBACK_HOSTNAMES.has(bind) ? [bind] : [];
  const named = (allowedOrigins ?? "").split(",").flatMap((entry) => {
    const hostname = hostnameOf(entry);
    return hostname !== null && !LOOPBACK_HOSTNAMES.has(hostname) ? [hostname] : [];
  });
  return new Set([...fromBind, ...named]);
}

/**
 * The predicate for one server, bound to the origins that server accepts. A factory rather than a
 * third optional argument, because that argument would default to "no extra origins" for every
 * caller that forgot to pass it — the exact failure `remoteAddress` was made required to prevent.
 */
export function createIsAllowedOrigin(browserHostnames: ReadonlySet<string>) {
  // `remoteAddress` is the socket's peer, and it is REQUIRED — not because every caller has one,
  // but because a caller that forgets it silently falls back to trusting a missing Origin, which
  // is the whole defect this parameter exists to close. A caller that genuinely cannot know (the
  // socket.io CORS callback, which is handed no request) writes `undefined` at the call site,
  // where the reader can see the gap instead of inferring it from an absent argument.
  //
  // A PRESENT Origin is judged on the origin alone, peer or not. That is deliberate: the origin
  // check defends against a BROWSER being driven cross-site, and a browser cannot forge the
  // header. Judging the peer instead would break the setup the opt-in exists for (a container or
  // WSL forwarding a port, where the peer IS the bridge).
  return function isAllowedOrigin(origin: string | undefined, remoteAddress: string | undefined): boolean {
    // No Origin means a non-browser caller — a CLI, an MCP tool, curl. Trustworthy only because
    // it is on this machine; a remote one is precisely what this must not wave through. Naming a
    // browser origin does NOT reach this rule: it says which PAGES may drive the server, not that
    // an unidentified remote caller has become trustworthy.
    if (!origin) return remoteAddress === undefined || isLoopbackAddress(remoteAddress);
    try {
      const { hostname } = new URL(origin);
      return LOOPBACK_HOSTNAMES.has(hostname) || browserHostnames.has(hostname);
    } catch {
      return false;
    }
  };
}

/**
 * What to print when the server ends up bound somewhere other than loopback. Written here, beside
 * the rule it describes, because the two drifting apart is what produced #956: the warning covered
 * authentication and said nothing about which origins may attach, so the operator met the limit as
 * a terminal that would not connect rather than as a sentence.
 */
export function bindSecurityWarning(bindHost: string, port: string | number, browserHostnames: ReadonlySet<string>): string {
  const exposure = `this server has no authentication, so anyone who can reach ${bindHost}:${port} can read your sessions and start terminals.`;
  // The symptom, named before it is met: the page loads (a plain GET) and then every terminal sits
  // at "connecting", which reads as a broken server rather than as a setting.
  const origins =
    browserHostnames.size === 0
      ? `No browser origin is allowed beyond localhost, so opening http://${bindHost}:${port} from another machine loads the page and then fails to attach a terminal — set MULMOTERMINAL_ALLOWED_ORIGINS to the address you open it at.`
      : `Browsers may attach from ${[...browserHostnames].join(", ")} (and localhost).`;
  return `\x1b[33m[security]\x1b[0m bound to ${bindHost}, not loopback — ${exposure} ${origins} Unset MULMOTERMINAL_HOST to bind 127.0.0.1.`;
}
