// Christmas calendar: 24 doors, a prize a day, winners drawn on a wheel weighted by tickets.
// Tickets come from Reels deposits ($50 = 1 ticket) that the owner confirms in a Discord ticket (ticket-bot/xmas.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_PATH = path.join(__dirname, '../../xmas-calendar.json');
const BOT_URL = 'http://127.0.0.1:3003';
const YEAR = 2026;
const TOTAL_POOL = 1500;
const MAX_WINNERS = 10;
const SPIN_SECONDS = 7;
// [winners, dollars each, prize]: mixed on purpose, bigger on weekends (5-6, 12-13, 19-20) and towards Christmas Eve; sums to 1500
const DEFAULT_DAYS = [
  [5, 5, 'Tip'], [1, 20, 'Bonus Buy'], [2, 15, 'Tip'], [1, 40, 'Bonus Buy'], [5, 10, 'Tip'], [1, 50, 'Tip'],
  [3, 10, 'Tip'], [2, 20, 'Bonus Buy'], [6, 5, 'Tip'], [1, 40, 'Bonus Buy'], [3, 15, 'Tip'], [1, 60, 'Bonus Buy'],
  [6, 10, 'Tip'], [2, 20, 'Bonus Buy'], [1, 40, 'Tip'], [3, 15, 'Tip'], [1, 60, 'Bonus Buy'], [5, 10, 'Tip'],
  [1, 80, 'Bonus Buy'], [4, 20, 'Tip'], [3, 20, 'Bonus Buy'], [1, 75, 'Tip'], [5, 30, 'Tip'], [2, 150, 'Tip'],
];

function defaults() {
  const days = {};
  DEFAULT_DAYS.forEach(([count, amount, kind], i) => { days[i + 1] = { count, amount, prize: `$${amount} ${kind}`, opened: false, openedAt: null, winners: [] }; });
  return { days, entrants: {}, log: [] };
}
function load() {
  try {
    if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch (e) { console.error('[xmas] could not read data:', e.message); }
  return defaults();
}
let data = load();
function save() { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2)); }

// the day of December in Denmark; 0 before the calendar starts, 25 once it is over
function todayDay() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
  const get = (t) => Number(p.find(x => x.type === t).value);
  const y = get('year'), m = get('month'), d = get('day');
  if (y < YEAR || (y === YEAR && m < 12)) return 0;
  if (y > YEAR || d > 24) return 25;
  return d;
}

function entrantList() {
  return Object.entries(data.entrants)
    .map(([id, e]) => ({ id, name: e.name, reels: e.reels || '', tickets: e.tickets || 0, deposit: e.deposit || 0 }))
    .filter(e => e.tickets > 0)
    .sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name));
}

function drawOne(list) {
  const total = list.reduce((s, e) => s + e.tickets, 0);
  if (!total) return null;
  let pick = crypto.randomInt(total);
  for (const e of list) { if (pick < e.tickets) return e; pick -= e.tickets; }
  return list[list.length - 1];
}
// n separate draws, each weighted by tickets; the same person can win more than once, so more tickets always help
function drawMany(list, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = drawOne(list);
    if (!w) break;
    out.push(w);
  }
  return out;
}
const slim = (e) => ({ id: e.id, name: e.name, tickets: e.tickets });

