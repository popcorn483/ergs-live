RUGBY PHOTO ENHANCER
====================

INSTALL (once)
  1. Unzip this folder anywhere (e.g. Downloads).
  2. Double-click Install.bat.
     - If Python isn't on the PC it tries to install it, then asks you to run Install.bat again.
  3. A "Rugby Photo Enhancer" shortcut appears on your Desktop and in the Start menu.

THE WINDOW
  The app opens in its own window (it uses Microsoft Edge behind the scenes, which is
  already on Windows). Close the window to quit.

CONNECT TO GOOGLE DRIVE (once, ~3 minutes - no Drive app needed)
  The first time you open the app it shows "Connect to Google Drive":
  1. Check the Rugby folder link, click "1. Copy script".
  2. Click "2. Open Apps Script" (sign in with the Google account that can see the Rugby
     folder). Delete the sample code, paste (Ctrl+V), save (Ctrl+S).
  3. Deploy > New deployment > cog > Web app.  Execute as: Me.  Who has access: Anyone.  Deploy.
  4. Authorise access > pick your account > Advanced > "Go to ... (unsafe)" > Allow.
     (It's your own script, so Google's warning is expected.)
  5. Copy the Web app URL into the app and click "Test & save".
  The uploader can only add folders/photos inside the Rugby folder, and only with the
  secret key the app created - so the URL alone is useless to anyone else.

EACH MATCH
  1. Put the SD card in (photos are read from E:\DCIM\100CANON - change with Browse).
  2. Type the folder name, e.g. "Dungannon 14 11 26".
  3. By default it only takes photos taken today, and skips any already imported.
  4. Click "Enhance". Every photo is analysed and tuned automatically - there's no look
     to choose.
  5. When they're done it asks "are you happy with them?". Nothing is uploaded yet.
     Say yes, or check them first: click any photo for a before/after slider (arrow keys
     move between photos, X excludes one), untick any you don't want, or move a slider
     to fine-tune one - it's redone automatically. Then press "Happy - upload".
     Cancel uploads nothing.

THE ENHANCEMENT ENGINE (v2)
  Works like a professional raw editor's "Auto", in this order:
   1. White balance in linear light, judged from neutral areas (white kit, lines,
      cloud) - only when they share a tint, so real scenes and golden-hour warmth survive.
   2. Exposure metered on skin (faces, arms, legs) or the centre, never the bright sky.
   3. Edge-aware local tone mapping: shadows lifted and highlights held without halos
      around players against the sky.
   4. Soft highlight roll-off instead of hard white clipping.
   5. Auto levels from a quick test render, contrast and clarity only if the photo needs it.
   6. Vibrance that protects skin tones and doesn't turn the pitch neon.
   7. Noise reduction measured from the full-size file (high ISO / evening matches).
   8. Sharpening only on real edges - never on noise or flat sky.
  Outdoor light is the main focus - each photo is checked for:
   - mist, fog, haze and sun glare: removed with a dehaze step (gentle on open sky)
   - overcast/grey days: warmed slightly, contrast and colour restored
   - harsh sun and backlight: shadows opened up, highlights and shine held back
  It needs OpenCV (installed automatically). If OpenCV can't be installed, the app
  still works using the simpler engine.

PHOTO-BY-PHOTO TUNING
  Every photo is analysed before it's enhanced, and only gets the corrections it needs:
  contrast only for flat photos, colour correction only when there's a real cast (judged
  from white kit, lines, cloud - never the green pitch), vibrance for dull colours,
  more sharpening for soft shots and less for crisp ones, plus the shadow/highlight fixes.
  The viewer shows the values chosen for each photo and why.

FINE-TUNING A PHOTO
  In the before/after viewer, the panel on the right lets you pick a different look for
  that photo (Gentle / Balanced / Punchy) or adjust it by hand: strength, colour, exposure,
  contrast, vibrance, sharpening, shadows, highlights, brightness and warmth.
  "Use on all selected" copies the look to every ticked photo. Photos with their own look
  show a small "Custom" or preset label in the grid.
  Backlit shots (bright sky behind a player) are handled automatically - if a face is
  still too dark, push "Shadows" up.

IMPROVING EARLIER UPLOADS
  Click "Google Drive" at the top-left. Tick the match folders in Rugby (or Select all),
  then "Load photos". Check them in the grid/viewer as normal, then either:
   - Replace the photos in Drive (originals go to Drive's Bin for 30 days), or
   - Save to an "Enhanced" subfolder inside each match folder.
  Photos already enhanced by the app are skipped automatically.
  The first time, the app asks you to update your uploader script (about 1 minute):
  Copy new script > open your project at script.google.com > paste over the old code >
  save > Deploy > Manage deployments > Edit > Version: New version > Deploy > Test & save.

OPTIONS
  - "Also keep a copy on this PC" saves the enhanced photos in Pictures\Rugby Photos too.
  - "Also upload untouched originals" adds an "Originals" subfolder.
  - Just want them on your PC? Choose "Save on this PC only" (default: Pictures\Rugby Photos).
    Nothing is uploaded. (Pointing it at a Google Drive for desktop folder also works.)
  - On the Google Drive tab, "Save on this PC only" enhances earlier uploads into folders on
    your PC (one per match) without changing anything in Drive.

NOTES
  - Photos on the card are never changed.
  - Camera date/time, rotation and settings are kept in the enhanced copies.
  - RAW files (.CR2/.CR3) are ignored - JPEGs only.
  - If any uploads fail (e.g. Wi-Fi drops), just click "Enhance & upload" again - only the
    missing ones are redone.

UPDATES
  The app checks for a new version every time it opens (and via "Check for updates"),
  installs it after checking its fingerprint, and asks you to restart.
  Updates come from: github.com/popcorn483/ergs-live  (branch: photo-enhancer)
