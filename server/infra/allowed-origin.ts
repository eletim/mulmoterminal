// Which browser origins may open this server's sockets and reach its privileged routes.
//
// Only same-machine browser origins, so a malicious website the user happens to visit can't
// drive the local Claude PTY (a cross-site WebSocket hijack). A MISSING Origin is allowed when
// the peer is on this machine — that is a non-browser local client (CLI, MCP tool, curl), which
// cannot be a cross-site request. Any localhost host on any port is allowed, which is what
// covers the Vite dev proxy.
//
// The peer check matters because "it must be local" used to be inferred from the bind address
// alone. Nothing enforced that, and the server in fact listened on every interface, so a remote
// client sending no Origin was trusted outright.
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

// `remoteAddress` is the socket's peer, and it is REQUIRED — not because every caller has one,
// but because a caller that forgets it silently falls back to trusting a missing Origin, which
// is the whole defect this parameter exists to close. A caller that genuinely cannot know (the
// socket.io CORS callback, which is handed no request) writes `undefined` at the call site,
// where the reader can see the gap instead of inferring it from an absent argument.
//
// A PRESENT Origin is still judged on the origin alone, peer or not. That is deliberate: the
// origin check defends against a BROWSER being driven cross-site, and a browser cannot forge
// the header. A non-browser that forges it must already be able to reach the port, which only
// happens when the operator widened the bind — an explicit decision to trust whoever can
// connect. Making a non-loopback peer fail outright here would break the one setup that opt-in
// exists for (a container or WSL forwarding a port, where the peer is the bridge).
export function isAllowedOrigin(origin: string | undefined, remoteAddress: string | undefined): boolean {
  // No Origin means a non-browser caller — a CLI, an MCP tool, curl. Trustworthy only because
  // it is on this machine; a remote one is precisely what this must not wave through.
  if (!origin) return remoteAddress === undefined || isLoopbackAddress(remoteAddress);
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
