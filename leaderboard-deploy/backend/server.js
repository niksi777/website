require("dotenv").config({path:"/root/website/.env"});
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

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
async function updateLeaderboard() {
  try {
    const raceId = 12640;

    const url =
  "https://gamba.com/_api/@?operationName=getRaceById" +
  `&variables=%7B%22raceId%22%3A${raceId}%7D` +
  "&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22edad63165a235e578a7ff3bc850e72a2dac211713ca37e80f1496cb59198c305%22%7D%7D";

   const response = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://gamba.com/promotions/exclusive-leaderboards/12640",
    "Origin": "https://gamba.com",
  },
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
app.get("/players", (req, res) => {
  db.all(
    "SELECT * FROM players ORDER BY position ASC",
    [],
    (err, rows) => {
      if (err) {
        console.log(err);
        return res.json([]);
      }
      res.json(rows);
    }
  );
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

app.get('/giveaway/state', (req, res) => {
  res.json(giveawayState);
});

app.post('/giveaway/start', (req, res) => {
  const { keyword, prize } = req.body;
  if (!keyword || !prize) return res.status(400).json({ error: 'keyword and prize required' });
  giveawayState = {
    giveaway: { keyword: keyword.toLowerCase().trim(), prize, winner: null, started_at: Date.now() },
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
  const pool = giveawayState.entries.filter(e => e.username !== previous);
  if (pool.length === 0) return res.status(400).json({ error: 'No other entries to reroll from' });
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

// Clean URLs
app.get('/leaderboards', (req, res) => res.sendFile(path.join(__dirname, '../frontend/leaderboards.html')));
app.get('/points', (req, res) => res.sendFile(path.join(__dirname, '../frontend/points.html')));
app.get('/store', (req, res) => res.sendFile(path.join(__dirname, '../frontend/store.html')));
app.get('/gamba', (req, res) => res.sendFile(path.join(__dirname, '../frontend/gamba.html')));
app.get('/giveaway', (req, res) => res.sendFile(path.join(__dirname, '../frontend/giveaway.html')));

// Points API
app.get('/points/:username', (req, res) => {
  try {
    const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    res.json({ username: req.params.username, points: data[req.params.username.toLowerCase()] || 0 });
  } catch { res.json({ username: req.params.username, points: 0 }); }
});
app.get('/leaderboard', (req, res) => {
  try {
    const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = Object.entries(data).sort(([,a],[,b]) => b-a).slice(0,limit).map(([username,points],i) => ({ rank:i+1, username, points }));
    res.json({ leaderboard });
  } catch { res.json({ leaderboard: [] }); }
});

// Store Redemption
const { Client: DClient2, GatewayIntentBits: GI2 } = require("discord.js");
const discordClient = new DClient2({ intents: [GI2.Guilds] });
discordClient.login('MTUwNzQ2MDgwNTUxODY5MjU1Mg.GG0MLQ.u9vybc8e0PnVGm8rWZiiBPEVNEoQO1PChKzkiA');
discordClient.on("ready", () => console.log("[discord] Bot ready:", discordClient.user.tag));

const REDEMPTION_ITEMS = [
  { id:1, title:'$10 Tip', cost:300 },
  { id:2, title:'$15 Tip', cost:425 },
  { id:3, title:'$20 Bonus Buy', cost:500 },
  { id:4, title:'$40 Bonus Buy', cost:1000 },
  { id:5, title:'$100 Bonus Buy', cost:2500 },
];
app.post('/redeem', async (req, res) => {
  const { username, itemId, note } = req.body;
  if (!username || !itemId) return res.status(400).json({ error: 'Missing username or item.' });
  const item = REDEMPTION_ITEMS.find(i => i.id === parseInt(itemId));
  if (!item) return res.status(400).json({ error: 'Item not found.' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let ptsData = {};
  try { ptsData = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const current = ptsData[username.toLowerCase()] || 0;
  if (current < item.cost) return res.status(400).json({ error: `Not enough points. You have ${current}, need ${item.cost}.` });
  ptsData[username.toLowerCase()] = current - item.cost;
  require('fs').writeFileSync(ptsPath, JSON.stringify(ptsData, null, 2));
  console.log(`[redeem] ${username} redeemed ${item.title} for ${item.cost} pts. Balance: ${ptsData[username.toLowerCase()]}`);
  try {
    await require('axios').post('http://localhost:3002/create-ticket', { username, item: item.title, cost: item.cost, note: note || '' });
  } catch (err) { console.error('[redeem] Discord error:', err.message); }
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
    const leaderboard = Object.entries(data).sort(([,a],[,b]) => b-a).slice(0,limit).map(([username,points],i) => ({ rank:i+1, username, points }));
    res.json({ leaderboard });
  } catch { res.json({ leaderboard: [] }); }
});
const cryptoM = require('crypto');
const sessions = {};
const pkceStore = {};
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
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) { delete sessions[sessionId]; return res.status(401).json({ error: 'Session expired' }); }
  try {
    const ptsData = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../points.json'), 'utf8'));
    session.points = ptsData[session.username] || 0;
  } catch { session.points = 0; }
  res.json({ username: session.username, displayName: session.displayName, avatar: session.avatar, points: session.points });
});
app.get('/auth/logout', (req, res) => {
  const sessionId = req.query.session;
  if (sessionId) delete sessions[sessionId];
  res.json({ ok: true });
});
