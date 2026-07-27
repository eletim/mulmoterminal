import { describe, it, expect } from "vitest";
import { dirConfigRows, parseDirConfigDetail } from "../../../src/components/dirConfigDetail";

describe("dirConfigRows", () => {
  it("has no rows for a directory that configured nothing", () => {
    expect(dirConfigRows({})).toEqual([]);
    expect(dirConfigRows(null)).toEqual([]);
  });

  it("lists only what is set, name first and colours in the order the eye meets them", () => {
    const rows = dirConfigRows({ name: "proj", badgeColor: "#445566", headerColor: "#112233", fontSize: 14 });
    expect(rows.map((r) => r.key)).toEqual(["name", "headerColor", "badgeColor", "fontSize"]);
    expect(rows.map((r) => r.value)).toEqual(["proj", "#112233", "#445566", "14px"]);
  });

  // The swatch is drawn off `color`; a non-colour row must not get one, or the preview would
  // paint a box from a font name.
  it("marks colour rows as colours and leaves the rest without one", () => {
    const rows = dirConfigRows({ headerColor: "#112233", fontFamily: "'Cica', monospace" });
    expect(rows.find((r) => r.key === "headerColor")?.color).toBe("#112233");
    expect(rows.find((r) => r.key === "fontFamily")?.color).toBeNull();
  });

  it("summarises the palette by count rather than listing xterm's keys", () => {
    expect(dirConfigRows({ colors: { background: "#000", foreground: "#fff" } })[0]).toEqual({
      key: "colors",
      label: "Palette overrides",
      value: "2 colours",
      color: null,
    });
    expect(dirConfigRows({ colors: { background: "#000" } })[0]?.value).toBe("1 colour");
  });

  // Priority 0 is a real rank (it sorts first) — dropping it as falsy would hide the setting
  // from the one screen meant to explain where a cell's position comes from.
  it("keeps a zero grid priority", () => {
    expect(dirConfigRows({ orderPriority: 0 })[0]?.value).toBe("0");
  });

  it("reports a configured sound without exposing its path", () => {
    expect(dirConfigRows({ hasSound: true })[0]?.label).toBe("Attention sound");
    expect(dirConfigRows({ hasSound: false })).toEqual([]);
  });
});

describe("parseDirConfigDetail", () => {
  it("reads a full response", () => {
    const view = parseDirConfigDetail({
      file: "/proj/.mulmoterminal.json",
      config: { name: "proj" },
      source: { applied: ["name"], ignored: ["cellColor"], unknown: ["badgeColour"] },
    });
    expect(view.file).toBe("/proj/.mulmoterminal.json");
    expect(view.rows.map((r) => r.key)).toEqual(["name"]);
    expect(view.source).toEqual({ applied: ["name"], ignored: ["cellColor"], unknown: ["badgeColour"] });
  });

  // The wire is a trust boundary like every other parser here: a shape the server would never
  // send must leave the preview empty rather than reaching the template.
  it("falls back to an empty view for anything unexpected on the wire", () => {
    expect(parseDirConfigDetail(null)).toEqual({ file: null, rows: [], source: { applied: [], ignored: [], unknown: [] } });
    expect(parseDirConfigDetail({ file: 7, config: "nope", source: { applied: "name" } })).toEqual({
      file: null,
      rows: [],
      source: { applied: [], ignored: [], unknown: [] },
    });
  });

  it("keeps only the string entries of a key list", () => {
    expect(parseDirConfigDetail({ source: { ignored: ["cellColor", 3, null] } }).source.ignored).toEqual(["cellColor"]);
  });
});
