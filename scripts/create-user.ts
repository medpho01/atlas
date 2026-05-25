#!/usr/bin/env tsx
/**
 * Bootstrap / manage Atlas users from the CLI.
 *
 * Usage:
 *   tsx scripts/create-user.ts <email> <password> "Full Name" [role]
 *   tsx scripts/create-user.ts ceo@labstack.com hunter2 "Pat Shroff" admin
 *
 * Role defaults to 'viewer'. Valid roles: admin | editor | viewer.
 * Re-running with an existing email updates the password + name + role.
 *
 * Requires DATABASE_URL in env (reads .env.local automatically via dotenv).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.production', override: false });

import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

async function main() {
  const [email, password, name, roleArg] = process.argv.slice(2);
  const role = (roleArg ?? 'viewer').toLowerCase();
  if (!email || !password || !name) {
    console.error('Usage: tsx scripts/create-user.ts <email> <password> "<name>" [role]');
    console.error('       role = admin | editor | viewer (default: viewer)');
    process.exit(1);
  }
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    console.error(`Invalid role "${role}". Must be admin | editor | viewer.`);
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  // Atlas users live in the APP DB. Fall back to DATABASE_URL / SOURCE_DATABASE_URL
  // for legacy single-DB dev environments.
  const url = process.env.APP_DATABASE_URL
           ?? process.env.SOURCE_DATABASE_URL
           ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('APP_DATABASE_URL (or SOURCE_DATABASE_URL / DATABASE_URL) not set. Put it in .env.local or export it.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const hash = await bcrypt.hash(password, 12);
  const r = await pool.query(
    `INSERT INTO atlas.users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name          = EXCLUDED.name,
           role          = EXCLUDED.role,
           active        = true
     RETURNING id, email, role, created_at`,
    [email.toLowerCase(), hash, name, role],
  );
  const row = r.rows[0];
  console.log(`✓ User ${row.email} (id=${row.id}, role=${row.role}) ready.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err.message ?? err);
  process.exit(1);
});
