<script setup lang="ts">
import { ref, watch } from "vue";
import { SECTION_HEADING } from "./sectionClasses";
import { PUSH_KINDS, type PushKind } from "../../../common/pushKinds";

const props = defineProps<{ pushKinds?: PushKind[] | undefined }>();
const emit = defineEmits<{
  (e: "update-push-kinds", kinds: PushKind[]): void;
}>();

// Which kinds of local mobile push to send (#850). Device registration lives on the mobile page;
// this says which activity moments qualify.
const PUSH_KIND_LABEL: Record<PushKind, string> = { finished: "Turn finished", waiting: "Waiting for you" };
const PUSH_KIND_HELP: Record<PushKind, string> = {
  finished: "the agent replied and the output is unread",
  waiting: "it stopped to ask — a permission prompt or a question. Fires once per prompt, so a task that asks a lot pushes a lot",
};
const pushKindList = ref<PushKind[]>([...(props.pushKinds ?? [])]);
watch(
  () => props.pushKinds,
  (k) => (pushKindList.value = [...(k ?? [])]),
);
function togglePushKind(kind: PushKind) {
  // Emitted in PUSH_KINDS order so the saved list reads the same however it was clicked.
  const next = pushKindList.value.includes(kind) ? pushKindList.value.filter((k) => k !== kind) : [...pushKindList.value, kind];
  pushKindList.value = PUSH_KINDS.filter((k) => next.includes(k));
  emit("update-push-kinds", pushKindList.value);
}
</script>

<template>
  <h3 :class="SECTION_HEADING">Web Push notifications</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Choose which activity moments notify registered mobile devices. Register this browser from the mobile terminal page.
  </p>
  <div class="mt-2.5">
    <p class="mb-1.5 text-[12px] text-dim">Which moments are worth a push:</p>
    <label v-for="kind in PUSH_KINDS" :key="kind" class="flex cursor-pointer items-start gap-2 py-0.5">
      <input
        type="checkbox"
        class="mt-1 cursor-pointer"
        :checked="pushKindList.includes(kind)"
        :aria-label="`Push when a session is ${kind}`"
        @change="togglePushKind(kind)"
      />
      <span class="text-[12px]">
        <strong>{{ PUSH_KIND_LABEL[kind] }}</strong> — {{ PUSH_KIND_HELP[kind] }}
      </span>
    </label>
  </div>
</template>
