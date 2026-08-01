// Whether a configured repo can be listed, and what the row says when it cannot. The message is
// the feature: an unsupported forge used to produce an empty section with no explanation (#981).
import { describe, it, expect } from "vitest";
import { repoSupport, isSupported, repoForRemote, repoForDir } from "../../../server/git/forge-support.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { forgeFromRepoEntry } from "../../../server/git/forge-host.js";

describe("forgeFromRepoEntry", () => {
  // Every config that exists today is this form, so it has to keep meaning GitHub.
  it("reads a bare owner/repo as github.com", () => {
    expect(forgeFromRepoEntry("receptron/mulmoterminal")).toMatchObject({ host: "github.com", kind: "github", path: "receptron/mulmoterminal" });
  });

  // A leading segment with a dot is the host. GitHub user and organisation names may hold only
  // alphanumerics and hyphens, so the two forms cannot collide.
  it.each([
    ["gitlab.com/group/project", "gitlab.com", "gitlab", "group/project"],
    ["gitlab.com/group/sub/project", "gitlab.com", "gitlab", "group/sub/project"],
    ["git.example.com/team/project", "git.example.com", "unknown", "team/project"],
  ])("reads %s as a hosted entry", (entry, host, kind, path) => {
    expect(forgeFromRepoEntry(entry)).toMatchObject({ host, kind, path });
  });

  it("lower-cases a shouted host", () => {
    expect(forgeFromRepoEntry("GitLab.COM/group/project")?.host).toBe("gitlab.com");
  });

  // One segment is never a repository, whichever form it was meant to be.
  it.each([["owner"], ["gitlab.com"], [""], ["   "], ["/"]])("returns null for %s", (entry) => {
    expect(forgeFromRepoEntry(entry)).toBeNull();
  });

  // The regression Codex caught. `gh --repo` takes `[HOST/]OWNER/REPO`, so it reads `a/b/c` as
  // host `a` — if this parser called the same string a GitHub path, the config and the CLI it
  // feeds would be aiming at different servers. Ambiguous means rejected, not guessed.
  it.each([["a/b/c"], ["owner/repo/extra"], ["a/b/c/d"]])("rejects the hostless multi-segment %s", (entry) => {
    expect(forgeFromRepoEntry(entry)).toBeNull();
  });

  // The mirror of it: a dotted first segment is a host, so it needs a namespace AND a name after
  // it. `foo.bar/baz` names a host with one segment, which is not a project anywhere.
  it("rejects a host with only one segment after it", () => {
    expect(forgeFromRepoEntry("foo.bar/baz")).toBeNull();
  });

  // An empty segment must not be forgiven. The entry is stored VERBATIM and handed to `gh --repo`,
  // so a parser that quietly reads `owner//repo` as `owner/repo` accepts a string the CLI then
  // rejects — the same shape of disagreement as the hostless multi-segment case (Codex review).
  it.each([["owner//repo"], ["owner/repo/"], ["/owner/repo"], ["gitlab.com//group/project"], ["gitlab.com/group//project"]])(
    "rejects the empty segment in %s",
    (entry) => {
      expect(forgeFromRepoEntry(entry)).toBeNull();
    },
  );
});

describe("repoSupport", () => {
  it("supports a GitHub repo", () => {
    const support = repoSupport("receptron/mulmoterminal");
    expect(isSupported(support)).toBe(true);
    expect(isSupported(support) && support.forge.webUrl).toBe("https://github.com/receptron/mulmoterminal");
  });

  // The point of the change: the row says which HOST is unhandled, so the reader does not go and
  // check their repository name or their credentials — the two things a bare failure implies.
  it("names the host of a forge that is not implemented", () => {
    const support = repoSupport("gitlab.com/group/project");
    expect(isSupported(support)).toBe(false);
    expect(!isSupported(support) && support.error).toContain("gitlab.com");
    expect(!isSupported(support) && support.error).toContain("not supported yet");
  });

  it("names a self-hosted forge by its own host", () => {
    const support = repoSupport("git.example.com/team/project");
    expect(!isSupported(support) && support.error).toContain("git.example.com");
  });

  it("says what a malformed entry should look like", () => {
    const support = repoSupport("owner");
    expect(!isSupported(support) && support.error).toContain("owner/repo");
  });
});

// The dir-derived half (#981 step 2b). Five call sites each wrote
// `repoFromWebUrl(await resolveGithubUrl(dir))`, which answers null for BOTH "no remote" and "a
// remote we cannot act on" — and then reported the second as the first.
describe("repoForRemote", () => {
  it("gives the owner/repo a GitHub remote names", () => {
    expect(repoForRemote("git@github.com:receptron/mulmoterminal.git")).toMatchObject({ repo: "receptron/mulmoterminal", forge: { kind: "github" } });
  });

  // The distinction the whole step exists for: the repository is SEEN (there is a forge) but not
  // one this app can act on, so `repo` is null while the answer itself is not.
  it.each([
    ["a GitLab remote", "git@gitlab.com:group/project.git", "gitlab"],
    ["a self-hosted remote", "git@git.example.com:team/project.git", "unknown"],
  ])("reports %s as seen but not actionable", (_case, url, kind) => {
    const found = repoForRemote(url);
    expect(found).not.toBeNull();
    expect(found?.repo).toBeNull();
    expect(found?.forge.kind).toBe(kind);
  });

  // Null stays reserved for "there is nothing here to read", which is what the callers turn into
  // "no repo".
  it.each([[""], ["not a remote"]])("is null for %s", (url) => {
    expect(repoForRemote(url)).toBeNull();
  });

  // A GitHub remote pointing deeper than owner/repo still names the project, unchanged from what
  // the old helper produced.
  it("truncates a deeper GitHub path the way the previous helper did", () => {
    expect(repoForRemote("https://github.com/owner/repo/tree/main")?.repo).toBe("owner/repo");
  });
});

describe("repoForDir", () => {
  it("reads this repository's own origin", async () => {
    expect((await repoForDir(process.cwd()))?.repo).toMatch(/^[^/]+\/[^/]+$/);
  });

  it("is null for a directory with no remote", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "forge-support-"));
    try {
      expect(await repoForDir(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
