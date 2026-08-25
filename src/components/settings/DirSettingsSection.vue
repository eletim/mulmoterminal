<script setup lang="ts">
import DirConfigPreview from "../DirConfigPreview.vue";
import { SECTION_HEADING } from "./sectionClasses";

defineProps<{ dirPaths?: string[] | undefined }>();
</script>

<template>
  <h3 :class="SECTION_HEADING">Directory settings</h3>
  <p class="mb-1 mt-1.5 text-[12px] text-dim">
    What each directory's <code>.mulmoterminal.json</code> is actually doing. Expand one to see the values in force, and any key the app dropped or doesn't
    recognise — a setting that never took effect looks the same as one you never made until you can see this.
  </p>
  <DirConfigPreview :paths="dirPaths ?? []" />
</template>
