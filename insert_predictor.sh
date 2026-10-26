#!/bin/bash
MARKER="// Clean URLs"
FILE="/root/website/leaderboard-deploy/backend/server.js"
BLOCK="/root/website/predictor_backend.js"
LINE=$(grep -n "$MARKER" "$FILE" | head -1 | cut -d: -f1)
echo "Inserting before line $LINE"
head -n $((LINE-1)) "$FILE" > /tmp/server_new.js
cat "$BLOCK" >> /tmp/server_new.js
tail -n +$LINE "$FILE" >> /tmp/server_new.js
cp /tmp/server_new.js "$FILE"
echo "Done. Lines: $(wc -l < $FILE)"
