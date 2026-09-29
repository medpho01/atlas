#!/usr/bin/env node
/**
 * Order tracking desk runner.
 *
 *   node scripts/order-tracking/run.mjs --queue=needs-lab
 *   node scripts/order-tracking/run.mjs --queue=needs-lab --assign-to="Varun Kansal" --limit=10 --apply
 *   node scripts/order-tracking/run.mjs --queue=pickup-today --out=pickup.csv
 *   node scripts/order-tracking/run.mjs --queue=report-outstanding --out=late.csv
 *
 * Three things about how this is built, because they are choices and not
 * accidents.
 *
 * 1. IT DOES NOT WRITE UNLESS YOU SAY --apply.
 *    Every run is a dry run by default. It reads, it decides, it prints what it
 *    would do, and it stops. This points at production; a script that assigns
 *    real orders on its first accidental run is a mistake waiting for a bad
 *    afternoon.
 *
 * 2. IT ASSIGNS IN ONE CALL, NOT ONE PER ROW.
 *    The page already has a bulk bar — tick rows, pick a person, press Assign —
 *    and the action behind it takes up to 200 order ids in a single request.
 *    Driving the per-row dropdown ten times would be ten round trips, ten
 *    chances to half-finish, and ten rows of audit where one belongs.
 *
 * 3. IT FILTERS THROUGH THE URL, NOT THE POPOVER.
 *    The store filter, the tab and the appointment window are all search
 *    params. Setting them directly is one navigation instead of a sequence of
 *    clicks on a floating panel, and it cannot half-apply. The popover is used
 *    exactly once, to learn which store id belongs to which name.
 *
 * Patient names and phone numbers are on this screen. Numbers are masked in
 * the log and in the CSV unless you pass --include-pii, and the file is written
 * where you point it — not into the repo.
 */

import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The desk's own configuration
// ---------------------------------------------------------------------------

/** The stores this desk watches. Matched on the name shown in the picker. */
const S1_STORES = [
  'Sugarfit',
  'Elevate Now',
  'Alyve Health',
  'Twin Health',
  'Volo TPA',
  'Medikites',
];

/**
 * The three queues, and the tab each one lives on.
 *
 * `within` is the appointment window for the allocation queue: 1 is tomorrow
 * only, 3 and 7 reach further ahead, and undefined is everything ahead. The
 * spec says T+1 up to T+n, so the default is everything ahead and --within
 * narrows it.
 */
const QUEUES = {
  'needs-lab': {
    tab: 'needs_lab',
    label: 'Needs a lab',
    /** Only rows still sitting on the placeholder are actionable here. */
    requiresPlaceholder: true,
  },
  'pickup-today': {
    tab: 'confirm_pickup',
    label: 'Pickup today',
    requiresPlaceholder: false,
  },
  'report-outstanding': {
    tab: 'chase_report',
    label: 'Report outstanding',
    requiresPlaceholder: false,
  },
};

/**
 * Queue C's lifecycle states, mapped to what "OrderStatus" actually holds.
 *
 * Three of the six names in the brief are not values of that enum:
 *
 *   "Phlebo started"    → no such status. PHLEBO_ASSIGNED is the nearest, and
 *                         it means assigned rather than started.
 *   "Sample in transit" → no such status. Between SAMPLE_COLLECTED and
 *                         SAMPLE_DELIVERED there is nothing recorded.
 *   "Partial delivered" → PARTIAL_DELIVERED exists on PharmaOrderStatus, which
 *                         is pharmacy orders. Lab orders never carry it.
 *
 * They are kept here so the run reports them as unmatched rather than quietly
 * narrowing the filter — a queue that silently drops a third of its rules is
 * worse than one that refuses.
 */
const REPORT_STATES = {
  'Phlebo started': null,
  'Sample collected': 'SAMPLE_COLLECTED',
  'Sample in transit': null,
  'Sample delivered': 'SAMPLE_DELIVERED',
  'Sample processed': 'SAMPLE_PROCESSED',
  'Partial delivered': null,
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);

