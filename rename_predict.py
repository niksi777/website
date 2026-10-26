import os
FRONTEND = "/root/website/leaderboard-deploy/frontend"
PAGES = ["packy","gamba","gamble","points","store","leaderboards","settings","giveaway","admin","index","predictor"]
for p in PAGES:
    path = os.path.join(FRONTEND, p + ".html")
    content = open(path).read()
    new = content.replace(">PREDIC<", ">PREDICT<")
    if new != content:
        open(path, "w").write(new)
        print("Updated: " + p)
    else:
        print("Skipped: " + p)
