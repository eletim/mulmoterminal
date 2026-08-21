import { nextTick, ref } from "vue";
import type { ComponentPublicInstance } from "vue";

export function useManualCopy() {
  const manualCopyText = ref("");
  const manualCopyTextareaEl = ref<HTMLTextAreaElement | null>(null);

  async function showManualCopy(text: string): Promise<void> {
    manualCopyText.value = text;
    await nextTick();
    manualCopyTextareaEl.value?.focus();
    manualCopyTextareaEl.value?.select();
  }

  function closeManualCopy(): void {
    manualCopyText.value = "";
  }

  function setManualCopyTextareaEl(el: Element | ComponentPublicInstance | null): void {
    manualCopyTextareaEl.value = el instanceof HTMLTextAreaElement ? el : null;
  }

  return { manualCopyText, setManualCopyTextareaEl, showManualCopy, closeManualCopy };
}
