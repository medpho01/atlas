import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionUser } from '@/lib/auth';
import { canManage } from '@/lib/access';
import { search } from '@/lib/discoverLabs';
import { readLabs, estimateCostUsd, maxSearchUses } from '@/lib/labDiscovery';

export const dynamic = 'force-dynamic';

/**
 * Run one search and show exactly what came back — without holding the
 * connection open while it runs.
 *
 * The first version of this was synchronous and nginx returned 504 after
 * sixty seconds, which is the same wall the search itself hit before it was
 * moved into the background. Nothing that takes minutes can answer an HTTP
 * request here, so this does what the search does: the first call starts a
 * probe and returns at once, and the same URL polled again returns the result
 * when there is one.
 *
 *   /api/discovery/debug?pincode=413736     → {"status":"started"}
 *   /api/discovery/debug?pincode=413736     → {"status":"running","seconds":22}
 *   /api/discovery/debug?pincode=413736     → the answer
 *
 * It writes nothing to the database — no claim, no rows — so it cannot
 * disturb what the card shows. Add &fresh=1 to discard a stored result and
 * probe again. Network and admin only.
 */

type Probe = {
  pincode: string;
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
};

// Module state, deliberately. The result has to outlive the request that
// started it and nothing else needs to see it; a table would mean a migration
// for a debugging aid.
const probes = new Map<string, Probe>();

export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canManage(me, 'commitments')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const pincode = sp.get('pincode') ?? '';
  if (!/^\d{6}$/.test(pincode)) {
    return NextResponse.json({ error: 'Pass ?pincode=NNNNNN' }, { status: 400 });
  }
  if (sp.get('fresh') === '1') probes.delete(pincode);

  const existing = probes.get(pincode);
  if (existing) {
    if (existing.finishedAt) return NextResponse.json(existing.result);
    return NextResponse.json({
      status: 'running',
      pincode,
      seconds: Math.round((Date.now() - existing.startedAt) / 1000),
      note: 'Reload this URL in a few seconds. A search reads several listings.',
    });
  }

  const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key) return NextResponse.json({ error: 'No Anthropic credential in this container' }, { status: 503 });

  const probe: Probe = { pincode, startedAt: Date.now() };
  probes.set(pincode, probe);

  const city = sp.get('city');
  const state = sp.get('state');
  const disciplines = (sp.get('disciplines') ?? '').split(',').filter(Boolean);

  // Started, not awaited — the whole point of this rewrite.
  void (async () => {
    const anthropic = new Anthropic({ timeout: 300_000, maxRetries: 0 });
    try {
      const answer = await search(anthropic, pincode, city, state,
                                  disciplines.length ? disciplines : null);
      const text = answer.content.filter((b) => b.type === 'text').pop()?.text ?? '';
      let labs: unknown[] | null = null;
      let parseError: string | null = null;
      try { labs = readLabs(answer); } catch (e) { parseError = (e as Error).message; }

      probe.result = {
        status: 'done',
        pincode,
        seconds: Math.round((Date.now() - probe.startedAt) / 100) / 10,
        stop_reason: answer.stop_reason ?? null,
        continuations: answer.continuations ?? 0,
        // What this one search cost, which is the question behind "why is the
        // bill like that".
        cost: {
          usd_estimate: estimateCostUsd(answer.usage),
          web_searches: answer.usage?.server_tool_use?.web_search_requests ?? null,
          max_uses_setting: maxSearchUses(),
          input_tokens: answer.usage?.input_tokens ?? null,
          cached_input_tokens: answer.usage?.cache_read_input_tokens ?? null,
          output_tokens: answer.usage?.output_tokens ?? null,
        },
        blocks: answer.content.map((b) => b.type),
        parsed: labs
          ? { count: labs.length, names: labs.map((l) => (l as { name?: string }).name ?? '?') }
          : null,
        parse_error: parseError,
        // Enough to tell JSON from prose from a refusal, without returning
        // tens of kilobytes.
        text_head: text.slice(0, 600),
        text_length: text.length,
        key_suffix: `…${key.slice(-4)}`,
        note: 'Nothing was written. This does not claim the pincode or store leads.',
      };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      probe.result = {
        status: 'failed',
        pincode,
        seconds: Math.round((Date.now() - probe.startedAt) / 100) / 10,
        http_status: err?.status ?? null,
        error: err?.message ?? String(e),
        key_suffix: `…${key.slice(-4)}`,
      };
    } finally {
      probe.finishedAt = Date.now();
    }
  })();

  return NextResponse.json({
    status: 'started',
    pincode,
    note: 'Reload this URL in 30-60 seconds for the result. Nothing is written to the database.',
  });
}
