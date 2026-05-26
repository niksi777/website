# Raffle Points System

A Kick chat bot + REST API for managing a points-based raffle system on your website.

## Files

| File | Purpose |
|---|---|
| `pointsManager.js` | Read/write user points to `points.json` |
| `raffleManager.js` | Raffle state: open, enter, draw, reroll |
| `kickBot.js` | Kick chat bot — polls chat and handles commands |
| `pointsApi.js` | REST API so the website store can award/deduct points |
| `index.js` | Starts both bot + API |

## Setup

1. Copy `.env.example` to `.env` and fill in your values:
   ```
   KICK_CHANNEL=niksi
   KICK_BOT_TOKEN=your_token_here
   MODS=niksi,yourmod
   POINTS_API_SECRET=your_secret_here
   ```

2. Install deps:
   ```bash
   npm install axios dotenv
   ```

3. Add to `index.js` (already done):
   ```js
   require('dotenv').config();
   ```

4. Run:
   ```bash
   node index.js
   ```

---

## Chat Commands

### Everyone
| Command | Description |
|---|---|
| `!enter` | Enter the current open raffle |
| `!raffle` | Check if a raffle is open + entrant count |
| `!points` | Check your own points |
| `!points @user` | Check another user's points |
| `!top` | Show top 5 points leaderboard |

### Mods only
| Command | Description |
|---|---|
| `!openraffle [title]` | Open a new raffle with optional title |
| `!closeraffle` | Close entries |
| `!draw` | Draw a random winner |
| `!reroll` | Re-draw a new winner |
| `!addpoints @user 500` | Add points to a user |
| `!removepoints @user 200` | Remove points from a user |
| `!setpoints @user 1000` | Set a user's points to exact amount |

---

## REST API (for the website store)

All mutating routes require the `x-api-secret` header.

```
GET  /points/:username           → { username, points }
GET  /leaderboard?limit=10       → { leaderboard: [...] }
POST /points/add                 → { username, amount } → { username, points }
POST /points/deduct              → { username, amount } → { username, points } or 400
POST /points/set                 → { username, amount } → { username, points }
```

### Example: deduct points when redeeming a store item
```js
const res = await fetch('http://localhost:3001/points/deduct', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-secret': process.env.POINTS_API_SECRET
  },
  body: JSON.stringify({ username: 'niksi', amount: 500 })
});
const data = await res.json();
// { username: 'niksi', points: 1200 }  ← new balance
// or 400 { error: 'Insufficient points', points: 300 }
```

---

## Notes

- Points persist in `points.json` — back this file up!
- Raffle state is **in-memory** and resets on bot restart (by design — raffles are per-stream).
- Kick doesn't have an official bot WebSocket API yet, so the bot polls the REST endpoint every 1.5s. This works fine for chat volume on most channels.
