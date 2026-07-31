// Which local clones a GitHub repository has on this machine — what `GET /api/repo-dirs` answers.
//
// Shared because both sides decide from it: the server resolves each saved directory's `origin`
// and groups them, and the UI picks which clone to start work in (and offers the rest). Several
// clones of one repo commonly run side by side here, so "the directory for owner/repo" is a
// CHOICE rather than a lookup — which is why a candidate carries what it takes to choose.

export interface RepoDirCandidate {
  /** Absolute path of the clone (the canonical spelling `cwdPresets` stores). */
  path: string;
  /** The preset's label, which is what the user named this clone in Settings. */
  label: string;
  /** The directory's own `orderPriority` from `.mulmoterminal.json`, or null when it sets none. */
  orderPriority: number | null;
}

export interface RepoDirs {
  /** `owner/repo`. */
  repo: string;
  /** Candidates, already ordered: by `orderPriority`, then by path for the ones that set none. */
  dirs: RepoDirCandidate[];
  /** The recorded choice for this repo, or null when there is none to honour. Always one of
   *  `dirs` — a recording whose directory has since gone or now points at a different repo is
   *  dropped rather than returned, because the caller would otherwise start work in it. */
  primary: string | null;
}

export interface RepoDirsResponse {
  repos: RepoDirs[];
}
