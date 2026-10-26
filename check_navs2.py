import os, re

FRONTEND = "/root/website/leaderboard-deploy/frontend"
PAGES = ["packy","gamba","gamble","points","store","leaderboards","settings","giveaway","admin","index"]

for p in PAGES:
    path = os.path.join(FRONTEND, p + ".html")
    content = open(path).read()
    lines = content.split("\n")
    for i, l in enumerate(lines):
        if "href" in l and ("STORE" in l or "store" in l) and "cases" in l.lower():
            print(p, i+1, l.strip()[:120])
            break