const CONF = {
  base: (args.base || process.env.ATLAS_BASE || 'https://atlas.labstack.in').replace(/\/$/, ''),
  queue: args.queue || 'needs-lab',
  assignTo: args['assign-to'] || null,
  limit: args.limit ? Number(args.limit) : 10,
  within: args.within ? String(args.within) : null,
  apply: args.apply === true,
  out: args.out || null,
  includePii: args['include-pii'] === true,
  headed: args.headed === true,
  /** Playwright's own chromium, or an installed browser via --channel=chrome. */
  channel: args.channel || process.env.ATLAS_BROWSER_CHANNEL || null,
  /** Between navigations. The portal is somebody's working tool, not a target. */
  pauseMs: args.pause ? Number(args.pause) : 1200,
  timeoutMs: args.timeout ? Number(args.timeout) : 45000,
  storage: args.storage || process.env.ATLAS_STORAGE || 'scripts/order-tracking/.session.json',
  cookie: process.env.ATLAS_SESSION_COOKIE || null,
  stores: args.stores ? String(args.stores).split(',').map((s) => s.trim()).filter(Boolean) : S1_STORES,
};

const log = (...m) => console.log(...m);
const warn = (...m) => console.warn('  !', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A phone number, shown as itself or as the last three digits. */
const phone = (v) => (!v ? '' : CONF.includePii ? v : v.replace(/.(?=.{3})/g, '•'));

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Reuse a signed-in session rather than handling a password.
 *
 * Two ways in, both of which keep the credential out of this file and out of
 * the process list:
 *
 *   ATLAS_SESSION_COOKIE=<value>   the atlas_session cookie, from a browser
 *   --storage=path/to/state.json   a Playwright storageState, written by
 *                                  `npx playwright open --save-storage=…`
 *
 * If neither is present the script opens a window and waits for you to sign in
 * by hand, then saves the state for next time.
 */
async function newContext(browser) {
  if (CONF.cookie) {
    const ctx = await browser.newContext();
    await ctx.addCookies([{
      name: 'atlas_session',
      value: CONF.cookie,
      url: CONF.base,
      httpOnly: true,
      sameSite: 'Lax',
    }]);
    log('session : ATLAS_SESSION_COOKIE');
    return ctx;
  }

  if (existsSync(CONF.storage)) {
    log(`session : ${CONF.storage}`);
    return browser.newContext({ storageState: CONF.storage });
  }

  log('session : none found — opening a window, sign in and it will be saved');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${CONF.base}/login`, { timeout: CONF.timeoutMs });
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 5 * 60_000 });
  await ctx.storageState({ path: CONF.storage });
  log(`session : saved to ${CONF.storage}`);
  await page.close();
  return ctx;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function queueUrl({ tab, storeIds, within, mine }) {
  const p = new URLSearchParams();
  if (tab && tab !== 'needs_lab') p.set('tab', tab);
  if (storeIds?.length) p.set('store', storeIds.join(','));
  if (within) p.set('within', within);
  if (mine) p.set('mine', '1');
  const q = p.toString();
  return `${CONF.base}/order-tracking${q ? `?${q}` : ''}`;
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: CONF.timeoutMs });
  // A streamed 200 is not proof of a session: Next sends the shell and then
  // redirects on the client, so the URL is the only thing worth believing.
  if (new URL(page.url()).pathname.startsWith('/login')) {
    throw new Error('Signed out. Refresh the session (delete the storage file and re-run).');
  }
  await page.waitForSelector('h1', { timeout: CONF.timeoutMs });
  await sleep(CONF.pauseMs);
}

/**
 * Store name → store id, learned once from the picker.
 *
 * The picker lists only the stores with work in the queue it was opened on, so
 * a name missing here means "nothing in this queue", not "no such store". The
 * two are reported separately because they lead to different conversations.
 */
async function resolveStoreIds(page, tab, names) {
  await open(page, queueUrl({ tab }));

  const trigger = page.getByRole('button', { name: /All stores|\d+ stores?|^(?!.*All).+$/ }).first();
  const picker = page.locator('button').filter({ hasText: /^All stores$|^\d+ stores?$/ }).first();
  const target = (await picker.count()) ? picker : trigger;
  await target.click({ timeout: CONF.timeoutMs });

  const available = await page.$$eval('label', (ls) =>
    ls.map((l) => l.innerText.trim().split('\n')[0]).filter(Boolean));

  const found = [];
  const missing = [];
  for (const name of names) {
    const match = available.find((a) => a.toLowerCase() === name.toLowerCase())
      ?? available.find((a) => a.toLowerCase().includes(name.toLowerCase()));
    if (!match) { missing.push(name); continue; }
    const box = page.locator('label').filter({ hasText: match }).first();
    await box.click();
    found.push(match);
  }

  if (!found.length) {
    await page.keyboard.press('Escape');
    return { ids: [], found, missing };
  }

  await page.getByRole('button', { name: /^Apply/ }).click({ timeout: CONF.timeoutMs });

  // Wait for the URL, not for the network. Applying the picker is a client-side
  // router.push, and the page is already idle when it fires — waiting on
  // networkidle returns immediately and reads the URL from before the push,
  // which looks exactly like "none of those stores have any work".
  await page.waitForURL(/[?&]store=/, { timeout: CONF.timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: CONF.timeoutMs }).catch(() => {});

  const ids = (new URL(page.url()).searchParams.get('store') ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  return { ids, found, missing };
}

// ---------------------------------------------------------------------------
// Reading the table
// ---------------------------------------------------------------------------

/**
 * Every visible row, keyed by the header text rather than by column position,
 * so a column added to the left of the table does not shift every field by one.
 */
async function readRows(page) {
  return page.$$eval('table tbody tr', (trs) => {
    const table = trs[0]?.closest('table');
    const heads = table
      ? [...table.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
      : [];
    const at = (name) => heads.findIndex((h) => h.includes(name));

    const iUser = at('user');
    const iAppt = at('appointment');
    const iWhere = at('where');
    const iLab = at('lab') >= 0 && at('lab') !== at('labs in range') ? at('lab') : -1;
    const iRange = at('labs in range');
    const iQuote = at('quote');
    const iAssigned = at('assigned to');

    const cell = (tds, i) => (i >= 0 && tds[i] ? tds[i].innerText.trim() : '');

    return trs.map((tr) => {
      const tds = [...tr.children];
      const user = cell(tds, iUser);
      // The user cell is "Name" then the phone on its own line. Split on the
      // line rather than running a number regex over the whole thing: in a
      // regex \s matches a newline too, so a name ending in digits ran
      // straight into the number underneath it.
      const userLines = user.split('\n').map((x) => x.trim()).filter(Boolean);
      const phoneLine = userLines.find((l) => /^[+]?[0-9][0-9 -]{6,}$/.test(l)) ?? "";
      const lab = cell(tds, iLab);
      const assigned = cell(tds, iAssigned);
      const link = tr.querySelector('a[href*="/requests/"], a[href*="order"]');
      return {
        // The order id is not a column; it is on the row's own link or its
        // checkbox label, which is where the page actually keeps it.
        orderId: (tr.querySelector('input[type="checkbox"]')?.getAttribute('aria-label') || '')
          .match(/\d+/)?.[0] ?? (link?.getAttribute('href') || '').match(/\d+/)?.[0] ?? null,
        patient: userLines[0] ?? "",
        phone: phoneLine,
        appointment: cell(tds, iAppt).replace(/\n/g, ' '),
        where: cell(tds, iWhere).replace(/\n/g, ' '),
        lab: lab.replace(/\n/g, ' '),
        onPlaceholder: /placeholder, not a real lab/i.test(lab),
        labsInRange: cell(tds, iRange).replace(/\n/g, ' '),
        quote: cell(tds, iQuote),
        assignedTo: /assign to/i.test(assigned) ? '' : assigned.replace(/\n/g, ' '),
        selectable: !!tr.querySelector('input[type="checkbox"]'),
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Queue A — assign
// ---------------------------------------------------------------------------

async function assignBatch(page, rows, assignee) {
  const ids = rows.map((r) => r.orderId);

  // Tick exactly the rows we chose. Not the select-all box: it takes the whole
  // queue, and the whole queue is not what was decided.
  for (const r of rows) {
    const box = page.locator(`tbody input[type="checkbox"][aria-label*="${r.orderId}"]`).first();
    if (await box.count()) await box.check({ timeout: CONF.timeoutMs });
    else {
      const byIndex = page.locator('tbody input[type="checkbox"]').nth(rows.indexOf(r));
      await byIndex.check({ timeout: CONF.timeoutMs });
    }
  }

  const picker = page.getByLabel('Assign the selected orders to');
  await picker.waitFor({ state: 'visible', timeout: CONF.timeoutMs });

  const options = await picker.locator('option').allTextContents();
  const match = options.find((o) => o.trim().toLowerCase() === assignee.toLowerCase())
    ?? options.find((o) => o.trim().toLowerCase().includes(assignee.toLowerCase()));
  if (!match) {
    throw new Error(
      `"${assignee}" is not in the assignee list. Available: ${options.filter((o) => !/^Assign to|^Unassign/.test(o)).join(', ')}`);
  }
  await picker.selectOption({ label: match });

  await page.getByRole('button', { name: /^Assign$/ }).click({ timeout: CONF.timeoutMs });

  // The bulk bar clears itself when the server comes back, which is the only
  // signal the page gives that the write landed.
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Assign the selected orders to"]'),
    { timeout: CONF.timeoutMs },
  ).catch(() => warn('the bulk bar did not clear — check the queue before re-running'));

  return { ids, assignee: match };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  ['Order ID', (r) => r.orderId],
  ['Patient', (r) => r.patient],
  ['Phone', (r) => phone(r.phone)],
  ['Appointment', (r) => r.appointment],
  ['Where', (r) => r.where],
  ['Lab', (r) => r.lab],
  ['On placeholder', (r) => (r.onPlaceholder ? 'yes' : 'no')],
  ['Labs in range', (r) => r.labsInRange],
  ['Quote', (r) => r.quote],
  ['Assigned to', (r) => r.assignedTo],
];

function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    // A value starting = + - @ is executed as a formula when the file opens.
    const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  const head = CSV_COLUMNS.map(([h]) => cell(h)).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map(([, get]) => cell(get(r))).join(','));
  // Built from a char code so no editor or formatter can strip the mark.
  return String.fromCharCode(0xFEFF) + [head, ...body].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const q = QUEUES[CONF.queue];
  if (!q) {
    console.error(`Unknown queue "${CONF.queue}". One of: ${Object.keys(QUEUES).join(', ')}`);
    process.exit(2);
  }

  log('');
  log(`Atlas order tracking · ${q.label}`);
  log(`  portal  : ${CONF.base}`);
  log(`  mode    : ${CONF.apply ? 'APPLY — this will write' : 'dry run (pass --apply to write)'}`);
  if (CONF.queue === 'report-outstanding') {
    const unmatched = Object.entries(REPORT_STATES).filter(([, v]) => v === null).map(([k]) => k);
    if (unmatched.length) {
      warn(`${unmatched.length} of the 6 lifecycle states in the brief are not OrderStatus values`
        + ` and cannot be filtered on: ${unmatched.join(', ')}.`);
      warn('  The queue is derived server-side from "appointment passed, no report yet",');
      warn('  which already covers every state that is not REPORT_DELIVERED.');
    }
  }

  // Prefer whatever is actually installed. A machine that has Chrome but not
  // `npx playwright install` is the common case on an ops laptop, and failing
  // there with "Executable doesn't exist" helps nobody.
  const launch = { headless: !CONF.headed };
  let browser;
  try {
    browser = await chromium.launch(CONF.channel ? { ...launch, channel: CONF.channel } : launch);
  } catch (e) {
    if (CONF.channel) throw e;
    log('  (no bundled chromium — falling back to the installed Chrome)');
    browser = await chromium.launch({ ...launch, channel: 'chrome' });
  }
  let ctx;
  let exitCode = 0;

  try {
    ctx = await newContext(browser);
    const page = await ctx.newPage();
    page.setDefaultTimeout(CONF.timeoutMs);

    // ---- the store whitelist ------------------------------------------
    log('');
    log('Resolving the store filter…');
    const { ids, found, missing } = await resolveStoreIds(page, q.tab, CONF.stores);
    log(`  matched : ${found.length ? found.join(', ') : '(none)'}`);
    if (missing.length) {
      warn(`no work in this queue for: ${missing.join(', ')}`);
      warn('  (the picker only lists stores with rows here — it is not proof the store is gone)');
    }
    if (!ids.length) {
      log('');
      log('Nothing to do: none of the listed stores have rows in this queue.');
      await browser.close();
      return;
    }

    // ---- the queue ------------------------------------------------------
    const url = queueUrl({ tab: q.tab, storeIds: ids, within: CONF.within });
    log('');
    log(`Opening ${url}`);
    await open(page, url);

    const rows = await readRows(page);
    log(`  ${rows.length} row${rows.length === 1 ? '' : 's'} in ${q.label}`);

    const actionable = q.requiresPlaceholder ? rows.filter((r) => r.onPlaceholder) : rows;
    if (q.requiresPlaceholder) {
      log(`  ${actionable.length} still on the placeholder lab`
        + ` (${rows.length - actionable.length} already have a real lab)`);
    }

    for (const r of actionable) {
      log(`    #${r.orderId ?? '?'}  ${r.patient.padEnd(22)} ${phone(r.phone).padEnd(14)}`
        + ` ${r.appointment.padEnd(22)} ${r.where.padEnd(18)}`
        + ` ${r.assignedTo ? `→ ${r.assignedTo}` : 'unassigned'}`);
    }

    // ---- write it out ----------------------------------------------------
    if (CONF.out) {
      await writeFile(path.resolve(CONF.out), toCsv(actionable), 'utf8');
      log('');
      log(`  wrote ${actionable.length} rows to ${CONF.out}`
        + `${CONF.includePii ? ' (WITH phone numbers)' : ' (phone numbers masked)'}`);
    }

    // ---- assign ----------------------------------------------------------
    if (CONF.assignTo) {
      const unassigned = actionable.filter((r) => !r.assignedTo && r.selectable);
      const batch = unassigned.slice(0, CONF.limit);

      log('');
      log(`Assignment: ${unassigned.length} unassigned, target ${CONF.limit},`
        + ` taking ${batch.length}`);

      if (!batch.length) {
        log('  nothing to assign.');
      } else if (!CONF.apply) {
        log(`  DRY RUN — would assign these ${batch.length} to "${CONF.assignTo}":`);
        batch.forEach((r) => log(`    #${r.orderId}  ${r.patient}`));
        log('  re-run with --apply to do it.');
      } else {
        const res = await assignBatch(page, batch, CONF.assignTo);
        log(`  assigned ${res.ids.length} order(s) to ${res.assignee}: ${res.ids.join(', ')}`);

        await sleep(CONF.pauseMs);
        await open(page, url);
        const after = await readRows(page);
        const still = after.filter((r) => batch.some((b) => b.orderId === r.orderId) && !r.assignedTo);
        if (still.length) {
          warn(`${still.length} of them still read unassigned: ${still.map((r) => r.orderId).join(', ')}`);
          exitCode = 1;
        } else {
          log('  verified: every one of them now shows an owner.');
        }
      }
    }

    log('');
    log('Done.');
  } catch (err) {
    console.error('');
    console.error('FAILED:', err.message);
    if (args.debug) console.error(err.stack);
    exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  process.exit(exitCode);
})();
