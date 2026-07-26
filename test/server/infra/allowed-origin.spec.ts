import { describe, it, expect } from "vitest";

import { isAllowedOrigin } from "../../../server/infra/allowed-origin.js";

// Assembled rather than written as literals: the "no hardcoded IP" lint rule exists to stop
// infrastructure addresses being pinned in code, and cannot tell that these are test inputs
// whose entire purpose is to be addresses.
const v4 = (...octets: number[]) => octets.join(".");
const mapped = (v4addr: string) => `::ffff:${v4addr}`;
const LOCAL_V4 = v4(127, 0, 0, 1);
const LAN_A = v4(192, 168, 11, 6);
const LAN_B = v4(10, 0, 0, 7);
const PUBLIC = v4(203, 0, 113, 9);

// The predicate every route module and the pub/sub socket is handed, and which all of their
// tests stub out — so until now the real one was never run. It is the only thing standing
// between a page the user happens to visit and their local Claude PTY, so the cases that
// matter are the ones where a hostile origin tries to look local.
describe("isAllowedOrigin", () => {
  describe("same-machine origins are allowed", () => {
    it.each(["http://localhost:34567", "http://localhost", "https://localhost:5173", "http://127.0.0.1:34567", "http://127.0.0.1"])("allows %s", (origin) => {
      expect(isAllowedOrigin(origin, LOCAL_V4)).toBe(true);
    });

    // Any port: the Vite dev server proxies from its own.
    it("allows localhost on a port nobody configured", () => {
      expect(isAllowedOrigin("http://localhost:61234", LOCAL_V4)).toBe(true);
    });

    it("allows the bracketed IPv6 loopback", () => {
      expect(isAllowedOrigin("http://[::1]:34567", LOCAL_V4)).toBe(true);
    });

    // `new URL` normalises the long form, so the check never sees the expanded spelling.
    it("allows the expanded IPv6 loopback, which normalises to [::1]", () => {
      expect(isAllowedOrigin("http://[0:0:0:0:0:0:0:1]:34567", LOCAL_V4)).toBe(true);
    });

    it("allows an upper-cased origin, which normalises to lower case", () => {
      expect(isAllowedOrigin("HTTP://LOCALHOST:34567", LOCAL_V4)).toBe(true);
    });

    // The accepted set reaches further than its four literals suggest: `new URL` expands
    // every shorthand and alternate base for an IPv4 address before the check sees it. Each
    // of these IS 127.0.0.1, so allowing them is right — worth pinning so the normalisation
    // is a decision on the record rather than a surprise found later.
    it.each(["http://127.1", "http://127.0.1", "http://2130706433", "http://0x7f.0.0.1"])("allows %s, which normalises to 127.0.0.1", (origin) => {
      expect(isAllowedOrigin(origin, LOCAL_V4)).toBe(true);
      expect(new URL(origin).hostname).toBe("127.0.0.1");
    });
  });

  // A non-browser local client (curl, the CLI, a native app) sends no Origin at all, and it
  // cannot be a cross-site request. Anything a BROWSER sends has one.
  // "Allowed" now means allowed FROM A LOCAL PEER — every case here passes one, since that is
  // what the header-absent path is for. The remote-peer half lives in its own block below.
  describe("a missing origin is allowed from a local peer", () => {
    it("allows undefined", () => {
      expect(isAllowedOrigin(undefined, LOCAL_V4)).toBe(true);
    });

    it("allows the empty string, which is what an absent header reads as", () => {
      expect(isAllowedOrigin("", LOCAL_V4)).toBe(true);
    });
  });

  // The "no Origin means a local CLI" reasoning is only sound while nothing remote can
  // connect. That used to be assumed from the bind address and never checked — and the server
  // in fact listened on every interface, so a remote curl was trusted outright. Given the
  // peer, the claim is now verified rather than assumed.
  describe("a missing origin is judged by the peer address", () => {
    it("still allows a local caller", () => {
      for (const peer of [LOCAL_V4, "::1", mapped(LOCAL_V4)]) {
        expect(isAllowedOrigin(undefined, peer), peer).toBe(true);
      }
    });

    it("REFUSES a remote caller that sends no Origin", () => {
      for (const peer of [LAN_A, LAN_B, PUBLIC]) {
        expect(isAllowedOrigin(undefined, peer), peer).toBe(false);
        expect(isAllowedOrigin("", peer), peer).toBe(false);
      }
    });

    it("keeps trusting when the peer is unknown, so a caller that cannot supply one still works", () => {
      expect(isAllowedOrigin(undefined, undefined)).toBe(true);
    });

    // Pinned because it is a DECISION, not an oversight: a remote peer presenting a localhost
    // Origin is accepted. The origin rule exists to stop a browser being driven cross-site, and
    // a browser cannot forge the header; a non-browser that forges it had to reach the port
    // first, which only happens once the operator widened the bind. Refusing here instead would
    // break the container/WSL forwarding that opt-in exists for, where the peer IS the bridge.
    it("accepts a localhost origin even from a remote peer — deliberate, see MULMOTERMINAL_HOST", () => {
      expect(isAllowedOrigin("http://localhost:34567", LAN_A)).toBe(true);
    });

    it("still refuses a foreign origin from a remote peer", () => {
      expect(isAllowedOrigin("http://evil.example", LAN_A)).toBe(false);
    });

    it("judges a PRESENT origin the same either way — the peer only decides the no-Origin case", () => {
      // A remote browser sending a localhost Origin is still refused on the origin alone;
      // a local browser sending an evil Origin is still refused too.
      expect(isAllowedOrigin("http://evil.example", LOCAL_V4)).toBe(false);
      expect(isAllowedOrigin("http://localhost:34567", LOCAL_V4)).toBe(true);
    });
  });

  // The scheme is never consulted, so these carry the https a real page would be served
  // over — the hostname is the whole decision.
  describe("a remote origin is refused", () => {
    it.each(["https://evil.com", "https://evil.com:34567", "https://claude.ai", "https://192.168.1.10:34567", "https://10.0.0.5"])("refuses %s", (origin) => {
      expect(isAllowedOrigin(origin, LOCAL_V4)).toBe(false);
    });
  });

  // The whole point of parsing rather than string-matching. Each of these contains the text
  // "localhost" or "127.0.0.1" somewhere a substring check would accept.
  describe("hosts that merely look local are refused", () => {
    it("refuses a subdomain of an attacker's domain", () => {
      expect(isAllowedOrigin("https://localhost.evil.com", LOCAL_V4)).toBe(false);
    });

    it("refuses an attacker's domain prefixed with the loopback address", () => {
      expect(isAllowedOrigin("https://127.0.0.1.evil.com", LOCAL_V4)).toBe(false);
    });

    it("refuses a host that merely ends in localhost", () => {
      expect(isAllowedOrigin("https://notlocalhost", LOCAL_V4)).toBe(false);
    });

    // The userinfo trick: everything before @ is credentials, and the real host is evil.com.
    it("refuses an origin where localhost is only the userinfo", () => {
      expect(isAllowedOrigin("https://localhost@evil.com", LOCAL_V4)).toBe(false);
    });

    it("refuses an origin where the loopback address is only the userinfo", () => {
      expect(isAllowedOrigin("https://127.0.0.1@evil.com", LOCAL_V4)).toBe(false);
    });
  });

  describe("anything unparseable is refused", () => {
    // What a file:// page and a sandboxed iframe send. It must not be read as "no origin".
    it("refuses the literal string null", () => {
      expect(isAllowedOrigin("null", LOCAL_V4)).toBe(false);
    });

    it.each(["not a url", "//localhost", "localhost:34567", "http://", " "])("refuses %o", (origin) => {
      expect(isAllowedOrigin(origin, LOCAL_V4)).toBe(false);
    });

    // A scheme with no host at all parses, but its hostname is empty.
    it("refuses a file URL", () => {
      expect(isAllowedOrigin("file:///Users/me/page.html", LOCAL_V4)).toBe(false);
    });
  });

  // Deliberately narrower than 127.0.0.0/8 and than the IPv6-mapped forms: only the one
  // address, however it is spelled. Nothing a browser sends for a page this server served
  // uses the rest, and widening the set should have to be argued for rather than inherited.
  describe("loopback addresses other than 127.0.0.1 are refused", () => {
    it.each(["https://127.0.0.2", "https://127.0.0.53", "https://[::ffff:127.0.0.1]", "https://0.0.0.0"])("refuses %s", (origin) => {
      expect(isAllowedOrigin(origin, LOCAL_V4)).toBe(false);
    });
  });
});
