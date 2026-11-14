RUGBY PHOTO ENHANCER
====================

INSTALL (once)
  1. Unzip this folder anywhere (e.g. Downloads).
  2. Double-click Install.bat.
     - If Python isn't on the PC it tries to install it, then asks you to run Install.bat again.
  3. A "Rugby Photo Enhancer" shortcut appears on your Desktop and in the Start menu.

CONNECT TO GOOGLE DRIVE (once, ~3 minutes - no Drive app needed)
  The first time you open the app it shows "Set up direct Google Drive upload":
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
  4. Click "Enhance & upload". A new folder is made in Rugby on Google Drive and the
     full-size enhanced photos are uploaded into it. "Open the new folder" opens it in Drive.

OPTIONS
  - "Also keep a copy on this PC" saves the enhanced photos in Pictures\Rugby Photos too.
  - "Also upload untouched originals" adds an "Originals" subfolder.
  - Prefer Google Drive for desktop? Choose "A folder on this PC" and pick the synced folder.

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
