require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { getPoints, addPoints, deductPoints, setPoints, getLeaderboard } = require('./pointsManager');
const { openRaffle, joinRaffle, getRaffleStatus, cancelRaffle } = require('./raffleManager');

const CHANNEL = process.env.KICK_CHANNEL || 'niksi777';
const CLIENT_ID = process.env.KICK_CLIENT_ID || '01KSJ34DC0Q8BD3DYQM328H81S';
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || '724b7105d889578107727bf454f909096a4f20d73bb1c0e2a84988c1759b1bae';
const MODS = (process.env.MODS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const CHATROOM_ID = process.env.KICK_CHATROOM_ID || '36479996';
const BROADCASTER_ID = 37840728;
const ENV_PATH = path.join(__dirname, '.env');

let BOT_TOKEN = process.env.KICK_BOT_TOKEN || '';
let REFRESH_TOKEN = process.env.KICK_BOT_REFRESH_TOKEN || '';

// ─── TOKEN REFRESH ────────────────────────────────────────────────────────────
async function refreshToken() {
  try {
    console.log('[auth] Refreshing token...');
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('refresh_token', REFRESH_TOKEN);

    const { data } = await axios.post('https://id.kick.com/oauth/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    BOT_TOKEN = data.access_token;
    REFRESH_TOKEN = data.refresh_token;

    // Update .env file with new tokens
    let env = fs.readFileSync(ENV_PATH, 'utf8');
    env = env.replace(/KICK_BOT_TOKEN=.*/,`KICK_BOT_TOKEN=${BOT_TOKEN}`);
    env = env.replace(/KICK_BOT_REFRESH_TOKEN=.*/,`KICK_BOT_REFRESH_TOKEN=${REFRESH_TOKEN}`);
    fs.writeFileSync(ENV_PATH, env);

    console.log('[auth] Token refreshed successfully.');
  } catch (err) {
    console.error('[auth] Token refresh failed:', err?.response?.data || err.message);
  }
}

// Refresh every 90 minutes (tokens last 2 hours)
setInterval(refreshToken, 90 * 60 * 1000);

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage(text) {
  try {
    await axios.post(
      'https://api.kick.com/public/v1/chat',
      { type: 'user', content: text, broadcaster_user_id: BROADCASTER_ID },
      { headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );
  } catch (err) {
    // If unauthorized, try refreshing token and retry once
    if (err?.response?.status === 401) {
      await refreshToken();
      try {
        await axios.post(
          'https://api.kick.com/public/v1/chat',
          { type: 'user', content: text, broadcaster_user_id: BROADCASTER_ID },
          { headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
        );
      } catch (err2) {
        console.error('[send error]', err2?.response?.data || err2.message);
      }
    } else {
      console.error('[send error]', err?.response?.data || err.message);
    }
  }
}

// ─── PERMISSIONS ──────────────────────────────────────────────────────────────
function isModOrBroadcaster(username) {
  const u = username.toLowerCase();
  return u === CHANNEL.toLowerCase() || MODS.includes(u);
}

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
async function handleCommand(username, message) {
  const parts = message.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '!raffle') {
    if (!isModOrBroadcaster(username)) return;
    const result = openRaffle(sendMessage);
    if (!result.success) await sendMessage(result.message);
    return;
  }

  if (cmd === '!join') { joinRaffle(username); return; }

  if (cmd === '!cancelraffle') {
    if (!isModOrBroadcaster(username)) return;
    const result = cancelRaffle();
    await sendMessage(result.message);
    return;
  }

  if (cmd === '!points') {
    const target = parts[1]?.replace('@', '') || username;
    await sendMessage(`@${target} has ${getPoints(target).toLocaleString()} points.`);
    return;
  }

  if (cmd === '!top') {
    const lb = getLeaderboard(5);
    if (lb.length === 0) { await sendMessage('No points data yet.'); return; }
    await sendMessage(`Top Points: ${lb.map(e => `#${e.rank} ${e.username} (${e.points.toLocaleString()})`).join(' | ')}`);
    return;
  }

  if (!isModOrBroadcaster(username)) return;

  if (cmd === '!addpoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount <= 0) { await sendMessage('Usage: !addpoints <user> <amount>'); return; }
    await sendMessage(`Added ${amount.toLocaleString()} pts to @${target}. Balance: ${addPoints(target, amount).toLocaleString()}`);
    return;
  }

  if (cmd === '!removepoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount <= 0) { await sendMessage('Usage: !removepoints <user> <amount>'); return; }
    const result = deductPoints(target, amount);
    if (result === null) await sendMessage(`@${target} does not have enough points.`);
    else await sendMessage(`Removed ${amount.toLocaleString()} pts from @${target}. Balance: ${result.toLocaleString()}`);
    return;
  }

  if (cmd === '!setpoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount < 0) { await sendMessage('Usage: !setpoints <user> <amount>'); return; }
    await sendMessage(`Set @${target} points to ${setPoints(target, amount).toLocaleString()}`);
    return;
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function connectWebSocket(chatroomId) {
  const ws = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false');

  ws.on('open', () => {
    console.log('[ws] Connected to Pusher');
    ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } }));
    console.log(`[ws] Subscribed to chatroom ${chatroomId}`);
  });

  ws.on('message', (raw) => {
    try {
      const packet = JSON.parse(raw.toString());
      if (packet.event === 'pusher:ping') { ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); return; }
      if (packet.event === 'App\\Events\\ChatMessageEvent') {
        const data = JSON.parse(packet.data);
        const username = data?.sender?.username || data?.sender?.slug;
        const content = data?.content;
        if (username && content) {
          fetch('http://localhost:4000/giveaway/chat-message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,content,ts:Date.now()})}).catch(()=>{});
          if (content.startsWith('!')) handleCommand(username, content);
          // Giveaway keyword check
          fetch('http://localhost:4000/giveaway/state')
            .then(r=>r.json())
            .then(state=>{
              if(state.giveaway && state.giveaway.keyword && !state.giveaway.winner) {
                const kw = state.giveaway.keyword.toLowerCase().trim();
                const msg = content.toLowerCase().trim();
                if(msg === kw) {
                  fetch('http://localhost:4000/giveaway/enter', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({username})
                  }).catch(()=>{});
                }
              }
            }).catch(()=>{});
        }
      }
    } catch {}
  });

  ws.on('close', () => { console.log('[ws] Disconnected. Reconnecting in 5s...'); setTimeout(() => connectWebSocket(chatroomId), 5000); });
  ws.on('error', (err) => { console.error('[ws error]', err.message); });
}

// ─── START ────────────────────────────────────────────────────────────────────
// ─── GIVEAWAY ANNOUNCER ───────────────────────────────────────────────────────
let lastAnnouncedKeyword = null;
setInterval(async () => {
  try {
    const r = await fetch('http://localhost:4000/giveaway/state');
    const state = await r.json();
    if (state.giveaway && state.giveaway.keyword && !state.giveaway.winner) {
      if (state.giveaway.keyword !== lastAnnouncedKeyword) {
        lastAnnouncedKeyword = state.giveaway.keyword;
        const prize = state.giveaway.prize ? ` Prize: ${state.giveaway.prize}` : '';
        await sendMessage(`🎉 Giveaway started! Type "${state.giveaway.keyword}" in chat to enter!${prize}`);
      }
    } else if (!state.giveaway) {
      lastAnnouncedKeyword = null;
    }
  } catch {}
}, 4000);

async function start() {
  console.log(`[bot] Starting for channel: ${CHANNEL}`);
  console.log(`[bot] Mods: ${MODS.join(', ') || '(none set)'}`);
  console.log(`[bot] Chatroom ID: ${CHATROOM_ID}`);
  // Do an initial refresh to make sure token is fresh
  await refreshToken();
  connectWebSocket(CHATROOM_ID);
}

start();
