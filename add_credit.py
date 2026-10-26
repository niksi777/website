import os, re

FRONTEND = "/root/website/leaderboard-deploy/frontend"

# Pages to update - skip overlays, stream assets, admin, backups
TARGETS = [
    "index.html", "packy.html", "gamba.html", "gamble.html",
    "chancer.html", "giveaway.html", "leaderboards.html",
    "points.html", "settings.html", "store.html", "acebet.html"
]

CREDIT = (
    '        <div style={{textAlign:"center",marginTop:10,paddingBottom:4,'
    'fontSize:11,color:"var(--mu)",letterSpacing:".08em",fontFamily:"\'Inter\',sans-serif"}}>'
    'Created by <strong style={{color:"var(--ac)"}}>@niksiii</strong> on Discord'
    '</div>\n'
)

for fname in TARGETS:
    path = os.path.join(FRONTEND, fname)
    if not os.path.exists(path):
        print(f"SKIP (not found): {fname}")
        continue
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if "Created by" in content:
        print(f"SKIP (already done): {fname}")
        continue
    # Insert before closing </footer>
    if "</footer>" not in content:
        print(f"SKIP (no footer): {fname}")
        continue
    # Replace the first occurrence of </footer>
    new_content = content.replace("</footer>", CREDIT + "      </footer>", 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"DONE: {fname}")
