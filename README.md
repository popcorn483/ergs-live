# ERGS Live

Live scores, fixtures and results for Enniskillen Royal Grammar School rugby. Supporters need no account; coaches sign in with Google to score.

- `index.html`, `app.js`, `crest.js`: the page
- `config.js`: Firebase settings and the admin's email
- `fb.js`: the live database connection
- `firestore.rules`: the database's rules for both apps (the only copy). After any change, paste it into Firebase → Firestore → Rules and press Publish
- `app/`: ERGS Rugby, the team app: `index.html`, `fb-main.js` (its database connection), `drill-pack.js` (premade drills) and `vendor/` (the libraries it uses, kept with the app)
- `tools/bump.sh`: run before each deploy. It gives both apps one new version stamp, so open pages offer to refresh and a new page never runs with old scripts
- `tools/*.mjs`, `.github/workflows/`: the scheduled jobs that fetch competition fixtures and news (`comps.json`, `news.json`)
- `tools/test/`: checks that run both apps against a stand-in for the database (see its README). Not loaded by the apps

## Kick-off reminders (coaches' phones)

A coach turns these on in ERGS Live (the bell at the bottom of the page, once signed in). About 15 minutes before one of their
teams kicks off, their phone shows a notification to open ERGS Live and press Kick off. The notifications are sent by a job that
runs on GitHub through the day (`.github/workflows/kickoff.yml`, `tools/kickoff.mjs`). It needs one repository secret,
`VAPID_PRIVATE` (Settings > Secrets and variables > Actions); without it the job does nothing. On an iPhone, ERGS Live has to be
added to the Home Screen first. Phones' registrations are kept in the database under `pushsubs` (see `firestore.rules`).

The Android build signs with a private key when the secrets `ANDROID_KEYSTORE_B64` and `ANDROID_KEY_PASS` are set, and with the
key in `android/` otherwise. Changing the key means everyone reinstalls the Android app once.
