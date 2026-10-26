
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
  const pT = preds.filter(p => p.side === 'profit').reduce((s, p) => s + p.amount, 0);
  const nT = preds.filter(p => p.side === 'noprofit').reduce((s, p) => s + p.amount, 0);
  res.json({
    hunt: d.hunt.status === 'resolved' ? d.hunt : { ...d.hunt, endingBalance: undefined },
    stats: { profitCount: preds.filter(p => p.side === 'profit').length, noprofitCount: preds.filter(p => p.side === 'noprofit').length, profitTotal: pT, noprofitTotal: nT, totalPot: pT + nT, totalPredictions: preds.length }
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
  const { side, amount } = req.body;
  if (!['profit', 'noprofit'].includes(side)) return res.status(400).json({ error: 'Side must be profit or noprofit' });
  const wager = Math.floor(Number(amount));
  if (!wager || wager < 1) return res.status(400).json({ error: 'Invalid wager amount' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status !== 'open') return res.status(400).json({ error: 'No open prediction right now' });
  if (d.predictions.find(p => p.username === sess.username)) return res.status(400).json({ error: 'You have already placed a prediction' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {}; try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const current = pts[sess.username] || 0;
  if (current < wager) return res.status(400).json({ error: `Not enough NP. You have ${current.toLocaleString()}, need ${wager.toLocaleString()}.` });
  pts[sess.username] = current - wager;
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  d.predictions.push({ username: sess.username, displayName: sess.displayName, side, amount: wager, payout: null, createdAt: new Date().toISOString() });
  savePredictor(d);
  res.json({ ok: true, side, amount: wager, newBalance: pts[sess.username] });
});

app.post('/predictor/bot-predict', (req, res) => {
  if (req.headers['x-bot-secret'] !== process.env.BOT_API_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const { username, side, amount } = req.body;
  const key = (username || '').toLowerCase();
  if (!key || !['profit', 'noprofit'].includes(side)) return res.status(400).json({ error: 'Invalid' });
  const wager = Math.floor(Number(amount));
  if (!wager || wager < 1) return res.status(400).json({ error: 'Invalid wager' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status !== 'open') return res.json({ ok: false, error: 'No open prediction right now' });
  if (d.predictions.find(p => p.username === key)) return res.json({ ok: false, error: 'You already placed a prediction' });
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {}; try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  const current = pts[key] || 0;
  if (current < wager) return res.json({ ok: false, error: `Not enough NP (you have ${current.toLocaleString()})` });
  pts[key] = current - wager;
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  d.predictions.push({ username: key, displayName: username, side, amount: wager, payout: null, createdAt: new Date().toISOString() });
  savePredictor(d);
  res.json({ ok: true, side, amount: wager, newBalance: pts[key] });
});

app.post('/predictor/create', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess || !isAdminUser(sess.username)) return res.status(403).json({ error: 'Forbidden' });
  const { startingBalance } = req.body;
  if (!startingBalance) return res.status(400).json({ error: 'Starting balance required' });
  const d = loadPredictor();
  if (d.hunt && d.hunt.status !== 'resolved') return res.status(400).json({ error: 'Resolve the current hunt first' });
  d.hunt = { id: Date.now().toString(), status: 'open', startingBalance: Number(startingBalance), endingBalance: null, result: null, createdAt: new Date().toISOString(), closedAt: null, resolvedAt: null };
  d.predictions = [];
  savePredictor(d);
  res.json({ ok: true, hunt: d.hunt });
});

app.post('/predictor/close', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess || !isAdminUser(sess.username)) return res.status(403).json({ error: 'Forbidden' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status !== 'open') return res.status(400).json({ error: 'No open hunt' });
  d.hunt.status = 'closed'; d.hunt.closedAt = new Date().toISOString();
  savePredictor(d);
  res.json({ ok: true });
});

app.post('/predictor/resolve', (req, res) => {
  const sid = req.headers['x-session-id'] || req.body.session;
  const sess = sessions[sid];
  if (!sess || !isAdminUser(sess.username)) return res.status(403).json({ error: 'Forbidden' });
  const { endingBalance } = req.body;
  if (endingBalance == null) return res.status(400).json({ error: 'Ending balance required' });
  const d = loadPredictor();
  if (!d.hunt || d.hunt.status === 'resolved') return res.status(400).json({ error: 'Nothing to resolve' });
  const ending = Number(endingBalance);
  const result = ending > d.hunt.startingBalance ? 'profit' : 'noprofit';
  d.hunt.status = 'resolved'; d.hunt.endingBalance = ending; d.hunt.result = result; d.hunt.resolvedAt = new Date().toISOString();
  const winners = d.predictions.filter(p => p.side === result);
  const losers  = d.predictions.filter(p => p.side !== result);
  const winTotal = winners.reduce((s, p) => s + p.amount, 0);
  const losTotal = losers.reduce((s, p) => s + p.amount, 0);
  const totalPot = winTotal + losTotal;
  const ptsPath = require('path').join(__dirname, '../../points.json');
  let pts = {}; try { pts = JSON.parse(require('fs').readFileSync(ptsPath, 'utf8')); } catch {}
  d.predictions.forEach(pred => {
    if (pred.side === result && winTotal > 0) {
      pred.payout = Math.floor((pred.amount / winTotal) * totalPot);
      pts[pred.username] = (pts[pred.username] || 0) + pred.payout;
    } else {
      pred.payout = 0;
    }
  });
  require('fs').writeFileSync(ptsPath, JSON.stringify(pts, null, 2));
  d.history = [{ ...d.hunt, predictions: [...d.predictions] }, ...(d.history || [])].slice(0, 50);
  savePredictor(d);
  res.json({ ok: true, result, totalPot, winnerCount: winners.length });
});

app.get('/predictor/history', (req, res) => {
  const d = loadPredictor();
  res.json({ history: (d.history || []).map(h => ({ id: h.id, startingBalance: h.startingBalance, endingBalance: h.endingBalance, result: h.result, resolvedAt: h.resolvedAt, totalPot: h.predictions.reduce((s,p)=>s+p.amount,0), winnerCount: h.predictions.filter(p=>p.side===h.result).length, totalPredictions: h.predictions.length })) });
});
