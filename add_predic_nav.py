import os

FRONTEND = "/root/website/leaderboard-deploy/frontend"
PAGES = ["packy","gamba","gamble","points","store","leaderboards","settings","giveaway","admin","index","predictor"]

PREDIC_LINK = '<a href="/predictor">PREDIC</a>'

for p in PAGES:
    path = os.path.join(FRONTEND, p + ".html")
    content = open(path).read()

    # Rename any existing PREDICTOR text to PREDIC
    content = content.replace(">PREDICTOR<", ">PREDIC<")

    # Add PREDIC after CASES if not already present
    if 'href="/predictor"' not in content:
        content = content.replace(
            '<a href="/cases">CASES</a>',
            '<a href="/cases">CASES</a>' + PREDIC_LINK
        )

    open(path, "w").write(content)
    has = 'href="/predictor"' in content
    print(p + ": " + ("OK" if has else "MISSING"))
