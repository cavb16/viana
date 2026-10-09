'use strict';
/* =====================================================================
   Viana – WhatsApp reminders (version 2.2)
   Runs on GitHub Actions every 15 minutes. It reads every user's data from
   Firebase, works out which reminders fall due since the last run, and sends
   one WhatsApp message per user through Whapi.

   Secrets (GitHub → Settings → Secrets and variables → Actions → Secrets):
     WHAPI_TOKEN                – the API token of your Whapi channel
     FIREBASE_SERVICE_ACCOUNT   – the full JSON of a Firebase service-account key
   Optional variables (same page → Variables tab):
     VIANA_TIMEZONE             – default Asia/Kolkata
     VIANA_APP_URL              – link added to the end of each message
   ===================================================================== */

const TZ = process.env.VIANA_TIMEZONE || 'Asia/Kolkata';
const APP_URL = (process.env.VIANA_APP_URL || '').trim();
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const TEST_TO = String(process.env.TEST_TO || '').replace(/[^\d]/g, '');

const DEFAULT_TIMES = ['06:00', '10:00', '14:00', '18:00', '22:00'];
const WEEKLY_WISHES = { weekday: 5, time: '18:00' };   // Friday 6 pm (0 = Sunday)
const FIRST_RUN_LOOKBACK_MIN = 20;                     // first ever run looks back this far
const MAX_LOOKBACK_MIN = 180;                          // never catch up more than 3 hours of missed runs
const PRIORITY = ['Very low', 'Low', 'Medium', 'High', 'Very high'];

/* ---------- time-zone helpers (no extra libraries) ---------- */
function zoneParts(ms, tz = TZ) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: wd };
}
/** Converts a local date + time in the time zone to a UTC timestamp. */
function zonedToMs(date, time, tz = TZ) {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zoneParts(guess, tz);
    const shown = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), +p.time.slice(0, 2), +p.time.slice(3, 5));
    const diff = target - shown;
    if (!diff) break;
    guess += diff;
  }
  return guess;
}
function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekdayOf(date) { return new Date(date + 'T00:00:00Z').getUTCDay(); }
function datesBetween(startMs, endMs, tz = TZ) {
  const out = []; let d = zoneParts(startMs, tz).date; const last = zoneParts(endMs, tz).date;
  while (d <= last && out.length < 5) { out.push(d); d = addDays(d, 1); }
  return out;
}
const fires = (date, time, startMs, endMs, tz = TZ) => { const t = zonedToMs(date, time, tz); return t > startMs && t <= endMs; };
const validTime = t => /^\d{2}:\d{2}$/.test(t || '');

/* ---------- deciding what is due ---------- */
const isWish = t => !t.date;
const notRecorded = t => !(t.actual && t.actual.status);
const rem = t => Object.assign({ def: true, times: [], weekly: true, at: [] }, t.rem || {});
const byPriority = (a, b) => ((+b.plan?.importance || 0) - (+a.plan?.importance || 0)) || String(a.name || '').localeCompare(String(b.name || ''));

/**
 * Works out the reminder sections for one user for the window (startMs, endMs].
 * Returns [{kind:'tasks', date, tasks:[...]}, {kind:'wishes', weekly:bool, tasks:[...]}]
 */
function dueSections(data, startMs, endMs, tz = TZ) {
  const tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
  const sections = [];
  const wishIds = new Set(); let weeklyFired = false;
  for (const date of datesBetween(startMs, endMs, tz)) {
    const defaultFired = DEFAULT_TIMES.some(tm => fires(date, tm, startMs, endMs, tz));
    const due = tasks.filter(t => t.date === date && !t.unplanned && notRecorded(t) && (
      (defaultFired && rem(t).def !== false) ||
      rem(t).times.some(tm => validTime(tm) && fires(date, tm, startMs, endMs, tz))));
    if (due.length) sections.push({ kind: 'tasks', date, tasks: due.sort(byPriority) });
    if (weekdayOf(date) === WEEKLY_WISHES.weekday && fires(date, WEEKLY_WISHES.time, startMs, endMs, tz)) {
      weeklyFired = true;
      tasks.filter(t => isWish(t) && rem(t).weekly !== false).forEach(t => wishIds.add(t.id));
    }
  }
  tasks.filter(isWish).forEach(t => {
    if (rem(t).at.some(a => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(a || '') && fires(a.slice(0, 10), a.slice(11, 16), startMs, endMs, tz))) wishIds.add(t.id);
  });
  if (wishIds.size) sections.push({ kind: 'wishes', weekly: weeklyFired, tasks: tasks.filter(t => wishIds.has(t.id)).sort(byPriority) });
  return sections;
}

