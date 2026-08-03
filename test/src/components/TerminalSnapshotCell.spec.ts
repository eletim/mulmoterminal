import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TerminalSnapshotCell from "../../../src/components/TerminalSnapshotCell.vue";
import type { TerminalSnapshotState } from "../../../src/composables/useTerminalSnapshots";
import type { TerminalSessionSummary } from "../../../common/terminalView";

const summary: TerminalSessionSummary = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  title: "Shared terminal",
  cwd: "/repo",
  live: true,
  agent: "shell",
  resume: { kind: "launcher", shell: true },
};

const snapshot = (over: Partial<TerminalSnapshotState> = {}): TerminalSnapshotState => ({
  screen: "hello",
  meta: { cwd: "/repo", branch: "main", memo: "note", summary: "summary", prompt: "prompt" },
  loading: false,
  error: null,
  notFound: false,
  stale: false,
  updatedAt: 1,
  inFlight: false,
  generation: 1,
  ...over,
});

describe("TerminalSnapshotCell", () => {
  it("renders screen as plain selectable text and never creates inputs/contenteditable", () => {
    const wrapper = mount(TerminalSnapshotCell, {
      props: { summary, snapshot: snapshot({ screen: "<b>not html</b>" }) },
    });

    expect(wrapper.find("[data-testid='terminal-snapshot-screen']").text()).toBe("<b>not html</b>");
    expect(wrapper.find("b").text()).not.toBe("not html");
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find("[contenteditable]").exists()).toBe(false);
  });

  it("emits hide and displays stale/error/loading states with metadata", async () => {
    const wrapper = mount(TerminalSnapshotCell, {
      props: { summary, snapshot: snapshot({ screen: "old", stale: true, error: "HTTP 500" }) },
    });

    expect(wrapper.text()).toContain("main");
    expect(wrapper.text()).toContain("note");
    expect(wrapper.text()).toContain("stale");
    expect(wrapper.text()).toContain("HTTP 500");
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("hide")?.[0]).toEqual([summary.id]);

    await wrapper.setProps({ snapshot: snapshot({ screen: null, loading: true }) });
    expect(wrapper.get("[data-testid='terminal-snapshot-empty']").text()).toBe("loading");
  });
});
