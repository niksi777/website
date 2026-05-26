require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const { getPoints, addPoints, deductPoints, setPoints, getLeaderboard } = require('./pointsManager');
const { openRaffle, joinRaffle, getRaffleStatus, cancelRaffle } = require('./raffleManager');

const CHANNEL = process.env.KICK_CHANNEL || 'niksi777';
const BOT_TOKEN = process.env.KICK_BOT_TOKEN || '';
const MODS = (process.env.MODS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage(text) {
  try {
    await axios.post(
      `https://api.kick.com/public/v1/chat`,
      { content: text, type: 'bot' },
      { headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // Try v2 endpoint as fallback
    try {
      await axios.post(
        `https://kick.com/api/v2/messages/send/${CHANNEL}`,
        { content: text, type: 'message' },
        { headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
      );
    } catch (err2) {
      console.error('[send error]', err2?.response?.data || err2.message);
    }
  }
}

// ─── GET CHANNEL INFO ─────────────────────────────────────────────────────────
async function getChannelInfo() {
  try {
    const { data } = await axios.get(`https://kick.com/api/v2/channels/${CHANNEL}`);
    return {
      chatroomId: data.chatroom?.id,
      channelId: data.id
    };
  } catch (err) {
    console.error('[channel error]', err?.response?.data || err.message);
    return null;
  }
}

// ─── PERMISSION CHECK ─────────────────────────────────────────────────────────
function isModOrBroadcaster(username) {
  const u = username.toLowerCase();
  return u === CHANNEL.toLowerCase() || MODS.includes(u);
}

// ─── COMMAND HANDLER ──────────────────────────────────────────────────────────
async function handleCommand(username, message) {
  const parts = message.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '!raffle') {
    if (!isModOrBroadcaster(username)) return;
    const result = openRaffle(sendMessage);
    if (!result.success) await sendMessage(result.message);
    return;
  }

  if (cmd === '!join') {
    joinRaffle(username);
    return;
  }

  if (cmd === '!cancelraffle') {
    if (!isModOrBroadcaster(username)) return;
    const result = cancelRaffle();
    await sendMessage(result.message);
    return;
  }

  if (cmd === '!points') {
    const target = parts[1]?.replace('@', '') || username;
    const pts = getPoints(target);
    await sendMessage(`@${target} has ${pts.toLocaleString()} points.`);
    return;
  }

  if (cmd === '!top') {
    const lb = getLeaderboard(5);
    if (lb.length === 0) { await sendMessage('No points data yet.'); return; }
    const text = lb.map(e => `#${e.rank} ${e.username} (${e.points.toLocaleString()})`).join(' | ');
    await sendMessage(`🏆 Top Points: ${text}`);
    return;
  }

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

// ─── WEBSOCKET (PUSHER) ───────────────────────────────────────────────────────
async function connectWebSocket(chatroomId) {
  const PUSHER_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

  const ws = new WebSocket(PUSHER_URL);

  ws.on('open', () => {
    console.log('[ws] Connected to Pusher');
    // Subscribe to chatroom
    ws.send(JSON.stringify({
      event: 'pusher:subscribe',
      data: { auth: '', channel: `chatrooms.${chatroomId}.v2` }
    }));
    console.log(`[ws] Subscribed to chatroom ${chatroomId}`);
  });

  ws.on('message', (raw) => {
    try {
      const packet = JSON.parse(raw);

      // Keep alive
      if (packet.event === 'pusher:ping') {
        ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        return;
      }

      if (packet.event === 'App\\Events\\ChatMessageEvent') {
        const data = JSON.parse(packet.data);
        const username = data?.sender?.username || data?.sender?.slug;
        const content = data?.content;
        if (username && content && content.startsWith('!')) {
          handleCommand(username, content);
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log('[ws] Disconnected. Reconnecting in 5s...');
    setTimeout(() => connectWebSocket(chatroomId), 5000);
  });

  ws.on('error', (err) => {
    console.error('[ws error]', err.message);
  });
}

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
  console.log(`[bot] Starting for channel: ${CHANNEL}`);
  console.log(`[bot] Mods: ${MODS.join(', ') || '(none set)'}`);

  const info = await getChannelInfo();
  if (!info?.chatroomId) {
    console.error('[bot] Could not get chatroom ID. Check your KICK_CHANNEL setting.');
    process.exit(1);
  }

  console.log(`[bot] Chatroom ID: ${info.chatroomId}`);
  connectWebSocket(info.chatroomId);
}

start();
