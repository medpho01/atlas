'use client';

import { useState } from 'react';

/**
 * A confirmation that survives the remount a successful server action causes.
 *
 * The problem, measured rather than assumed. A server action that calls
 * revalidatePath re-renders the route, and the client subtree under it is
 * unmounted and mounted again — during the swap `document.querySelector` on a
 * field inside it returns null. So the ordinary shape:
 *
 *     const r = await save(...);
 *     setNote(r.ok ? 'Saved.' : r.error);
 *
 * works perfectly for the failure (which does not revalidate, so nothing
 * remounts) and silently does nothing for the success. The component holding
 * that state is already gone by the time the update is applied, and React
 * discards it. Every save appeared to do nothing, which is the worst possible
 * way for a save to behave: the operator repeats it.
 *
 * Parking the message in module scope fixes it, because the module is not
 * reloaded by the remount. The new mount picks it up in its state initialiser
 * and takes it off the shelf, so it is shown exactly once.
 *
 * Deliberately not auto-dismissed. It is cleared by the next action or the
 * next navigation, and a confirmation that vanishes before somebody has
 * finished reading it is the same bug in a politer form.
 */

export type Flash = { kind: 'ok' | 'bad'; text: string };

/**
 * Messages waiting for a component to come back.
 *
 * Swept after three seconds, which is the other half of the problem. The
 * remount happens within a few hundred milliseconds, so three seconds is
 * generous for collecting one. Leaving it on the shelf any longer means a
 * person who navigates away and straight back is shown a stale confirmation
 * for something they already saw — a message reappearing out of nowhere is
 * its own small bug, and the shelf is only ever meant to bridge one remount.
 *
 * The sweep clears the shelf, never the state: a message already on screen
 * stays there until the next action or the next navigation.
 */
const parked = new Map<string, { flash: Flash; at: number }>();
const SHELF_LIFE_MS = 3_000;

function collect(key: string): Flash | null {
  const p = parked.get(key);
  if (!p) return null;
  parked.delete(key);
  return Date.now() - p.at < SHELF_LIFE_MS ? p.flash : null;
}

/**
 * `key` identifies the thing being acted on — e.g. `store-profile-7`. It must
 * be stable across the remount and different between two components that can
 * be on screen at once, or one would collect the other's message.
 */
export function useActionFlash(key: string): [Flash | null, (f: Flash | null) => void] {
  // The initialiser runs on mount, which is the one moment that matters: this
  // is where a message left by the component this one replaced is picked up.
  const [flash, setLocal] = useState<Flash | null>(() => collect(key));

  const set = (f: Flash | null) => {
    // Parked first, then set locally. Whichever way the render goes — remount
    // or not — exactly one of the two paths shows it.
    if (f) {
      parked.set(key, { flash: f, at: Date.now() });
      setTimeout(() => {
        const still = parked.get(key);
        // Only sweep the message this call parked. A newer one has its own
        // timer and must not be taken off the shelf early by this one.
        if (still && Date.now() - still.at >= SHELF_LIFE_MS - 50) parked.delete(key);
      }, SHELF_LIFE_MS);
    } else {
      parked.delete(key);
    }
    setLocal(f);
  };

  return [flash, set];
}
