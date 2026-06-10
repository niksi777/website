const { EmbedBuilder } = require('discord.js');

const LIVE_CHANNEL_ID = '1415263789900632075';
const KICK_CHANNEL   = 'niksi777';
const POLL_INTERVAL  = 60 * 1000;

let wasLive = null; // null = first check, don't trigger post on startup

async function getStreamInfo() {
  try {
    const r = await fetch(`https://kick.com/api/v2/channels/${KICK_CHANNEL}`, {
      headers: { Accept: 'application/json' }
    });
    const data = await r.json();
    if (!data.livestream) return null;
    return {
      title:    data.livestream.session_title || 'Live on Kick!',
      category: data.livestream.categories?.[0]?.name || null,
      viewers:  data.livestream.viewer_count  || 0,
    };
  } catch { return null; }
}

function startStreamWatcher(client) {
  setInterval(async () => {
    const info = await getStreamInfo();
    const isLive = !!info;

    if (wasLive === false && isLive) {
      try {
        const ch = await client.channels.fetch(LIVE_CHANNEL_ID);
        const embed = new EmbedBuilder()
          .setColor(0x22c55e)
          .setAuthor({ name: 'Niksi777 is now LIVE on Kick!', iconURL: 'https://niksi777.com/assets/niksi.png' })
          .setTitle(info.title)
          .setURL(`https://kick.com/${KICK_CHANNEL}`)
          .addFields(
            ...(info.category ? [{ name: 'Playing', value: info.category, inline: true }] : []),
            { name: 'Watch', value: `[kick.com/${KICK_CHANNEL}](https://kick.com/${KICK_CHANNEL})`, inline: true }
          )
          .setThumbnail('https://niksi777.com/assets/niksi.png')
          .setTimestamp();

        await ch.send({ content: '@everyone', embeds: [embed] });
      } catch (err) {
        console.error('[streamWatcher] Failed to post:', err.message);
      }
    }

    wasLive = isLive;
  }, POLL_INTERVAL);
}

module.exports = { startStreamWatcher };
