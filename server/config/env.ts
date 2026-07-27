// Process-wide settings read from the environment. Their own module because the session
// registry persists under MULMOTERMINAL_HOME and validates ids with SESSION_ID_RE — taking
// them from index.ts would make the registry import its own importer.
import os from "node:os";
import path from "node:path";

export const PORT = process.env.PORT || 34567;

// The interface the HTTP server binds to. LOOPBACK BY DEFAULT — this server has no
// authentication of its own: every /api route, the terminal WebSockets, and the routes that
// spawn a PTY are reachable by anyone who can open a socket to it. Binding every interface
// (Node's default when `listen()` is given no host) put all of that on the local network.
//
// It is also what several guards silently depend on: `isAllowedOrigin` trusts a request with
// no Origin header, on the grounds that such a caller is a local CLI or MCP tool rather than
// a browser. That reasoning only holds while nothing remote can connect at all.
//
// Set MULMOTERMINAL_HOST to widen it deliberately — `0.0.0.0` to accept from anywhere, or a
// specific address. Only on a network you trust, and knowing the above.
//
// Widening the BIND is half of reaching this from another machine; the other half is which
// browser ORIGINS may attach (see infra/allowed-origin.ts). A specific address here is taken as
// one of them. `0.0.0.0` cannot be — it names every interface, so there is no address to accept
// — and that setup needs MULMOTERMINAL_ALLOWED_ORIGINS to say which one is actually opened. The
// startup warning prints whichever set it ended up with, because a browser that cannot attach
// otherwise looks like a broken server (#956).
export const BIND_HOST = process.env.MULMOTERMINAL_HOST || "127.0.0.1";

// The workspace used as the PTY cwd and as the root for persisted session state. index.ts
// creates it at boot before anything spawns into it.
export const CLAUDE_CWD = process.env.CLAUDE_CWD || path.join(os.homedir(), "mulmoclaude");

// MulmoTerminal's own per-session GUI state (tool-result render data + tool-call history)
// lives here, keyed by sessionId (a global UUID) — NOT under the workspace dir, so it stays
// valid regardless of which directory is active.
export const MULMOTERMINAL_HOME = path.join(os.homedir(), ".mulmoterminal");

// A session id is always a UUID (server-generated, or a .jsonl basename). Reject anything
// else so a client can't smuggle CLI flags (e.g. "--resume" followed by a value that claude
// re-parses as a flag) into the spawned process.
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
