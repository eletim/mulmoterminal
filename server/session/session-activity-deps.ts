// What a route needs in order to report on a live session: its working / needs-attention
// flags, and the header prompt + AI title that ride along with them.
//
// The hook route is the only thing that CALLS these, but app-routes.ts has to declare them
// too — index.ts owns the implementations and hands them down — so the contract is named
// once here rather than restated on both sides (#826).
export interface SessionActivityDeps {
  setWorking: (id: string, working: boolean, event?: string) => void;
  setWaiting: (id: string, waiting: boolean, event?: string) => void;
  publishActivity: (id: string) => void;
  forgetTitle: (id: string) => Promise<void>;
  noteTitleTurn: (id: string, prompt: string) => Promise<void>;
  /** Feed the live turn's tool names, so the published status can say planning vs editing (#727). */
  noteWorkPhase: (id: string, event: string, toolName?: string) => void;
  maybeGenerateTitle: (id: string, cwd: string | undefined, transcriptId?: string) => Promise<void>;
}
