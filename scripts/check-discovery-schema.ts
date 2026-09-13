/**
 * Does the API accept the discovery output schema?
 *
 * Production answered `HTTP 400: Schema is too complex` and every search
 * failed. The schema has been slimmed and the search now falls back to the
 * prompt alone if it is rejected again — but "is it accepted" should be
 * answerable in a second, without a deploy and without paying for a search.
 *
 *   npm run check:discovery-schema
 *
 * Local only. The server has no Node — the app runs from a standalone build
 * inside a container, which carries neither this file nor the TypeScript it
 * imports. Ask a deployed host through the route instead, which runs the same
 * check with that container's key:
 *
 *   GET /api/discovery/schema-check
 *
 * Uses messages.count_tokens, which validates the whole request — schema,
 * tools and system prompt — and runs no inference, so it costs nothing.
 * Reads the key the app reads: ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_SYSTEM, SEARCH_SCHEMA, searchPrompt } from '../lib/labDiscovery';

const MODEL = 'claude-opus-5';

const count = (o: unknown): number =>
  o && typeof o === 'object'
    ? 1 + Object.values(o as Record<string, unknown>).reduce((n: number, v) => n + count(v), 0)
    : 0;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error('No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in the environment.');
    console.error('For a deployed host, use the route instead: GET /api/discovery/schema-check');
    process.exit(2);
  }

  const props = (SEARCH_SCHEMA as { properties: { labs: { items: { properties: object } } } })
    .properties.labs.items.properties;
  console.log(`Schema: ${Object.keys(props).length} properties per lab, ${count(SEARCH_SCHEMA)} nodes.\n`);

  const anthropic = new Anthropic({ timeout: 60_000, maxRetries: 0 });
  const request = {
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: SEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: searchPrompt('560001', 'Bengaluru', 'Karnataka', ['PATHOLOGY']) }],
  };

  try {
    const r = await anthropic.messages.countTokens({
      ...request,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SEARCH_SCHEMA } },
    } as never);
    console.log(`ACCEPTED — the schema is within the limit (${r.input_tokens} input tokens).`);
    console.log('Searches run with the structured-output guarantee.');
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 400 && /schema/i.test(err?.message ?? '')) {
      console.log(`REJECTED — ${err.message}`);
      console.log('\nSearches still work: the code falls back to the prompt alone, which asks');
      console.log('for the same JSON and parses it. To restore the guarantee, drop fields from');
      console.log('SEARCH_SCHEMA in lib/labDiscovery.ts and run this again.');
      process.exit(1);
    }
    console.error(`Could not tell — ${err?.status ?? ''} ${err?.message ?? String(e)}`);
    process.exit(2);
  }
}

main();
