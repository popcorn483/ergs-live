RUGBY PHOTO ENHANCER
====================

INSTALL (once)
  1. Unzip this folder anywhere (e.g. Downloads).
  2. Double-click Install.bat.
     - If Python isn't on the PC it tries to install it, then asks you to run Install.bat again.
  3. A "Rugby Photo Enhancer" shortcut appears on your Desktop and in the Start menu.

YOU ALSO NEED: Google Drive for desktop
  https://www.google.com/drive/download/
  Sign in with the account that has the school's shared drive. The app finds
  Shared drives > ... > School Photos > 2026-27 > Rugby automatically. If it doesn't,
  click Browse next to "Rugby Drive folder" and pick it once - it's remembered.

EACH MATCH
  1. Put the SD card in (photos are read from E:\DCIM\100CANON - change with Browse).
  2. Type the folder name, e.g. "Dungannon 14 11 26".
  3. By default it only takes photos taken today, and skips any already imported.
  4. Click "Enhance & upload". Full-size enhanced photos go into the new folder and
     Google Drive uploads them in the background - leave the PC on until the Drive
     icon in the taskbar says it's up to date.

NOTES
  - Photos on the card are never changed.
  - Camera date/time, rotation and settings are kept in the enhanced copies.
  - Tick "Also keep untouched originals" to save the originals too, in an "Originals" subfolder.
  - RAW files (.CR2/.CR3) are ignored - JPEGs only.
  - Settings are stored in %APPDATA%\RugbyPhotoEnhancer\config.json

UPDATES
  The app checks for a new version every time it opens (and via "Check for updates").
  New versions download, are checked against a published fingerprint, and install
  themselves - you just click "Restart". The previous version is kept as
  rugby_photo_enhancer.py.bak in %LOCALAPPDATA%\RugbyPhotoEnhancer.
  Updates come from: github.com/popcorn483/ergs-live  (branch: photo-enhancer)
