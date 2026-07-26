// The `GET /api/transcribe/model` response. The server builds it; the UI decides the mic
// button's visibility and the settings section's from it — both sides read it, so it lives
// here rather than as one interface per side.
//
// Deliberately independent of whisper's own types: this is the API contract, and which
// package implements transcription behind it is not the UI's business. The server's
// `getVoiceInputStatus(): VoiceInputStatus` annotation is what keeps the two in step.

export type VoiceModelState = "idle" | "downloading" | "ready" | "error";

export interface VoiceInputStatus {
  /** The platform and binaries are present — the mic can appear. */
  capable: boolean;
  model: {
    name: string;
    state: VoiceModelState;
    /** 0..1, only while downloading and only when the size is known. */
    progress?: number;
    error?: string;
  };
}
