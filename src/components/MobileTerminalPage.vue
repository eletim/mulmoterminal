<script setup lang="ts">
// The mobile entry point (/mobile/terminals), mounted by App.vue instead of
// DesktopAppShell — never alongside it. A static placeholder only: the actual mobile
// terminal UI (session list, screen, input) lands in a follow-up change. This page
// exists to prove the route split works before any of that is built.
import { useRouter } from "vue-router";

const router = useRouter();

function backToDesktop(): void {
  void router.push("/terminals");
}
</script>

<template>
  <div class="flex h-full min-h-screen flex-col items-center justify-center gap-3 bg-base px-6 text-center text-fg">
    <h1 class="font-sans text-[15px] font-semibold tracking-[0.02em]">MulmoTerminal</h1>
    <p class="text-[13px] font-medium text-secondary">Local mobile terminal</p>
    <p class="max-w-xs text-[13px] text-muted">The mobile terminal UI will be added in the next step.</p>
    <button type="button" class="mt-2 rounded-md border border-border bg-panel px-3 py-1.5 text-[13px] text-fg hover:bg-hover" @click="backToDesktop">
      Back to desktop
    </button>
  </div>
</template>
