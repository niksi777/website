content = open("/root/website/leaderboard-deploy/backend/server.js").read()

# Find the predictor section and replace isAdminUser with niksi777-only check
# We need to replace only lines 916, 930, 941 (the three predictor admin checks)
# Strategy: replace within the predictor block only

PREDICTOR_MARKER = "// ─── PREDICTOR ───"
OLD_CHECK = "if (!sess || !isAdminUser(sess.username)) return res.status(403).json({ error: 'Forbidden' });"
NEW_CHECK = "if (!sess || sess.username !== 'niksi777') return res.status(403).json({ error: 'Forbidden' });"

# Only replace within the predictor section
pred_start = content.index(PREDICTOR_MARKER)
pred_section = content[pred_start:]
pred_section_new = pred_section.replace(OLD_CHECK, NEW_CHECK)
content_new = content[:pred_start] + pred_section_new

count = content_new.count(NEW_CHECK)
open("/root/website/leaderboard-deploy/backend/server.js", "w").write(content_new)
print("Replaced " + str(count) + " predictor admin checks with niksi777-only check")
