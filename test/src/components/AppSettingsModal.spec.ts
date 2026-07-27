import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import AppSettingsModal from "../../../src/components/AppSettingsModal.vue";

// Only the props reaching the modal matter here; the modal itself is covered by its own spec.
vi.mock("../../../src/components/SettingsModal.vue", () => ({
  default: { name: "SettingsModal", props: ["dirPaths", "cwd", "sessionId"], template: "<div />" },
}));

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

const dirPaths = (props: Record<string, unknown>) => mount(AppSettingsModal, { props }).findComponent({ name: "SettingsModal" }).props("dirPaths");

describe("AppSettingsModal", () => {
  // The regression this exists for: `presets` is a PER-CALL ref inside useAppConfig, so reading
  // it here instead of taking it from the shell yielded a permanently empty list — which the
  // preview showed as "no directories yet" on a machine with plenty of them.
  it("lists the shell's recent directories", () => {
    const presets = [
      { label: "a", path: "/proj/a" },
      { label: "b", path: "/proj/b" },
    ];
    expect(dirPaths({ presets })).toEqual(["/proj/a", "/proj/b"]);
  });

  it("puts the focused session's directory first when it isn't a recent one yet", () => {
    expect(dirPaths({ cwd: "/proj/new", presets: [{ label: "a", path: "/proj/a" }] })).toEqual(["/proj/new", "/proj/a"]);
  });

  it("doesn't list the focused directory twice when it is already a recent one", () => {
    expect(dirPaths({ cwd: "/proj/a", presets: [{ label: "a", path: "/proj/a" }] })).toEqual(["/proj/a"]);
  });

  // The grid opens this with no cwd at all.
  it("is empty when the shell has neither", () => {
    expect(dirPaths({})).toEqual([]);
  });
});
