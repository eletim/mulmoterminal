// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { needsSameOrigin, requestOriginAllowed, sameOriginGuard } from "../../../server/routes/same-origin-guard.js";

describe("needsSameOrigin", () => {
  it("gates every state-changing method", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post", "delete"]) {
      expect(needsSameOrigin(m, "/api/config"), m).toBe(true);
    }
  });

  // Safe methods change nothing, and gating them would break the <img>/<video> loads that
  // cannot send an Authorization header.
  // Pinned so the reason survives: gating GETs would not stop a cross-site <img>, which sends
  // no Origin at all, and would break the media loads that cannot send a header. The guarantee
  // that a GET is harmless has to come from the routes, not from here.
  it("leaves safe methods alone", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(needsSameOrigin(m, "/api/config"), m).toBe(false);
    }
  });

  it("has no feature-specific bypasses", () => {
    expect(needsSameOrigin("PUT", "/api/files/browse/text")).toBe(true);
    expect(needsSameOrigin("POST", "/api/plugin/spawnBackgroundChat")).toBe(true);
  });
});

describe("sameOriginGuard", () => {
  const run = (method: string, path: string, allowed: boolean) => {
    const next = vi.fn() as unknown as NextFunction;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })), json } as unknown as Response;
    const req = { method, path, headers: { origin: "http://evil.example" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
    sameOriginGuard(() => allowed)(req, res, next);
    return { next, res, json };
  };

  it("passes a request the predicate allows", () => {
    const { next, res } = run("POST", "/api/config", true);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a state-changing request the predicate refuses", () => {
    const { next, res } = run("POST", "/api/config", false);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("lets a safe method through even when the predicate would refuse", () => {
    const { next } = run("GET", "/api/config", false);
    expect(next).toHaveBeenCalledOnce();
  });

  it("hands the predicate both the origin and the peer", () => {
    const predicate = vi.fn(() => true);
    const req = {
      method: "POST",
      path: "/api/config",
      headers: { origin: "http://localhost:1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
    sameOriginGuard(predicate)(req, {} as Response, vi.fn() as unknown as NextFunction);
    expect(predicate).toHaveBeenCalledWith("http://localhost:1", "127.0.0.1");
  });
});

// The per-route form. Its whole reason for existing is that the safe-method exemption must travel
// with the rule: #1094 was two routes that guarded a GET by calling the predicate themselves, and
// a browser sends no Origin on a same-origin GET — so they refused the page from the very origin
// MULMOTERMINAL_ALLOWED_ORIGINS had just named.
describe("requestOriginAllowed", () => {
  // Assembled rather than written as a literal, as in loopback.spec.ts: the "no hardcoded IP"
  // lint rule cannot tell an infrastructure address from a test input that has to be one.
  const LAN_PEER = [10, 0, 0, 50].join(".");
  const request = (method: string, path: string): Request =>
    ({ method, path, headers: { origin: "http://evil.example" }, socket: { remoteAddress: LAN_PEER } }) as unknown as Request;
  const refuseEverything = () => false;

  it("allows a safe method without consulting the predicate", () => {
    const predicate = vi.fn(refuseEverything);
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(requestOriginAllowed(request(m, "/api/mobile-mode"), predicate), m).toBe(true);
    }
    expect(predicate).not.toHaveBeenCalled();
  });

  it("still asks the predicate for a state-changing method", () => {
    expect(requestOriginAllowed(request("POST", "/api/mobile/terminal-input"), refuseEverything)).toBe(false);
    expect(requestOriginAllowed(request("POST", "/api/mobile/terminal-input"), () => true)).toBe(true);
  });

  it("hands the predicate both the origin and the peer", () => {
    const predicate = vi.fn(() => true);
    requestOriginAllowed(request("POST", "/api/config"), predicate);
    expect(predicate).toHaveBeenCalledWith("http://evil.example", LAN_PEER);
  });
});
