// Is a peer address on this machine?
//
// The one thing several guards ultimately rest on. The server binds to loopback by default
// (see BIND_HOST in config/env.ts), and code that treats a request as trusted because
// "remote traffic can't reach us" is only correct while that holds — a deployment that opts
// into a wider bind, or any proxy in front, breaks the assumption silently. Asking the socket
// is the only answer that stays true either way.
//
// Node reports an IPv4 peer on a dual-stack listener as `::ffff:127.0.0.1`, so the mapped
// form is unwrapped before comparing: matching the bare literals alone would classify a real
// loopback client as remote. The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const bare = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;
  return LOOPBACK_V4.test(bare);
}

// 127.0.0.0/8, with each octet actually in range — `127.999.0.1` is not an address. The peer
// form comes from the kernel and could not be out of range, but isLoopbackBindHost below runs
// this over a value the operator typed.
const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const LOOPBACK_V4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

// Whether the server ended up listening only on this machine, from what the OS says it bound —
// `server.address()` — rather than from the string that was requested.
//
// Classifying the requested string cannot be made right: `localhost`, `127.1`, `127.0.1` and
// `127.000.000.001` are all valid ways to ask for loopback, and `localhost` can be pointed
// somewhere else entirely by a hosts file. Asking after the fact answers all of them, because
// the kernel has already resolved whatever was typed. A warning that fires on a safe setting
// trains people to ignore the one that matters, so it has to be exact.
//
// A string address is a pipe or UNIX socket — no network exposure. A null means the server is
// not listening, so there is nothing to warn about yet.
export function isLoopbackBinding(address: string | { address: string } | null): boolean {
  if (address === null) return true;
  if (typeof address === "string") return true;
  return isLoopbackAddress(address.address);
}
