// Reading a JSON response without `any` — the browser-side counterpart to the server's
// `requestBody`.
//
// `Response.json()` is typed `Promise<any>`, so `(await res.json()).entries` type-checks against
// anything and every value read out of it stays `any` all the way to wherever it is used. That is
// the widest `any` door in the UI: the body came off the wire, and nothing has checked it.
//
// Answering a plain record makes each field `unknown`, which is what the callers already assume —
// they were written as `typeof data.version === "string" ? ... : null`, and that guard becomes the
// thing the type checker follows rather than decoration on an `any`.

import { isRecord } from "../common/isRecord";

/**
 * The response body as a record of unverified fields; `{}` when it is not a JSON object or not
 * JSON at all. Absorbing the parse failure matches what the callers did by hand
 * (`res.json().catch(() => ({}))`) and keeps a truncated body from throwing past an error path
 * that was already handling the HTTP status.
 */
export const jsonBody = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    const body: unknown = await res.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
};
