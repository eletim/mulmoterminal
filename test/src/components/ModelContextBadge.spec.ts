import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ModelContextBadge from "../../../src/components/ModelContextBadge.vue";

// Wiring only — which window a model has, and what the badge says when we cannot know, is decided
// in src/components/modelBadge.ts and tested in modelBadge.spec.ts without mounting anything.
function mountBadge(props: { agent?: "claude" | "codex"; model: string | null; contextTokens?: number }) {
  return mount(ModelContextBadge, {
    props: { agent: props.agent ?? "claude", model: props.model, contextTokens: props.contextTokens ?? 0 },
  });
}

describe("ModelContextBadge", () => {
  it("renders the badge text, with the tooltip on the same element", () => {
    const badge = mountBadge({ model: "claude-opus-4-20250514", contextTokens: 70_000 }).find('[data-testid="model-badge"]');
    expect(badge.text()).toBe("Opus · ctx 35%");
    expect(badge.attributes("title")).toContain("70,000 / 200,000 (35%)");
  });

  it("renders nothing when the model is unknown/null (no transcript model yet)", () => {
    expect(mountBadge({ model: null, contextTokens: 1000 }).find("span").exists()).toBe(false);
  });
});
