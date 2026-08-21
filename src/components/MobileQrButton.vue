<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useTemplateRef, watch } from "vue";
import ToolbarPopover from "./ToolbarPopover.vue";
import { mobileAccessUrl } from "../mobileAccessUrl";
import { useManualCopy } from "../composables/useManualCopy";

const popoverRef = useTemplateRef<InstanceType<typeof ToolbarPopover>>("popover");
const canvasRef = useTemplateRef<HTMLCanvasElement>("qrCanvas");
const mobileUrl = computed(() => mobileAccessUrl());
const copied = ref(false);
const qrError = ref(false);
const { manualCopyText, setManualCopyTextareaEl, showManualCopy, closeManualCopy } = useManualCopy();
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function drawQrCode(): Promise<void> {
  const canvas = canvasRef.value;
  if (!canvas) return;
  qrError.value = false;
  try {
    const QRCode = await import("qrcode");
    await QRCode.toCanvas(canvas, mobileUrl.value, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
      width: 168,
      color: { dark: "#111827", light: "#ffffff" },
    });
  } catch {
    qrError.value = true;
  }
}

function markCopied(): void {
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 1500);
}

async function onOpen(): Promise<void> {
  copied.value = false;
  await nextTick();
  await drawQrCode();
}

async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(mobileUrl.value);
    markCopied();
  } catch {
    await showManualCopy(mobileUrl.value);
  }
}

watch(mobileUrl, () => {
  if (canvasRef.value) void drawQrCode();
});

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="ml-1 inline-flex">
    <ToolbarPopover
      ref="popover"
      icon="qr_code_2"
      title="Open mobile view"
      trigger-label="Mobile QR code"
      pane-class="w-[260px] p-3 gap-3"
      pane-label="Mobile access QR code"
      @open="onOpen"
    >
      <div class="flex flex-col gap-3 font-sans text-[12px] text-fg">
        <div class="flex items-center justify-center rounded-md border border-border bg-white p-2">
          <canvas ref="qrCanvas" data-testid="mobile-qr-canvas" class="h-[168px] w-[168px]" width="168" height="168" aria-label="Mobile access QR code" />
        </div>
        <p v-if="qrError" class="m-0 text-[12px] text-err-text">QR code could not be generated.</p>
        <code
          data-testid="mobile-qr-url"
          class="block max-h-16 overflow-y-auto rounded border border-border bg-deep px-2 py-1.5 font-mono text-[11px] leading-4 text-fg [overflow-wrap:anywhere]"
          >{{ mobileUrl }}</code
        >
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="mobile-qr-copy"
            class="rounded border border-border px-2.5 py-1 text-[12px] hover:bg-hover"
            @click="copyUrl"
          >
            {{ copied ? "Copied" : "Copy URL" }}
          </button>
          <button type="button" class="rounded border border-border px-2.5 py-1 text-[12px] hover:bg-hover" @click="popoverRef?.close()">Close</button>
        </div>
      </div>
    </ToolbarPopover>
  </div>

  <Teleport to="body">
    <div v-if="manualCopyText" class="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(0,0,0,0.45)] px-4" role="dialog" aria-modal="true">
      <div class="flex max-h-[80vh] w-[min(520px,92vw)] flex-col gap-2 rounded-lg bg-panel p-4 text-fg shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
        <p class="text-[12px] text-muted">Clipboard access is blocked here. The mobile URL is selected below.</p>
        <textarea
          :ref="setManualCopyTextareaEl"
          readonly
          data-testid="mobile-qr-manual-copy"
          class="h-28 w-full resize-none rounded border border-border bg-deep p-2 font-mono text-[12px] text-fg"
          :value="manualCopyText"
        />
        <button type="button" class="self-end rounded border border-border px-3 py-1 text-[12px] hover:bg-hover" @click="closeManualCopy">Close</button>
      </div>
    </div>
  </Teleport>
</template>
