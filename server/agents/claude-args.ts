// Pure builder for the `claude` CLI argv. Kept separate so the exact flag set —
// especially the GUI-MCP / --strict-mcp-config switch — is unit-testable without
// spawning a PTY.
import { SESSION_SUMMARY_PROMPT } from "./session-summary-prompt.js";
import { prClonePrompt } from "./pr-clone-prompt.js";

export interface ClaudeArgsInput {
  sessionId: string;
  resume: string | null;
  // Whether the requested session has an on-disk transcript to --resume. When
  // false we start fresh, reusing the id via --session-id.
  canResume: boolean;
  settings: string; // hook settings JSON (--settings)
  permissionMode: string; // --permission-mode
  // true  (single view): attach the in-process GUI MCP, auto-allow its tools, and
  //        isolate to it with --strict-mcp-config (main's classic behavior).
  // false (grid dev terminal): no GUI MCP and no --strict-mcp-config, so the user's
  //        + project's MCP servers load normally.
  attachGuiMcp: boolean;
  mcpConfig: string; // GUI MCP config JSON (--mcp-config), used only when attachGuiMcp
  guiMcpTools: string; // comma-joined GUI tool names (--allowedTools), used only when attachGuiMcp
  // What this session runs (#579): an alias (sonnet/opus/haiku) or a backend's own model
  // name. Null leaves the choice to Claude Code. `--model` outranks both the settings
  // `model` key and ANTHROPIC_MODEL, so it is the one place the decision has to be made.
  model?: string | null;
  // Extra directories the session may read/edit (#908). Absolute, existing, deduped by the
  // config layer — this builder only places them.
  addDirs?: string[] | null;
  // The `work in <clone>` line a PR this session opens should end with, or null when the
  // directory is not a repo / the footer is switched off. Resolved by the caller because the
  // right answer is the MAIN checkout, which an agent asked to work it out would get wrong
  // inside a managed worktree.
  workdirFooter?: string | null;
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const guiArgs = ["--permission-mode", input.permissionMode];
  // Inline, not --append-system-prompt-file: the sandbox spawn runs in a container that cannot
  // read a host path, which is why --settings is already passed inline too. A prompt this size
  // is nowhere near the tmux arg limit that forced the seed prompt out of the argv (#942).
  // One flag, two sections: `--append-system-prompt` given twice would leave which one wins up
  // to the CLI, and the two texts are independent enough to simply concatenate.
  const appended = input.workdirFooter ? `${SESSION_SUMMARY_PROMPT}\n\n${prClonePrompt(input.workdirFooter)}` : SESSION_SUMMARY_PROMPT;
  guiArgs.push("--append-system-prompt", appended);
  if (input.model) guiArgs.push("--model", input.model);
  if (input.attachGuiMcp) {
    guiArgs.push("--mcp-config", input.mcpConfig, "--strict-mcp-config", "--allowedTools", input.guiMcpTools);
  }
  // LAST, and one flag for the whole list: `--add-dir` is variadic (`<directories...>`), so a
  // flag placed after it would be fine but a VALUE would be swallowed. Keeping it at the end
  // means nothing can ever follow it.
  if (input.addDirs?.length) guiArgs.push("--add-dir", ...input.addDirs);

  // No initial-prompt positional: an auto-run prompt is TYPED into the input box after
  // claude is ready (see spawnClaudePty), not passed as an arg — a large prompt as a
  // tmux `new-session` command arg overflows tmux's length limit ("command too long").
  return input.canResume && input.resume !== null
    ? ["--resume", input.resume, "--settings", input.settings, ...guiArgs]
    : ["--session-id", input.sessionId, "--settings", input.settings, ...guiArgs];
}
