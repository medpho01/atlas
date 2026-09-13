'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * A readable failure instead of a white screen.
 *
 * A client-side exception on this route used to replace the whole page with
 * Next's bare "Application error" — no message, no way back, and the request
 * somebody was working gone from the screen. The error itself was only in the
 * browser console, which is not where the person on the phone is looking.
 *
 * This says what happened, keeps the digest that matches the server log, and
 * offers the two things that actually help: try again, or go back to the
 * queue.
 */
export default function RequestError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[requests/[id]]', error);
  }, [error]);

  return (
    <div className="px-6 lg:px-8 py-10 max-w-2xl mx-auto">
      <div className="rounded-xl border border-danger-100 bg-danger-50/40 p-5">
        <h1 className="text-[15px] font-semibold text-ink-900">This request could not be shown</h1>
        <p className="text-sm text-ink-600 mt-1.5">
          Something on this page failed after it loaded. The request itself is fine — nothing
          has been lost, and the lab search, if one was running, carries on in the background.
        </p>
        <pre className="mt-3 text-[11px] text-ink-600 whitespace-pre-wrap break-words
                        bg-surface border border-ink-150 rounded-md p-2.5">
          {error.message || 'No message'}
          {error.digest ? `\n\ndigest ${error.digest}` : ''}
        </pre>
        <div className="flex items-center gap-2 mt-3.5">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5
                       text-xs font-semibold text-white hover:bg-brand-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
          <a href="/requests" className="text-xs text-ink-600 hover:text-ink-900">Back to the queue</a>
        </div>
      </div>
    </div>
  );
}
