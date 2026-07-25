// Extensions a browser can only ever show as SOURCE — the code, style, config and log
// files a terminal actually prints paths to.
//
// Both sides of the file-path link decide something from this set, and the two decisions
// are different, so this is the shared CORE rather than either side's whole answer:
//   - the server serves these as text/plain so they VIEW instead of downloading
//     (backends/rawServingPlan.ts, which also covers docs, markup and dotfiles), and
//   - the client opens these in the app's own Files view instead of a new tab
//     (composables/terminalFilePathLinkProvider.ts, which also covers .txt).
// Each side adds its own extras next to its import; anything that belongs to only one of
// them does NOT belong here.
export const SOURCE_CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".hpp",
  ".cs",
  ".php",
  ".swift",
  ".scala",
  ".lua",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".xml",
  ".jsonc",
  ".log",
  ".diff",
  ".patch",
] as const;
