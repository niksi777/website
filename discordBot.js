require('dotenv').config();
const { REST } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const DAILY_CH_ID  = '1546252823350476901';
const WEEKLY_CH_ID = '1546252826181902538';
const REDEEMS_PATH = path.join(__dirname, 'redeems.json');

const PLATFORM_LABELS = {
  gamba:   'Gamba',
  cs2skin: 'CS2SKIN',
  chicken: 'Chicken',
  betfury: 'Betfury',
};

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

function loadRedeems() {
  try { return JSON.parse(fs.readFileSync(REDEEMS_PATH, 'utf8')); }
  catch { return []; }
}

function startOfDay(d) {
  const t = new Date(d);
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime();
}

function formatSummary(entries) {
  if (!entries.length) return 'No redeems logged.';
  const totals = {};
  for (const e of entries) {
    totals[e.platform] = (totals[e.platform] || 0) + e.amount;
  }
  return Object.entries(totals)
    .map(([p, amt]) => `**${PLATFORM_LABELS[p] || p}** - $${amt}`)
    .join('\n');
}

async function postToChannel(channelId, content) {
  await rest.post(`/channels/${channelId}/messages`, { body: { content } });
}

async function postDailySummary() {
  const now = Date.now();
  const dayStart = startOfDay(now);
  const entries = loadRedeems().filter(e => e.timestamp >= dayStart && e.timestamp <= now);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  let msg = `**Daily Update - ${date}**\n\n`;
  if (entries.length) {
    msg += formatSummary(entries);
    msg += `\n\n**Total today: $${total}**`;
  } else {
    msg += 'No redeems logged today.';
  }
  await postToChannel(DAILY_CH_ID, msg);
}

async function postWeeklySummary() {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const entries = loadRedeems().filter(e => e.timestamp >= weekAgo && e.timestamp <= now);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const from = new Date(weekAgo).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const to   = new Date(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  let msg = `**Weekly Redeems - ${from} to ${to}**\n\n`;
  if (entries.length) {
    msg += formatSummary(entries);
    msg += `\n\n**Total this week: $${total}**`;
  } else {
    msg += 'No redeems logged this week.';
  }
  await postToChannel(WEEKLY_CH_ID, msg);
}

// Daily at 18:00 CET+1 = 17:00 UTC
cron.schedule('0 17 * * *', () => postDailySummary().catch(console.error), { timezone: 'UTC' });
// Weekly Sunday at 18:00 CET+1 = 17:00 UTC
cron.schedule('0 17 * * 0', () => postWeeklySummary().catch(console.error), { timezone: 'UTC' });

console.log('[DiscordBot] Cron scheduler running (REST-only, no gateway connection)');
