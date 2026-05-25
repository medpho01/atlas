import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

// Liveness/readiness probe for the Docker healthcheck. Cheap: SELECT 1.
// Public — does not require auth (middleware whitelists /api/health).
export async function GET() {
  try {
    await queryOne(`SELECT 1 AS ok`);
    return NextResponse.json({ status: 'ok', db: 'up' });
  } catch (err: any) {
    return NextResponse.json({ status: 'degraded', db: 'down', error: err?.message ?? String(err) }, { status: 503 });
  }
}
