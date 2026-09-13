import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionUser } from '@/lib/auth';
import { canManage } from '@/lib/access';
import { SEARCH_SYSTEM, SEARCH_SCHEMA, searchPrompt } from '@/lib/labDiscovery';

export const dynamic = 'force-dynamic';

/**
 * Does the API accept the discovery output schema?
 *
 * Production answered `HTTP 400: Schema is too complex` and every search
 * failed. The schema has been slimmed and a rejection now falls back to the
 * prompt alone — but which of the two is happening should be answerable in a
 * second, by the people who run this, without a deploy.
 *
 * It lives here rather than in scripts/ because the server has no Node: the
 * app runs from a standalone build inside a container, which carries no
 * scripts and no TypeScript source. This route runs in that container, with
 * that container's key and the exact schema the search uses.
 *
 * count_tokens validates the whole request — schema, tools, system prompt —
 * and runs no inference, so asking costs nothing.
 */
export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canManage(me, 'commitments')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const props = (SEARCH_SCHEMA as { properties: { labs: { items: { properties: object } } } })
    .properties.labs.items.properties;
  const shape = { properties_per_lab: Object.keys(props).length };

  const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key) {
    return NextResponse.json({
      verdict: 'no_credential',
      detail: 'No ANTHROPIC_API_KEY in this container. The app loads .env.production.',
      ...shape,
    }, { status: 503 });
  }

  const request = {
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: [{ type: 'text', text: SEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: searchPrompt('560001', 'Bengaluru', 'Karnataka', ['PATHOLOGY']) }],
  };

  const anthropic = new Anthropic({ timeout: 60_000, maxRetries: 0 });
  try {
    const r = await anthropic.messages.countTokens({
      ...request,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SEARCH_SCHEMA } },
    } as never);
    return NextResponse.json({
      verdict: 'accepted',
      detail: 'Searches run with the structured-output guarantee.',
      input_tokens: r.input_tokens,
      key_suffix: `…${key.slice(-4)}`,
      ...shape,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const schemaRefused = err?.status === 400 && /schema/i.test(err?.message ?? '');
    return NextResponse.json({
      verdict: schemaRefused ? 'rejected' : 'unknown',
      detail: schemaRefused
        ? 'Searches still work — the code falls back to the prompt alone. To restore the ' +
          'guarantee, drop fields from SEARCH_SCHEMA in lib/labDiscovery.ts.'
        : 'Could not tell from this response.',
      error: err?.message ?? String(e),
      status: err?.status ?? null,
      key_suffix: `…${key.slice(-4)}`,
      ...shape,
    }, { status: schemaRefused ? 200 : 502 });
  }
}
