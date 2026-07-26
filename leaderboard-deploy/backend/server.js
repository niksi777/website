require("dotenv").config({path:"/root/website/.env"});
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// SPA root route
app.get('/', (req,res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));

// Serve frontend files correctly
app.use(express.static(path.join(__dirname, "../frontend")));

const db = new sqlite3.Database(path.join(__dirname, "database.db"));

// Create table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      wager REAL,
      position INTEGER,
      avatar TEXT,
      reward REAL
    )
  `);
});

let lastUpdatedMs = null;

function normalizeChancerRows(payload) {
  const list = Array.isArray(payload)
    ? payload
    : (payload && (payload.rows || payload.leaderboard || payload.data || payload.results)) || [];

  if (!Array.isArray(list)) return [];

  return list
    .map((row, index) => {
      const username =
        row.username ||
        row.user ||
        row.player ||
        row.display_name ||
        row.nickname ||
        `player_${index + 1}`;

      const wager = Number(
        row.wager ??
        row.wagered ??
        row.total_wager ??
        row.totalWager ??
        row.volume ??
        0
      );

      const position = Number(row.position ?? row.rank ?? row.place ?? index + 1);

      return {
        id: row.id ?? `${position}-${username}`,
        username,
        wager,
        position,
        avatar: row.avatar || row.image || row.profile_image || "/assets/niksi.png",
      };
    })
    .sort((a, b) => a.position - b.position);
}

async function updateAcebet() {
  try {
    const response = await fetch(
      "https://api.acebet.co/affiliates/detailed-summary/v2/2023-01-01",
      {
        headers: {
          "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();
    console.log("ACEBET DATA:", data);
  } catch (err) {
    console.log("Acebet error:", err);
  }
}

// Fetch Gamba leaderboard
let gambaMeta = { endDate: null, prizePool: null };
async function updateLeaderboard() {
  try {
    const raceId = 16139;

    const gql = JSON.stringify({
      query: `query { getRaceById(raceId: ${raceId}) { id prize_pool start_date end_date race_name competitors { id display_name total_wagered position avatar vip_level_name } prize_distribution { position percentage amount } } }`
    });

    const response = await fetch("https://gamba.com/_api/@", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Referer": `https://gamba.com/promotions/exclusive-leaderboards/${raceId}`,
        "Origin": "https://gamba.com",
      },
      body: gql,
    });

const text = await response.text();

console.log("GAMBA STATUS:", response.status);
console.log("GAMBA RAW RESPONSE:", text);

let json;
try {
  json = JSON.parse(text);
} catch (err) {
  console.log("Gamba returned non-JSON");
  return;
}

    const race = json.data.getRaceById;
    gambaMeta.endDate = race.end_date ? race.end_date.replace(' ', 'T') + 'Z' : null;
    gambaMeta.prizePool = race.prize_pool || null;
    const competitors = race.competitors;
    const prizes = race.prize_distribution;

    console.log("Race ID:", raceId);
    console.log("Competitors:", competitors ? competitors.length : 0);

    if (!competitors || competitors.length === 0) {
      console.log("No competitors returned — keeping existing data");
      return;
    }

    db.run("DELETE FROM players");

    competitors.forEach((player) => {
      const prize = prizes.find((p) => p.position === player.position);

      db.run(
        `INSERT INTO players (username, wager, position, avatar, reward)
         VALUES (?, ?, ?, ?, ?)`,
        [
          player.display_name,
          player.total_wagered,
          player.position,
          player.avatar,
          prize ? prize.amount : 0,
        ]
      );
    });

    console.log("Leaderboard updated from Gamba");
  } catch (err) {
    console.log("Update error:", err);
  }
}

// Update every 30 seconds
setInterval(updateLeaderboard, 160000);
updateLeaderboard();

// Existing Gamba endpoint
﻿const fs_lb = require("fs");
const LB_HISTORY_PATH = require("path").join(__dirname, "gamba-history.json");
const GAMBA_HIDDEN_PATH = require("path").join(__dirname, "gamba-hidden.json");

function loadGambaHidden() {
  try { return fs_lb.existsSync(GAMBA_HIDDEN_PATH) ? JSON.parse(fs_lb.readFileSync(GAMBA_HIDDEN_PATH, "utf-8")) : []; } catch { return []; }
}
function saveGambaHidden(list) {
  fs_lb.writeFileSync(GAMBA_HIDDEN_PATH, JSON.stringify(list, null, 2));
}
let gambaHidden = loadGambaHidden();

app.get("/lb-meta", (req, res) => {
  res.json({ lastUpdated: lastUpdatedMs });
});

app.get("/lb-history", (req, res) => {
  try {
    const data = fs_lb.existsSync(LB_HISTORY_PATH)
      ? JSON.parse(fs_lb.readFileSync(LB_HISTORY_PATH, "utf-8"))
      : [];
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

app.post("/admin/leaderboard/snapshot", async (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const label = (req.body && req.body.label) || '';
    const raceIdMatch = label.match(/exclusive-leaderboards\/(\d+)/) || label.match(/(\d+)\s*$/);
    let rows, prizePool;

    if (raceIdMatch) {
      const raceId = raceIdMatch[1];
      const gql = JSON.stringify({
        query: `query { getRaceById(raceId: ${raceId}) { id prize_pool start_date end_date race_name competitors { id display_name total_wagered position avatar vip_level_name } prize_distribution { position percentage amount } } }`
      });
      const response = await fetch("https://gamba.com/_api/@", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
          "Referer": `https://gamba.com/promotions/exclusive-leaderboards/${raceId}`,
          "Origin": "https://gamba.com",
        },
        body: gql,
      });
      const json = await response.json();
      const race = json.data && json.data.getRaceById;
      if (!race || !race.competitors || race.competitors.length === 0) {
        return res.status(400).json({ error: `No data found for race ${raceId} on Gamba` });
      }
      const prizes = race.prize_distribution || [];
      rows = race.competitors
        .map(c => {
          const prize = prizes.find(p => p.position === c.position);
          return { username: c.display_name, wager: c.total_wagered, position: c.position, avatar: c.avatar, reward: prize ? prize.amount : 0 };
        })
        .sort((a, b) => a.position - b.position);
      prizePool = race.prize_pool || 0;
    } else {
      rows = await new Promise((resolve, reject) => {
        db.all("SELECT username, wager, position, avatar, reward FROM players ORDER BY position ASC", [], (err, r) => err ? reject(err) : resolve(r));
      });
      prizePool = gambaMeta.prizePool || 0;
    }

    let history = [];
    try {
      history = fs_lb.existsSync(LB_HISTORY_PATH) ? JSON.parse(fs_lb.readFileSync(LB_HISTORY_PATH, "utf-8")) : [];
    } catch (e) {}
    const nextId = history.length ? Math.max(...history.map(h => h.id || 0)) + 1 : 1;
    const prevEnd = history.length ? history[history.length - 1].end : null;
    const totalWagered = rows.reduce((s, p) => s + Number(p.wager || 0), 0);
    const entry = {
      id: nextId,
      label: label || `Leaderboard #${nextId}`,
      start: prevEnd || (req.body && req.body.start) || null,
      end: new Date().toISOString().slice(0, 10),
      prizePool,
      totalWagered,
      totalUsers: rows.length,
      entries: rows
    };
    history.push(entry);
    fs_lb.writeFileSync(LB_HISTORY_PATH, JSON.stringify(history, null, 2));
    res.json({ ok: true, entry });
  } catch (e) {
    console.log("Snapshot error:", e);
    res.status(500).json({ error: "Failed to snapshot leaderboard" });
  }
});


app.get("/players", (req, res) => {
  db.all(
    "SELECT * FROM players ORDER BY position ASC",
    [],
    (err, rows) => {
      if (err) {
        console.log(err);
        return res.json([]);
      }
      const hidden = gambaHidden.map(u => u.toLowerCase());
      res.json(rows.filter(r => !hidden.includes((r.username || '').toLowerCase())));
    }
  );
});

app.get("/gamba-meta", (req, res) => res.json(gambaMeta));

app.get("/admin/gamba/hidden", (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'];
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  res.json(gambaHidden);
});

app.post("/admin/gamba/hidden/add", (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  const username = (req.body.username || '').trim();
  if (!username) return res.status(400).json({ error: 'No username' });
  if (!gambaHidden.map(u => u.toLowerCase()).includes(username.toLowerCase())) {
    gambaHidden.push(username);
    saveGambaHidden(gambaHidden);
  }
  res.json({ ok: true, hidden: gambaHidden });
});

app.post("/admin/gamba/hidden/remove", (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  const username = (req.body.username || '').trim();
  gambaHidden = gambaHidden.filter(u => u.toLowerCase() !== username.toLowerCase());
  saveGambaHidden(gambaHidden);
  res.json({ ok: true, hidden: gambaHidden });
});

