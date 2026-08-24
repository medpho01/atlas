#!/usr/bin/env tsx
/**
 * Answer one question: would this email and password sign in?
 *
 * Runs exactly the checks lib/auth.ts runs — row exists, active, bcrypt
 * compare — against the same database the app uses, with no browser in the
 * way. When a login fails it is otherwise impossible to tell a wrong password
 * from a deactivated account from a stale page, and all three look identical
 * from the sign-in form.
 *
 *   tsx scripts/verify-login.ts <email> <password>
 *
 * Prints a verdict and never prints the password or the hash.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.production', override: false });

import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: tsx scripts/verify-login.ts <email> <password>');
    process.exit(1);
  }
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) { console.error('APP_DATABASE_URL not set.'); process.exit(1); }

  // Show which database is being checked — an app pointed at a different
  // database than the reset script is a real possibility worth ruling out.
  const target = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
  console.log(`Database : ${target}`);

  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(
    `SELECT id, email, role, active, password_hash FROM atlas.users WHERE lower(email) = lower($1)`,
    [email],
  );

  if (!rows.length) {
    console.log(`✗ No user with email "${email}".`);
    const all = await pool.query(`SELECT email, role, active FROM atlas.users ORDER BY id`);
    console.log('  Accounts that do exist:');
    for (const u of all.rows) {
      console.log(`    ${u.active ? ' ' : '✗'} ${u.email}  (${u.role})${u.active ? '' : '  — DEACTIVATED'}`);
    }
    await pool.end();
    process.exit(1);
  }

  const u = rows[0];
  const ok = await bcrypt.compare(password, u.password_hash);

  console.log(`Account  : ${u.email} (id=${u.id}, role=${u.role})`);
  console.log(`Active   : ${u.active ? 'yes' : 'NO — login is refused before the password is even checked'}`);
  console.log(`Password : ${ok ? 'matches' : 'DOES NOT match this account'}`);
  console.log(
    u.active && ok
      ? '\n✓ These credentials would sign in. If the browser still refuses, the problem is the browser or what sits in front of the app, not the account.'
      : '\n✗ These credentials would not sign in.',
  );

  await pool.end();
  process.exit(u.active && ok ? 0 : 1);
}

main().catch((e) => { console.error('Failed:', e.message ?? e); process.exit(1); });
