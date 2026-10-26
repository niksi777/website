#!/bin/bash
FILE="/root/website/leaderboard-deploy/frontend/gamble.html"
python3 - <<'PYEOF'
content = open("/root/website/leaderboard-deploy/frontend/gamble.html").read()
if 'href="/predictor"' not in content:
    content = content.replace(
        "<a href=\"/cases\" className={activeCaseId?'':'on'}>CASES</a>",
        "<a href=\"/cases\" className={activeCaseId?'':'on'}>CASES</a><a href=\"/predictor\">PREDIC</a>"
    )
    open("/root/website/leaderboard-deploy/frontend/gamble.html", "w").write(content)
    print("Added PREDIC to gamble.html")
else:
    print("Already present")
PYEOF