// ── Chicken.gg affiliate referrals ──────────────────────────────────────────
const CHICKEN_CACHE_PATH = require("path").join(__dirname, "../../chicken-cache.json");
const CHICKEN_PERIOD_PATH = require("path").join(__dirname, "../../chicken-period.json");
const CHICKEN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
let chickenReferrals = [];
let chickenLastUpdated = null;
let chickenPeriod = { start: null, end: null };
try {
  if (fs_lb.existsSync(CHICKEN_CACHE_PATH)) {
    const cached = JSON.parse(fs_lb.readFileSync(CHICKEN_CACHE_PATH, "utf-8"));
    chickenReferrals = cached.referrals || [];
    chickenLastUpdated = cached.lastUpdated || null;
  }
} catch (e) {}
try {
  if (fs_lb.existsSync(CHICKEN_PERIOD_PATH)) {
    chickenPeriod = JSON.parse(fs_lb.readFileSync(CHICKEN_PERIOD_PATH, "utf-8"));
  }
} catch (e) {}

async function updateChickenLeaderboard() {
  try {
    if (!process.env.CHICKEN_API_KEY) {
      console.log("Chicken.gg: no CHICKEN_API_KEY set, skipping sync");
      return;
    }
    let url = `https://api.chicken.gg/affiliate/v1/referrals?key=${process.env.CHICKEN_API_KEY}`;
    if (chickenPeriod.start) url += `&minTime=${chickenPeriod.start}`;
    if (chickenPeriod.end) url += `&maxTime=${chickenPeriod.end}`;
    const response = await fetch(url);
    const json = await response.json();
    if (!json || !Array.isArray(json.referrals)) {
      console.log("Chicken.gg: unexpected response, keeping existing data");
      return;
    }
    chickenReferrals = json.referrals;
    chickenLastUpdated = Date.now();
    fs_lb.writeFileSync(
      CHICKEN_CACHE_PATH,
      JSON.stringify({ referrals: chickenReferrals, lastUpdated: chickenLastUpdated }, null, 2)
    );
    console.log("Chicken.gg leaderboard updated:", chickenReferrals.length, "referrals");
    checkChickenRaceWinner();
  } catch (err) {
    console.log("Chicken.gg update error:", err.message);
  }
}

// Poll every 3 min - chicken.gg hasn't confirmed an exact rate limit, watch logs for 429s
setInterval(updateChickenLeaderboard, 3 * 60 * 1000);
updateChickenLeaderboard();

const CHICKEN_PRIZES = [250, 100, 50, 25, 20, 15, 15, 10, 10, 5]; // coins, sums to 500 (50% to 1st, descending to 10th)

app.get("/chicken-leaderboard", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const rows = chickenReferrals
    .filter(r => Number(r.wagerAmount || 0) > 0)
    .slice()
    .sort((a, b) => Number(b.wagerAmount || 0) - Number(a.wagerAmount || 0))
    .slice(0, limit)
    .map((r, i) => ({
      position: i + 1,
      username: r.displayName || "Hidden",
      avatar: r.imageUrl || null,
      wager: Number(r.wagerAmount || 0),
      deposit: Number(r.depositAmount || 0),
      commission: Number(r.commissionAmount || 0),
      prize: CHICKEN_PRIZES[i] || 0,
    }));
  res.json({ leaderboard: rows });
});

const CHICKEN_POOL_TOTAL = 500; // coins - fixed prize pool, not derived from wagered amount

const CHICKEN_HISTORY_PATH = require("path").join(__dirname, "../../chicken-history.json");

app.get("/chicken-lb-history", (req, res) => {
  try {
    const data = fs_lb.existsSync(CHICKEN_HISTORY_PATH)
      ? JSON.parse(fs_lb.readFileSync(CHICKEN_HISTORY_PATH, "utf-8"))
      : [];
    res.json(data);
  } catch { res.json([]); }
});

app.post("/admin/chicken/lb-snapshot", (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const label = (req.body && req.body.label) || '';
    const rows = chickenReferrals
      .filter(r => Number(r.wagerAmount || 0) > 0)
      .slice().sort((a, b) => Number(b.wagerAmount || 0) - Number(a.wagerAmount || 0))
      .slice(0, CHICKEN_PRIZES.length)
      .map((r, i) => ({
        position: i + 1,
        username: r.displayName || 'Hidden',
        avatar: r.imageUrl || null,
        wager: Number(r.wagerAmount || 0),
        prize: CHICKEN_PRIZES[i] || 0,
      }));
    let history = [];
    try { history = fs_lb.existsSync(CHICKEN_HISTORY_PATH) ? JSON.parse(fs_lb.readFileSync(CHICKEN_HISTORY_PATH, "utf-8")) : []; } catch {}
    const nextId = history.length ? Math.max(...history.map(h => h.id || 0)) + 1 : 1;
    const prevEnd = history.length ? history[history.length - 1].end : null;
    const entry = {
      id: nextId,
      label: label || `Chicken Leaderboard #${nextId}`,
      start: prevEnd || (chickenPeriod.start ? new Date(chickenPeriod.start).toISOString().slice(0, 10) : null),
      end: chickenPeriod.end ? new Date(chickenPeriod.end).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      prizePool: CHICKEN_POOL_TOTAL,
      totalWagered: rows.reduce((s, r) => s + r.wager, 0),
      totalUsers: rows.length,
      entries: rows,
    };
    history.push(entry);
    fs_lb.writeFileSync(CHICKEN_HISTORY_PATH, JSON.stringify(history, null, 2));
    res.json({ ok: true, entry });
  } catch (e) {
    console.log("Chicken snapshot error:", e);
    res.status(500).json({ error: "Failed to snapshot chicken leaderboard" });
  }
});

// ── Chicken.gg wager race (first to wager `goal` SINCE RACE START wins) ────
// Tracks progress via a baseline snapshot taken when the race starts, so it
// counts only wagers placed after that moment - completely independent of
// the main leaderboard's all-time cumulative totals (which has its own
// separate period and must never be reset by this feature).
const CHICKEN_RACE_PATH = require("path").join(__dirname, "../../chicken-race.json");
let chickenRace = { goal: 10000, prize: 100, winner: null, baseline: {}, startedAt: null };
try {
  if (fs_lb.existsSync(CHICKEN_RACE_PATH)) {
    chickenRace = { goal: 10000, prize: 100, winner: null, baseline: {}, startedAt: null, ...JSON.parse(fs_lb.readFileSync(CHICKEN_RACE_PATH, "utf-8")) };
  }
} catch (e) {}

function chickenRaceProgress(r) {
  const base = chickenRace.baseline[r.displayName] || 0;
  return Math.max(0, Number(r.wagerAmount || 0) - base);
}

function checkChickenRaceWinner() {
  if (chickenRace.winner || !chickenRace.startedAt) return;
  const qualifiers = chickenReferrals.filter(r => chickenRaceProgress(r) >= chickenRace.goal);
  if (qualifiers.length === 0) return;
  const top = qualifiers.sort((a, b) => chickenRaceProgress(b) - chickenRaceProgress(a))[0];
  chickenRace.winner = {
    username: top.displayName || "Hidden",
    avatar: top.imageUrl || null,
    wager: chickenRaceProgress(top),
    wonAt: Date.now(),
  };
  fs_lb.writeFileSync(CHICKEN_RACE_PATH, JSON.stringify(chickenRace, null, 2));
  console.log("Chicken.gg wager race won by:", chickenRace.winner.username);
}

app.get("/chicken-wager-race", (req, res) => {
  const rows = chickenReferrals
    .map(r => ({ username: r.displayName || "Hidden", avatar: r.imageUrl || null, wager: chickenRaceProgress(r) }))
    .filter(r => r.wager > 0)
    .map(r => ({ ...r, progress: Math.min(1, r.wager / chickenRace.goal) }))
    .sort((a, b) => b.wager - a.wager);
  res.json({ goal: chickenRace.goal, prize: chickenRace.prize, winner: chickenRace.winner, referrals: rows });
});

app.post("/admin/chicken/race/start", (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });

  const goal = Number(req.body && req.body.goal) || 10000;
  const prize = Number(req.body && req.body.prize) || 100;
  const baseline = {};
  chickenReferrals.forEach(r => { baseline[r.displayName] = Number(r.wagerAmount || 0); });
  chickenRace = { goal, prize, winner: null, baseline, startedAt: Date.now() };
  fs_lb.writeFileSync(CHICKEN_RACE_PATH, JSON.stringify(chickenRace, null, 2));
  res.json({ ok: true, goal, prize });
});

app.get("/chicken-meta", (req, res) => {
  const totalWagered = chickenReferrals.reduce((s, r) => s + Number(r.wagerAmount || 0), 0);
  const totalCommission = chickenReferrals.reduce((s, r) => s + Number(r.commissionAmount || 0), 0);
  const now = Date.now();
  res.json({
    totalReferrals: chickenReferrals.length,
    totalWagered,
    totalCommission,
    totalPool: CHICKEN_POOL_TOTAL,
    prizes: CHICKEN_PRIZES,
    lastUpdated: chickenLastUpdated,
    start: chickenPeriod.start,
    end: chickenPeriod.end,
    active: !!(chickenPeriod.start && chickenPeriod.end),
  });
});

