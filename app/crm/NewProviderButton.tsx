'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { AddProviderModal } from './AddProviderModal';

/**
 * Create a provider from the queue.
 *
 * The only way in used to be through a thread board, which meant deciding the
 * campaign by navigating to it before you had typed anything. The thread is a
 * field on the form now, so the entry point belongs where the work is.
 */
export function NewProviderButton({ threads }: { threads: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!threads.length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 text-white px-3 py-1.5
                   text-sm font-medium hover:bg-brand-700 transition"
      >
        <Plus className="w-3.5 h-3.5" /> Add provider
      </button>
      {open && (
        <AddProviderModal
          threadId={threads[0].id}
          threads={threads}
          defaultKind="LAB"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
