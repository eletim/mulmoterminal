// How /api/files/raw should serve a workspace file: its content type, whether the response
// must be sandboxed, and whether it is over the size cap.
//
// Three decisions that were inline in the route and reached, between them, by one .png test.
// The one that matters is the sandbox: an .svg can carry inline <script>, so the response
// gets `Content-Security-Policy: sandbox` to keep it out of the app origin. PDFs are the sole
// exception — WebKit will not render a sandbox-opaque PDF — and that exception is exactly the
// kind of thing that widens by accident. Serving an SVG WITHOUT the sandbox is stored XSS
// against /api/* and the session cookie.
import path from "node:path";
import { SOURCE_CODE_EXTENSIONS } from "../../common/sourceExtensions.js";

const MAX_RAW_BYTES = 25 * 1024 * 1024; // images / text / generic
const MAX_MEDIA_BYTES = 500 * 1024 * 1024; // audio / video (streamed via Range)

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

// Source / docs / config files: serve as text so they VIEW in the browser instead of
// downloading (the file-path links in terminal output point at these — a code workspace's
// `.md`/`.ts`/… should open, not save). text/plain is never executed, so it stays safe under
// the sandbox CSP; a genuinely unknown extension still falls through to octet-stream (download).
const TEXT_PLAIN = "text/plain; charset=utf-8";

// On top of the shared source set: prose and markup the browser would otherwise render or
// download, the languages the client's in-app viewer doesn't claim, and the extensionless
// dotfiles (matched by basename — see `textKey` below). `.txt`/`.json`/`.csv` are absent
// because MIME_BY_EXT already types them.
const TEXT_ONLY_EXTS = [
  ".md",
  ".markdown",
  ".rst",
  ".adoc",
  ".mdx",
  ".pl",
  ".r",
  ".dart",
  ".ex",
  ".exs",
  ".env",
  ".properties",
  ".html",
  ".htm",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".lock",
];

const TEXT_EXTS = new Set<string>([...SOURCE_CODE_EXTENSIONS, ...TEXT_ONLY_EXTS]);

// Audio and video are the large, Range-streamed kinds that get the bigger cap.
function isMedia(mime: string): boolean {
  return mime.startsWith("audio/") || mime.startsWith("video/");
}

export interface RawServingPlan {
  contentType: string;
  // False only for application/pdf; everything else is sandboxed.
  sandbox: boolean;
  // True when the file is over the cap for its kind — the route answers 413.
  tooLarge: boolean;
}

export function rawServingPlan(absPath: string, size: number): RawServingPlan {
  const ext = path.extname(absPath).toLowerCase();
  // `path.extname` is "" for a dotfile (`.gitignore`, `.env`), so fall back to the full
  // basename for the text lookup — else those names in TEXT_EXTS never match and download.
  const textKey = ext || path.basename(absPath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? (TEXT_EXTS.has(textKey) ? TEXT_PLAIN : "application/octet-stream");
  const cap = isMedia(contentType) ? MAX_MEDIA_BYTES : MAX_RAW_BYTES;
  return { contentType, sandbox: contentType !== "application/pdf", tooLarge: size > cap };
}
