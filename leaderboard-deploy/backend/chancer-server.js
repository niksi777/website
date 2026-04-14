const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serves frontend so this server can run chancer.html independently
app.use(express.static(path.join(__dirname, "../frontend")));

function normalizeChancerRows(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.rows || payload?.leaderboard || payload?.data || payload?.results || [];

  if (!Array.isArray(list)) return [];

  return list.map((row, index) => {
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
  }).sort((a, b) => a.position - b.position);
}

app.get("/chancer-players", async (_req, res) => {
  const apiUrl = "https://api-affiliate.fungamess.games/nux/leaderboard/";
  const token = "fYDQGOG7YncwMZZnGffJzkozjz5XcxbP";

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-API-Key": token,
        "x-api-key": token,
      },
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.log("Chancer API returned non-JSON payload");
      return res.json([]);
    }

    const rows = normalizeChancerRows(json);
    res.json(rows);
  } catch (err) {
    console.log("Chancer API error:", err);
    res.json([]);
  }
});

app.listen(4100, () => {
  console.log("Chancer backend running on http://127.0.0.1:4100");
});
