<script setup lang="ts">
// The settings modal with its config wiring already attached.
//
// Both shells open the same modal — the chat view and the grid — and each wired the same five
// values and five save handlers to it by hand. Ten identical lines in two places is how one
// of them ends up missing a setting added later, and the symptom would be a control that
// silently does nothing in one view (#646 A5).
//
// useAppConfig's state is a singleton, so reading it here is the same state the shells read.
// What genuinely differs stays a prop or an event: the chat view knows a cwd and a session,
// and each shell configures appearance its own way.
import { computed } from "vue";
import { useAppConfig } from "../composables/useAppConfig";
import SettingsModal from "./SettingsModal.vue";

const props = defineProps<{ cwd?: string | null; sessionId?: string | null }>();
const emit = defineEmits<{ (e: "configure-appearance" | "close"): void }>();

const {
  soundFile,
  saveSound,
  soundKinds,
  saveSoundKinds,
  sounds,
  saveSounds,
  pushEnabled,
  savePushEnabled,
  pushKinds,
  savePushKinds,
  prRepos,
  savePrRepos,
  launchers,
  saveLaunchers,
  quickCommands,
  saveQuickCommands,
  userMcpServers,
  saveUserMcpServers,
  presets,
} = useAppConfig();

// Which directories the config preview lists: the recent dirs, plus the focused session's own
// directory when it isn't among them (the chat view knows a cwd; the grid doesn't).
const dirPaths = computed(() => {
  const paths = presets.value.map((p) => p.path);
  return props.cwd && !paths.includes(props.cwd) ? [props.cwd, ...paths] : paths;
});
</script>

<template>
  <SettingsModal
    :sound-file="soundFile"
    :sound-kinds="soundKinds"
    :sounds="sounds"
    :push-enabled="pushEnabled"
    :push-kinds="pushKinds"
    :pr-repos="prRepos"
    :launchers="launchers"
    :quick-commands="quickCommands"
    :user-mcp-servers="userMcpServers"
    :cwd="cwd"
    :session-id="sessionId"
    :dir-paths="dirPaths"
    @update-sound="saveSound"
    @update-sound-kinds="saveSoundKinds"
    @update-sounds="saveSounds"
    @update-push-enabled="savePushEnabled"
    @update-push-kinds="savePushKinds"
    @update-repos="savePrRepos"
    @update-launchers="saveLaunchers"
    @update-quick-commands="saveQuickCommands"
    @update-user-mcp="saveUserMcpServers"
    @configure-appearance="emit('configure-appearance')"
    @close="emit('close')"
  />
</template>
