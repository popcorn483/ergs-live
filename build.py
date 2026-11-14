"""Embed ui.html into rugby_photo_enhancer.py (the app ships as one file so updates are one file)."""
import re
html = open("ui.html", encoding="utf-8").read()
assert '"""' not in html
p = "rugby_photo_enhancer.py"
s = open(p, encoding="utf-8").read()
start = s.index('UI_HTML = r"""') + len('UI_HTML = r"""')
end = s.index('"""', start)
s = s[:start] + html + s[end:]
open(p, "w", encoding="utf-8").write(s)
print("embedded", len(html), "chars")
