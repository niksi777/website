#!/bin/bash
FILE="/root/website/leaderboard-deploy/backend/server.js"
LINE=$(grep -n "app.get('/admin'" "$FILE" | head -1 | cut -d: -f1)
ROUTE="app.get('/predictor', (req, res) => res.sendFile(path.join(__dirname, '../frontend/predictor.html')));"
head -n $((LINE-1)) "$FILE" > /tmp/srv2.js
echo "$ROUTE" >> /tmp/srv2.js
tail -n +$LINE "$FILE" >> /tmp/srv2.js
cp /tmp/srv2.js "$FILE"
echo "Route added at line $LINE"
