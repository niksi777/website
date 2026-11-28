// Christmas calendar: 24 doors, one prize a day, winner drawn on a wheel weighted by tickets.
// Tickets come from Reels deposits ($50 = 1 ticket) that the owner confirms in a Discord ticket (ticket-bot/xmas.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_PATH = path.join(__dirname, '../../xmas-calendar.json');
const BOT_URL = 'http://127.0.0.1:3003';
const YEAR = 2026;
const TOTAL_POOL = 1500;
// rising towards Christmas Eve, a little extra on weekends (5-6, 12-13, 19-20); sums to 1500
const DEFAULT_AMOUNTS = [25, 25, 25, 35, 50, 50, 30, 30, 30, 35, 45, 60, 60, 40, 40, 45, 45, 55, 80, 80, 65, 75, 125, 350];

function load() {
  try {
    if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch (e) { console.error('[xmas] could not read data:', e.message); }
  const days = {};
  DEFAULT_AMOUNTS.forEach((amount, i) => { days[i + 1] = { amount, prize: `$${amount} Tip`, opened: false, winner: null, openedAt: null }; });
  return { days, entrants: {}, log: [] };
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

function drawWinner(list) {
  const total = list.reduce((s, e) => s + e.tickets, 0);
  if (!total) return null;
  let pick = crypto.randomInt(total);
  for (const e of list) { if (pick < e.tickets) return e; pick -= e.tickets; }
  return list[list.length - 1];
}

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

  // public state; the prize behind a closed door stays hidden unless the owner asks
  app.get('/xmas/state', (req, res) => {
    const isAdmin = admin(req);
    const list = entrantList();
    const days = Object.keys(data.days).map(Number).sort((a, b) => a - b).map(day => {
      const d = data.days[day];
      const show = d.opened || isAdmin;
      return { day, opened: !!d.opened, openedAt: d.openedAt || null, winner: d.winner ? { name: d.winner.name, tickets: d.winner.tickets } : null,
        amount: show ? d.amount : null, prize: show ? d.prize : null };
    });
    res.json({
      today: todayDay(), totalPool: TOTAL_POOL, days,
      planned: isAdmin ? Object.values(data.days).reduce((s, d) => s + (Number(d.amount) || 0), 0) : undefined,
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
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Bad amount' });
    d.amount = amount;
    d.prize = String(req.body.prize || '').slice(0, 80) || `$${amount} Tip`;
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
    const day = Number(req.body.day);
    const d = data.days[day];
    if (!d) return res.status(400).json({ error: 'Unknown day' });
    const reroll = !!req.body.reroll;
    if (d.opened && !reroll) return res.status(400).json({ error: 'That door is already open' });
    if (!d.opened && reroll) return res.status(400).json({ error: 'That door is not open yet' });
    if (day > todayDay()) return res.status(400).json({ error: 'That door cannot be opened yet' });
    let list = entrantList();
    if (reroll && d.winner) list = list.filter(e => e.id !== d.winner.id);
    const w = drawWinner(list);
    if (!w) return res.status(400).json({ error: 'Nobody has tickets yet' });
    const wheel = list.map(e => ({ id: e.id, name: e.name, tickets: e.tickets }));
    d.opened = true;
    d.openedAt = Date.now();
    d.winner = { id: w.id, name: w.name, reels: w.reels, tickets: w.tickets };
    data.log.push({ at: Date.now(), type: reroll ? 'reroll' : 'open', day, winner: w.name, discordId: w.id, prize: d.prize });
    save();
    // the announcement waits for the wheel on the page to stop
    setTimeout(() => notifyBot('/winner', { day, prize: d.prize, amount: d.amount, discordId: w.id, name: w.name, tickets: w.tickets, reroll }), 9000);
    res.json({ ok: true, day, prize: d.prize, amount: d.amount, winner: { id: w.id, name: w.name, tickets: w.tickets }, wheel });
  });
};
