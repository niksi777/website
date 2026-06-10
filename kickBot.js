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

// â”€â”€â”€ TOKEN REFRESH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _refreshing = false; // mutex â€” prevent simultaneous refresh calls invalidating each other
async function refreshToken() {
  if (_refreshing) { console.log('[auth] Refresh already in progress, skipping.'); return; }
  _refreshing = true;
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
  } finally {
    _refreshing = false;
  }
}

// Refresh every 60 minutes (tokens last 2 hours â€” more frequent = safer margin)
setInterval(refreshToken, 60 * 60 * 1000);

// â”€â”€â”€ SEND MESSAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ PERMISSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isBroadcaster(username) {
  const u = username.toLowerCase();
  return u === CHANNEL.toLowerCase() || MODS.includes(u);
}
function isModOrBroadcaster(username, isBadgeMod = false) {
  return isBroadcaster(username) || isBadgeMod;
}

// â”€â”€â”€ EARLY NP ROLL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let earlyRaffle = null; // { entries: Set, timeout }

// â”€â”€â”€ CUSTOM COMMANDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CMDS_PATH = path.join(__dirname, 'commands.json');
function loadCmds() {
  try { return JSON.parse(fs.readFileSync(CMDS_PATH, 'utf8')); } catch { return {}; }
}
function saveCmds(cmds) {
  fs.writeFileSync(CMDS_PATH, JSON.stringify(cmds, null, 2));
}

// â”€â”€â”€ COMMANDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleCommand(username, message, isBadgeMod = false) {
  const parts = message.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '!raffle') {
    if (!isBroadcaster(username)) return;
    const result = openRaffle(sendMessage);
    if (!result.success) await sendMessage(result.message);
    return;
  }

  if (cmd === '!join') {
    joinRaffle(username);
    if (earlyRaffle) earlyRaffle.entries.add(username.toLowerCase());
    return;
  }

  if (cmd === '!early') {
    if (!isBroadcaster(username)) return;
    if (earlyRaffle) { await sendMessage('An early NP roll is already active! Type !join to enter.'); return; }
    earlyRaffle = { entries: new Set() };
    await sendMessage('Early NP Roll! Type !join to enter - winner gets 25 NP! Rolling in 2 minutes!');
    earlyRaffle.timeout = setTimeout(async () => {
      const entries = [...earlyRaffle.entries];
      earlyRaffle = null;
      if (entries.length === 0) { await sendMessage('No one joined the early NP roll!'); return; }
      const winner = entries[Math.floor(Math.random() * entries.length)];
      const newBal = addPoints(winner, 25);
      await sendMessage(`@${winner} won the early NP roll and received 25 NP! Balance: ${newBal.toLocaleString()} NP`);
    }, 2 * 60 * 1000);
    return;
  }

  if (cmd === '!cancelraffle') {
    if (!isBroadcaster(username)) return;
    const result = cancelRaffle();
    await sendMessage(result.message);
    return;
  }

  if (cmd === '!points') {
    const target = parts[1]?.replace('@', '') || username;
    await sendMessage(`@${target} has ${getPoints(target).toLocaleString()} NP.`);
    return;
  }

  if (cmd === '!top') {
    const lb = getLeaderboard(5);
    if (lb.length === 0) { await sendMessage('No NP data yet.'); return; }
    await sendMessage(`Top NP: ${lb.map(e => `#${e.rank} ${e.username} (${e.points.toLocaleString()})`).join(' | ')}`);
    return;
  }

  if (cmd === '!addcom') {
    if (!isModOrBroadcaster(username, isBadgeMod)) return;
    const name = parts[1]?.toLowerCase();
    const text = parts.slice(2).join(' ');
    if (!name || !name.startsWith('!') || !text) { await sendMessage('Usage: !addcom !command response text'); return; }
    const cmdsA = loadCmds();
    if (cmdsA[name]) { await sendMessage(`Command ${name} already exists. Use !editcom to update it.`); return; }
    cmdsA[name] = text; saveCmds(cmdsA);
    await sendMessage(`Command ${name} added.`); return;
  }

  if (cmd === '!editcom') {
    if (!isModOrBroadcaster(username, isBadgeMod)) return;
    const name = parts[1]?.toLowerCase();
    const text = parts.slice(2).join(' ');
    if (!name || !name.startsWith('!') || !text) { await sendMessage('Usage: !editcom !command new response text'); return; }
    const cmdsE = loadCmds();
    if (!cmdsE[name]) { await sendMessage(`Command ${name} doesn't exist. Use !addcom to create it.`); return; }
    cmdsE[name] = text; saveCmds(cmdsE);
    await sendMessage(`Command ${name} updated.`); return;
  }

  if (cmd === '!delcom') {
    if (!isModOrBroadcaster(username, isBadgeMod)) return;
    const name = parts[1]?.toLowerCase();
    if (!name || !name.startsWith('!')) { await sendMessage('Usage: !delcom !command'); return; }
    const cmdsD = loadCmds();
    if (!cmdsD[name]) { await sendMessage(`Command ${name} doesn't exist.`); return; }
    delete cmdsD[name]; saveCmds(cmdsD);
    await sendMessage(`Command ${name} deleted.`); return;
  }

  // Custom commands - available to everyone

  if (cmd === '!predict') {
    const guess = parseInt(parts[1]);
    const wager = parseInt(parts[2]);
    if (!guess || isNaN(guess) || guess < 1 || !wager || isNaN(wager) || wager < 1) {
      await sendMessage("@" + username + " Usage: !predict <ending balance guess> <wager> - e.g. !predict 7500 50");
      return;
    }
    try {
      const r = await axios.post("http://localhost:4000/predictor/bot-predict",
        { username, guess, wager },
        { headers: { "x-bot-secret": process.env.BOT_API_SECRET, "Content-Type": "application/json" } }
      );
      if (r.data.ok) {
        await sendMessage("@" + username + " Guessed $" + guess.toLocaleString() + " with " + wager.toLocaleString() + " NP! Win and get " + (wager * 2).toLocaleString() + " NP back. Balance: " + r.data.newBalance.toLocaleString() + " NP");
      } else {
        await sendMessage("@" + username + ": " + r.data.error);
      }
    } catch(e) { await sendMessage("@" + username + " Something went wrong."); }
    return;
  }

  const cmdsLookup = loadCmds();
  if (cmdsLookup[cmd]) {
    let response = cmdsLookup[cmd];
    response = response.replace(/\$\(sender\)/gi, username);
    response = response.replace(/Rand\[(\d+),(\d+)\]/gi, (_, min, max) => {
      const lo = parseInt(min), hi = parseInt(max);
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    });
    await sendMessage(response); return;
  }

  if (!isBroadcaster(username)) return;

  if (cmd === '!addpoints') {
    const target = parts[1]?.replace('@', '').trim().toLowerCase();
    const amount = parseInt(parts[2]?.replace(/,/g, ''));
    console.log(`[addpoints] user=${username} target=${target} amount=${amount} parts=${JSON.stringify(parts)}`);
    if (!target || isNaN(amount) || amount <= 0) { await sendMessage(`Usage: !addpoints <user> <amount> â€” received: "${parts.slice(1).join(' ')}"`); return; }
    const newBal = addPoints(target, amount);
    await sendMessage(`Added ${amount.toLocaleString()} pts to @${target}. New balance: ${newBal.toLocaleString()}`);
    return;
  }

  if (cmd === '!removepoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount <= 0) { await sendMessage('Usage: !removepoints <user> <amount>'); return; }
    const result = deductPoints(target, amount);
    if (result === null) await sendMessage(`@${target} does not have enough NP.`);
    else await sendMessage(`Removed ${amount.toLocaleString()} pts from @${target}. Balance: ${result.toLocaleString()}`);
    return;
  }

  if (cmd === '!setpoints') {
    const target = parts[1]?.replace('@', '');
    const amount = parseInt(parts[2]);
    if (!target || isNaN(amount) || amount < 0) { await sendMessage('Usage: !setpoints <user> <amount>'); return; }
    await sendMessage(`Set @${target} NP to ${setPoints(target, amount).toLocaleString()}`);
    return;
  }

}

