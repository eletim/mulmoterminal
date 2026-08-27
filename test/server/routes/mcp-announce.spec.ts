// @vitest-environment node
// What an MCP session's URL tells us about it, and when that is announced.
//
// The tools pane asks what a session has while the agent is still being spawned, so its first
// answer is empty; the first-contact announcement is what tells it to ask again. Which groups the
// session has is the separate question, and both URLs answer it now: one group for a group URL,
// every group for the all-tools one it can only have been given by --mcp-config.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
const { mountMcpRoutes, TOOL_GROUPS_CHANNEL } = await import("../../../server/routes/mcp-routes.js");
const { TOOL_GROUPS } = await import("../../../common/toolGroups.js");

const capabilities = new Map<string, { groups: Set<(typeof TOOL_GROUPS)[number]>; allTools: boolean }>();

const published: { channel: string; data: Record<string, unknown> }[] = [];
const app = express();
app.use(express.json());
mountMcpRoutes(app, {
  publish: (channel, data) => void published.push({ channel, data: data as Record<string, unknown> }),
  guiCallHistory: async () => null,
  isInternalSession: async () => false,
  learnGuiCapabilities: async (id, groups, allTools) => {
    const current = capabilities.get(id) ?? { groups: new Set(), allTools: false };
    const before = current.groups.size;
    for (const group of groups) current.groups.add(group);
    const changed = current.groups.size !== before || (allTools && !current.allTools);
    current.allTools ||= allTools;
    capabilities.set(id, current);
    return { groups: [...current.groups], changed };
  },
});

// A tools/list, the cheapest real MCP request: it needs no plugin dispatch, so nothing here
// depends on a running host.
const call = (route: string) =>
  request(app).post(route).set("accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

const announcementsFor = (id: string) => published.filter((p) => p.channel === TOOL_GROUPS_CHANNEL && p.data.sessionId === id);

beforeEach(() => {
  published.length = 0;
  capabilities.clear();
});

describe("MCP first-contact announcement", () => {
  it("announces first contact with no `groups` key at all", async () => {
    const id = randomUUID();
    await call(`/api/mcp/${id}`);
    const bare = announcementsFor(id).filter((p) => !("groups" in p.data));
    expect(bare).toHaveLength(1);
    // Undefined and `[]` are different answers downstream: a consumer reading a missing field as
    // an empty list would tell a cell that can draw that it cannot. Only a message that actually
    // carries groups says anything about them.
    expect(bare[0].data).toEqual({ sessionId: id });
  });

  it("reports EVERY group for an all-tools session", async () => {
    // This URL comes from --mcp-config and nowhere else, so reaching it is proof the session
    // carries the whole GUI MCP. Announcing no groups was right while only the single view used
    // it; a programmatically started chat is spawned the same way and then adopted as a grid
    // cell, where "no groups" is read as "no Canvas" — for a session holding every drawing tool.
    const id = randomUUID();
    await call(`/api/mcp/${id}`);
    const withGroups = announcementsFor(id).filter((p) => Array.isArray(p.data.groups));
    expect(withGroups).toHaveLength(1);
    expect([...(withGroups[0].data.groups as string[])].sort()).toEqual([...TOOL_GROUPS].sort());
  });

  it("announces once per session, not once per tool call", async () => {
    const id = randomUUID();
    await call(`/api/mcp/${id}`);
    await call(`/api/mcp/${id}`);
    await call(`/api/mcp/${id}`);
    // One first-contact and one groups message, from the first call only: a server is built per
    // request, so anything not guarded on the transition would republish on every tool call.
    expect(announcementsFor(id)).toHaveLength(2);
  });

  it("still announces the learned groups for a grid cell's group url", async () => {
    const id = randomUUID();
    await call(`/api/mcp/render/${id}`);
    expect(announcementsFor(id).some((p) => Array.isArray(p.data.groups) && (p.data.groups as string[]).includes("render"))).toBe(true);
  });

  // The other fact this url proves, and it is NOT the group list. Only a session handed the url
  // by --mcp-config can reach it, so it carries the tools that belong to no group and are
  // therefore reachable through no group url — spawnBackgroundChat. A directory that registered
  // all four group urls has every group and none of those.
  it("records that the session carries the WHOLE GUI MCP, not just four groups", async () => {
    const id = randomUUID();
    expect(capabilities.get(id)?.allTools ?? false).toBe(false);
    await call(`/api/mcp/${id}`);
    expect(capabilities.get(id)?.allTools).toBe(true);
  });

  it("does NOT record it for a group url", async () => {
    const id = randomUUID();
    await call(`/api/mcp/render/${id}`);
    await call(`/api/mcp/data/${id}`);
    expect(capabilities.get(id)?.allTools).toBe(false);
  });

  it("says nothing for a malformed session id", async () => {
    await call("/api/mcp/not-a-uuid");
    expect(published).toHaveLength(0);
  });
});
