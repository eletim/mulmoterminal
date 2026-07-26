// Normalizes the fields every `gh` list row shares (issues and PRs alike). The shape
// itself is the wire contract and lives in common/ghItems.ts; issues.ts / prs.ts layer
// their own extra fields on top of this base.
import type { GhItemBase } from "../../common/ghItems.js";
import { isRecord } from "../../common/isRecord.js";
const asString = (v: unknown): string => (typeof v === "string" ? v : "");

// Returns null when the row lacks the identity fields (number + url) — a row we can't
// link to or key on is not worth rendering. Missing text fields degrade to "".
export function normalizeGhItemBase(raw: unknown): GhItemBase | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.number !== "number" || typeof raw.url !== "string") return null;
  const author = isRecord(raw.author) && typeof raw.author.login === "string" ? raw.author.login : "";
  return { number: raw.number, title: asString(raw.title), author, updatedAt: asString(raw.updatedAt), url: raw.url };
}

export { isRecord };
