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
 * count_tokens runs no inference, so asking costs nothing. It will not take
 * the web_search tool, so what it validates is the schema, the system prompt
 * and the message — which is where the complexity limit applies.
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

  // What count_tokens will and will not take, learned the hard way:
  //
  //   max_tokens  — rejected. It counts the input; an output cap is not input.
  //   tools       — rejected when any of them is a server tool. web_search is
  //                 one, and the API expands it to code_execution as well:
  //                 "Server tools are not supported in the count_tokens
  //                 endpoint … Use the /v1/messages endpoint instead."
  //
  // So this validates the schema, the system prompt and the message — which is
  // what the question is about, since the limit that bit is on the schema —
  // and says in its answer that the tools were not part of the check.
  const request: Anthropic.MessageCountTokensParams = {
    model: 'claude-opus-5',
    system: [{ type: 'text', text: SEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: searchPrompt('560001', 'Bengaluru', 'Karnataka', ['PATHOLOGY']) }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SEARCH_SCHEMA } } as never,
  };
  const caveat = 'Schema, system prompt and message only — count_tokens refuses server tools, ' +
                 'so the web_search tool is not part of this check.';

  const anthropic = new Anthropic({ timeout: 60_000, maxRetries: 0 });
  try {
    const r = await anthropic.messages.countTokens(request);
    return NextResponse.json({
      verdict: 'accepted',
      detail: 'Searches run with the structured-output guarantee.',
      checked: caveat,
      input_tokens: r.input_tokens,
      key_suffix: `…${key.slice(-4)}`,
      ...shape,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const schemaRefused = err?.status === 400 && /schema/i.test(err?.message ?? '');
    return NextResponse.json({
      verdict: schemaRefused ? 'rejected' : 'unknown',
      checked: caveat,
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