app.post("/admin/chicken/start", (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });

  const start = (req.body && req.body.start) ? new Date(req.body.start).getTime() : Date.now();
  const end = (req.body && req.body.end) ? new Date(req.body.end).getTime() : start + CHICKEN_DURATION_MS;
  chickenPeriod = { start, end };
  fs_lb.writeFileSync(CHICKEN_PERIOD_PATH, JSON.stringify(chickenPeriod, null, 2));
  chickenReferrals = [];
  updateChickenLeaderboard();
  res.json({ ok: true, start, end });
});

// ── Krush.gg affiliate wager-leader (30-day race, admin-started) ───────────
const KRUSH_PERIOD_PATH = require("path").join(__dirname, "../../krush-period.json");
const KRUSH_CACHE_PATH = require("path").join(__dirname, "../../krush-cache.json");
const KRUSH_PRIZES = [500, 200, 100, 60, 40, 30, 25, 20, 15, 10];
const KRUSH_POOL_TOTAL = KRUSH_PRIZES.reduce((s, p) => s + p, 0);
const KRUSH_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

let krushPeriod = { start: null, end: null };
let krushReferrals = [];
let krushLastUpdated = null;
try {
  if (fs_lb.existsSync(KRUSH_PERIOD_PATH)) {
    krushPeriod = JSON.parse(fs_lb.readFileSync(KRUSH_PERIOD_PATH, "utf-8"));
  }
} catch (e) {}
try {
  if (fs_lb.existsSync(KRUSH_CACHE_PATH)) {
    const cached = JSON.parse(fs_lb.readFileSync(KRUSH_CACHE_PATH, "utf-8"));
    krushReferrals = cached.referrals || [];
    krushLastUpdated = cached.lastUpdated || null;
  }
} catch (e) {}

async function updateKrushLeaderboard() {
  try {
    if (!process.env.KRUSH_API_KEY || !krushPeriod.start) return;
    const startTimestamp = Math.floor(krushPeriod.start / 1000);
    const response = await fetch(
      `https://api.krush.gg/api/affiliate/wager-leader?startTimestamp=${startTimestamp}`,
      { headers: { "X-API-Key": process.env.KRUSH_API_KEY } }
    );
    const json = await response.json();
    if (!json || json.code !== 200 || !Array.isArray(json.data)) {
      console.log("Krush.gg: unexpected response, keeping existing data");
      return;
    }
    krushReferrals = json.data;
    krushLastUpdated = Date.now();
    fs_lb.writeFileSync(
      KRUSH_CACHE_PATH,
      JSON.stringify({ referrals: krushReferrals, lastUpdated: krushLastUpdated }, null, 2)
    );
    console.log("Krush.gg leaderboard updated:", krushReferrals.length, "referrals");
  } catch (err) {
    console.log("Krush.gg update error:", err.message);
  }
}

setInterval(updateKrushLeaderboard, 15 * 60 * 1000);
updateKrushLeaderboard();

app.get("/krush-leaderboard", (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const rows = krushReferrals
    .filter(r => Number(r.wagered || 0) > 0)
    .slice()
    .sort((a, b) => Number(b.wagered || 0) - Number(a.wagered || 0))
    .slice(0, limit)
    .map((r, i) => ({
      position: i + 1,
      username: r.username || "Hidden",
      avatar: r.avatarUrl || null,
      wager: Number(r.wagered || 0),
      prize: KRUSH_PRIZES[i] || 0,
    }));
  res.json({ leaderboard: rows });
});

app.get("/krush-meta", (req, res) => {
  const now = Date.now();
  res.json({
    start: krushPeriod.start,
    end: krushPeriod.end,
    active: !!(krushPeriod.start && krushPeriod.end && now < krushPeriod.end),
    totalPool: KRUSH_POOL_TOTAL,
    prizes: KRUSH_PRIZES,
    lastUpdated: krushLastUpdated,
  });
});

app.post("/admin/krush/start", (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });

  const start = (req.body && req.body.start) ? new Date(req.body.start).getTime() : Date.now();
  const end = start + KRUSH_DURATION_MS;
  krushPeriod = { start, end };
  fs_lb.writeFileSync(KRUSH_PERIOD_PATH, JSON.stringify(krushPeriod, null, 2));
  krushReferrals = [];
  updateKrushLeaderboard();
  res.json({ ok: true, start, end });
});

