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

// `remoteAddress` is the socket's peer. It is optional so existing callers keep compiling, but
// pass it wherever it is available: without it a missing Origin is trusted on the old
// assumption alone, which is exactly what stops being true the moment the server is bound
// wider than loopback.
export function isAllowedOrigin(origin?: string, remoteAddress?: string): boolean {
  // No Origin means a non-browser caller — a CLI, an MCP tool, curl. Trustworthy only because
  // it is on this machine; a remote one is precisely what this must not wave through.
  if (!origin) return remoteAddress === undefined || isLoopbackAddress(remoteAddress);
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
