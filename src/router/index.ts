// App-wide navigation router. MulmoTerminal renders its grid shell and route-driven
// overlays by `route.name` (NOT via <router-view>), so each route only needs to
// carry a name + params — a no-op Stub component satisfies the matcher.
//
// The singleton is exported so module-level stores can push routes / read
// currentRoute without component context. `routes` is exported for unit tests that
// want a throwaway memory-history router.
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { defineComponent } from "vue";
import { APP_BASE_PATH } from "../basePath";

const Stub = defineComponent({ name: "RouteStub", render: () => null });

export const routes: RouteRecordRaw[] = [
  // `/` is the DEFAULT-VIEW ENTRY, not a view of its own: which screen the app opens on
  // is this one line (#883). That only holds while navigation goes through route NAMES —
  // a `push("/")` written to mean "the single view" pins the default in place and breaks
  // the moment it moves, which is exactly what this change had to undo in six call sites.
  { path: "/", redirect: { name: "terminals" } },
  { path: "/terminals", name: "terminals", component: Stub },
  // Full-screen read-only file viewer, rooted at a project dir (?cwd=). Opened from a
  // terminal header's Files button.
  { path: "/files", name: "files", component: Stub },
  // The local mobile terminal's entry point. A route of its own, distinct from /terminals,
  // so App.vue can mount the mobile page alone — never the desktop grid shell alongside it.
  { path: "/mobile", redirect: { name: "mobileTerminals" } },
  { path: "/mobile/terminals", name: "mobileTerminals", component: Stub },
  // Unknown URLs land on the default view — via `/`, so they follow it wherever it points.
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(APP_BASE_PATH), routes });
