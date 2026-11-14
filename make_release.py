"""Publish a new version: bump APP_VERSION in rugby_photo_enhancer.py, then run
    python make_release.py "What changed"
and commit/push version.json + rugby_photo_enhancer.py to the photo-enhancer branch.
Every installed copy picks it up next time it opens."""
import hashlib, json, re, sys
src = open("rugby_photo_enhancer.py", "rb").read()
ver = re.search(rb'^APP_VERSION = "([\d.]+)"', src, re.M).group(1).decode()
compile(src, "rugby_photo_enhancer.py", "exec")
info = {"version": ver, "file": "rugby_photo_enhancer.py", "sha256": hashlib.sha256(src).hexdigest(),
        "requires": ["pillow", "numpy"], "notes": sys.argv[1] if len(sys.argv) > 1 else ""}
json.dump(info, open("version.json", "w"), indent=2)
print("version.json ->", ver)
