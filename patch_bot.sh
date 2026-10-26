#!/bin/bash
FILE="/root/website/kickBot.js"
# Find the line with "const cmdsLookup = loadCmds();" and insert !predict before it
LINE=$(grep -n "const cmdsLookup = loadCmds" "$FILE" | head -1 | cut -d: -f1)
echo "Inserting !predict before line $LINE"

PRED_CMD='
  if (cmd === '"'"'!predict'"'"') {
    const side = parts[1]?.toLowerCase();
    const amount = parseInt(parts[2]);
    if (!side || !amount || !["profit","noprofit"].includes(side) || isNaN(amount) || amount < 1) {
      await sendMessage("@" + username + " Usage: !predict profit/noprofit <amount> - e.g. !predict profit 500");
      return;
    }
    try {
      const r = await axios.post("http://localhost:4000/predictor/bot-predict",
        { username, side, amount },
        { headers: { "x-bot-secret": process.env.BOT_API_SECRET, "Content-Type": "application/json" } }
      );
      if (r.data.ok) {
        await sendMessage("@" + username + " Predicted " + side.toUpperCase() + " with " + amount.toLocaleString() + " NP! Balance: " + r.data.newBalance.toLocaleString() + " NP");
      } else {
        await sendMessage("@" + username + ": " + r.data.error);
      }
    } catch(e) { await sendMessage("@" + username + " Something went wrong."); }
    return;
  }
'

head -n $((LINE-1)) "$FILE" > /tmp/bot_new.js
echo "$PRED_CMD" >> /tmp/bot_new.js
tail -n +$LINE "$FILE" >> /tmp/bot_new.js
cp /tmp/bot_new.js "$FILE"
echo "Done."
