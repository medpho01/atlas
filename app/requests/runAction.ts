'use client';

/**
 * Call a server action, and recognise the one failure that is not the action's
 * fault.
 *
 * Next gives every server action a build-specific id. After a rebuild, a tab
 * still holding the old page posts ids the server has never heard of, and the
 * action fails with "Failed to find Server Action". Next's own error path then
 * throws on a null digest, which lands in the log as a stack trace and reads
 * like the app crashing.
 *
 * It is neither a crash nor a bug in the action — the page is simply stale.
 * Twice today that cost an afternoon of looking in the wrong place, so it now
 * says so plainly and tells the user the one thing that fixes it.
 */
export const STALE_PAGE =
  'Atlas was updated since this page loaded. Reload (⌘⇧R) and try again.';

export function isStalePage(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /Failed to find Server Action|older or newer deployment/i.test(msg);
}

/**
 * Returns either the action's result or a message to show. Never throws, so a
 * stale page cannot take a click down with it.
 */
export async function runAction<T extends { ok: boolean; error?: string }>(
  fn: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: isStalePage(e) ? STALE_PAGE : (e as Error).message };
  }
}
