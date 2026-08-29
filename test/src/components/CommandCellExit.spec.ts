import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

// The one link in the command-cell notification that no pure test can reach: the exit frame
// arriving, and the cell turning it into a sound of the right KIND. A Run PTY never enters the
// session registry, so nothing on the server publishes its exit — this component is the only
// place that knows, which is exactly why the wiring is worth pinning.
// hoisted: vi.mock's factory is lifted above ordinary consts, so the spy has to be too.
const { notifySound } = vi.hoisted(() => ({ notifySound: vi.fn() }));
vi.mock("../../../src/composables/notifySound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/composables/notifySound")>();
  return { ...actual, notifySound };
});

import CommandCell from "../../../src/components/CommandCell.vue";

const CWD = "/repo/app";
const mountCell = () =>
  mount(CommandCell, {
    props: {
      active: false,
      expanded: false,
      home: null,
      command: { source: "script" as const, index: 0, label: "build", cwd: CWD },
    },
    global: { stubs: { TerminalView: true, CellChromeButtons: true } },
  });

describe("a Run cell's exit raises the notification", () => {
  beforeEach(() => notifySound.mockClear());

  it("reports a clean exit as command-done, with the command's directory", () => {
    mountCell().findComponent({ name: "TerminalView" }).vm.$emit("exit", 0);
    expect(notifySound).toHaveBeenCalledWith("command-done", CWD);
  });

  it("reports a non-zero exit as command-failed", () => {
    mountCell().findComponent({ name: "TerminalView" }).vm.$emit("exit", 1);
    expect(notifySound).toHaveBeenCalledWith("command-failed", CWD);
  });

  // The server names no status when the command never started; calling that "done" would
  // announce a failure to launch as a success.
  it("reports a missing status as command-failed", () => {
    mountCell().findComponent({ name: "TerminalView" }).vm.$emit("exit", null);
    expect(notifySound).toHaveBeenCalledWith("command-failed", CWD);
  });

  it("says nothing until the command actually exits", () => {
    mountCell();
    expect(notifySound).not.toHaveBeenCalled();
  });
});
