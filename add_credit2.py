import os

FRONTEND = "/root/website/leaderboard-deploy/frontend"

# Fix chancer.html - insert after copyright div
chancer_path = os.path.join(FRONTEND, "chancer.html")
with open(chancer_path, "r", encoding="utf-8") as f:
    content = f.read()
if "Created by" not in content:
    OLD = '© 2026 NIKSI777. All Rights Reserved.\n              </div>'
    NEW = ('© 2026 NIKSI777. All Rights Reserved.\n              </div>\n'
           '            <div className="text-center text-xs" style={{marginTop:6,color:"#6b7a99",letterSpacing:".06em"}}>'
           'Created by <strong style={{color:"#4a9eff"}}>@niksiii</strong> on Discord</div>')
    content = content.replace(OLD, NEW)
    with open(chancer_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("DONE: chancer.html")
else:
    print("SKIP: chancer.html")

# Fix acebet.html - insert before closing ReactDOM render
acebet_path = os.path.join(FRONTEND, "acebet.html")
with open(acebet_path, "r", encoding="utf-8") as f:
    content = f.read()
if "Created by" not in content:
    OLD = '    </div>\n  );\n}\n\nReactDOM.createRoot'
    NEW = ('    <div style={{textAlign:"center",marginTop:24,paddingBottom:16,fontSize:11,'
           'color:"#6b7a99",letterSpacing:".08em",fontFamily:"\'Inter\',sans-serif"}}>'
           'Created by <strong style={{color:"#4a9eff"}}>@niksiii</strong> on Discord</div>\n'
           '    </div>\n  );\n}\n\nReactDOM.createRoot')
    content = content.replace(OLD, NEW)
    with open(acebet_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("DONE: acebet.html")
else:
    print("SKIP: acebet.html")
