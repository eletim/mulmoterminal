<script setup lang="ts">
// The application entry point. Which page mounts is decided by the route alone — the
// desktop grid shell for everything under /terminals and friends, or the mobile terminal
// page for /mobile/terminals — so the two never share a mount and the mobile page never
// pulls in the grid, its overlays, or the launch-terminal subscription that belongs to
// the desktop shell.
import { computed } from "vue";
import { useRoute } from "vue-router";
import DesktopAppShell from "./components/DesktopAppShell.vue";
import MobileTerminalPage from "./components/MobileTerminalPage.vue";

const route = useRoute();
const isMobileTerminalPage = computed(() => route.name === "mobileTerminals");
</script>

<template>
  <MobileTerminalPage v-if="isMobileTerminalPage" />
  <DesktopAppShell v-else />
</template>
