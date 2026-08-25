<script setup lang="ts">
import { SECTION_HEADING } from "./sectionClasses";
</script>

<template>
  <h3 :class="SECTION_HEADING">Directory appearance</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Directory name badge, colors, terminal palette, and grid position come from each directory's <code>.mulmoterminal.json</code>.
  </p>
</template>