/* ---------- message text ---------- */
function niceDate(date) { return new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function taskLines(t, i, acts) {
  const a = acts[t.activityId], p = t.plan || {};
  const lines = [`${i + 1}. *${t.name || (a && a.name) || 'Task'}*`];
  const meta = [`Activity: ${a ? a.name : '—'}`];
  if (p.importance) meta.push(`Priority: ${PRIORITY[p.importance - 1]}`);
  lines.push('   ' + meta.join(' · '));
  lines.push('   Motive: ' + ((p.motives && p.motives.length) ? p.motives.join(', ') : '—'));
  lines.push('   Expected outcome: ' + ((p.outcomes && p.outcomes.length) ? p.outcomes.join(', ') : '—'));
  return lines.join('\n');
}
function buildMessage(username, data, sections, todayDate) {
  const acts = Object.fromEntries(((data && data.activities) || []).map(a => [a.id, a]));
  const parts = [`🌿 *Viana reminder*`, `Hi ${username},`];
  for (const s of sections) {
    if (s.kind === 'tasks') {
      const when = s.date === todayDate ? 'today' : `on ${niceDate(s.date)}`;
      parts.push(s.tasks.length === 1
        ? `\nThis task ${when} doesn't have actuals recorded yet:\n`
        : `\nThese ${s.tasks.length} tasks ${when} don't have actuals recorded yet:\n`);
    } else {
      parts.push(`\n⭐ *${s.weekly ? 'Your wishes without a date' : 'A reminder about your wish' + (s.tasks.length > 1 ? 'es' : '')}* (${s.tasks.length}):\n`);
    }
    parts.push(s.tasks.map((t, i) => taskLines(t, i, acts)).join('\n\n'));
  }
  if (APP_URL) parts.push(`\nOpen Viana: ${APP_URL}`);
  return parts.join('\n');
}

/* ---------- Whapi ---------- */
async function sendWhatsApp(to, body) {
  const res = await fetch('https://gate.whapi.cloud/messages/text', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.WHAPI_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ to, body })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const hint = { 401: 'the Whapi channel is not connected or the token is wrong', 402: 'the Whapi Sandbox limit has been reached', 429: 'too many requests' }[res.status] || '';
    throw new Error(`Whapi replied ${res.status}${hint ? ' (' + hint + ')' : ''}: ${txt.slice(0, 200)}`);
  }
}
const mask = n => n ? n.slice(0, 2) + '•••••' + n.slice(-3) : '';

/* ---------- main ---------- */
async function main() {
  if (!process.env.WHAPI_TOKEN && !DRY_RUN) throw new Error('The WHAPI_TOKEN secret is missing. Add it in GitHub → Settings → Secrets and variables → Actions.');

  if (TEST_TO) {
    const msg = `🌿 *Viana test message*\nIf you can read this, WhatsApp reminders are set up correctly.`;
    if (DRY_RUN) console.log(`[dry run] Would send a test message to ${mask(TEST_TO)}:\n${msg}`);
    else { await sendWhatsApp(TEST_TO, msg); console.log(`Test message sent to ${mask(TEST_TO)}.`); }
    return;
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('The FIREBASE_SERVICE_ACCOUNT secret is missing. Add it in GitHub → Settings → Secrets and variables → Actions.');
  let creds;
  try { creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole contents of the downloaded key file, from { to }.'); }

  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  const db = admin.firestore();
  const metaRef = db.collection('meta').doc('reminders');

  const now = Date.now();
  const meta = (await metaRef.get()).data() || {};
  const last = meta.lastRunMs ? +meta.lastRunMs : now - FIRST_RUN_LOOKBACK_MIN * 60000;
  const start = Math.max(last, now - MAX_LOOKBACK_MIN * 60000);
  const todayDate = zoneParts(now).date;
  console.log(`Checking reminders due after ${zoneParts(start).date} ${zoneParts(start).time} and up to ${todayDate} ${zoneParts(now).time} (${TZ})${DRY_RUN ? ' — DRY RUN, nothing will be sent' : ''}.`);

  const snap = await db.collection('users').get();
  let sent = 0, failed = 0, skipped = 0;
  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.disabled) { skipped++; continue; }
    let data; try { data = JSON.parse(u.data || '{}'); } catch (e) { skipped++; continue; }
    const prof = data.profile || {};
    const phone = String(prof.phone || '').replace(/[^\d]/g, '');
    if (!phone || prof.remindersOn === false) { skipped++; continue; }
    const sections = dueSections(data, start, now);
    if (!sections.length) continue;
    const msg = buildMessage(u.username || 'there', data, sections, todayDate);
    if (DRY_RUN) { console.log(`\n[dry run] To ${u.username} (${mask(phone)}):\n${msg}\n`); continue; }
    try { await sendWhatsApp(phone, msg); sent++; console.log(`Sent to ${u.username} (${mask(phone)}).`); }
    catch (e) { failed++; console.error(`Could not send to ${u.username}: ${e.message}`); }
  }
  if (!DRY_RUN) await metaRef.set({ lastRunMs: now, lastRunAt: new Date(now).toISOString(), lastSent: sent, lastFailed: failed }, { merge: true });
  console.log(`Done. Sent ${sent}, failed ${failed}, users without a number or with reminders off: ${skipped}.`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}
module.exports = { main, zoneParts, zonedToMs, datesBetween, dueSections, buildMessage, DEFAULT_TIMES };
