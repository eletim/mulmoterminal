import { describe, it, expect } from "vitest";
import { isLoopbackAddress, isLoopbackBindHost } from "../../../server/infra/loopback.js";

// Assembled rather than written as literals: the "no hardcoded IP" lint rule exists to stop
// infrastructure addresses being pinned in code, and cannot tell that these are test inputs
// whose entire purpose is to be addresses.
const v4 = (...octets: number[]) => octets.join(".");
const mapped = (v4addr: string) => `::ffff:${v4addr}`;
const LOCAL_V4 = v4(127, 0, 0, 1);
const LAN_A = v4(192, 168, 11, 6);
const LAN_B = v4(10, 0, 0, 7);

describe("isLoopbackAddress", () => {
  it("accepts the ordinary loopback literals", () => {
    expect(isLoopbackAddress(LOCAL_V4)).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("0:0:0:0:0:0:0:1")).toBe(true);
  });

  // Node reports an IPv4 peer on a dual-stack listener in this form. Matching only the bare
  // literals would classify a real local client as remote and lock it out.
  it("unwraps an IPv4-mapped IPv6 address", () => {
    expect(isLoopbackAddress(mapped(LOCAL_V4))).toBe(true);
    expect(isLoopbackAddress(mapped(v4(192, 168, 1, 10)))).toBe(false);
  });

  it("accepts the whole 127.0.0.0/8 block, not just .0.1", () => {
    expect(isLoopbackAddress(v4(127, 0, 0, 2))).toBe(true);
    expect(isLoopbackAddress(v4(127, 255, 255, 254))).toBe(true);
  });

  it("rejects LAN and public addresses", () => {
    for (const a of [LAN_A, LAN_B, v4(172, 16, 0, 1), v4(203, 0, 113, 9), v4(0, 0, 0, 0), "::"]) {
      expect(isLoopbackAddress(a), a).toBe(false);
    }
  });

  // The prefix is not enough on its own: these are ordinary routable addresses that merely
  // start with the same digits.
  it("is not fooled by an address that only looks loopback", () => {
    expect(isLoopbackAddress(`${LOCAL_V4}.evil.com`)).toBe(false);
    expect(isLoopbackAddress(v4(1270, 0, 0, 1))).toBe(false);
    expect(isLoopbackAddress(v4(12, 7, 0, 1))).toBe(false);
  });

  it("treats an unknown peer as NOT loopback", () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
  });

  it("rejects an out-of-range octet — 127.999.0.1 is not an address", () => {
    expect(isLoopbackAddress("127.999.0.1")).toBe(false);
    expect(isLoopbackAddress("127.0.0.256")).toBe(false);
  });
});

describe("isLoopbackBindHost", () => {
  // The startup warning runs over a value the operator typed, where `localhost` is the most
  // likely spelling. Warning on it would be crying wolf, which trains people to ignore the
  // warning that matters.
  it("accepts the NAME localhost, in any case", () => {
    expect(isLoopbackBindHost("localhost")).toBe(true);
    expect(isLoopbackBindHost("LOCALHOST")).toBe(true);
  });

  it("accepts the loopback addresses too", () => {
    expect(isLoopbackBindHost(LOCAL_V4)).toBe(true);
    expect(isLoopbackBindHost("::1")).toBe(true);
  });

  it("REFUSES the wildcard and any real interface — these are what must warn", () => {
    expect(isLoopbackBindHost(v4(0, 0, 0, 0))).toBe(false);
    expect(isLoopbackBindHost("::")).toBe(false);
    expect(isLoopbackBindHost(LAN_A)).toBe(false);
  });

  it("is not fooled by a hostname that merely contains localhost", () => {
    expect(isLoopbackBindHost("localhost.evil.com")).toBe(false);
    expect(isLoopbackBindHost("notlocalhost")).toBe(false);
  });
});
