# ERGS Live

Live scores, fixtures and results for Enniskillen Royal Grammar School rugby. Supporters need no account; coaches sign in with Google to score.

- `index.html`, `app.js`, `crest.js`: the page
- `config.js`: Firebase settings and the admin's email
- `fb.js`: the live database connection
- `firestore.rules`: the database's rules for both apps (the only copy). After any change, paste it into Firebase → Firestore → Rules and press Publish
- `app/`: ERGS Rugby, the team app: `index.html`, `fb-main.js` (its database connection), `drill-pack.js` (premade drills) and `vendor/` (the libraries it uses, kept with the app)
- `tools/bump.sh`: run before each deploy. It gives both apps one new version stamp, so open pages offer to refresh and a new page never runs with old scripts
- `tools/*.mjs`, `.github/workflows/`: the scheduled jobs that fetch competition fixtures and news (`comps.json`, `news.json`)
