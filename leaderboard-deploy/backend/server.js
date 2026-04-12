const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend files correctly (VERY IMPORTANT)
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

  } catch(err) {
    console.log("Acebet error:", err);
  }

}



// Fetch Gamba leaderboard
async function updateLeaderboard() {
  try {
    const raceId = 10495;

const url =
  "https://gamba.com/_api/@?operationName=getRaceById" +
  `&variables=%7B%22raceId%22%3A${raceId}%7D` +
  "&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22f2215aa98152288fd3b357d0a96f1d186e1ce1d9b8764ee6353f6aec0d26beee%22%7D%7D";

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer":
          "https://gamba.com/promotions/exclusive-leaderboards/10495",
        "Origin": "https://gamba.com",
      },
    });

    const json = await response.json();

    if (!json.data || !json.data.getRaceById) {
      console.log("Invalid API response");
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

// Only wipe DB if valid competitors exist
db.run("DELETE FROM players");

competitors.forEach((player) => {
      const prize = prizes.find(
        (p) => p.position === player.position
      );

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
setInterval(updateLeaderboard, 30000);
updateLeaderboard();

// API endpoint for overlay + website
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
