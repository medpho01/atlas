import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionUser } from '@/lib/auth';
import { canManage } from '@/lib/access';
import { search, readLabs } from '@/lib/discoverLabs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Run one search and show exactly what came back.
 *
 * Three deploys went on guessing at this: a timeout, then a schema rejection,
 * then "Cannot read properties of undefined (reading 'map')" — each one a
 * sentence about the code rather than about the answer, because the answer was
 * never visible. This returns it: the stop reason, how many times the server
 * paused, which block types arrived, and the head of the text.
 *
 *   /api/discovery/debug?pincode=413736
 *
 * It costs one real search — that is the point of it — and writes nothing. No
 * claim, no rows, no effect on what the card shows. Network and admin only.
 */
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
  const city = sp.get('city');
  const state = sp.get('state');
  const disciplines = (sp.get('disciplines') ?? '').split(',').filter(Boolean);

  const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key) return NextResponse.json({ error: 'No Anthropic credential in this container' }, { status: 503 });

  const started = Date.now();
  const anthropic = new Anthropic({ timeout: 240_000, maxRetries: 0 });

  try {
    const answer = await search(anthropic, pincode, city, state, disciplines.length ? disciplines : null);
    const text = answer.content.filter((b) => b.type === 'text').pop()?.text ?? '';

    let labs: unknown[] | null = null;
    let parseError: string | null = null;
    try { labs = readLabs(answer); } catch (e) { parseError = (e as Error).message; }

    return NextResponse.json({
      pincode,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      stop_reason: answer.stop_reason ?? null,
      continuations: answer.continuations ?? 0,
      blocks: answer.content.map((b) => b.type),
      parsed: labs ? { count: labs.length, names: labs.map((l) => (l as { name?: string }).name ?? '?') } : null,
      parse_error: parseError,
      // Enough to see whether it is JSON, prose, or a refusal — not the whole
      // answer, which can be tens of kilobytes.
      text_head: text.slice(0, 600),
      text_length: text.length,
      key_suffix: `…${key.slice(-4)}`,
      note: 'Nothing was written. This does not claim the pincode or store leads.',
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({
      pincode,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      failed: true,
      status: err?.status ?? null,
      error: err?.message ?? String(e),
      key_suffix: `…${key.slice(-4)}`,
    }, { status: 502 });
  }
}
