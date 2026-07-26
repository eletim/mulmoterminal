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
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}
