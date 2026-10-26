import os
pages = ["packy","gamba","gamble","points","store","leaderboards","settings","giveaway","admin"]
for p in pages:
    f = open("/root/website/leaderboard-deploy/frontend/" + p + ".html").read()
    lines = f.split("\n")
    for i,l in enumerate(lines):
        if "nlinks" in l or "CASES" in l or ("STORE" in l and "href" in l):
            print(p, i+1, l.strip()[:120])
            break