app.get("/chancer-players", async (req, res) => {
  const apiUrl = "https://admin.chancer.bet/external/activities/leaderboard";
  const token = "fYDQGOG7YncwMZZnGffJzkozjz5XcxbP";

  const today = new Date();
  const dateTo = today.toISOString().slice(0, 10);

  const dateFromObj = new Date();
  dateFromObj.setDate(dateFromObj.getDate() - 30);
  const dateFrom = dateFromObj.toISOString().slice(0, 10);

  try {
    const response = await axios({
      url: apiUrl,
      method: "GET",
      headers: {
        "X-Affiliate-Secret": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      data: {
        date_from: dateFrom,
        date_to: dateTo,
        currency: "USD",
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    console.log("CHANCER STATUS:", response.status);
    console.log("CHANCER RAW BODY:", response.data);

    const json = response.data;

    const payload = Array.isArray(json) ? json[0] : json;
    const items = Array.isArray(payload?.items) ? payload.items : [];

    const rows = items.map((row, index) => ({
      id: row.player_id || `player-${index + 1}`,
      username: row.nickname || `Player #${row.rank || index + 1}`,
      wager: Number(row.total_wager || 0),
      position: Number(row.rank || index + 1),
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${row.player_id}`,
    }));

    return res.json({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      parsed: json,
      normalized: rows,
    });
  } catch (err) {
    console.log("Chancer API error:", err.message);
    return res.json({
      ok: false,
      error: err.message,
    });
  }
});

app.get("/acebet", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.acebet.co/affiliates/detailed-summary/v2/2023-01-01",
      {
        headers: {
          "Authorization": "Bearer DIN_TOKEN_HER",
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    const text = await response.text();

    console.log("ACEBET RAW RESPONSE:");
    console.log(text);

    res.send(text);
  } catch (err) {
    console.log("Acebet API error:", err);
    res.json([]);
  }
});

// ─── GAMBLE CASES ────────────────────────────────────────────────────────────
// Store prizes for golden spin (same across all cases)
const STORE_PRIZES = {
  tip10:   { storeItem:true, title:'$10 Tip',         itemId:1 },
  tip15:   { storeItem:true, title:'$15 Tip',         itemId:2 },
  bonus20: { storeItem:true, title:'$20 Bonus Buy',   itemId:3 },
  bonus40: { storeItem:true, title:'$40 Bonus Buy',   itemId:4 },
  bonus100:{ storeItem:true, title:'$100 Bonus Buy',  itemId:5 },
};
// Max payout = 100x case cost. Golden spin has store prizes + points.
// All golden spin items use 'gold' rarity so they share the same golden visual style.
// 'gold-big' = slightly brighter gold for larger prizes. 'gold-ultra' = special top prize.
const CASES_PATH = require('path').join(__dirname, '../../cases.json');
let GAMBLE_CASES = [
  { id:'starter', name:'Starter Case', cost:50, emoji:'📦',
    items:[
      {name:'Nothing',points:0,weight:900,rarity:'bust'},
      {name:'40 Points',points:40,weight:55,rarity:'blue'},
      {name:'120 Points',points:0,weight:25,rarity:'purple',isGolden:true},
      {name:'350 Points',points:0,weight:10,rarity:'pink',isGolden:true},
      {name:'Golden Spin',points:0,weight:15,rarity:'golden-trigger',isGolden:true},
    ],
    goldenItems:[
      {name:'100 Points',points:100,weight:285,rarity:'purple'},
      {name:'200 Points',points:200,weight:185,rarity:'purple'},
      {name:'400 Points',points:400,weight:140,rarity:'pink'},
      {name:'$10 Tip',...STORE_PRIZES.tip10,points:0,weight:195,rarity:'gold'},
      {name:'$15 Tip',...STORE_PRIZES.tip15,points:0,weight:120,rarity:'gold'},
      {name:'1,000 Points',points:1000,weight:60,rarity:'gold'},
      {name:'$100 Bonus Buy',...STORE_PRIZES.bonus100,points:0,weight:15,rarity:'gold-ultra'},
    ]},
  { id:'premium', name:'Premium Case', cost:100, emoji:'🎁',
    items:[
      {name:'Nothing',points:0,weight:900,rarity:'bust'},
      {name:'80 Points',points:80,weight:55,rarity:'blue'},
      {name:'250 Points',points:0,weight:25,rarity:'purple',isGolden:true},
      {name:'700 Points',points:0,weight:10,rarity:'pink',isGolden:true},
      {name:'Golden Spin',points:0,weight:15,rarity:'golden-trigger',isGolden:true},
    ],
    goldenItems:[
      {name:'200 Points',points:200,weight:265,rarity:'purple'},
      {name:'400 Points',points:400,weight:170,rarity:'purple'},
      {name:'800 Points',points:800,weight:100,rarity:'pink'},
      {name:'$10 Tip',...STORE_PRIZES.tip10,points:0,weight:195,rarity:'gold'},
      {name:'$15 Tip',...STORE_PRIZES.tip15,points:0,weight:120,rarity:'gold'},
      {name:'$40 Bonus Buy',...STORE_PRIZES.bonus40,points:0,weight:75,rarity:'gold'},
      {name:'2,000 Points',points:2000,weight:60,rarity:'gold'},
      {name:'$100 Bonus Buy',...STORE_PRIZES.bonus100,points:0,weight:15,rarity:'gold-ultra'},
    ]},
  { id:'elite', name:'Elite Case', cost:250, emoji:'💎',
    items:[
      {name:'Nothing',points:0,weight:900,rarity:'bust'},
      {name:'200 Points',points:200,weight:55,rarity:'blue'},
      {name:'625 Points',points:0,weight:25,rarity:'purple',isGolden:true},
      {name:'1,750 Points',points:0,weight:10,rarity:'pink',isGolden:true},
      {name:'Golden Spin',points:0,weight:15,rarity:'golden-trigger',isGolden:true},
    ],
    goldenItems:[
      {name:'500 Points',points:500,weight:250,rarity:'purple'},
      {name:'1,000 Points',points:1000,weight:155,rarity:'purple'},
      {name:'2,000 Points',points:2000,weight:85,rarity:'pink'},
      {name:'$15 Tip',...STORE_PRIZES.tip15,points:0,weight:180,rarity:'gold'},
      {name:'$20 Bonus Buy',...STORE_PRIZES.bonus20,points:0,weight:135,rarity:'gold'},
      {name:'$40 Bonus Buy',...STORE_PRIZES.bonus40,points:0,weight:90,rarity:'gold'},
      {name:'5,000 Points',points:5000,weight:90,rarity:'gold'},
      {name:'$100 Bonus Buy',...STORE_PRIZES.bonus100,points:0,weight:15,rarity:'gold-ultra'},
    ]},
  { id:'flip', name:'Flip Case', cost:25, emoji:'🪙',
    items:[
      {name:'Double Up',      points:47, weight:500,rarity:'gold'},
      {name:'Golden Spin',    points:0,  weight:50, rarity:'golden-trigger',isGolden:true},
      {name:'Nothing',        points:0,  weight:450,rarity:'bust'},
    ],
    goldenItems:[
      {name:'50 Points',  points:50,  weight:300,rarity:'purple'},
      {name:'100 Points', points:100, weight:250,rarity:'purple'},
      {name:'200 Points', points:200, weight:150,rarity:'pink'},
      {name:'$10 Tip',...STORE_PRIZES.tip10,  points:0,weight:200,rarity:'gold'},
      {name:'$15 Tip',...STORE_PRIZES.tip15,  points:0,weight:85, rarity:'gold'},
      {name:'$40 Bonus Buy',...STORE_PRIZES.bonus40,points:0,weight:15,rarity:'gold-ultra'},
    ]},
  { id:'lucky', name:'Lucky Case', cost:50, emoji:'🍀',
    items:[
      {name:'Nothing',     points:0,weight:990,rarity:'bust'},
      {name:'Golden Spin', points:0,weight:10, rarity:'golden-trigger',isGolden:true},
    ],
    goldenItems:[
      {name:'500 Points',   points:500,  weight:280,rarity:'purple'},
      {name:'1,000 Points', points:1000, weight:180,rarity:'pink'},
      {name:'$15 Tip',...STORE_PRIZES.tip15,   points:0,weight:180,rarity:'gold'},
      {name:'$40 Bonus Buy',...STORE_PRIZES.bonus40, points:0,weight:155,rarity:'gold'},
      {name:'2,000 Points', points:2000, weight:100,rarity:'gold'},
      {name:'$100 Bonus Buy',...STORE_PRIZES.bonus100,points:0,weight:90,rarity:'gold'},
      {name:'5,000 Points', points:5000, weight:10, rarity:'gold-ultra'},
      {name:'$100 Bonus Buy x2',...STORE_PRIZES.bonus100,points:0,weight:5,rarity:'gold-ultra'},
    ]},
  { id:'mega', name:'Mega Case', cost:500, emoji:'👑',
    items:[
      {name:'Nothing',points:0,weight:900,rarity:'bust'},
      {name:'400 Points',points:400,weight:55,rarity:'blue'},
      {name:'1,250 Points',points:0,weight:25,rarity:'purple',isGolden:true},
      {name:'3,500 Points',points:0,weight:10,rarity:'pink',isGolden:true},
      {name:'Golden Spin',points:0,weight:15,rarity:'golden-trigger',isGolden:true},
    ],
    goldenItems:[
      {name:'1,000 Points',points:1000,weight:240,rarity:'purple'},
      {name:'2,000 Points',points:2000,weight:145,rarity:'purple'},
      {name:'4,000 Points',points:4000,weight:75,rarity:'pink'},
      {name:'$20 Bonus Buy',...STORE_PRIZES.bonus20,points:0,weight:195,rarity:'gold'},
      {name:'$40 Bonus Buy',...STORE_PRIZES.bonus40,points:0,weight:150,rarity:'gold'},
      {name:'$100 Bonus Buy',...STORE_PRIZES.bonus100,points:0,weight:90,rarity:'gold'},
      {name:'10,000 Points',points:10000,weight:90,rarity:'gold'},
      {name:'$100 Bonus Buy x2',...STORE_PRIZES.bonus100,points:0,weight:15,rarity:'gold-ultra'},
    ]},
];

// Load persisted case config from file if it exists
try {
  const saved = JSON.parse(require('fs').readFileSync(CASES_PATH, 'utf8'));
  if (Array.isArray(saved) && saved.length) { GAMBLE_CASES = saved; console.log('[cases] Loaded from cases.json'); }
} catch(e) {}

app.get('/gamble/cases', (req, res) => {
  res.json(GAMBLE_CASES.map(c => ({ id:c.id, name:c.name, cost:c.cost, emoji:c.emoji, items:c.items, goldenItems:c.goldenItems })));
});

function weightedRoll(items, hashHex, offset) {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const roll = Number(BigInt('0x' + hashHex.slice(offset, offset+16)) % BigInt(totalWeight));
  let cum = 0;
  for (const item of items) { cum += item.weight; if (roll < cum) return { item, roll, totalWeight }; }
  return { item: items[items.length-1], roll, totalWeight };
}
const HISTORY_PATH = require('path').join(__dirname, '../../case_history.json');
let caseHistory = [];
try { caseHistory = JSON.parse(require('fs').readFileSync(HISTORY_PATH, 'utf8')); } catch {}

function pushHistory(entry) {
  caseHistory.unshift(entry);
  if (caseHistory.length > 50) caseHistory = caseHistory.slice(0, 50);
  require('fs').writeFileSync(HISTORY_PATH, JSON.stringify(caseHistory));
}

app.get('/gamble/history', (req, res) => {
  res.json(caseHistory.slice(0, 10));
});

app.post('/gamble/open', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  const caseConfig = GAMBLE_CASES.find(c => c.id === req.body.caseId);
  if (!caseConfig) return res.status(400).json({ error: 'Invalid case' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let ptsData = {};
  try { ptsData = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const current = ptsData[session.username] || 0;
  if (current < caseConfig.cost) return res.status(400).json({ error: `Not enough NP. Have ${current}, need ${caseConfig.cost}.` });
  const serverSeed = cryptoPF.randomBytes(32).toString('hex');
  const resultHash = cryptoPF.createHash('sha256').update(serverSeed).digest('hex');
  const { item: regularItem, roll: roll1, totalWeight: tw1 } = weightedRoll(caseConfig.items, resultHash, 0);
  let goldenItem = null, roll2 = null, tw2 = null, pointsWon = regularItem.points;
  if (regularItem.isGolden && caseConfig.goldenItems) {
    const gr = weightedRoll(caseConfig.goldenItems, resultHash, 16);
    goldenItem = gr.item; roll2 = gr.roll; tw2 = gr.totalWeight;
    pointsWon = goldenItem.points;
  }
  // Deduct case cost, add any points won
  ptsData[session.username] = (current - caseConfig.cost) + pointsWon;
  require('fs').writeFileSync(ptsPath, JSON.stringify(ptsData, null, 2));
  session.points = ptsData[session.username];

  // If a store item was won, create a ticket
  const storeWin = goldenItem?.storeItem ? goldenItem : null;
  if (storeWin) {
    try {
      await axios.post('http://localhost:3002/create-ticket', {
        username: session.username,
        item: storeWin.title,
        cost: 0,
        note: `Won via ${caseConfig.name} case opening (Cases)`,
        discordId: session.discordId || null,
        discordName: session.discordName || null
      });
    } catch(e) { console.error('[gamble ticket]', e.message); }
  }

  const wonItem = goldenItem || regularItem;
  pushHistory({
    ts: Date.now(),
    username: session.username,
    displayName: session.displayName || session.username,
    avatar: session.avatar || null,
    caseName: caseConfig.name,
    caseId: caseConfig.id,
    itemName: wonItem.name,
    itemRarity: wonItem.rarity,
    itemPoints: wonItem.points || 0,
    isGolden: !!goldenItem,
    isStore: !!storeWin,
  });

  res.json({
    regularItem, goldenItem, pointsWon,
    storeWin: storeWin ? { title: storeWin.title } : null,
    newPoints: ptsData[session.username],
    proof: { serverSeed, resultHash, roll1, tw1, roll2, tw2 },
    allItems: caseConfig.items,
    goldenAllItems: caseConfig.goldenItems || null
  });
});

app.get('/cases', (req, res) => res.sendFile(path.join(__dirname, '../frontend/gamble.html')));
app.get('/cases/:caseId', (req, res) => res.sendFile(path.join(__dirname, '../frontend/gamble.html')));
app.get('/gamble', (req, res) => res.redirect('/cases'));
app.get('/gamble/:caseId', (req, res) => res.redirect('/cases/' + req.params.caseId));

// ─── NIKSIBOT TOKEN REFRESH ──────────────────────────────────────────────────
const NIKSIBOT_CLIENT_ID = '01KSJ34DC0Q8BD3DYQM328H81S';
const NIKSIBOT_CLIENT_SECRET = '724b7105d889578107727bf454f909096a4f20d73bb1c0e2a84988c1759b1bae';
const TOKEN_REDIRECT = 'https://niksi777.com/token-callback';
let tokenPkce = null;

app.get('/token-refresh', (req, res) => {
  const codeVerifier = cryptoM.randomBytes(64).toString('base64url');
  const codeChallenge = cryptoM.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = cryptoM.randomBytes(16).toString('hex');
  tokenPkce = { codeVerifier, state };
  const authUrl = `https://id.kick.com/oauth/authorize?response_type=code&client_id=${NIKSIBOT_CLIENT_ID}&redirect_uri=${encodeURIComponent(TOKEN_REDIRECT)}&scope=chat%3Awrite&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`;
  res.redirect(authUrl);
});

app.get('/token-callback', async (req, res) => {
  const { code, state } = req.query;
  if (!tokenPkce || tokenPkce.state !== state) return res.send('<h1 style="font-family:sans-serif;color:red;padding:40px">Error: invalid state. Visit /token-refresh again.</h1>');
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', NIKSIBOT_CLIENT_ID);
    params.append('client_secret', NIKSIBOT_CLIENT_SECRET);
    params.append('redirect_uri', TOKEN_REDIRECT);
    params.append('code_verifier', tokenPkce.codeVerifier);
    params.append('code', code);
    const { data } = await axios.post('https://id.kick.com/oauth/token', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const envPath = '/root/website/.env';
    const fs = require('fs');
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (env.includes('KICK_BOT_TOKEN=')) {
      env = env.replace(/KICK_BOT_TOKEN=.*/, `KICK_BOT_TOKEN=${data.access_token}`);
    } else {
      env += `\nKICK_BOT_TOKEN=${data.access_token}`;
    }
    if (data.refresh_token) {
      if (env.includes('KICK_BOT_REFRESH_TOKEN=')) {
        env = env.replace(/KICK_BOT_REFRESH_TOKEN=.*/, `KICK_BOT_REFRESH_TOKEN=${data.refresh_token}`);
      } else {
        env += `\nKICK_BOT_REFRESH_TOKEN=${data.refresh_token}`;
      }
    }
    fs.writeFileSync(envPath, env.trim() + '\n');
    tokenPkce = null;
    require('child_process').exec('pm2 restart niksibot');
    res.send('<h1 style="font-family:sans-serif;color:#22c55e;background:#07080c;margin:0;padding:60px;min-height:100vh">✅ Token saved! NiksiBot is restarting with the new token.</h1>');
  } catch (err) {
    res.send(`<h1 style="font-family:sans-serif;color:red;padding:40px">Error: ${JSON.stringify(err?.response?.data || err.message)}</h1>`);
  }
});

app.get("/ip", async (req, res) => {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.json({ error: "Could not detect IP" });
  }
});

// Start server
app.listen(4000, () => {
  console.log("Backend running on http://127.0.0.1:4000");
});

// ─── GIVEAWAY ROUTES ────────────────────────────────────────────────────────
let giveawayState = { giveaway: null, entries: [] };

// Chat message buffer: { username -> [{ username, content, ts }] }
const chatBuffer = {};
const CHAT_MAX = 150;
const CHAT_BUFFER_PATH = require('path').join(__dirname, '../../chat-buffer.json');
try { Object.assign(chatBuffer, JSON.parse(require('fs').readFileSync(CHAT_BUFFER_PATH, 'utf8'))); console.log('[chat] Buffer loaded from disk'); } catch {}
let chatSaveTimer = null;
function scheduleChatSave() {
  clearTimeout(chatSaveTimer);
  chatSaveTimer = setTimeout(() => { try { require('fs').writeFileSync(CHAT_BUFFER_PATH, JSON.stringify(chatBuffer)); } catch {} }, 2000);
}
app.post('/giveaway/chat-message', (req, res) => {
  const { username, content, ts, avatar } = req.body;
  if (!username || !content) return res.json({ ok: false });
  const key = username.toLowerCase();
  if (!chatBuffer[key]) chatBuffer[key] = [];
  chatBuffer[key].push({ username, content, ts: ts || Date.now() });
  if (chatBuffer[key].length > CHAT_MAX) chatBuffer[key].shift();
  // Store Kick avatar so it shows up in the giveaway roller
  if (avatar) {
    const accounts = loadAccounts();
    if (!accounts[key]) accounts[key] = { kickUsername: key, kickDisplayName: username, firstSeen: new Date().toISOString() };
    if (accounts[key].kickAvatar !== avatar) {
      accounts[key].kickAvatar = avatar;
      accounts[key].lastSeen = new Date().toISOString();
      require('fs').writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
    }
  }
  scheduleChatSave();
  res.json({ ok: true });
});
app.get('/giveaway/winner-chat', (req, res) => {
  const key = (req.query.username || '').toLowerCase();
  res.json((chatBuffer[key] || []).slice(-20));
});
app.get('/giveaway/avatars', (req, res) => {
  const accounts = loadAccounts();
  const result = {};
  (giveawayState.entries || []).forEach(e => {
    const key = e.username.toLowerCase();
    const acc = accounts[key];
    result[key] = (acc && (acc.discordAvatar || acc.kickAvatar)) || null;
  });
  res.json(result);
});
app.get('/giveaway/winner-info', (req, res) => {
  const key = (req.query.username || '').toLowerCase();
  try {
    const accounts = loadAccounts();
    const acc = accounts[key] || {};
    res.json({ discordAvatar: acc.discordAvatar || null, discordName: acc.discordName || null });
  } catch { res.json({ discordAvatar: null, discordName: null }); }
});

// ─── WATCH TIME REWARDS ──────────────────────────────────────────────────────
const WATCH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

async function isStreamLive() {
  try {
    const r = await fetch('https://kick.com/api/v2/channels/niksi777', { headers: { 'Accept': 'application/json' } });
    const data = await r.json();
    return !!(data.livestream);
  } catch { return false; }
}

function wasActiveAntiAbuse(messages, cutoff) {
  const recent = messages.filter(m => m.ts > cutoff);
  if (recent.length < 2) return false; // Need at least 2 messages
  // Messages must span at least 2 different minutes (prevents single-burst bots)
  const uniqueMinutes = new Set(recent.map(m => Math.floor(m.ts / 60000)));
  return uniqueMinutes.size >= 2;
}

setInterval(async () => {
  try {
    const live = await isStreamLive();
    if (!live) { console.log('[watchtime] Stream offline, skipping.'); return; }
    const accounts = loadAccounts();
    const cutoff = Date.now() - WATCH_INTERVAL_MS;
    const ptsPath = require('path').join(__dirname, '../../points.json');
    let ptsData = {};
    try { ptsData = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
    let rewarded = 0;
    Object.entries(chatBuffer).forEach(([username, messages]) => {
      if (!wasActiveAntiAbuse(messages, cutoff)) return;
      const acc = accounts[username.toLowerCase()];
      if (acc && acc.discordId) {
        ptsData[username.toLowerCase()] = (ptsData[username.toLowerCase()] || 0) + 1;
        rewarded++;
      }
    });
    if (rewarded > 0) {
      require('fs').writeFileSync(ptsPath, JSON.stringify(ptsData, null, 2));
      console.log(`[watchtime] Stream live - +1 pt to ${rewarded} linked viewers`);
    }
  } catch (err) { console.error('[watchtime]', err.message); }
}, WATCH_INTERVAL_MS);

// Provably Fair
const cryptoPF = require('crypto');
let pfState = { seed: null, hash: null };
app.get('/giveaway/pf/prepare', (req, res) => {
  const seed = cryptoPF.randomBytes(32).toString('hex');
  const hash = cryptoPF.createHash('sha256').update(seed).digest('hex');
  pfState = { seed, hash };
  res.json({ hash });
});
app.post('/giveaway/pf/roll', (req, res) => {
  if (!pfState.seed) return res.status(400).json({ error: 'No seed prepared. Click Generate Seed first.' });
  const entries = giveawayState.entries;
  if (!entries || entries.length === 0) return res.status(400).json({ error: 'No entries to roll from.' });
  const entriesStr = entries.map(e => e.username).join(',');
  const combined = pfState.seed + ':' + entriesStr;
  const resultHash = cryptoPF.createHash('sha256').update(combined).digest('hex');
  const idx = Number(BigInt('0x' + resultHash.slice(0, 16)) % BigInt(entries.length));
  const winner = entries[idx].username;
  const proof = { winner, serverSeed: pfState.seed, serverSeedHash: pfState.hash, entries: entries.map(e => e.username), resultHash, index: idx, total: entries.length };
  pfState = { seed: null, hash: null };
  res.json(proof);
});

app.get('/giveaway/state', (req, res) => {
  res.json(giveawayState);
});

app.post('/giveaway/start', (req, res) => {
  const { keyword, prize } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  giveawayState = {
    giveaway: { keyword: keyword.toLowerCase().trim(), prize: prize||'', winner: null, started_at: Date.now() },
    entries: []
  };
  console.log('Giveaway started — keyword: ' + keyword + ' prize: ' + prize);
  res.json({ ok: true });
});

app.post('/giveaway/enter', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (!giveawayState.giveaway) {
    return res.status(400).json({ error: 'No active giveaway' });
  }
  const already = giveawayState.entries.find(e => e.username.toLowerCase() === username.toLowerCase());
  if (already) return res.json({ ok: true, duplicate: true });
  giveawayState.entries.push({ id: Date.now(), username, entered_at: Date.now() });
  console.log('Entry: ' + username + ' (total: ' + giveawayState.entries.length + ')');
  res.json({ ok: true });
});

app.post('/giveaway/remove-entry', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  giveawayState.entries = giveawayState.entries.filter(e => e.username.toLowerCase() !== username.toLowerCase());
  res.json({ ok: true, remaining: giveawayState.entries.length });
});

app.post('/giveaway/roll', (req, res) => {
  if (!giveawayState.giveaway || giveawayState.entries.length === 0) {
    return res.status(400).json({ error: 'No entries to roll' });
  }
  let winner = req.body && req.body.winner;
  if (!winner) {
    const idx = Math.floor(Math.random() * giveawayState.entries.length);
    winner = giveawayState.entries[idx].username;
  }
  giveawayState.giveaway.winner = winner;
  console.log('Winner: ' + winner);
  res.json({ winner });
});

app.post('/giveaway/reroll', (req, res) => {
  if (!giveawayState.giveaway || giveawayState.entries.length === 0) {
    return res.status(400).json({ error: 'No entries to reroll' });
  }
  const previous = giveawayState.giveaway.winner;
  const pool = giveawayState.entries;
  if (pool.length === 0) return res.status(400).json({ error: 'No entries to reroll from' });
  const winner = pool[Math.floor(Math.random() * pool.length)].username;
  giveawayState.giveaway.winner = winner;
  console.log('Reroll winner: ' + winner);
  res.json({ winner });
});

app.post('/giveaway/reset', (req, res) => {
  giveawayState = { giveaway: null, entries: [] };
  console.log('Giveaway reset');
  res.json({ ok: true });
});

// Timer signal endpoint
let timerSignal = null;
app.post('/giveaway/timer', (req, res) => {
  const { action, duration } = req.body;
  timerSignal = { action, duration: duration || 60 };
  res.json({ ok: true });
});
app.get('/giveaway/timer', (req, res) => {
  const sig = timerSignal;
  timerSignal = null;
  res.json({ signal: sig ? sig.action : null, duration: sig ? sig.duration : 60 });
});

app.post('/admin/points', (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  const { username, amount, action } = req.body;
  if (!username || !amount || !action) return res.status(400).json({ error: 'Missing fields' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {};
  try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const key = username.toLowerCase();
  const current = pts[key] || 0;
  if (action === 'add') pts[key] = current + Number(amount);
  else if (action === 'remove') pts[key] = Math.max(0, current - Number(amount));
  else if (action === 'set') pts[key] = Math.max(0, Number(amount));
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  res.json({ ok: true, username: key, newBalance: pts[key] });
});

app.get('/admin/cases', (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'];
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  res.json(GAMBLE_CASES);
});

// Bot API — authenticated by BOT_API_SECRET in .env
app.post('/bot/points', (req, res) => {
  if (req.headers['x-bot-secret'] !== process.env.BOT_API_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const { username, amount, action } = req.body;
  if (!username || amount == null || !action) return res.status(400).json({ error: 'Missing fields' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {};
  try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const key = username.toLowerCase();
  const current = pts[key] || 0;
  if (action === 'add') pts[key] = current + Number(amount);
  else if (action === 'remove') pts[key] = Math.max(0, current - Number(amount));
  else if (action === 'set') pts[key] = Math.max(0, Number(amount));
  else return res.status(400).json({ error: 'Invalid action' });
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  res.json({ ok: true, username: key, action, newBalance: pts[key] });
});

app.post('/admin/cases', (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  const { cases } = req.body;
  if (!Array.isArray(cases) || !cases.length) return res.status(400).json({ error: 'Invalid data' });
  GAMBLE_CASES = cases;
  require('fs').writeFileSync(CASES_PATH, JSON.stringify(cases, null, 2));
  res.json({ ok: true });
});

app.get('/admin/accounts', (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'];
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  const accounts = loadAccounts();
  let points = {};
  try { points = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8')); } catch {}
  // Start with every user who has points, overlay account data for those who have logged in
  const merged = {};
  Object.entries(points).forEach(([username, pts]) => {
    merged[username] = { kickUsername: username, kickDisplayName: username, points: pts };
  });
  Object.entries(accounts).forEach(([username, account]) => {
    merged[username] = { ...merged[username], ...account, points: points[username] || account.points || 0 };
  });
  const result = Object.values(merged).sort((a, b) => (b.points || 0) - (a.points || 0));
  res.json(result);
});

app.post('/admin/accounts/remove', (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'] || req.body.session;
  const session = sessions[sessionId];
  if (!session || !isAdminUser(session.username)) return res.status(403).json({ error: 'Forbidden' });
  const username = (req.body.username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'No username' });
  const fs2 = require('fs'), path2 = require('path');
  const POINTS_PATH = path2.join(__dirname, '../../points.json');
  // Remove from accounts.json
  const accounts = loadAccounts();
  const accKey = Object.keys(accounts).find(k => k.toLowerCase() === username);
  if (accKey) { delete accounts[accKey]; require('fs').writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2)); }
  // Remove from points.json
  try {
    const pts = JSON.parse(fs2.readFileSync(POINTS_PATH, 'utf8'));
    const ptKey = Object.keys(pts).find(k => k.toLowerCase() === username);
    if (ptKey) { delete pts[ptKey]; fs2.writeFileSync(POINTS_PATH, JSON.stringify(pts, null, 2)); }
  } catch {}
  res.json({ ok: true });
});

﻿
// ─── PREDICTOR ───────────────────────────────────────────────────────────────
const PREDICTOR_PATH = require('path').join(__dirname, '../../predictor.json');
function loadPredictor() {
  try { return JSON.parse(require('fs').readFileSync(PREDICTOR_PATH, 'utf8')); }
  catch { return { hunt: null, predictions: [], history: [] }; }
}
function savePredictor(d) { require('fs').writeFileSync(PREDICTOR_PATH, JSON.stringify(d, null, 2)); }

app.get('/predictor/current', (req, res) => {
  const d = loadPredictor();
  if (!d.hunt) return res.json({ hunt: null, stats: null });
  const preds = d.predictions;
  const totalPot = preds.reduce((s, p) => s + (p.wager || 0), 0);
  let winnerGuess = null;
  if (d.hunt.status === 'resolved' && d.hunt.endingBalance != null && preds.length > 0) {
    const ending = d.hunt.endingBalance;
    const minDist = Math.min(...preds.map(p => Math.abs(p.guess - ending)));
    winnerGuess = preds.filter(p => Math.abs(p.guess - ending) === minDist)[0]?.guess;
  }
  const ending = d.hunt.endingBalance;
  const predList = preds.map(p => ({
    username: p.username,
    guess: p.guess,
    wager: p.wager,
    payout: p.payout,
    isWinner: d.hunt.status === 'resolved' && ending != null && winnerGuess != null && p.guess === winnerGuess
  }));
  res.json({
    hunt: d.hunt.status === 'resolved' ? d.hunt : { ...d.hunt, endingBalance: undefined },
    stats: { totalPot, totalPredictions: preds.length, winnerGuess },
    predictions: predList
  });
});

app.get('/predictor/my', (req, res) => {
  const sid = req.query.session || req.headers['x-session-id'];
  const sess = sessions[sid];
  if (!sess) return res.json({ prediction: null });
  const d = loadPredictor();
  res.json({ prediction: d.predictions.find(p => p.username === sess.username) || null });
});

app.post('/predictor/predict', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess) return res.status(401).json({ error: 'Not logged in' });
  const { guess, wager } = req.body;
  const guessVal = Math.floor(Number(guess));
  if (!guessVal || guessVal < 1) return res.status(400).json({ error: 'Enter a valid ending balance guess ($)' });
  const wagerVal = Math.floor(Number(wager));
  if (!wagerVal || wagerVal < 1) return res.status(400).json({ error: 'Invalid wager amount' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status !== 'open') return res.status(400).json({ error: 'No open prediction right now' });
  if (d.predictions.find(p => p.username === sess.username)) return res.status(400).json({ error: 'You have already placed a prediction' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {}; try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const current = pts[sess.username] || 0;
  if (current < wagerVal) return res.status(400).json({ error: `Not enough NP. You have ${current.toLocaleString()}, need ${wagerVal.toLocaleString()}.` });
  pts[sess.username] = current - wagerVal;
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  d.predictions.push({ username: sess.username, displayName: sess.displayName, guess: guessVal, wager: wagerVal, payout: null, createdAt: new Date().toISOString() });
  savePredictor(d);
  res.json({ ok: true, guess: guessVal, wager: wagerVal, newBalance: pts[sess.username] });
});

app.post('/predictor/bot-predict', (req, res) => {
  if (req.headers['x-bot-secret'] !== process.env.BOT_API_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const { username, guess, wager } = req.body;
  const key = (username || '').toLowerCase();
  if (!key) return res.status(400).json({ error: 'Invalid' });
  const guessVal = Math.floor(Number(guess));
  if (!guessVal || guessVal < 1) return res.status(400).json({ error: 'Invalid guess' });
  const wagerVal = Math.floor(Number(wager));
  if (!wagerVal || wagerVal < 1) return res.status(400).json({ error: 'Invalid wager' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status !== 'open') return res.json({ ok: false, error: 'No open prediction right now' });
  if (d.predictions.find(p => p.username === key)) return res.json({ ok: false, error: 'You already placed a prediction' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {}; try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const current = pts[key] || 0;
  if (current < wagerVal) return res.json({ ok: false, error: `Not enough NP (you have ${current.toLocaleString()})` });
  pts[key] = current - wagerVal;
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  d.predictions.push({ username: key, displayName: username, guess: guessVal, wager: wagerVal, payout: null, createdAt: new Date().toISOString() });
  savePredictor(d);
  res.json({ ok: true, guess: guessVal, wager: wagerVal, newBalance: pts[key] });
});

app.post('/predictor/create', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess || sess.username !== 'niksi777') return res.status(403).json({ error: 'Forbidden' });
  const { startingBalance } = req.body;
  if (!startingBalance) return res.status(400).json({ error: 'Starting balance required' });
  const d = loadPredictor();
  if (d.hunt && d.hunt.status !== 'resolved') return res.status(400).json({ error: 'Resolve the current hunt first' });
  d.hunt = { id: Date.now().toString(), status: 'open', startingBalance: Number(startingBalance), endingBalance: null, result: null, createdAt: new Date().toISOString(), closedAt: null, resolvedAt: null };
  d.predictions = [];
  savePredictor(d);
  const announceMsg = `A $${Number(startingBalance).toLocaleString()} bonus hunt has started - Predict the ending balance to win 2x your wager! Type: !predict [your guess] [wager] e.g. !predict 1200 50 or visit: https://niksi777.com/predictor`;
  require('http').request({ hostname: '127.0.0.1', port: 4002, path: '/announce', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_API_SECRET } }, () => {}).on('error', () => {}).end(JSON.stringify({ message: announceMsg }));
  res.json({ ok: true, hunt: d.hunt });
});

app.post('/predictor/close', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess || sess.username !== 'niksi777') return res.status(403).json({ error: 'Forbidden' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status !== 'open') return res.status(400).json({ error: 'No open hunt' });
  d.hunt.status = 'closed'; d.hunt.closedAt = new Date().toISOString();
  savePredictor(d);
  res.json({ ok: true });
});

app.post('/predictor/cancel', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess || sess.username !== 'niksi777') return res.status(403).json({ error: 'Forbidden' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status === 'resolved') return res.status(400).json({ error: 'No active hunt to cancel' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {}; try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  let refundCount = 0;
  d.predictions.forEach(pred => {
    pts[pred.username] = (pts[pred.username] || 0) + pred.wager;
    refundCount++;
  });
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  d.hunt = null;
  d.predictions = [];
  savePredictor(d);
  res.json({ ok: true, refundCount });
});

app.post('/predictor/resolve', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess || sess.username !== 'niksi777') return res.status(403).json({ error: 'Forbidden' });
  const { endingBalance } = req.body;
  if (endingBalance == null) return res.status(400).json({ error: 'Ending balance required' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status === 'resolved') return res.status(400).json({ error: 'Nothing to resolve' });
  const ending = Number(endingBalance);
  d.hunt.status = 'resolved'; d.hunt.endingBalance = ending; d.hunt.resolvedAt = new Date().toISOString();
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {}; try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  let winnerCount = 0;
  if (d.predictions.length > 0) {
    const minDist = Math.min(...d.predictions.map(p => Math.abs(p.guess - ending)));
    d.predictions.forEach(pred => {
      if (Math.abs(pred.guess - ending) === minDist) {
        pred.payout = pred.wager * 2;
        pts[pred.username] = (pts[pred.username] || 0) + pred.payout;
        winnerCount++;
      } else {
        pred.payout = 0;
      }
    });
  }
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  d.history = [{ ...d.hunt, predictions: [...d.predictions] }, ...(d.history || [])].slice(0, 50);
  savePredictor(d);
  const totalPot = d.predictions.reduce((s, p) => s + (p.wager || 0), 0);
  res.json({ ok: true, endingBalance: ending, totalPot, winnerCount });
});

app.get('/predictor/history', (req, res) => {
  const d = loadPredictor();
  res.json({ history: (d.history || []).map(h => {
    const preds = h.predictions || [];
    let winnerGuess = null;
    if (h.endingBalance != null && preds.length > 0) {
      const minDist = Math.min(...preds.map(p => Math.abs(p.guess - h.endingBalance)));
      winnerGuess = preds.filter(p => Math.abs(p.guess - h.endingBalance) === minDist)[0]?.guess;
    }
    return { id: h.id, startingBalance: h.startingBalance, endingBalance: h.endingBalance, winnerGuess, resolvedAt: h.resolvedAt, totalPot: preds.reduce((s,p)=>s+(p.wager||0),0), winnerCount: preds.filter(p=>p.payout>0).length, totalPredictions: preds.length };
  }) });
});
app.delete('/predictor/history/:id', (req, res) => {
  const sess = sessions[req.headers['x-session-id']];
  if (!sess || sess.username !== 'niksi777') return res.status(403).json({ error: 'Forbidden' });
  const d = loadPredictor();
  const before = (d.history || []).length;
  d.history = (d.history || []).filter(h => h.id !== req.params.id);
  if (d.history.length === before) return res.status(404).json({ error: 'Not found' });
  savePredictor(d);
  res.json({ ok: true });
});
// Clean URLs
app.get('/leaderboards', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/points', (req, res) => res.redirect(301, '/leaderboards?tab=points'));
app.get('/store', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/gamba', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/giveaway', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/predictor', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/predict',   (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
app.get('/overlay-giveaway', (req, res) => res.sendFile(path.join(__dirname, '../frontend/overlay-giveaway.html')));
app.get('/stream-overlay', (req, res) => res.sendFile(path.join(__dirname, '../frontend/stream-overlay.html')));
app.get('/stream-bg', (req, res) => res.sendFile(path.join(__dirname, '../frontend/stream-bg.html')));
app.get('/stream-banner', (req, res) => res.sendFile(path.join(__dirname, '../frontend/stream-banner.html')));
app.get('/chicken-banner', (req, res) => res.sendFile(path.join(__dirname, '../frontend/chicken-banner.html')));
app.get('/chicken-weekly-banner', (req, res) => res.sendFile(path.join(__dirname, '../frontend/chicken-weekly-banner.html')));
app.get('/krush-banner', (req, res) => res.sendFile(path.join(__dirname, '../frontend/krush-banner.html')));
app.get('/betfury-banner', (req, res) => res.sendFile(path.join(__dirname, '../frontend/betfury-banner.html')));

// Points API
app.get('/points/:username', (req, res) => {
  try {
    const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    res.json({ username: req.params.username, points: data[req.params.username.toLowerCase()] || 0 });
  } catch { res.json({ username: req.params.username, points: 0 }); }
});
const LEADERBOARD_HIDDEN = ['niksi777','niksibot'];
app.get('/leaderboard', (req, res) => {
  try {
    const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = Object.entries(data).filter(([u])=>!LEADERBOARD_HIDDEN.includes(u.toLowerCase())).sort(([,a],[,b]) => b-a).slice(0,limit).map(([username,points],i) => ({ rank:i+1, username, points }));
    res.json({ leaderboard });
  } catch { res.json({ leaderboard: [] }); }
});

// Store Redemption
const { Client: DClient2, GatewayIntentBits: GI2 } = require("discord.js");
const discordClient = new DClient2({ intents: [GI2.Guilds] });
discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(err => console.error('[discord bot] Login failed:', err.message));
discordClient.on("ready", () => console.log("[discord] Bot ready:", discordClient.user.tag));

const REDEMPTION_ITEMS = [
  { id:1, title:'$10 Tip', cost:600 },
  { id:2, title:'$15 Tip', cost:850 },
  { id:3, title:'$20 Bonus Buy', cost:1000 },
  { id:4, title:'$40 Bonus Buy', cost:2000 },
  { id:5, title:'$100 Bonus Buy', cost:5000 },
];
app.post('/redeem', async (req, res) => {
  const { username, itemId, note } = req.body;
  if (!username || !itemId) return res.status(400).json({ error: 'Missing username or item.' });

  const redeemSessionId = req.headers['x-session-id'] || req.body.session;
  const redeemSession = sessions[redeemSessionId];
  if (!redeemSession || !redeemSession.discordId) {
    return res.status(400).json({ error: 'Please link your Discord account before redeeming.' });
  }

  const item = REDEMPTION_ITEMS.find(i => i.id === parseInt(itemId));
  if (!item) return res.status(400).json({ error: 'Item not found.' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let ptsData = {};
  try { ptsData = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const current = ptsData[username.toLowerCase()] || 0;
  if (current < item.cost) return res.status(400).json({ error: `Not enough NP. You have ${current}, need ${item.cost}.` });
  ptsData[username.toLowerCase()] = current - item.cost;
  require('fs').writeFileSync(ptsPath, JSON.stringify(ptsData, null, 2));
  console.log(`[redeem] ${username} (Discord: ${redeemSession.discordName}) redeemed ${item.title} for ${item.cost} pts. Balance: ${ptsData[username.toLowerCase()]}`);
  try {
    await require('axios').post('http://localhost:3002/create-ticket', {
      username,
      item: item.title,
      cost: item.cost,
      note: note || '',
      discordId: redeemSession.discordId,
      discordName: redeemSession.discordName
    });
  } catch (err) { console.error('[redeem] ticket error:', err.message); }
  res.json({ ok: true, points: ptsData[username.toLowerCase()] });
});

// Points API routes
app.get('/api/points/:username', (req, res) => {
  try {
    const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    res.json({ username: req.params.username, points: data[req.params.username.toLowerCase()] || 0 });
  } catch { res.json({ username: req.params.username, points: 0 }); }
});
app.get('/api/leaderboard', (req, res) => {
  try {
    const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = Object.entries(data).filter(([u])=>!LEADERBOARD_HIDDEN.includes(u.toLowerCase())).sort(([,a],[,b]) => b-a).slice(0,limit).map(([username,points],i) => ({ rank:i+1, username, points }));
    res.json({ leaderboard });
  } catch { res.json({ leaderboard: [] }); }
});
const cryptoM = require('crypto');
const sessions = {};
const pkceStore = {};
const discordStateStore = {};

const ADMIN_USERNAMES = ['niksi777', 'niksibot'];
const isAdminUser = (username) => ADMIN_USERNAMES.includes((username || '').toLowerCase());
const ACCOUNTS_PATH = require('path').join(__dirname, '../../accounts.json');
const SESSIONS_PATH = require('path').join(__dirname, '../../sessions.json');
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

function loadAccounts() {
  try { return JSON.parse(require('fs').readFileSync(ACCOUNTS_PATH, 'utf8')); } catch { return {}; }
}
function upsertAccount(update) {
  const accounts = loadAccounts();
  const key = update.kickUsername;
  accounts[key] = Object.assign(accounts[key] || { firstSeen: new Date().toISOString() }, update, { lastSeen: new Date().toISOString() });
  require('fs').writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}
function saveSessions() {
  require('fs').writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
}
// Load persisted sessions on startup, purge expired ones
try {
  const stored = JSON.parse(require('fs').readFileSync(SESSIONS_PATH, 'utf8'));
  const now = Date.now();
  Object.entries(stored).forEach(([id, sess]) => {
    if (now - sess.createdAt < SESSION_TTL) sessions[id] = sess;
  });
  console.log(`[sessions] Loaded ${Object.keys(sessions).length} active sessions`);
} catch { /* no sessions file yet */ }
const KICK_CLIENT_ID_AUTH = '01KSMGZDPR13CZRMZS6QV6ZFZC';
const KICK_CLIENT_SECRET_AUTH = '866339aa78f7dd05cff1d25a0ca567dab3f1505cd6eb4d49ff277cde010a4a42';
const AUTH_REDIRECT = 'https://niksi777.com/auth/callback';
app.get('/auth/login', (req, res) => {
  const codeVerifier = cryptoM.randomBytes(64).toString('base64url');
  const codeChallenge = cryptoM.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = cryptoM.randomBytes(16).toString('hex');
  pkceStore[state] = { codeVerifier, createdAt: Date.now() };
  setTimeout(() => delete pkceStore[state], 600000);
  res.redirect(`https://id.kick.com/oauth/authorize?response_type=code&client_id=${KICK_CLIENT_ID_AUTH}&redirect_uri=${encodeURIComponent(AUTH_REDIRECT)}&scope=user%3Aread&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`);
});
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const pkce = pkceStore[state];
  if (!pkce) return res.redirect('/store?auth=error');
  delete pkceStore[state];
  try {
    const axiosA = require('axios');
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', KICK_CLIENT_ID_AUTH);
    params.append('client_secret', KICK_CLIENT_SECRET_AUTH);
    params.append('redirect_uri', AUTH_REDIRECT);
    params.append('code_verifier', pkce.codeVerifier);
    params.append('code', code);
    const { data: tokenData } = await axiosA.post('https://id.kick.com/oauth/token', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const { data: userData } = await axiosA.get('https://api.kick.com/public/v1/users', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const user = userData.data[0];
    const sessionId = cryptoM.randomBytes(32).toString('hex');
    sessions[sessionId] = { username: user.name.toLowerCase(), displayName: user.name, avatar: user.profile_picture, createdAt: Date.now() };
    upsertAccount({ kickUsername: user.name.toLowerCase(), kickDisplayName: user.name, kickAvatar: user.profile_picture });
    // Restore permanently linked Discord info
    const savedAcc = loadAccounts()[user.name.toLowerCase()];
    if (savedAcc && savedAcc.discordId) {
      sessions[sessionId].discordId = savedAcc.discordId;
      sessions[sessionId].discordName = savedAcc.discordName;
      sessions[sessionId].discordAvatar = savedAcc.discordAvatar;
    }
    saveSessions();
    res.redirect(`/store?session=${sessionId}`);
  } catch (err) {
    console.error('[auth]', err?.response?.data || err.message);
    res.redirect('/store?auth=error');
  }
});
app.get('/auth/me', (req, res) => {
  const sessionId = req.query.session || req.headers['x-session-id'];
  const session = sessions[sessionId];
  if (!session) return res.status(401).json({ error: 'Not logged in' });
  if (Date.now() - session.createdAt > SESSION_TTL) { delete sessions[sessionId]; saveSessions(); return res.status(401).json({ error: 'Session expired' }); }
  try {
    const ptsData = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    session.points = ptsData[session.username] || 0;
  } catch { session.points = 0; }
  res.json({
    username: session.username,
    displayName: session.displayName,
    avatar: session.discordAvatar || session.avatar,
    points: session.points,
    discordLinked: !!session.discordId,
    discordId: session.discordId || null,
    discordName: session.discordName || null,
    discordAvatar: session.discordAvatar || null,
    isAdmin: isAdminUser(session.username)
  });
});
app.get('/auth/logout', (req, res) => {
  const sessionId = req.query.session;
  if (sessionId) { delete sessions[sessionId]; saveSessions(); }
  res.json({ ok: true });
});

app.get('/auth/discord', (req, res) => {
  const sessionId = req.query.session;
  if (!sessionId || !sessions[sessionId]) return res.redirect('/store?discord=error&reason=no-session');
  const state = cryptoM.randomBytes(16).toString('hex');
  discordStateStore[state] = { sessionId, createdAt: Date.now() };
  setTimeout(() => delete discordStateStore[state], 600000);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: '1507460805518692552',
    redirect_uri: 'http://niksi777.com/auth/discord/callback',
    scope: 'identify',
    state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  const stored = discordStateStore[state];
  if (!stored) return res.redirect('/store?discord=error');
  delete discordStateStore[state];
  try {
    const params = new URLSearchParams({
      client_id: '1507460805518692552',
      client_secret: 'n3Ossxz3GiImDvWE3XUEDiyvjGxb63ot',
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://niksi777.com/auth/discord/callback'
    });
    const { data: tokenData } = await axios.post('https://discord.com/api/oauth2/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const { data: discordUser } = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordUser.id) % 5n)}.png`;
    if (stored.sessionId && sessions[stored.sessionId]) {
      sessions[stored.sessionId].discordId = discordUser.id;
      sessions[stored.sessionId].discordName = discordUser.username;
      sessions[stored.sessionId].discordAvatar = avatarUrl;
      console.log(`[discord] Linked ${discordUser.username} to Kick session ${stored.sessionId}`);
      upsertAccount({ kickUsername: sessions[stored.sessionId].username, discordId: discordUser.id, discordName: discordUser.username, discordAvatar: avatarUrl });
      saveSessions();
    }
    res.redirect(`/store?session=${stored.sessionId}&discord=linked`);
  } catch (err) {
    console.error('[discord auth]', err?.response?.data || err.message);
    res.redirect('/store?discord=error');
  }
});
