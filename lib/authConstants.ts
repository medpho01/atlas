// Edge-safe constants shared between middleware and server-only auth code.
// Do NOT import server-only modules here (pg, bcryptjs, node:crypto, etc.) —
// middleware.ts runs in the Edge runtime and can't load them.

export const SESSION_COOKIE = 'atlas_session';
export const SESSION_TTL_DAYS = 30;
