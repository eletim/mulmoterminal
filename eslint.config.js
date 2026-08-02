import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import sonarjs from "eslint-plugin-sonarjs";
import security from "eslint-plugin-security";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...pluginVue.configs["flat/recommended"],
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
      // Components are styled with Tailwind utilities (docs/styling.md) so the styling
      // travels with the markup. A <style> block is the exception, not the default —
      // add the file to the allowlist below WITH a reason rather than disabling inline.
      "vue/no-restricted-block": [
        "error",
        {
          element: "style",
          message:
            "Use Tailwind utilities (see docs/styling.md). If this genuinely can't be a utility, add the file to the scoped-CSS allowlist in eslint.config.js with a reason.",
        },
      ],
    },
  },
  {
    // Scoped-CSS allowlist. Each entry is something Tailwind utilities cannot express;
    // keep the reason current, and delete the entry when the reason goes away.
    files: [
      "src/components/Sidebar.vue", //            @keyframes — the "thinking" spinner ring
      "src/components/SessionTabBar.vue", //      @keyframes — the same spinner
      "src/components/Terminal.vue", //           @keyframes — the voice button's pulse / spin
      "src/components/TerminalGrid.vue", //       parent-state x descendant layout machine + FLIP @keyframes
      "src/components/GuiPanel.vue", //           `.frame + .frame` sibling-combinator spacing
      "src/components/WikiPageView.vue", //       :deep into v-html markdown
      "src/components/WikiBrowseOverlay.vue", //  :deep into v-html lint output
      "src/components/FilesOverlay.vue", //       :deep into CodeMirror's injected root
      "src/components/ToolbarPopover.vue", //     shared popover chrome import
    ],
    rules: { "vue/no-restricted-block": "off" },
  },
  {
    files: ["server/**/*.{js,mjs}", "bin/**/*.js", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The launcher's job is to run the user's installed CLIs — claude, gh, tmux,
    // codex, git — which have no portable absolute path and are found on PATH by
    // design. no-os-command-from-path fights that premise on every spawn, so it
    // is off here rather than suppressed inline at each call.
    files: ["bin/**/*.js"],
    rules: {
      "sonarjs/no-os-command-from-path": "off",
    },
  },
  {
    // Complexity / size guards. Cognitive complexity is already covered by sonarjs
    // (error@15). All ERRORS (enforced going forward) except max-params, which stays WARN
    // for its one intentional offender: spawnClaudePty's 7 params (hot path, not worth
    // churning 5 call sites into an options object) — flip it to error once resolved.
    //
    // max-lines is per FILE and was the gap: the per-function guards were all passing while
    // TerminalCell.vue reached 2000 lines, because nothing was watching the file. Counted
    // without comments, which is why the three heavily-documented 800+ line files
    // (useTerminalConnections.ts, server/index.ts, collections.ts) are already under it —
    // long because they explain themselves, not because they do too much.
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["warn", 6],
      "max-nested-callbacks": ["error", 4],
    },
  },
  {
    // no-redundant-optional assumes `?: T` already admits undefined, so `?: T | undefined`
    // says nothing new. Every tsconfig here sets exactOptionalPropertyTypes, which makes the
    // two DIFFERENT types — `?: T` forbids the key from holding undefined — so the rule's
    // premise no longer holds and it flags the only way to spell "undefined is a valid value".
    // Turn it back on if the flag ever comes off.
    rules: {
      "sonarjs/no-redundant-optional": "off",
    },
  },
  {
    // `const { secret, ...rest } = obj` is how you drop a field by construction —
    // the named siblings are the point, not dead code. Scoped to where the
    // typescript-eslint rule owns unused-vars; plain .js keeps the plugin default.
    files: ["**/*.{ts,tsx,mts,cts}", "**/*.vue"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // `as` casts, which CLAUDE.md forbids ("MUST use type guards instead") and nothing was
    // enforcing — so they accumulated to 90 in the app while the rule existed only on paper.
    // A cast asserts a type the compiler could not prove; a type guard PROVES it, and the
    // difference shows up at runtime, on the data you least control.
    //
    // ERROR since #1231 finished: the 149 assertions the app started with are gone, and the
    // allowlist below is the only way to keep one — with a reason, since inline eslint-disable is
    // forbidden and hides the debt at the scene.
    files: ["**/*.{ts,tsx,mts,cts}", "**/*.vue"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  {
    // Type-aware lint, on the APP ONLY — the two promise rules from #1301's sibling (#1300).
    //
    // Scoped to server/src/common rather than everything: the type program is the whole cost of
    // this pass, so keeping tests out of it keeps that program smaller. WARN, not error, for the
    // same reason #1231 started at warn — the count stays visible without CI going red while the
    // real ones are read one at a time.
    //
    // Only these two: they catch things NO syntactic rule can. A missing `await` makes a rejection
    // vanish and the call look like it succeeded; an async callback handed to an API that ignores
    // the returned promise does the same. The `no-unsafe-*` family is the rest of #1300 and is a
    // separate piece of work — 139 findings that mostly say "this is untyped", not "this is wrong".
    //
    // .ts only. A .vue file needs vue-eslint-parser as the PARSER (with tseslint.parser underneath
    // for the script block), and pointing tseslint.parser straight at one fails to parse the SFC.
    // Wiring type info through the Vue block is its own change; the promise mistakes this catches
    // live in the composables and the server either way.
    files: ["server/**/*.ts", "src/**/*.ts", "common/**/*.ts"],
    // Specs are out, as #1300 asks: they are not in either project, so the parser cannot place
    // them — and keeping them out is what keeps the type program small.
    ignores: ["**/*.spec.ts", "**/*.test.ts"],
    languageOptions: {
      parser: tseslint.parser,
      // Explicit projects, not `projectService: true`: the root tsconfig.json references only
      // app and node, so the service could not place any server/** file and reported 321 parse
      // errors. Naming both projects is what actually covers the code these rules are for.
      parserOptions: { project: ["./tsconfig.app.json", "./tsconfig.server.json"], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      // Type-aware sonarjs rules that were ALREADY configured as errors and never ran, because
      // nothing built a type program until this block did. Turning them on is not what this change
      // is for, and 30 findings would hide the promise ones — so they are visible at warn and get
      // read in #1300 with the rest of the type-aware pass. They were never enforced, so this
      // takes nothing away.
      "sonarjs/different-types-comparison": "warn",
      "sonarjs/deprecation": "warn",
      "sonarjs/no-alphabetical-sort": "warn",
      "sonarjs/void-use": "warn",
      "sonarjs/function-return-type": "warn",
      "sonarjs/reduce-initial-value": "warn",
      "sonarjs/no-selector-parameter": "warn",
      "sonarjs/no-misleading-array-reverse": "warn",
    },
  },
  {
    // Type-assertion allowlist. Every entry is a place where NO amount of local typing can
    // express the truth, because the type that is wrong belongs to someone else. Each says which
    // upstream and what would remove it — delete the entry when that lands.
    //
    // Nothing here is "we could not be bothered": a host-side fix was written and merged for the
    // one case that had one (mulmoclaude#2721 widened `modalTeleportTarget`, and the assertion it
    // forced is gone from this repo as of collection-plugin 1.2.3).
    files: [
      // @modelcontextprotocol/sdk declares `class StreamableHTTPServerTransport implements
      // Transport` while typing that class's onclose/onerror/onmessage accessors `T | undefined`
      // where Transport spells them `?: T`. Under exactOptionalPropertyTypes the class therefore
      // fails the interface it claims to implement. Upstream issue (open, and it names this exact
      // workaround): https://github.com/modelcontextprotocol/typescript-sdk/issues/2083
      "server/routes/mcp-routes.ts",
      // gui-chat-protocol declares `dispatch<T = unknown>(args): Promise<T>` and
      // `subscribe<T>(name, handler: (payload: T) => void)`. The PLUGIN chooses T and the HOST has
      // to produce it from an untyped response / channel frame — unverifiable by construction, so
      // any implementation asserts. (The same shape in OUR OWN generics — wikiApi's getJson,
      // useSessionFeed, postConfigField — was fixed by taking a reader from the caller; that is
      // not open here, because changing the protocol's signatures breaks every plugin that
      // annotates its handler.) Moving the assertion onto the payload (`handler(data as T)`)
      // relocates it rather than removing it, so it stays where the unprovable claim is made.
      "src/composables/pluginRuntime.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    // Tests may build values the types forbid on purpose: a malformed payload to prove the
    // parser rejects it, a partial stub standing in for a big interface. Asserting there is
    // the point of the test, not a hole in the app.
    files: ["**/*.spec.{ts,tsx,js}", "**/*.test.{ts,tsx,js}", "test/**/*.{ts,tsx,js}"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    // Test files: a describe/it suite is one big (nested) callback by design, so the
    // length + callback-nesting guards are noise here. Keep the logic-complexity guards on.
    files: ["**/*.spec.{ts,js}", "**/*.test.{ts,js}"],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      // The FILE limit still applies here, but as a warning: a 1900-line spec is worth
      // seeing, and yet splitting one moves assertions away from each other — the same
      // trade-off the paragraph below describes for stubs. Warn says so without making a
      // long-standing spec block anyone's CI.
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
      // Same reasoning for components: a spec defines throwaway stubs next to the case that
      // uses them (useCaptureKeydown, useNewTerminal). Splitting one-line stubs into their own
      // files would put the fixture further from the assertion, which is the opposite of what
      // the rule is for — it exists to keep SHIPPED components findable.
      "vue/one-component-per-file": "off",
    },
  },
  {
    // The files that already exceed max-lines, listed here rather than silenced with
    // eslint-disable comments so the debt is countable in one place (CLAUDE.md forbids the
    // comments, and rightly — they hide at the scene). Delete an entry once its file is under
    // the limit; the rule then holds it there.
    files: [
      "src/components/TerminalCell.vue", // 1078 — the launch form is out (#1122); the running cell's chrome (header chips, diff panel, close confirm, handoff menu) is what's left
      "src/components/TerminalGrid.vue", //  815 — layout state machine + its documented <style> exception (#1125)
    ],
    rules: {
      "max-lines": "off",
    },
  },
  {
    // eslint-plugin-security tuning (mirrors mulmoclaude): these three rules fire
    // on safe, intentional patterns here — workspace-relative fs paths (session
    // files keyed by validated UUIDs), dynamic `obj[key]` lookups, and regexps —
    // so they're high-noise, low-signal. The rest of `recommended` stays on.
    rules: {
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-regexp": "off",
    },
  },
  prettierRecommended,
];
