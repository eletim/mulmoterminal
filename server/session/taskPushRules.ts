// Background workers and translation workers aren't real user tasks, so a turn ending on one
// must never reach the phone. "never" is why the caller answers `background` from the durable
// marking rather than from which sessions this process happens to have spawned.
//
// A user's SCHEDULED task is the exception, and it is the reason this takes three answers rather
// than two. It is a background session in every other respect — out of the chat list, never bold,
// no grid cell — but it is a task the user configured, running while they are away, and the phone
// is the only way they would ever hear about it. Suppressing it would silence exactly the case the
// setting exists for (Codex, PR #1196).
//
// A translation worker is still refused even if something ever schedules one: it is an internal
// helper with no output a person reads, so there is nothing to tell them about.
export function shouldSuppressPush(background: boolean, translationWorker: boolean, userScheduled = false): boolean {
  if (translationWorker) return true;
  return background && !userScheduled;
}
