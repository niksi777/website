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
    const raceId = 11287;

    const url =
  "https://gamba.com/_api/@?operationName=getRaceById" +
  `&variables=%7B%22raceId%22%3A${raceId}%7D` +
  "&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22edad63165a235e578a7ff3bc850e72a2dac211713ca37e80f1496cb59198c305%22%7D%7D";

   const response = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://gamba.com/promotions/exclusive-leaderboards/11287",
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
