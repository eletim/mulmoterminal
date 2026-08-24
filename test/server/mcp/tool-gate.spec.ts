// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  offeredTools,
  routeToolCall,
  describeTool,
  SUBMIT_TRANSLATION_TOOL_NAME,
  type PluginToolDefinition,
  type OfferedTool,
} from "../../../server/mcp/tool-gate.js";

const WORKER_TOOL: OfferedTool = {
  name: SUBMIT_TRANSLATION_TOOL_NAME,
  description: "Report the finished translation.",
  inputSchema: { type: "object", properties: { translations: { type: "array" } } },
};

const PLUGINS: PluginToolDefinition[] = [
  { name: "presentHtml", description: "Show an HTML artifact.", prompt: "Prefer this over printing HTML.", parameters: { type: "object" } },
  { name: "generateImage", description: "Generate an image.", parameters: { type: "object" } },
  { name: "spawnBackgroundChat", description: "Start another session." },
];

const names = (tools: OfferedTool[]) => tools.map((tool) => tool.name);

describe("translation worker tool gate", () => {
  it("offers and accepts only submitTranslation for a worker", () => {
    expect(offeredTools(true, PLUGINS, WORKER_TOOL)).toEqual([WORKER_TOOL]);
    expect(routeToolCall(SUBMIT_TRANSLATION_TOOL_NAME, true)).toEqual({ kind: "submit-translation" });
    expect(routeToolCall("presentHtml", true).kind).toBe("refused");
  });

  it("refuses submitTranslation for ordinary sessions", () => {
    expect(routeToolCall(SUBMIT_TRANSLATION_TOOL_NAME, false).kind).toBe("refused");
  });
});

describe("ordinary and grouped tool gates", () => {
  it("offers every plugin to an ordinary ungrouped session", () => {
    expect(names(offeredTools(false, PLUGINS, WORKER_TOOL))).toEqual(["presentHtml", "generateImage", "spawnBackgroundChat"]);
  });

  it("offers and dispatches only tools in the requested group", () => {
    expect(names(offeredTools(false, PLUGINS, WORKER_TOOL, "render"))).toEqual(["presentHtml"]);
    expect(names(offeredTools(false, PLUGINS, WORKER_TOOL, "media"))).toEqual(["generateImage"]);
    expect(routeToolCall("presentHtml", false, "render")).toEqual({ kind: "dispatch" });
    expect(routeToolCall("generateImage", false, "render").kind).toBe("refused");
  });

  it("dispatches plugin calls when no group is given", () => {
    expect(routeToolCall("presentHtml", false)).toEqual({ kind: "dispatch" });
    expect(routeToolCall("anything-at-all", false)).toEqual({ kind: "dispatch" });
  });
});

describe("describeTool", () => {
  it("folds prompt text into the description", () => {
    expect(describeTool({ name: "x", description: "What it does.", prompt: "When to use it." })).toBe("What it does.\n\nWhen to use it.");
  });
});
