require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const GUILD_ID       = '799081942623977492';
const OWNER_ID       = '180779629714341888';
const DAILY_CH_ID    = '1546252823350476901';
const WEEKLY_CH_ID   = '1546252826181902538';
const REDEEMS_PATH   = path.join(__dirname, 'redeems.json');

const PLATFORM_LABELS = {
  gamba:   'Gamba',
  cs2skin: 'CS2SKIN',
  chicken: 'Chicken',
  betfury: 'Betfury',
};

function loadRedeems() {
  try { return JSON.parse(fs.readFileSync(REDEEMS_PATH, 'utf8')); }
  catch { return []; }
}

function saveRedeems(data) {
  fs.writeFileSync(REDEEMS_PATH, JSON.stringify(data, null, 2));
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

async function postDailySummary(client) {
  const now = Date.now();
  const dayStart = startOfDay(now);
  const entries = loadRedeems().filter(e => e.timestamp >= dayStart && e.timestamp <= now);
  const ch = await client.channels.fetch(DAILY_CH_ID);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  let msg = `**Daily Update - ${date}**\n\n`;
  if (entries.length) {
    msg += formatSummary(entries);
    msg += `\n\n**Total today: $${total}**`;
  } else {
    msg += 'No redeems logged today.';
  }
  await ch.send(msg);
}

async function postWeeklySummary(client) {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const entries = loadRedeems().filter(e => e.timestamp >= weekAgo && e.timestamp <= now);
  const ch = await client.channels.fetch(WEEKLY_CH_ID);
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
  await ch.send(msg);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`[DiscordBot] Logged in as ${client.user.tag}`);

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  const cmd = new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Log a giveaway redemption')
    .addNumberOption(o => o.setName('amount').setDescription('Amount in $').setRequired(true))
    .addStringOption(o => o.setName('platform').setDescription('Platform').setRequired(true)
      .addChoices(
        { name: 'Gamba',   value: 'gamba' },
        { name: 'CS2SKIN', value: 'cs2skin' },
        { name: 'Chicken', value: 'chicken' },
        { name: 'Betfury', value: 'betfury' },
      ))
    .toJSON();

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: [cmd] });
  console.log('[DiscordBot] Slash commands registered');

  // Daily at 18:00 CET+1 = 17:00 UTC
  cron.schedule('0 17 * * *', () => postDailySummary(client), { timezone: 'UTC' });
  // Weekly Sunday at 18:00 CET+1 = 17:00 UTC
  cron.schedule('0 17 * * 0', () => postWeeklySummary(client), { timezone: 'UTC' });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'redeem') return;

  if (interaction.user.id !== OWNER_ID) {
    await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    return;
  }

  const amount   = interaction.options.getNumber('amount');
  const platform = interaction.options.getString('platform');
  const label    = PLATFORM_LABELS[platform] || platform;

  const redeems = loadRedeems();
  redeems.push({ timestamp: Date.now(), amount, platform });
  saveRedeems(redeems);

  await interaction.reply({ content: `Logged **$${amount}** for **${label}**`, ephemeral: true });
});

client.login(process.env.DISCORD_BOT_TOKEN);
