const axios = require('axios');
const { getPoints, addPoints, deductPoints, setPoints, getLeaderboard } = require('./pointsManager');
const { openRaffle, joinRaffle, getRaffleStatus, cancelRaffle } = require('./raffleManager');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CHANNEL = process.env.KICK_CHANNEL || 'yourchannel';
const BOT_TOKEN = process.env.KICK_BOT_TOKEN || '';
const MODS = (process.env.MODS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const BROADCASTER = (process.env.KICK_CHANNEL || '').toLowerCase();

const POLL_INTERVAL = 1500;
let lastMessageId = null;

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage(text) {
  try {
    await axios.post(
      `https://kick.com/api/v2/channels/${CHANNEL}/messages`,
      { content: text },
      { headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[send error]', err?.response?.data || err.message);
  }
}

// ─── FETCH MESSAGES ───────────────────────────────────────────────────────────
async function fetchMessages() {
  try {
    const { data } = await axios.get(`https://kick.com/api/v2/channels/${CHANNEL}/messages`);
    return data?.data?.messages || [];
  } catch (err) {
    console.error('[fetch error]', err?.response?.data || err.message);
    return [];
  }
}

// ─── PERMISSION CHECK ─────────────────────────────────────────────────────────
function isModOrBroadcaster(username) {
  const u = username.toLowerCase();
  return u === BROADCASTER || MODS.includes(u);
}

// ─── COMMAND HANDLER ──────────────────────────────────────────────────────────
async function handleCommand(username, message) {
  const parts = message.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  // ── !raffle — mods/broadcaster only ──
  if (cmd === '!raffle') {
    if (!isModOrBroadcaster(username)) return;
    const result = openRaffle(sendMessage);
    if (!result.success) await sendMessage(result.message);
    return;
  }

  // ── !join — anyone ──
  if (cmd === '!join') {
    joinRaffle(username); // silent — no reply
    return;
  }

  // ── !cancelraffle — mods/broadcaster only ──
  if (cmd === '!cancelraffle') {
    if (!isModOrBroadcaster(username)) return;
    const result = cancelRaffle();
    await sendMessage(result.message);
    return;
  }

  // ── !points [user] ──
  if (cmd === '!points') {
    const target = parts[1]?.replace('@', '') || username;
    const pts = getPoints(target);
    await sendMessage(`@${target} has ${pts.toLocaleString()} points.`);
    return;
  }

  // ── !top ──
  if (cmd === '!top') {
    const lb = getLeaderboard(5);
    if (lb.length === 0) { await sendMessage('No points data yet.'); return; }
    const text = lb.map(e => `#${e.rank} ${e.username} (${e.points.toLocaleString()})`).join(' | ');
    await sendMessage(`🏆 Top Points: ${text}`);
    return;
  }

  // ── Mod-only points commands ──
  if (!isModOrBroadcaster(username)) return;

  if (cmd === '!addpoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount <= 0) { await sendMessage('Usage: !addpoints <user> <amount>'); return; }
    const newBal = addPoints(target, amount);
    await sendMessage(`✅ Added ${amount.toLocaleString()} points to @${target}. Balance: ${newBal.toLocaleString()}`);
    return;
  }

  if (cmd === '!removepoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount <= 0) { await sendMessage('Usage: !removepoints <user> <amount>'); return; }
    const result = deductPoints(target, amount);
    if (result === null) await sendMessage(`@${target} doesn't have enough points.`);
    else await sendMessage(`✅ Removed ${amount.toLocaleString()} points from @${target}. Balance: ${result.toLocaleString()}`);
    return;
  }

  if (cmd === '!setpoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount < 0) { await sendMessage('Usage: !setpoints <user> <amount>'); return; }
    const newBal = setPoints(target, amount);
    await sendMessage(`✅ Set @${target}'s points to ${newBal.toLocaleString()}`);
    return;
  }
}

// ─── POLL LOOP ────────────────────────────────────────────────────────────────
async function poll() {
  const messages = await fetchMessages();
  for (const msg of messages) {
    if (lastMessageId && msg.id <= lastMessageId) continue;
    const username = msg?.sender?.username || msg?.sender?.slug || 'unknown';
    const content = msg?.content || '';
    if (content.startsWith('!')) await handleCommand(username, content);
  }
  if (messages.length > 0) lastMessageId = messages[messages.length - 1].id;
}

// ─── START ────────────────────────────────────────────────────────────────────
console.log(`[bot] Starting for channel: ${CHANNEL}`);
console.log(`[bot] Mods: ${MODS.join(', ') || '(none set)'}`);

fetchMessages().then(msgs => {
  if (msgs.length > 0) lastMessageId = msgs[msgs.length - 1].id;
  console.log('[bot] Ready. Listening for commands...');
  setInterval(poll, POLL_INTERVAL);
});
