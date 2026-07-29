import { describe, it, expect } from "vitest";
import { skillSeed } from "../../../src/components/skillSeed.js";
import { BUNDLED_SKILL_NAMES, DIR_CONFIG_SKILL } from "../../../common/bundledSkills.js";

describe("skillSeed", () => {
  it("uses claude's /<slug> command for claude", () => {
    expect(skillSeed("mulmoterminal-config", "claude")).toBe("/mulmoterminal-config");
  });

  it("names the skill in natural language for codex (no slash command)", () => {
    expect(skillSeed("mulmoterminal-config", "codex")).toBe('Use the "mulmoterminal-config" skill.');
    // Claude is the exception, not the rule: an agent without slash commands gets the sentence.
    expect(skillSeed("mulmoterminal-config", "antigravity")).toBe('Use the "mulmoterminal-config" skill.');
  });
});

// Settings' "Configure appearance…" is answered by BOTH the grid and the single view, and the slug
// used to be written out in each. One rename updated only one of them, so the same button launched
// a different skill depending on which view you pressed it from — green everywhere, since each
// half was self-consistent. The shared constant is the fix; this pins it to a skill that ships.
describe("DIR_CONFIG_SKILL", () => {
  it("names a skill that is bundled", () => {
    expect(BUNDLED_SKILL_NAMES.some((name) => name === DIR_CONFIG_SKILL)).toBe(true);
  });

  it("seeds the directory skill, not the router", () => {
    expect(skillSeed(DIR_CONFIG_SKILL, "claude")).toBe("/mulmoterminal-dirs");
  });
});
