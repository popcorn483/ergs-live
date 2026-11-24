# Checks for the two apps

These run the real pages and the real database code (`app/fb-main.js`, `fb.js`) in a headless browser, against a stand-in
for Firebase (`fake/`). The stand-in keeps a database in memory, counts reads, writes and deletes the way Firebase bills
them (including the look-ups its rules make), refuses what `firestore.rules` refuses, and can be put "offline".
Nothing here touches the real database, and none of it is loaded by the apps.

Needs Node and Playwright (`require('playwright')`). From this folder:

    node mkseed.js                    # once: writes fake/seed.js (153 players, 11 coaches, 60 posts… all made up)
    STUB3=1 node real.js player       # what opening the app costs, as admin | coach | squadcoach | player | guardian | public | out
    STUB3=1 RELOAD=1 node real.js coach squads,news     # …and opening it again, then those screens
    STUB3=1 node flow1.js             # Team news on two devices
    STUB3=1 node flow2.js             # the one-off move of the premade drills, from the app as it was before
    STUB3=1 node flow3.js             # likes, photo tags, headshots, a score request, the rules note
    STUB3=1 node flow4.js             # no connection, the day's reads used up, a device's copy against the database
    STUB3=1 node flow5.js             # Access checks: what people without a login left behind
    STUB3=1 node flow6.js             # extra emails, the player search, the contact list, a changed email, parents, who is scoring
    STUB3=1 node flow7.js             # “Open the album” in Team news opens the album inside the app
    STUB3=1 node flow8.js             # Team of the week: the team being worked on is shared between coaches
    STUB3=1 node flow9.js             # a waiting sign-in can be added to a login the player already has
    STUB3=1 node flow10.js            # who is asking for access: the choice is required, and shown to the coaches
    STUB3=1 node flow11.js            # players and parents: My season and Match alerts on the home page; kinds of alert
    STUB3=1 node flow17.js            # C2k password sign-in for players (and an unknown address asking for access); the installed app opening on the role they picked
    STUB3=1 node flow18.js            # staff email + password: a coach sets one after a Google or link sign-in, then signs in with it
    STUB3=1 node flow19.js            # rejecting a request: off Waiting for access for good, listed under Rejected, the person is told
    STUB3=1 node flow20.js            # a sign-in look-up that gets no answer: the app says so with Try again, never stuck
    STUB3=1 node flow21.js            # Team of the Week on a phone: a finger drag moves a shirt; names centred under shirts
    node flow22.js                    # ERGS Live: full animations only on the match's own screen; none for whoever is scoring
    node flow23.js                    # ERGS Live: a coach changes who scored (and the minute, or a kick) after full time
    STUB3=1 node flow24.js            # results graphic: a lead of more than 40 points is shown as 40
    node flow25.js                    # ERGS Live: a match for a B or C team ("U14 B")
    node kick.test.mjs                # the alert job: what counts as news (full time, postponed, new time, team named)
    STUB3=1 node flow12.js <folder>   # Play IQ: the rugby laws game (every question has one right answer and no giveaway)
    STUB3=1 node walk.js admin        # presses every control it can find on every screen (add "phone" for a phone)
    node walklive.js out              # the same on ERGS Live
    node syn.js ../../app/index.html  # syntax of the page's scripts

`STUB3=1` swaps the 3D library for a stub: without a graphics card the 3D drawing makes everything very slow. Leave it off
to exercise the 3D screens themselves. `RULES2=1` counts reads as they are with the reordered rules; `DETAIL=1` lists them.

When `firestore.rules` changes, change `canWrite` / `RD` in `fake/firebase-firestore.js` to match.
