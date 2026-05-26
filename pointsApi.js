const http = require('http');
const { getPoints, addPoints, deductPoints, setPoints, getAllPoints, getLeaderboard } = require('./pointsManager');

const PORT = process.env.POINTS_API_PORT || 3001;
const API_SECRET = process.env.POINTS_API_SECRET || 'changeme'; // set this in your env!

// Tiny router — no framework needed
function router(req, res) {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // CORS for local website dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Auth check on mutating routes
  function authorized() {
    const secret = req.headers['x-api-secret'] || url.searchParams.get('secret');
    return secret === API_SECRET;
  }

  function json(data, status = 200) {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }

  // ── GET /points/:username ──
  if (req.method === 'GET' && pathname.startsWith('/points/')) {
    const username = pathname.split('/')[2];
    if (!username) return json({ error: 'Missing username' }, 400);
    return json({ username, points: getPoints(username) });
  }

  // ── GET /leaderboard?limit=10 ──
  if (req.method === 'GET' && pathname === '/leaderboard') {
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    return json({ leaderboard: getLeaderboard(limit) });
  }

  // ── GET /all ── (full dump, protected)
  if (req.method === 'GET' && pathname === '/all') {
    if (!authorized()) return json({ error: 'Unauthorized' }, 401);
    return json(getAllPoints());
  }

  // All mutating routes need a body — collect it
  if (['POST', 'PUT'].includes(req.method)) {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}

      if (!authorized()) return json({ error: 'Unauthorized' }, 401);

      // ── POST /points/add  { username, amount } ──
      if (pathname === '/points/add') {
        const { username, amount } = parsed;
        if (!username || typeof amount !== 'number') return json({ error: 'username and numeric amount required' }, 400);
        const newBal = addPoints(username, amount);
        return json({ username, points: newBal });
      }

      // ── POST /points/deduct  { username, amount } ──
      if (pathname === '/points/deduct') {
        const { username, amount } = parsed;
        if (!username || typeof amount !== 'number') return json({ error: 'username and numeric amount required' }, 400);
        const result = deductPoints(username, amount);
        if (result === null) return json({ error: 'Insufficient points', points: getPoints(username) }, 400);
        return json({ username, points: result });
      }

      // ── POST /points/set  { username, amount } ──
      if (pathname === '/points/set') {
        const { username, amount } = parsed;
        if (!username || typeof amount !== 'number') return json({ error: 'username and numeric amount required' }, 400);
        const newBal = setPoints(username, amount);
        return json({ username, points: newBal });
      }

      return json({ error: 'Not found' }, 404);
    });
    return;
  }

  json({ error: 'Not found' }, 404);
}

http.createServer(router).listen(PORT, () => {
  console.log(`[points-api] Running on http://localhost:${PORT}`);
});