async function notifyBot(route, body) {
  try {
    await fetch(BOT_URL + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-xmas-secret': process.env.XMAS_SECRET || '' }, body: JSON.stringify(body) });
  } catch (e) { console.log('[xmas] bot notify failed:', e.message); }
}

module.exports = function mountXmas(app, { sessions, isAdminUser }) {
  const admin = (req) => {
    const sid = req.query.session || req.headers['x-session-id'] || (req.body && req.body.session);
    const s = sessions[sid];
    return !!(s && isAdminUser(s.username));
  };
  const fromBot = (req) => !!process.env.XMAS_SECRET && req.headers['x-xmas-secret'] === process.env.XMAS_SECRET;

  // public state; what is behind a closed door stays hidden unless the owner asks
  app.get('/xmas/state', (req, res) => {
    const isAdmin = admin(req);
    const list = entrantList();
    const days = Object.keys(data.days).map(Number).sort((a, b) => a - b).map(day => {
      const d = data.days[day];
      const show = d.opened || isAdmin;
      return { day, opened: !!d.opened, openedAt: d.openedAt || null, winners: (d.winners || []).map(w => ({ name: w.name })),
        count: show ? d.count : null, amount: show ? d.amount : null, prize: show ? d.prize : null };
    });
    res.json({
      today: todayDay(), totalPool: TOTAL_POOL, days,
      planned: isAdmin ? Object.values(data.days).reduce((s, d) => s + (Number(d.amount) || 0) * (Number(d.count) || 1), 0) : undefined,
      totalTickets: list.reduce((s, e) => s + e.tickets, 0),
      entrants: list.map(e => isAdmin ? e : { name: e.name, tickets: e.tickets }),
    });
  });

  // ticket-bot: tickets confirmed in a Discord ticket
  app.post('/xmas/entries/add', (req, res) => {
    if (!fromBot(req)) return res.status(403).json({ error: 'Forbidden' });
    const { discordId, name, reels, tickets, deposit } = req.body || {};
    const n = Math.floor(Number(tickets));
    if (!discordId || !Number.isFinite(n) || n < 1 || n > 1000) return res.status(400).json({ error: 'Bad request' });
    const e = data.entrants[discordId] || { name: name || 'Unknown', reels: '', tickets: 0, deposit: 0 };
    e.name = name || e.name;
    if (reels) e.reels = reels;
    e.tickets += n;
    e.deposit = (e.deposit || 0) + (Number(deposit) || 0);
    data.entrants[discordId] = e;
    data.log.push({ at: Date.now(), type: 'add', discordId, name: e.name, tickets: n, deposit: Number(deposit) || 0 });
    save();
    res.json({ ok: true, tickets: e.tickets });
  });

  app.post('/admin/xmas/day', (req, res) => {
    if (!admin(req)) return res.status(403).json({ error: 'Forbidden' });
    const d = data.days[Number(req.body.day)];
    if (!d) return res.status(400).json({ error: 'Unknown day' });
    if (d.opened) return res.status(400).json({ error: 'That door is already open' });
    const amount = Number(req.body.amount), count = Math.floor(Number(req.body.count));
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Bad amount' });
    if (!Number.isFinite(count) || count < 1 || count > MAX_WINNERS) return res.status(400).json({ error: `Winners must be 1 to ${MAX_WINNERS}` });
    d.amount = amount;
    d.count = count;
    d.prize = String(req.body.prize || '').slice(0, 60) || `$${amount} Tip`;
    save();
    res.json({ ok: true });
  });

  app.post('/admin/xmas/entrant', (req, res) => {
    if (!admin(req)) return res.status(403).json({ error: 'Forbidden' });
    const e = data.entrants[req.body.id];
    const n = Math.floor(Number(req.body.tickets));
    if (!e || !Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Bad request' });
    data.log.push({ at: Date.now(), type: 'set', discordId: req.body.id, name: e.name, from: e.tickets, to: n });
    e.tickets = n;
    save();
    res.json({ ok: true });
  });

  // open a door: only the owner, only today's door or an earlier one that was missed
  app.post('/admin/xmas/open', (req, res) => {
    if (!admin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (req.body.test) {
      let demo = entrantList();
      if (!demo.length) demo = ['Rudolph', 'Frosty', 'Grinch', 'Elf', 'Santa', 'Snowman'].map((name, i) => ({ id: 'demo' + i, name, tickets: [8, 5, 3, 2, 1, 1][i] }));
      return res.json({ ok: true, test: true, day: 0, prize: 'TEST SPIN', count: 3, winners: drawMany(demo, 3).map(slim), wheel: demo.map(slim) });
    }
    const day = Number(req.body.day);
    const d = data.days[day];
    if (!d) return res.status(400).json({ error: 'Unknown day' });
    if (day > todayDay()) return res.status(400).json({ error: 'That door cannot be opened yet' });
    const list = entrantList();

    // redraw one winner of an open door; only the person being replaced is left out
    if (req.body.reroll) {
      const index = Number(req.body.index);
      if (!d.opened || !d.winners[index]) return res.status(400).json({ error: 'No such winner to redraw' });
      const pool = list.filter(e => e.id !== d.winners[index].id);
      const w = drawOne(pool);
      if (!w) return res.status(400).json({ error: 'Nobody else has tickets' });
      const old = d.winners[index];
      d.winners[index] = { id: w.id, name: w.name, reels: w.reels, tickets: w.tickets };
      data.log.push({ at: Date.now(), type: 'reroll', day, from: old.name, winner: w.name, discordId: w.id, prize: d.prize });
      save();
      setTimeout(() => notifyBot('/winner', { day, prize: d.prize, winners: [slim(w)], reroll: true }), (SPIN_SECONDS + 2) * 1000);
      return res.json({ ok: true, day, prize: d.prize, count: 1, winners: [slim(w)], wheel: pool.map(slim) });
    }

    if (d.opened) return res.status(400).json({ error: 'That door is already open' });
    const winners = drawMany(list, d.count || 1);
    if (!winners.length) return res.status(400).json({ error: 'Nobody has tickets yet' });
    d.opened = true;
    d.openedAt = Date.now();
    d.winners = winners.map(w => ({ id: w.id, name: w.name, reels: w.reels, tickets: w.tickets }));
    data.log.push({ at: Date.now(), type: 'open', day, winners: winners.map(w => w.name), prize: d.prize });
    save();
    // the announcement waits for the wheel on the page to finish every spin
    setTimeout(() => notifyBot('/winner', { day, prize: d.prize, winners: winners.map(slim) }), (winners.length * (SPIN_SECONDS + 2) + 2) * 1000);
    res.json({ ok: true, day, prize: d.prize, count: d.count, winners: winners.map(slim), wheel: list.map(slim) });
  });
};