// â”€â”€â”€ WEBSOCKET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        const badges = data?.sender?.badges || [];
        const isBadgeMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster');
        if (username && content) {
          fetch('http://localhost:4000/giveaway/chat-message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,content,ts:Date.now()})}).catch(()=>{});
          if (content.startsWith('!')) handleCommand(username, content, isBadgeMod);
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

// â”€â”€â”€ START â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€ GIVEAWAY ANNOUNCER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let lastAnnouncedKeyword = null;
setInterval(async () => {
  try {
    const r = await fetch('http://localhost:4000/giveaway/state');
    const state = await r.json();
    if (state.giveaway && state.giveaway.keyword && !state.giveaway.winner) {
      if (state.giveaway.keyword !== lastAnnouncedKeyword) {
        lastAnnouncedKeyword = state.giveaway.keyword;
        const prize = state.giveaway.prize ? ` Prize: ${state.giveaway.prize}` : '';
        await sendMessage(`Giveaway started! Type "${state.giveaway.keyword}" in chat to enter!${prize}`);
      }
    } else if (!state.giveaway) {
      lastAnnouncedKeyword = null;
    }
  } catch {}
}, 4000);

// --- ROTATING COMMAND TIMERS -------------------------------------------
// Cycles through !gamba, !packy, !web every 20 minutes (each fires ~every 60 min)
// Only posts when the stream is live.
const TIMER_INTERVAL = 20 * 60 * 1000;
const TIMER_COMMANDS = [
  () => { const c = loadCmds(); return c['!gamba'] || null; },
  () => { const c = loadCmds(); return c['!packy'] || null; },
  () => { const c = loadCmds(); return c['!web']   || null; },
];
let timerIndex = 0;
async function isStreamLive() {
  try {
    const r = await axios.get(`https://kick.com/api/v2/channels/${CHANNEL}`, { timeout: 5000 });
    return r.data && r.data.livestream !== null && r.data.livestream !== undefined;
  } catch { return false; }
}
function startTimers() {
  setInterval(async () => {
    if (!(await isStreamLive())) return;
    const getText = TIMER_COMMANDS[timerIndex % TIMER_COMMANDS.length];
    timerIndex++;
    const text = getText();
    if (text) await sendMessage(text);
  }, TIMER_INTERVAL);
}

async function start() {
  console.log(`[bot] Starting for channel: ${CHANNEL}`);
  console.log(`[bot] Mods: ${MODS.join(', ') || '(none set)'}`);
  console.log(`[bot] Chatroom ID: ${CHATROOM_ID}`);
  // Do an initial refresh to make sure token is fresh
  await refreshToken();
  connectWebSocket(CHATROOM_ID);
  startTimers();
}

start();
