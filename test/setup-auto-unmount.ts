// Every spec that mounts a component gets its wrappers torn down after each test.
//
// Without this a mounted component OUTLIVES the test that created it: its watchers keep
// running and its pending timers keep ticking on the real clock. The counters specs read
// (fetch mocks, emitted events) are global, so a leftover component's late work is counted
// as the NEXT test's — which is what made the TerminalCell debounce case fail only on a
// loaded runner, where a later test's measurement window stretches far enough to overlap a
// previous test's 300ms debounce (#903).
//
// Global rather than per-file: 18 spec files mounted without ever unmounting, and the next
// one written would have joined them.
import { enableAutoUnmount } from "@vue/test-utils";
import { afterEach } from "vitest";

enableAutoUnmount(afterEach);
