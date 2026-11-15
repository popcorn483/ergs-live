#!/bin/bash
# New version stamp for a deploy: one stamp for ERGS Live and the team app, written everywhere a browser decides whether
# its copy is current. Every script address gets it (?v=…), so a returning visitor never runs a new page with old scripts.
#   tools/bump.sh        from the repository root, before committing
set -e
cd "$(dirname "$0")/.."
V=$(python3 -c "import os;print(os.urandom(5).hex())")
for f in index.html app/index.html; do
  sed -i -E "s/ERGS_VER = '[0-9a-f]{10}'/ERGS_VER = '$V'/" "$f"
  sed -i -E "s/((config|crest|app|fb|fb-main)\.js)\?v=[0-9a-f]+/\1?v=$V/g" "$f"
done
echo "{\"v\": \"$V\"}" > version.json
echo "{\"v\": \"$V\"}" > app/version.json
echo "$V"
