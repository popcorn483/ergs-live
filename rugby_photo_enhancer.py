"""
Rugby Photo Enhancer
--------------------
Reads photos from the camera card (e.g. E:\\DCIM\\100CANON), auto-enhances them
(colour balance, levels, exposure, contrast, vibrance, sharpening) and saves
full-size copies into a new, named folder inside your Google Drive Rugby folder -
either uploaded directly (through a small Apps Script uploader in your own Google
account, no Drive app needed) or saved into a folder such as Google Drive for desktop.

Originals on the card are never changed.
"""
import glob
import json
import os
import shutil
import string
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime

import numpy as np
from PIL import Image, ImageFilter, ImageOps

APP_NAME = "Rugby Photo Enhancer"
APP_VERSION = "1.3.0"
# Updates are published here (branch "photo-enhancer" of github.com/popcorn483/ergs-live)
UPDATE_BASE = "https://raw.githubusercontent.com/popcorn483/ergs-live/photo-enhancer/"
DEFAULT_SOURCE = r"E:\DCIM\100CANON"
# Where the Rugby folder lives inside Google Drive for desktop
DRIVE_SUBPATH = os.path.join("School Photos", "2026-27", "Rugby")
PHOTO_EXT = (".jpg", ".jpeg", ".png")

PRESETS = {
    "Gentle":   dict(strength=0.55, colour=0.45, exposure=0.45, contrast=0.20, vibrance=0.20, sharpen=0.25),
    "Balanced": dict(strength=0.80, colour=0.65, exposure=0.65, contrast=0.35, vibrance=0.35, sharpen=0.40),
    "Punchy":   dict(strength=1.00, colour=0.80, exposure=0.80, contrast=0.60, vibrance=0.60, sharpen=0.60),
}


# --------------------------------------------------------------------------
# Enhancement maths
# --------------------------------------------------------------------------
def _pct(hist, p):
    c = np.cumsum(hist)
    return int(np.searchsorted(c, c[-1] * p))


def build_luts(arr, s):
    """Analyse an RGB uint8 array and return 3 lookup tables + description tags."""
    h, w, _ = arr.shape
    step = max(1, (h * w) // 500_000)
    sub = arr.reshape(-1, 3)[::step]
    H = [np.bincount(sub[:, c], minlength=256).astype(np.float64) for c in range(3)]
    lum = (sub[:, 0].astype(np.uint32) * 77 + sub[:, 1].astype(np.uint32) * 150 + sub[:, 2].astype(np.uint32) * 29) >> 8
    HL = np.bincount(lum, minlength=256).astype(np.float64)
    total = HL.sum()
    S = s["strength"]
    tags = []

    lum_lo, lum_hi = _pct(HL, 0.005), _pct(HL, 0.995)
    Lo, Hi = min(lum_lo, 80), max(lum_hi, 170)
    c_lo, c_hi, cast = [], [], 0
    for c in range(3):
        lo, hi = min(_pct(H[c], 0.005), 110), max(_pct(H[c], 0.995), 70)
        if hi - lo < 50:
            m = (hi + lo) / 2; lo, hi = m - 25, m + 25
        c_lo.append(lo); c_hi.append(hi)
        cast = max(cast, abs(lo - lum_lo), abs(hi - lum_hi))

    i = np.arange(256, dtype=np.float64)

    def levels(c):
        a = np.clip((i - Lo) / (Hi - Lo), 0, 1)
        b = np.clip((i - c_lo[c]) / (c_hi[c] - c_lo[c]), 0, 1)
        x = a + (b - a) * s["colour"]
        return np.clip(i / 255 + (x - i / 255) * S, 0, 1)

    lv = [levels(c) for c in range(3)]
    m = [float(np.clip((H[c] * lv[c]).sum() / total, 0.03, 0.97)) for c in range(3)]
    avg = sum(m) / 3
    cg = [float(np.clip((np.log(avg) / np.log(m[c])) ** (s["colour"] * S * 0.7), 0.75, 1.33)) for c in range(3)]
    if s["colour"] > 0.1 and (cast > 14 or max(cg) - min(cg) > 0.08):
        tags.append("colour cast fixed")
    if lum_hi - lum_lo < 215 and S > 0.2:
        tags.append("levels")

    mean = float(np.clip(0.3 * m[0] ** cg[0] + 0.59 * m[1] ** cg[1] + 0.11 * m[2] ** cg[2], 0.02, 0.98))
    gamma = float(np.clip(np.log(0.46) / np.log(mean), 0.55, 1.6)) ** (s["exposure"] * (0.4 + 0.6 * S))
    if gamma < 0.93:
        tags.append("brightened")
    elif gamma > 1.07:
        tags.append("toned down")

    k = s["contrast"] * 0.55
    if k > 0.1:
        tags.append("contrast")
    if s["vibrance"] > 0.1:
        tags.append("vibrance")
    luts = []
    for c in range(3):
        x = lv[c] ** (cg[c] * gamma)
        sm = x * x * (3 - 2 * x)
        x = x + (sm - x) * k
        luts.append(np.round(x * 255).astype(np.uint8))
    return luts, tags


def enhance_array(arr, s):
    luts, tags = build_luts(arr, s)
    out = np.empty_like(arr)
    for c in range(3):
        out[..., c] = luts[c][arr[..., c]]
    vib = s["vibrance"] * 0.9
    if vib > 0:
        for y0 in range(0, out.shape[0], 400):  # in strips to keep memory low
            blk = out[y0:y0 + 400].astype(np.float32)
            mx, mn = blk.max(2), blk.min(2)
            sat = (mx - mn) / 255.0
            avg = blk.mean(2, keepdims=True)
            r, g, b = blk[..., 0], blk[..., 1], blk[..., 2]
            skin = (r > g) & (g > b) & (sat > 0.08) & (sat < 0.55)
            f = 1 + vib * (1 - sat) ** 2 * np.where(skin, 0.5, 1.0)
            blk = avg + (blk - avg) * f[..., None]
            out[y0:y0 + 400] = np.clip(blk + 0.5, 0, 255).astype(np.uint8)
    return out, tags


def process_one(src, dst, settings, quality=93):
    """Enhance one photo file and save it. Runs in a worker process."""
    with Image.open(src) as im:
        im.load()
        icc = im.info.get("icc_profile")
        im = ImageOps.exif_transpose(im)          # apply camera rotation
        exif = im.getexif()
        exif[0x0112] = 1                          # orientation now 'normal'
        rgb = im.convert("RGB")
    arr = np.asarray(rgb)
    out, tags = enhance_array(arr, settings)
    img = Image.fromarray(out, "RGB")
    if settings["sharpen"] > 0.01:
        radius = max(1.0, max(img.size) / 2500)
        img = img.filter(ImageFilter.UnsharpMask(radius=radius, percent=int(settings["sharpen"] * 110), threshold=2))
        tags.append("sharpened")
    tmp = dst + ".part"
    kw = dict(exif=exif.tobytes())
    if icc:
        kw["icc_profile"] = icc
    if dst.lower().endswith(".png"):
        img.save(tmp, "PNG", **kw)
    else:
        img.save(tmp, "JPEG", quality=quality, subsampling=0 if quality >= 95 else 2, optimize=True, **kw)
    os.replace(tmp, dst)                          # only appears once complete (Drive won't upload half a file)
    st = os.stat(src)
    os.utime(dst, (st.st_atime, st.st_mtime))
    return tags


# --------------------------------------------------------------------------
# Automatic updates
# --------------------------------------------------------------------------
def _vtuple(v):
    try:
        return tuple(int(x) for x in str(v).strip().split("."))
    except ValueError:
        return (0,)


def check_for_update(timeout=6):
    """Return the update manifest if a newer version is published, else None."""
    import urllib.request
    url = UPDATE_BASE + "version.json?t=" + str(int(time.time()))
    req = urllib.request.Request(url, headers={"User-Agent": f"RugbyPhotoEnhancer/{APP_VERSION}", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        info = json.loads(r.read().decode("utf-8"))
    return info if _vtuple(info.get("version")) > _vtuple(APP_VERSION) else None


def install_update(info, timeout=60):
    """Download, verify and swap in the new version of this script. Returns the new version string."""
    import hashlib
    import subprocess
    import urllib.request
    url = UPDATE_BASE + info.get("file", "rugby_photo_enhancer.py") + "?t=" + str(int(time.time()))
    req = urllib.request.Request(url, headers={"User-Agent": f"RugbyPhotoEnhancer/{APP_VERSION}", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != info.get("sha256", "").lower():
        raise RuntimeError("download didn't match the published checksum")
    compile(data, "rugby_photo_enhancer.py", "exec")   # refuse anything that isn't valid Python
    # make sure any newly required libraries are installed first
    reqs = info.get("requires") or []
    if reqs:
        py = sys.executable
        if py.lower().endswith("pythonw.exe"):
            py = py[:-len("pythonw.exe")] + "python.exe"
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run([py, "-m", "pip", "install", "--user", "--upgrade", "--quiet", *reqs],
                       check=False, creationflags=flags, timeout=600)
    me = os.path.abspath(__file__)
    tmp = me + ".new"
    with open(tmp, "wb") as f:
        f.write(data)
    try:
        shutil.copy2(me, me + ".bak")                    # previous version kept, just in case
    except OSError:
        pass
    os.replace(tmp, me)
    return info.get("version")


def restart_app():
    import subprocess
    flags = getattr(subprocess, "DETACHED_PROCESS", 0)
    subprocess.Popen([sys.executable, os.path.abspath(__file__)], creationflags=flags, close_fds=True)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def config_path():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "RugbyPhotoEnhancer")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "config.json")


def load_config():
    try:
        with open(config_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg):
    try:
        with open(config_path(), "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=1)
    except Exception:
        pass


def find_drive_rugby_folder():
    """Look for Google Drive for desktop's copy of the Rugby folder on any drive letter."""
    roots = []
    if os.name == "nt":
        roots = [f"{l}:\\" for l in string.ascii_uppercase if os.path.exists(f"{l}:\\")]
    roots.append(os.path.expanduser("~"))
    for r in roots:
        for pattern in (os.path.join(r, "Shared drives", "*", DRIVE_SUBPATH),
                        os.path.join(r, "Shared Drives", "*", DRIVE_SUBPATH),
                        os.path.join(r, "My Drive", DRIVE_SUBPATH),
                        os.path.join(r, "Google Drive", "Shared drives", "*", DRIVE_SUBPATH)):
            try:
                hits = glob.glob(pattern)
            except Exception:
                hits = []
            if hits:
                return hits[0]
    return ""


def photo_date(path):
    """Date the photo was taken (EXIF), falling back to the file's modified date."""
    try:
        with Image.open(path) as im:
            ex = im.getexif()
            raw = ex.get_ifd(0x8769).get(0x9003) or ex.get(0x0132)
            if raw:
                return datetime.strptime(str(raw)[:10], "%Y:%m:%d").date()
    except Exception:
        pass
    return date.fromtimestamp(os.path.getmtime(path))


def list_photos(folder):
    try:
        names = sorted(n for n in os.listdir(folder) if n.lower().endswith(PHOTO_EXT) and not n.startswith("._"))
    except Exception:
        return []
    return [os.path.join(folder, n) for n in names]


def photo_key(path):
    st = os.stat(path)
    return f"{os.path.basename(path)}|{st.st_size}|{int(st.st_mtime)}"


def safe_folder_name(name):
    bad = '<>:"/\\|?*'
    name = "".join("-" if ch in bad else ch for ch in name).strip().rstrip(".")
    return name


# --------------------------------------------------------------------------
# Direct Google Drive upload (via a small Apps Script in the user's own account)
# --------------------------------------------------------------------------
DEFAULT_RUGBY_FOLDER_ID = "1qBvZ1ZBL4O0Xnu1UO1iA7YVygRbfvtw9"

APPS_SCRIPT_TEMPLATE = r"""// Rugby Photo Enhancer - Drive uploader. Runs in YOUR Google account.
// It can only create folders and add photos inside the folder below.
const KEY = '%KEY%';
const ROOT_ID = '%ROOT%';

function doGet() { return out({ok: true, app: 'Rugby Photo Enhancer uploader'}); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.key !== KEY) return out({ok: false, error: 'Wrong key'});
    const root = DriveApp.getFolderById(ROOT_ID);
    if (req.action === 'ping') return out({ok: true, root: root.getName()});
    if (req.action === 'mkdir') {
      const parent = req.parent ? DriveApp.getFolderById(req.parent) : root;
      if (req.parent && !isUnder(parent, root)) return out({ok: false, error: 'Not allowed'});
      const name = String(req.name || '').slice(0, 200);
      if (!name) return out({ok: false, error: 'No name'});
      const it = parent.getFoldersByName(name);
      const existed = it.hasNext();
      const f = existed ? it.next() : parent.createFolder(name);
      return out({ok: true, id: f.getId(), url: f.getUrl(), existed: existed});
    }
    if (req.action === 'upload') {
      const folder = DriveApp.getFolderById(req.folder);
      if (!isUnder(folder, root)) return out({ok: false, error: 'Not allowed'});
      const same = folder.getFilesByName(req.name);
      while (same.hasNext()) {            // already there (e.g. a retry) - don't duplicate
        const f = same.next();
        if (f.getSize() === req.size) return out({ok: true, id: f.getId(), skipped: true});
      }
      const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'image/jpeg', req.name);
      const f = folder.createFile(blob);
      return out({ok: true, id: f.getId()});
    }
    return out({ok: false, error: 'Unknown action'});
  } catch (err) {
    return out({ok: false, error: String(err)});
  }
}

function isUnder(folder, root) {
  const rid = root.getId();
  let level = [folder];
  for (let d = 0; d < 5 && level.length; d++) {
    const next = [];
    for (const f of level) {
      if (f.getId() === rid) return true;
      const ps = f.getParents();
      while (ps.hasNext()) next.push(ps.next());
    }
    level = next;
  }
  return false;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
"""


def folder_id_from(text):
    import re
    text = (text or "").strip()
    m = re.search(r"/folders/([\w-]{10,})", text) or re.search(r"[?&]id=([\w-]{10,})", text)
    if m:
        return m.group(1)
    return text if re.fullmatch(r"[\w-]{10,}", text) else ""


class DriveUploader:
    def __init__(self, url, key):
        self.url, self.key = url.strip(), key

    def _call(self, payload, timeout=60):
        import urllib.request
        body = json.dumps(dict(payload, key=self.key)).encode("utf-8")
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:   # Apps Script answers via a redirect
            text = r.read().decode("utf-8", "replace")
        try:
            res = json.loads(text)
        except ValueError:
            if "<html" in text.lower():
                raise RuntimeError("the uploader web app isn't reachable - check it's deployed with access 'Anyone'")
            raise RuntimeError(text[:200])
        if not res.get("ok"):
            raise RuntimeError(res.get("error", "upload failed"))
        return res

    def ping(self):
        return self._call({"action": "ping"}, timeout=30)

    def mkdir(self, name, parent=None):
        return self._call({"action": "mkdir", "name": name, "parent": parent}, timeout=60)

    def upload(self, path, folder_id, tries=3):
        import base64
        with open(path, "rb") as f:
            data = f.read()
        mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
        payload = {"action": "upload", "folder": folder_id, "name": os.path.basename(path), "mime": mime,
                   "size": len(data), "data": base64.b64encode(data).decode("ascii")}
        for attempt in range(tries):
            try:
                return self._call(payload, timeout=300)
            except Exception:
                if attempt == tries - 1:
                    raise
                time.sleep(3 * (attempt + 1))


# --------------------------------------------------------------------------
# Previews
# --------------------------------------------------------------------------
def photo_taken(path):
    """(date, 'HH:MM') the photo was taken - EXIF first, else file time."""
    try:
        with Image.open(path) as im:
            ex = im.getexif()
            raw = ex.get_ifd(0x8769).get(0x9003) or ex.get(0x0132)
            if raw:
                dt = datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S")
                return dt.date(), dt.strftime("%H:%M")
    except Exception:
        pass
    dt = datetime.fromtimestamp(os.path.getmtime(path))
    return dt.date(), dt.strftime("%H:%M")


def make_preview(path, max_side, settings=None, quality=85):
    """Small JPEG of a photo (optionally enhanced). Returns (bytes, tags)."""
    import io
    with Image.open(path) as im:
        try:
            im.draft("RGB", (max_side, max_side))       # fast JPEG downscale while decoding
        except Exception:
            pass
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    tags = []
    if settings:
        out, tags = enhance_array(np.asarray(im), settings)
        im = Image.fromarray(out, "RGB")
        if settings["sharpen"] > 0.01:
            im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=int(settings["sharpen"] * 90), threshold=2))
            tags.append("sharpened")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue(), tags


class LRU:
    def __init__(self, n):
        from collections import OrderedDict
        self.n, self.d, self.lock = n, OrderedDict(), threading.Lock()

    def get(self, k):
        with self.lock:
            if k in self.d:
                self.d.move_to_end(k)
                return self.d[k]

    def put(self, k, v):
        with self.lock:
            self.d[k] = v
            self.d.move_to_end(k)
            while len(self.d) > self.n:
                self.d.popitem(last=False)


# --------------------------------------------------------------------------
# App (local web UI shown in an Edge/Chrome app window)
# --------------------------------------------------------------------------
class App:
    def __init__(self):
        import secrets
        self.cfg = load_config()
        self.token = secrets.token_urlsafe(18)
        self.photos = {}           # id -> dict(path, name, ...)
        self.thumbs = LRU(1500)
        self.views = LRU(40)
        self.tags = {}
        self.job = {"running": False}
        self.job_lock = threading.Lock()
        self.last_seen = time.time() + 60
        self.update = {"state": "idle"}
        self.browse_lock = threading.Lock()
        self.cfg_lock = threading.Lock()

    # ---------- config ----------
    def defaults(self):
        c = self.cfg
        return {
            "source": c.get("source", DEFAULT_SOURCE),
            "mode": c.get("mode", "direct"),
            "dest": c.get("dest") or find_drive_rugby_folder(),
            "localDir": c.get("local_copy_dir") or os.path.join(os.path.expanduser("~"), "Pictures", "Rugby Photos"),
            "keepLocal": c.get("keep_local", True),
            "onlyDate": c.get("only_date", True),
            "skip": c.get("skip_imported", True),
            "keepOriginals": c.get("keep_originals", False),
            "preset": c.get("preset", "Balanced"),
            "quality": c.get("quality_num", 93),
        }

    def save_settings(self, s):
        m = {"source": "source", "mode": "mode", "dest": "dest", "localDir": "local_copy_dir", "keepLocal": "keep_local",
             "onlyDate": "only_date", "skip": "skip_imported", "keepOriginals": "keep_originals",
             "preset": "preset", "quality": "quality_num"}
        with self.cfg_lock:
            for k, v in s.items():
                if k in m:
                    self.cfg[m[k]] = v
            save_config(self.cfg)

    def uploader(self):
        if self.cfg.get("upload_url") and self.cfg.get("upload_key"):
            return DriveUploader(self.cfg["upload_url"], self.cfg["upload_key"])
        return None

    def state(self):
        return {
            "version": APP_VERSION, "settings": self.defaults(),
            "drive": {"ok": bool(self.uploader()), "root": self.cfg.get("drive_root_name", ""),
                      "folderLink": self.cfg.get("folder_link") or f"https://drive.google.com/drive/folders/{DEFAULT_RUGBY_FOLDER_ID}"},
            "today": date.today().isoformat(), "update": self.update,
            "presets": list(PRESETS),
        }

    # ---------- photos ----------
    def scan(self, source, only_date, day, skip):
        if not os.path.isdir(source):
            return {"ok": False, "error": "Camera folder not found — is the SD card in?"}
        want = None
        if only_date:
            try:
                want = datetime.strptime(day, "%Y-%m-%d").date()
            except Exception:
                return {"ok": False, "error": "Pick a date"}
        done = set(self.cfg.get("imported", []))
        allp = list_photos(source)
        out, photos = [], {}
        for i, p in enumerate(allp):
            d, hm = photo_taken(p)
            if want and d != want:
                continue
            key = photo_key(p)
            imported = key in done
            if skip and imported:
                continue
            pid = f"p{i}"
            photos[pid] = {"path": p, "name": os.path.basename(p), "key": key}
            out.append({"id": pid, "name": os.path.basename(p), "time": hm, "date": d.strftime("%d/%m/%Y"),
                        "size": os.path.getsize(p), "imported": imported})
        self.photos = photos
        return {"ok": True, "photos": out, "total": len(allp)}

    def thumb(self, pid, kind, preset, side):
        ph = self.photos.get(pid)
        if not ph:
            return None
        k = (ph["key"], kind, preset if kind == "after" else "", side)
        cache = self.thumbs if side <= 600 else self.views
        hit = cache.get(k)
        if hit:
            return hit
        data, tags = make_preview(ph["path"], side, PRESETS.get(preset) if kind == "after" else None,
                                  quality=80 if side <= 600 else 88)
        if kind == "after":
            self.tags[(pid, preset)] = tags
        cache.put(k, data)
        return data

    # ---------- the run ----------
    def run(self, req):
        with self.job_lock:
            if self.job.get("running"):
                return {"ok": False, "error": "Already running"}
            ids = [i for i in req.get("ids", []) if i in self.photos]
            name = safe_folder_name(req.get("name", ""))
            s = req.get("settings", {})
            self.save_settings(s)
            direct = s.get("mode") == "direct"
            up = self.uploader() if direct else None
            if not ids:
                return {"ok": False, "error": "No photos selected"}
            if not name:
                return {"ok": False, "error": "Give the new folder a name, e.g. “Dungannon 14 11 26”"}
            if direct and not up:
                return {"ok": False, "error": "setup"}
            if direct:
                base = s.get("localDir") if s.get("keepLocal") else os.path.join(
                    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "RugbyPhotoEnhancer", "staging")
            else:
                base = s.get("dest", "")
                if not os.path.isdir(base):
                    return {"ok": False, "error": "Choose the folder to save into"}
            out_dir = os.path.join(base, name)
            try:
                os.makedirs(out_dir, exist_ok=True)
            except OSError as e:
                return {"ok": False, "error": f"Couldn't create {out_dir}: {e}"}
            self.job = {"running": True, "total": len(ids), "enh": 0, "up": 0, "fail": 0, "direct": direct,
                        "status": {i: "queued" for i in ids}, "errors": {}, "log": [], "name": name,
                        "open": "" if direct else out_dir, "started": time.time(), "message": "Starting…"}
        threading.Thread(target=self._work, args=(ids, name, s, direct, up, out_dir), daemon=True).start()
        return {"ok": True}

    def _log(self, t):
        self.job["log"] = (self.job["log"] + [t])[-200:]

    def _work(self, ids, name, s, direct, up, out_dir):
        from concurrent.futures import ThreadPoolExecutor
        job, lock = self.job, threading.Lock()
        settings = PRESETS.get(s.get("preset"), PRESETS["Balanced"])
        quality = int(s.get("quality", 93))
        keep_orig, keep_local = bool(s.get("keepOriginals")), bool(s.get("keepLocal"))
        orig_dir = os.path.join(out_dir, "Originals") if keep_orig else None
        if orig_dir:
            os.makedirs(orig_dir, exist_ok=True)
        folder_id = sub_id = None
        if direct:
            try:
                job["message"] = "Creating the Drive folder…"
                res = up.mkdir(name)
                folder_id, job["open"] = res["id"], res.get("url", "")
                self._log(("Adding to existing" if res.get("existed") else "Created") + f" Drive folder “{name}”")
                if orig_dir:
                    sub_id = up.mkdir("Originals", parent=folder_id)["id"]
            except Exception as e:
                job.update(running=False, message=f"Couldn't create the Drive folder: {e}", failed=True)
                return

        def mark_imported(pid):
            with self.cfg_lock:
                self.cfg.setdefault("imported", []).append(self.photos[pid]["key"])

        def do_upload(pid, path, fid, is_orig=False):
            try:
                if not is_orig:
                    job["status"][pid] = "uploading"
                up.upload(path, fid)
                if is_orig:
                    return
                with lock:
                    job["up"] += 1
                job["status"][pid] = "done"
                mark_imported(pid)
                if not keep_local:
                    try:
                        os.remove(path)
                    except OSError:
                        pass
            except Exception as e:
                if not is_orig:
                    with lock:
                        job["fail"] += 1
                    job["status"][pid], job["errors"][pid] = "error", f"Upload failed: {e}"
                self._log(f"✗ {os.path.basename(path)}: upload failed — {e}")

        n_workers = max(1, min(4, (os.cpu_count() or 2) - 1))
        job["message"] = "Enhancing…"
        with ThreadPoolExecutor(max_workers=3) as uploads, ProcessPoolExecutor(max_workers=n_workers) as ex:
            futs = {}
            for pid in ids:
                ph = self.photos[pid]
                base, ext = os.path.splitext(ph["name"])
                dst = os.path.join(out_dir, base + (".png" if ext.lower() == ".png" else ".jpg"))
                futs[ex.submit(process_one, ph["path"], dst, settings, quality)] = (pid, dst)
                job["status"][pid] = "working"
            for fut in as_completed(futs):
                pid, dst = futs[fut]
                ph = self.photos[pid]
                try:
                    tags = fut.result()
                    with lock:
                        job["enh"] += 1
                    self._log(f"✓ {ph['name']}  ({', '.join(tags)})")
                    if orig_dir:
                        op = os.path.join(orig_dir, ph["name"])
                        shutil.copy2(ph["path"], op)
                        if direct:
                            uploads.submit(do_upload, pid, op, sub_id, True)
                    if direct:
                        job["status"][pid] = "uploading"
                        uploads.submit(do_upload, pid, dst, folder_id)
                    else:
                        job["status"][pid] = "done"
                        mark_imported(pid)
                except Exception as e:
                    with lock:
                        job["fail"] += 1
                    job["status"][pid], job["errors"][pid] = "error", str(e)
                    self._log(f"✗ {ph['name']}: {e}")
        with self.cfg_lock:
            self.cfg["imported"] = self.cfg.get("imported", [])[-20000:]
            save_config(self.cfg)
        ok = job["up"] if direct else job["enh"]
        job["message"] = (f"{ok} of {job['total']} photos " + ("uploaded to Google Drive" if direct else "saved")
                          + (f" — {job['fail']} failed, run again to retry them" if job["fail"] else ""))
        job["running"] = False
        job["finished"] = True

    def job_view(self):
        j = dict(self.job)
        if j.get("running") and j.get("total"):
            steps = j["total"] * (2 if j["direct"] else 1)
            done = j["enh"] + j.get("up", 0) + j["fail"] * (2 if j["direct"] else 1)
            el = time.time() - j["started"]
            j["eta"] = int(el / max(done, 1) * max(steps - done, 0)) if done else None
            j["progress"] = done / steps
        return j

    # ---------- Drive setup ----------
    def setup_script(self, link):
        fid = folder_id_from(link)
        if not fid:
            return {"ok": False, "error": "That doesn't look like a Drive folder link."}
        import secrets
        key = self.cfg.get("pending_key") or self.cfg.get("upload_key") or secrets.token_urlsafe(24)
        with self.cfg_lock:
            self.cfg["pending_key"], self.cfg["pending_link"] = key, link
            save_config(self.cfg)
        return {"ok": True, "script": APPS_SCRIPT_TEMPLATE.replace("%KEY%", key).replace("%ROOT%", fid)}

    def setup_test(self, url):
        url = (url or "").strip()
        if not url.startswith("https://script.google.com/"):
            return {"ok": False, "error": "Paste the Web app URL — it starts with https://script.google.com/macros/s/…/exec"}
        key = self.cfg.get("pending_key") or self.cfg.get("upload_key")
        if not key:
            return {"ok": False, "error": "Click “Copy script” first."}
        try:
            res = DriveUploader(url, key).ping()
        except Exception as e:
            return {"ok": False, "error": str(e)}
        with self.cfg_lock:
            self.cfg.update(upload_url=url, upload_key=key, drive_root_name=res.get("root", ""),
                            folder_link=self.cfg.get("pending_link") or self.cfg.get("folder_link"))
            self.cfg.pop("pending_key", None)
            save_config(self.cfg)
        return {"ok": True, "root": res.get("root", "")}

    # ---------- misc ----------
    def browse(self, initial, title):
        with self.browse_lock:
            try:
                import tkinter as tk
                from tkinter import filedialog
                r = tk.Tk()
                r.withdraw()
                r.attributes("-topmost", True)
                d = filedialog.askdirectory(parent=r, title=title or "Choose a folder",
                                            initialdir=initial if initial and os.path.isdir(initial) else None)
                r.destroy()
                return {"ok": True, "path": os.path.normpath(d) if d else ""}
            except Exception as e:
                return {"ok": False, "error": f"Couldn't open the folder picker ({e}) — type the path instead."}

    def open_target(self, target):
        import webbrowser
        if not target:
            return {"ok": False}
        if target.startswith("http"):
            webbrowser.open(target)
        elif hasattr(os, "startfile") and os.path.exists(target):
            os.startfile(target)
        return {"ok": True}

    def check_updates(self, manual=False):
        def bg():
            self.update = {"state": "checking"}
            try:
                info = check_for_update()
            except Exception:
                self.update = {"state": "offline" if manual else "idle"}
                return
            if not info:
                self.update = {"state": "current"}
                return
            self.update = {"state": "downloading", "version": info.get("version")}
            try:
                newv = install_update(info)
                self.update = {"state": "ready", "version": newv, "notes": info.get("notes", "")}
            except Exception as e:
                self.update = {"state": "failed", "error": str(e)}
        threading.Thread(target=bg, daemon=True).start()


def make_handler(app):
    from http.server import BaseHTTPRequestHandler
    from urllib.parse import urlparse, parse_qs

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json", cache=False):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode("utf-8")
            elif isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "max-age=3600" if cache else "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if q.get("t") != app.token:
                return self._send(403, {"error": "forbidden"})
            app.last_seen = time.time()
            p = u.path
            if p == "/":
                return self._send(200, UI_HTML.replace("__TOKEN__", app.token), "text/html; charset=utf-8")
            if p == "/api/alive":
                return self._send(200, {"ok": True})
            if p == "/api/state":
                return self._send(200, app.state())
            if p == "/api/job":
                return self._send(200, app.job_view())
            if p.startswith("/img/"):
                pid = p.split("/")[2]
                kind = q.get("kind", "before")
                side = 1800 if q.get("size") == "view" else 420
                try:
                    data = app.thumb(pid, kind, q.get("preset", "Balanced"), side)
                except Exception as e:
                    return self._send(500, {"error": str(e)})
                if data is None:
                    return self._send(404, {"error": "unknown photo"})
                return self._send(200, data, "image/jpeg", cache=True)
            if p.startswith("/api/info/"):
                pid = p.split("/")[3]
                return self._send(200, {"tags": app.tags.get((pid, q.get("preset", "Balanced")), [])})
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.headers.get("X-Token") != app.token:
                return self._send(403, {"error": "forbidden"})
            app.last_seen = time.time()
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                body = {}
            p = urlparse(self.path).path
            if p == "/api/ping":
                return self._send(200, {"ok": True, "update": app.update})
            if p == "/api/settings":
                app.save_settings(body)
                return self._send(200, {"ok": True})
            if p == "/api/scan":
                return self._send(200, app.scan(body.get("source", ""), body.get("onlyDate"), body.get("date", ""), body.get("skip")))
            if p == "/api/run":
                return self._send(200, app.run(body))
            if p == "/api/browse":
                return self._send(200, app.browse(body.get("initial", ""), body.get("title", "")))
            if p == "/api/open":
                return self._send(200, app.open_target(body.get("target", "")))
            if p == "/api/setup/script":
                return self._send(200, app.setup_script(body.get("link", "")))
            if p == "/api/setup/test":
                return self._send(200, app.setup_test(body.get("url", "")))
            if p == "/api/update/check":
                app.check_updates(manual=True)
                return self._send(200, {"ok": True})
            if p == "/api/restart":
                self._send(200, {"ok": True})
                threading.Thread(target=_restart_soon, args=(app,), daemon=True).start()
                return
            return self._send(404, {"error": "not found"})
    return H


def instance_path():
    return os.path.join(os.path.dirname(config_path()), "instance.json")


def _restart_soon(app):
    time.sleep(0.4)
    try:
        os.remove(instance_path())
    except OSError:
        pass
    restart_app()
    os._exit(0)


def find_app_browser():
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    la = os.environ.get("LOCALAPPDATA", "")
    for c in (os.path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
              os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
              os.path.join(la, "Microsoft", "Edge", "Application", "msedge.exe"),
              os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
              os.path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
              os.path.join(la, "Google", "Chrome", "Application", "chrome.exe")):
        if c and os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome") or shutil.which("google-chrome")


def open_window(url):
    import subprocess
    import webbrowser
    exe = find_app_browser()
    if exe:
        prof = os.path.join(os.path.dirname(config_path()), "window")
        subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={prof}", "--no-first-run", "--no-default-browser-check",
                          "--window-size=1400,900", "--disable-features=Translate"], close_fds=True)
    else:
        webbrowser.open(url)


def run_app(open_ui=True, port=0):
    from http.server import ThreadingHTTPServer
    import urllib.request
    # already running? just show its window
    try:
        with open(instance_path(), encoding="utf-8") as f:
            inst = json.load(f)
        url = f"http://127.0.0.1:{inst['port']}/?t={inst['token']}"
        with urllib.request.urlopen(f"http://127.0.0.1:{inst['port']}/api/alive?t={inst['token']}", timeout=1.5) as r:
            if r.status == 200:
                if open_ui:
                    open_window(url)
                return
    except Exception:
        pass

    app = App()
    srv = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    srv.daemon_threads = True
    port = srv.server_address[1]
    url = f"http://127.0.0.1:{port}/?t={app.token}"
    with open(instance_path(), "w", encoding="utf-8") as f:
        json.dump({"port": port, "token": app.token, "pid": os.getpid()}, f)

    def watchdog():   # quit when the window has been closed (and nothing is running)
        while True:
            time.sleep(5)
            if time.time() - app.last_seen > 25 and not app.job.get("running"):
                try:
                    os.remove(instance_path())
                except OSError:
                    pass
                os._exit(0)
    if open_ui:
        threading.Thread(target=watchdog, daemon=True).start()
        open_window(url)
    else:
        print(url, flush=True)
    app.check_updates()
    srv.serve_forever()


UI_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rugby Photo Enhancer</title>
<style>
  :root{
    --bg:#121316; --panel:#1b1d22; --panel2:#23262c; --line:#2f333b; --line2:#3a3f49;
    --text:#eceef2; --muted:#9aa1ad; --accent:#f2b544; --accent2:#ffd58a; --ok:#6fcf97; --bad:#ef6b6b; --blue:#7fb2ff;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif}
  button,input,select{font:inherit;color:inherit}
  ::-webkit-scrollbar{width:10px;height:10px} ::-webkit-scrollbar-thumb{background:#2c3038;border-radius:6px} ::-webkit-scrollbar-track{background:transparent}
  .app{display:grid;grid-template-columns:330px 1fr;height:100vh}
  /* sidebar */
  aside{background:var(--panel);border-right:1px solid var(--line);overflow:auto;padding:18px 18px 24px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#e0892b);display:grid;place-items:center;color:#1b1404;font-weight:800}
  .brand h1{font-size:17px;margin:0;line-height:1.2}
  .brand small{color:var(--muted);font-size:12px}
  .sec{margin:0 0 18px}
  .sec h2{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 8px;font-weight:600}
  .path{display:flex;gap:6px}
  .path input{flex:1;min-width:0}
  input[type=text],input[type=date],select{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;outline:none}
  input[type=text]:focus,input[type=date]:focus,select:focus{border-color:var(--accent)}
  input[type=date]{color-scheme:dark}
  .chk{display:flex;align-items:center;gap:8px;margin:7px 0;cursor:pointer;user-select:none}
  .chk input{accent-color:var(--accent);width:15px;height:15px}
  .seg{display:grid;grid-template-columns:repeat(3,1fr);background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:3px;gap:3px}
  .seg button{border:0;background:transparent;border-radius:7px;padding:6px 0;cursor:pointer;color:var(--muted)}
  .seg button.on{background:#33302a;color:var(--accent2);box-shadow:inset 0 0 0 1px #5b4a25}
  .row{display:flex;gap:8px;align-items:center}
  .dest{border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px;cursor:pointer;transition:border-color .15s}
  .dest.on{border-color:var(--accent);background:#1f1d18}
  .dest .t{display:flex;align-items:center;gap:8px;font-weight:600}
  .dest .t input{accent-color:var(--accent)}
  .dest .d{color:var(--muted);font-size:12.5px;margin:4px 0 0 23px}
  .dest .more{margin:8px 0 0 23px}
  .pill{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:2px 8px;border-radius:20px;background:var(--panel2);color:var(--muted)}
  .pill.ok{color:var(--ok)} .pill.bad{color:var(--bad)}
  .btn{background:var(--accent);color:#1b1404;border:0;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer;white-space:nowrap}
  .btn:disabled{opacity:.4;cursor:default}
  .btn.ghost{background:var(--panel2);color:var(--text);border:1px solid var(--line);font-weight:500}
  .btn.ghost:hover:not(:disabled){border-color:var(--line2)}
  .btn.sm{padding:6px 10px;font-size:13px;border-radius:8px}
  .link{background:none;border:0;color:var(--accent2);cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px}
  .foot{color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  /* main */
  main{display:flex;flex-direction:column;min-width:0;height:100vh}
  .top{padding:16px 22px 12px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}
  .namebox{flex:1;min-width:260px}
  .namebox label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}
  .namebox input{width:100%;font-size:18px;padding:10px 12px;border-radius:10px}
  .go{padding:13px 22px;font-size:15px;border-radius:11px}
  .progress{padding:10px 22px 0}
  .bar{height:6px;background:var(--panel2);border-radius:4px;overflow:hidden}
  .bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .3s}
  .stat{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:13px;margin-top:7px;min-height:20px}
  .toolbar{display:flex;align-items:center;gap:10px;padding:10px 22px;flex-wrap:wrap}
  .toolbar .sp{flex:1}
  .count{color:var(--muted)}
  .count b{color:var(--text)}
  .grid{flex:1;overflow:auto;padding:4px 22px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;align-content:start}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;position:relative;transition:border-color .15s,opacity .15s}
  .tile:hover{border-color:var(--line2)}
  .tile.off{opacity:.38}
  .tile.isdone .sel{visibility:hidden}
  .thumb{aspect-ratio:3/2;background:#0c0d0f;cursor:zoom-in;position:relative;overflow:hidden}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .25s}
  .thumb img.ld{opacity:1}
  .sel{position:absolute;top:8px;left:8px;width:24px;height:24px;border-radius:7px;background:rgba(0,0,0,.55);border:1.5px solid rgba(255,255,255,.6);display:grid;place-items:center;cursor:pointer;z-index:2;font-size:14px;color:#1b1404}
  .tile:not(.off) .sel{background:var(--accent);border-color:var(--accent)}
  .tile:not(.off) .sel::after{content:"✓";font-weight:800}
  .badge{position:absolute;top:8px;right:8px;z-index:2;font-size:11.5px;padding:3px 8px;border-radius:20px;background:rgba(0,0,0,.65);backdrop-filter:blur(4px)}
  .badge.ok{color:var(--ok)} .badge.bad{color:var(--bad)} .badge.work{color:var(--accent2)} .badge.up{color:var(--blue)}
  .meta{padding:8px 10px 9px;display:flex;justify-content:space-between;gap:8px;font-size:12.5px}
  .meta .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .meta .tm{color:var(--muted)}
  .empty{grid-column:1/-1;text-align:center;color:var(--muted);padding:70px 20px}
  .empty .big{font-size:18px;color:var(--text);margin-bottom:6px}
  /* modal viewer */
  .modal{position:fixed;inset:0;background:rgba(5,6,8,.94);display:none;flex-direction:column;z-index:40}
  .modal.open{display:flex}
  .mhead{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;gap:10px;flex-wrap:wrap}
  .mhead .title{font-size:15px}
  .mhead .tags{color:var(--muted);font-size:12.5px}
  .stage{flex:1;display:grid;place-items:center;padding:0 16px 16px;min-height:0}
  .cmp{position:relative;user-select:none;touch-action:none;cursor:ew-resize}
  .cmp img{display:block;max-width:calc(100vw - 32px);max-height:calc(100vh - 92px);object-fit:contain}
  .cmp .before{position:absolute;inset:0;width:100%;height:100%}
  .cmp .handle{position:absolute;top:0;bottom:0;width:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);pointer-events:none}
  .cmp .handle::after{content:"⟷";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;color:#111;border-radius:50%;width:32px;height:32px;display:grid;place-items:center;font-size:16px}
  .lbl{position:absolute;top:10px;padding:3px 9px;border-radius:6px;background:rgba(0,0,0,.6);font-size:12px;pointer-events:none}
  .lbl.l{left:10px}.lbl.r{right:10px}
  .loading{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted)}
  /* dialog */
  .dlg{position:fixed;inset:0;background:rgba(5,6,8,.75);display:none;place-items:center;z-index:50}
  .dlg.open{display:grid}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px 24px;width:min(640px,94vw);max-height:92vh;overflow:auto}
  .card h3{margin:0 0 4px;font-size:18px}
  .card p{color:var(--muted);margin:0 0 14px}
  .steps{counter-reset:s;margin:0 0 14px;padding:0;list-style:none}
  .steps li{counter-increment:s;position:relative;padding:0 0 12px 34px}
  .steps li::before{content:counter(s);position:absolute;left:0;top:-1px;width:23px;height:23px;border-radius:50%;background:var(--panel2);border:1px solid var(--line2);display:grid;place-items:center;font-size:12px;color:var(--accent2)}
  .steps code{background:var(--panel2);padding:1px 6px;border-radius:5px;font-size:12.5px}
  .card input[type=text]{width:100%}
  .msg{min-height:20px;margin-top:10px;font-size:13px}
  .msg.ok{color:var(--ok)} .msg.bad{color:var(--bad)}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(10px);background:var(--panel2);border:1px solid var(--line2);padding:10px 16px;border-radius:10px;opacity:0;transition:.25s;pointer-events:none;z-index:60;max-width:90vw}
  .toast.show{opacity:1;transform:translateX(-50%)}
  .gone{display:none!important}
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand"><div class="logo">R</div><div><h1>Rugby Photo Enhancer</h1><small id="ver"></small></div></div>

    <div class="sec">
      <h2>Camera card</h2>
      <div class="path"><input type="text" id="source" spellcheck="false"><button class="btn ghost sm" data-browse="source" data-title="Choose the camera folder">Browse</button></div>
      <label class="chk"><input type="checkbox" id="onlyDate"> Only photos taken on</label>
      <div class="row" style="margin-left:23px"><input type="date" id="day"></div>
      <label class="chk"><input type="checkbox" id="skip"> Skip photos already imported</label>
    </div>

    <div class="sec">
      <h2>Look</h2>
      <div class="seg" id="presets"></div>
      <div class="row" style="margin-top:9px;justify-content:space-between">
        <span class="count">JPEG quality</span>
        <select id="quality"><option value="88">Good (88%)</option><option value="93">High (93%)</option><option value="97">Max (97%)</option></select>
      </div>
    </div>

    <div class="sec">
      <h2>Upload to</h2>
      <div class="dest" data-mode="direct">
        <div class="t"><input type="radio" name="mode" value="direct"> Google Drive</div>
        <div class="d" id="driveState"></div>
        <div class="more">
          <label class="chk"><input type="checkbox" id="keepLocal"> Also keep a copy on this PC</label>
          <div class="path"><input type="text" id="localDir" spellcheck="false"><button class="btn ghost sm" data-browse="localDir" data-title="Where to keep local copies">Browse</button></div>
        </div>
      </div>
      <div class="dest" data-mode="folder">
        <div class="t"><input type="radio" name="mode" value="folder"> A folder on this PC</div>
        <div class="d">e.g. a Google Drive for desktop folder</div>
        <div class="more"><div class="path"><input type="text" id="dest" spellcheck="false"><button class="btn ghost sm" data-browse="dest" data-title="Choose the folder to save into">Browse</button></div></div>
      </div>
      <label class="chk"><input type="checkbox" id="keepOriginals"> Also upload untouched originals</label>
    </div>

    <div class="foot"><span id="updState"></span><button class="link" id="updBtn">Check for updates</button></div>
  </aside>

  <main>
    <div class="top">
      <div class="namebox">
        <label for="folderName">New folder in Rugby</label>
        <input type="text" id="folderName" placeholder="e.g. Dungannon 14 11 26" spellcheck="false">
      </div>
      <button class="btn go" id="go" disabled>Enhance &amp; upload</button>
    </div>
    <div class="progress"><div class="bar"><i id="bar"></i></div><div class="stat"><span id="status">Put the camera card in and pick a date.</span><span id="eta"></span></div></div>
    <div class="toolbar">
      <span class="count" id="count"></span>
      <button class="btn ghost sm" id="selAll">Select all</button>
      <button class="btn ghost sm" id="selNone">Select none</button>
      <span class="sp"></span>
      <button class="btn ghost sm" id="rescan">↻ Rescan card</button>
      <div class="seg" style="width:190px;grid-template-columns:1fr 1fr" id="showSeg"><button data-k="after" class="on">Enhanced</button><button data-k="before">Original</button></div>
      <button class="btn ghost sm gone" id="openBtn">Open folder</button>
    </div>
    <div class="grid" id="grid"><div class="empty"><div class="big">Looking for photos…</div></div></div>
  </main>
</div>

<div class="modal" id="modal">
  <div class="mhead">
    <div><div class="title" id="mName"></div><div class="tags" id="mTags"></div></div>
    <div class="row">
      <button class="btn ghost sm" id="mPrev">‹ Prev</button>
      <button class="btn ghost sm" id="mNext">Next ›</button>
      <button class="btn ghost sm" id="mToggle">Exclude</button>
      <button class="btn sm" id="mClose">Close</button>
    </div>
  </div>
  <div class="stage">
    <div class="cmp" id="cmp">
      <img id="imgAfter" alt="Enhanced">
      <img id="imgBefore" class="before" alt="Original">
      <div class="handle" id="handle"></div>
      <span class="lbl l">Original</span><span class="lbl r">Enhanced</span>
      <div class="loading" id="mLoad">Loading…</div>
    </div>
  </div>
</div>

<div class="dlg" id="setup">
  <div class="card">
    <h3>Connect to Google Drive</h3>
    <p>One-time setup, about 3 minutes. It creates a private uploader in your own Google account that can only add folders and photos inside your Rugby folder.</p>
    <ol class="steps">
      <li>Rugby folder link:<div style="margin-top:6px"><input type="text" id="folderLink" spellcheck="false"></div></li>
      <li><button class="btn sm" id="copyScript">Copy script</button> then <button class="btn ghost sm" id="openScript">Open Apps Script</button><br>
        <span class="count">In the new project: delete the sample, paste (Ctrl+V), save (Ctrl+S).</span></li>
      <li><b>Deploy → New deployment</b> → ⚙ → <b>Web app</b>. Execute as <code>Me</code>, Who has access <code>Anyone</code> → Deploy.</li>
      <li><b>Authorise access</b> → your account → <b>Advanced</b> → <b>Go to … (unsafe)</b> → Allow. <span class="count">(It's your own script, so this warning is expected.)</span></li>
      <li>Paste the <b>Web app URL</b>:<div style="margin-top:6px"><input type="text" id="scriptUrl" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false"></div></li>
    </ol>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="setupClose">Later</button><button class="btn" id="setupTest">Test &amp; save</button></div>
    <div class="msg" id="setupMsg"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(() => {
  const T = "__TOKEN__";
  const $ = id => document.getElementById(id);
  const api = async (path, body) => {
    const r = await fetch(path + (body ? "" : (path.includes("?") ? "&" : "?") + "t=" + T), body ? {method:"POST", headers:{"Content-Type":"application/json","X-Token":T}, body:JSON.stringify(body)} : {});
    return r.json();
  };
  let S = null, photos = [], show = "after", jobTimer = null, running = false, lastStatus = {};
  const fmtEta = s => s == null ? "" : s < 60 ? `about ${s}s left` : `about ${Math.floor(s/60)}m ${s%60}s left`;
  let tt; const toast = t => { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => e.classList.remove("show"), 3000); };

  /* ---------- settings ---------- */
  function settings(){
    return {
      source: $("source").value.trim(), onlyDate: $("onlyDate").checked, skip: $("skip").checked,
      preset: document.querySelector("#presets .on").dataset.p, quality: +$("quality").value,
      mode: document.querySelector("input[name=mode]:checked").value,
      keepLocal: $("keepLocal").checked, localDir: $("localDir").value.trim(), dest: $("dest").value.trim(),
      keepOriginals: $("keepOriginals").checked,
    };
  }
  let saveT; const saveSettings = () => { clearTimeout(saveT); saveT = setTimeout(() => api("/api/settings", settings()), 400); };

  function paintDest(){
    const m = settings().mode;
    document.querySelectorAll(".dest").forEach(d => d.classList.toggle("on", d.dataset.mode === m));
    document.querySelectorAll(".dest .more").forEach(x => x.style.display = x.closest(".dest").dataset.mode === m ? "" : "none");
    const ds = $("driveState");
    ds.innerHTML = S.drive.ok ? `<span class="pill ok">✓ Connected${S.drive.root ? " to “" + esc(S.drive.root) + "”" : ""}</span> <button class="link" id="reSetup">change</button>`
                              : `<span class="pill bad">Not set up</span> <button class="link" id="reSetup">Set up…</button>`;
    $("reSetup").onclick = e => { e.stopPropagation(); openSetup(); };
    updateGo();
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  async function init(){
    S = await api("/api/state");
    const st = S.settings;
    $("ver").textContent = "Version " + S.version;
    $("source").value = st.source; $("onlyDate").checked = st.onlyDate; $("skip").checked = st.skip;
    $("day").value = S.today; $("quality").value = String(st.quality);
    $("keepLocal").checked = st.keepLocal; $("localDir").value = st.localDir; $("dest").value = st.dest;
    $("keepOriginals").checked = st.keepOriginals;
    document.querySelector(`input[name=mode][value=${st.mode === "folder" ? "folder" : "direct"}]`).checked = true;
    $("presets").innerHTML = S.presets.map(p => `<button data-p="${p}" class="${p === st.preset ? "on" : ""}">${p}</button>`).join("");
    const d = new Date(); $("folderName").value = [d.getDate(), d.getMonth()+1, d.getFullYear()%100].map(n => String(n).padStart(2,"0")).join(" ");
    $("folderLink").value = S.drive.folderLink;
    paintDest(); paintUpdate(S.update);
    $("folderName").focus(); $("folderName").setSelectionRange(0, 0);
    scan();
    if (st.mode !== "folder" && !S.drive.ok) setTimeout(openSetup, 500);
  }

  /* ---------- sidebar events ---------- */
  ["source","day"].forEach(id => $(id).addEventListener("change", () => { saveSettings(); scan(); }));
  ["onlyDate","skip"].forEach(id => $(id).addEventListener("change", () => { saveSettings(); scan(); }));
  ["quality","keepLocal","localDir","dest","keepOriginals"].forEach(id => $(id).addEventListener("change", saveSettings));
  $("presets").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#presets button").forEach(x => x.classList.toggle("on", x === b));
    saveSettings(); refreshImages();
  });
  document.querySelectorAll(".dest").forEach(d => d.addEventListener("click", e => {
    if (e.target.closest("input[type=text],button,label.chk")) return;
    d.querySelector("input[type=radio]").checked = true; paintDest(); saveSettings();
  }));
  document.querySelectorAll("[data-browse]").forEach(b => b.addEventListener("click", async e => {
    e.stopPropagation();
    const inp = $(b.dataset.browse);
    const r = await api("/api/browse", {initial: inp.value, title: b.dataset.title});
    if (r.ok && r.path) { inp.value = r.path; inp.dispatchEvent(new Event("change")); }
    else if (!r.ok) toast(r.error);
  }));
  $("folderName").addEventListener("input", updateGo);

  /* ---------- photos ---------- */
  async function scan(){
    if (running) return;
    $("grid").innerHTML = `<div class="empty"><div class="big">Reading the card…</div></div>`;
    const s = settings();
    const r = await api("/api/scan", {source: s.source, onlyDate: s.onlyDate, date: $("day").value, skip: s.skip});
    lastStatus = {};
    if (!r.ok) { photos = []; $("grid").innerHTML = `<div class="empty"><div class="big">${esc(r.error)}</div>Check the card is in, or click Browse to pick the folder.</div>`; setStatus(""); updateCount(); return; }
    photos = r.photos.map(p => Object.assign(p, {include: true}));
    if (!photos.length) {
      const why = s.onlyDate ? "No photos taken on that date" + (s.skip ? " that haven't already been imported" : "") : "No new photos on the card";
      $("grid").innerHTML = `<div class="empty"><div class="big">${why}</div>${r.total} photos on the card in total. Try another date, or untick the filters on the left.</div>`;
    } else renderGrid();
    setStatus(photos.length ? "Click any photo to compare before/after. Untick any you don't want." : "");
    updateCount();
  }
  const imgURL = (p, kind, size) => `/img/${p.id}?t=${T}&kind=${kind}&preset=${currentPreset()}${size ? "&size=" + size : ""}`;
  const currentPreset = () => document.querySelector("#presets .on").dataset.p;

  function renderGrid(){
    const g = $("grid"); g.innerHTML = "";
    const io = new IntersectionObserver(ents => ents.forEach(en => {
      if (!en.isIntersecting) return;
      const img = en.target; io.unobserve(img); img.src = img.dataset.src;
    }), {root: g, rootMargin: "400px"});
    photos.forEach((p, i) => {
      const t = document.createElement("div"); t.className = "tile" + (p.include ? "" : " off"); t.dataset.i = i;
      t.innerHTML = `<div class="thumb"><img alt=""><div class="sel" title="Include / exclude"></div><span class="badge gone"></span></div>
        <div class="meta"><span class="n"></span><span class="tm">${esc(p.time)}</span></div>`;
      t.querySelector(".n").textContent = p.name;
      const img = t.querySelector("img"); img.dataset.src = imgURL(p, show);
      img.onload = () => img.classList.add("ld");
      io.observe(img);
      t.querySelector(".sel").onclick = e => { e.stopPropagation(); toggle(i); };
      t.querySelector(".thumb").onclick = () => openViewer(i);
      p.el = t; g.appendChild(t);
      paintBadge(p);
    });
    window.__io = io;
  }
  function refreshImages(){
    photos.forEach(p => { const img = p.el && p.el.querySelector("img"); if (!img) return; img.classList.remove("ld"); const u = imgURL(p, show); if (img.src) img.src = u; else img.dataset.src = u; });
    if ($("modal").classList.contains("open")) openViewer(cur);
  }
  function toggle(i){
    if (running) return;
    const p = photos[i]; if (p.done) return; p.include = !p.include; p.el.classList.toggle("off", !p.include);
    updateCount(); if (cur === i) $("mToggle").textContent = p.include ? "Exclude" : "Include";
  }
  $("selAll").onclick = () => { if (running) return; photos.forEach(p => { if (p.done) return; p.include = true; p.el.classList.remove("off"); }); updateCount(); };
  $("selNone").onclick = () => { if (running) return; photos.forEach((p, i) => { p.include = false; p.el.classList.add("off"); }); updateCount(); };
  $("showSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    show = b.dataset.k;
    $("showSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    refreshImages();
  });
  $("rescan").onclick = () => scan();
  function updateCount(){
    const n = photos.filter(p => p.include).length;
    $("count").innerHTML = photos.length ? `<b>${n}</b> of ${photos.length} selected` : "";
    updateGo();
  }
  function updateGo(){
    const n = photos.filter(p => p.include).length, s = S && settings();
    const target = s && s.mode === "direct" ? "upload" : "save";
    $("go").textContent = running ? "Working…" : n ? `Enhance & ${target} ${n} photo${n === 1 ? "" : "s"}` : `Enhance & ${target}`;
    $("go").disabled = running || !n || !$("folderName").value.trim();
  }
  const BADGE = {queued:["Queued","work"], working:["Enhancing…","work"], uploading:["Uploading…","up"], done:["✓ Done","ok"], error:["✗ Failed","bad"]};
  function paintBadge(p){
    const b = p.el && p.el.querySelector(".badge"); if (!b) return;
    const st = lastStatus[p.id];
    if (!st) { b.className = "badge gone"; return; }
    p.el.classList.toggle("isdone", st === "done");
    const [txt, cls] = BADGE[st] || [st, ""];
    b.className = "badge " + cls; b.textContent = st === "done" && settings().mode === "direct" ? "✓ In Drive" : txt;
    if (st === "error" && p.err) b.title = p.err;
  }
  function setStatus(t, eta){ $("status").textContent = t || ""; $("eta").textContent = eta || ""; }

  /* ---------- run ---------- */
  $("go").onclick = async () => {
    const ids = photos.filter(p => p.include).map(p => p.id);
    const r = await api("/api/run", {ids, name: $("folderName").value.trim(), settings: settings()});
    if (!r.ok) { if (r.error === "setup") openSetup(); else toast(r.error); return; }
    running = true; updateGo(); $("openBtn").classList.add("gone");
    poll();
  };
  async function poll(){
    const j = await api("/api/job");
    lastStatus = j.status || {};
    photos.forEach(p => { p.err = (j.errors || {})[p.id]; paintBadge(p); });
    $("bar").style.width = ((j.running ? j.progress || 0 : (j.finished ? 1 : 0)) * 100) + "%";
    if (j.running) {
      const t = j.direct ? `Enhanced ${j.enh} of ${j.total} · Uploaded ${j.up} of ${j.total}` : `Enhanced ${j.enh} of ${j.total}`;
      setStatus(j.enh === 0 && j.up === 0 ? j.message : t, fmtEta(j.eta));
      jobTimer = setTimeout(poll, 700);
    } else {
      running = false;
      // finished photos are unticked, so pressing the button again only retries failures
      photos.forEach(p => { if (lastStatus[p.id] === "done") { p.include = false; p.done = true; } });
      updateCount(); updateGo();
      setStatus(j.message || "Done.", "");
      if (j.open) { $("openBtn").classList.remove("gone"); $("openBtn").textContent = j.direct ? "Open in Google Drive" : "Open folder"; $("openBtn").onclick = () => api("/api/open", {target: j.open}); }
      if (j.finished) toast(j.fail ? "Finished with some failures — click the button again to retry them" : "All done!");
    }
  }

  /* ---------- viewer ---------- */
  let cur = -1, split = 50;
  function openViewer(i){
    const p = photos[i]; if (!p) return;
    cur = i;
    $("mName").textContent = `${p.name} · ${p.time} · ${(p.size/1048576).toFixed(1)} MB`;
    $("mTags").textContent = "";
    $("mToggle").textContent = p.include ? "Exclude" : "Include";
    $("mLoad").style.display = "";
    let n = 0; const done = () => { if (++n === 2) { $("mLoad").style.display = "none"; api(`/api/info/${p.id}?preset=${currentPreset()}`).then(r => { if (cur === i) $("mTags").textContent = r.tags.length ? "Changes: " + r.tags.join(", ") : ""; }); } };
    $("imgAfter").onload = done; $("imgBefore").onload = done;
    $("imgAfter").src = imgURL(p, "after", "view"); $("imgBefore").src = imgURL(p, "before", "view");
    $("modal").classList.add("open"); setSplit(split);
    [i-1, i+1].forEach(k => { if (photos[k]) { new Image().src = imgURL(photos[k], "after", "view"); new Image().src = imgURL(photos[k], "before", "view"); } });
  }
  function setSplit(v){ split = Math.max(0, Math.min(100, v)); $("imgBefore").style.clipPath = `inset(0 ${100 - split}% 0 0)`; $("handle").style.left = split + "%"; }
  const cmp = $("cmp"); let drag = false;
  const mv = e => { const r = cmp.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width * 100); };
  cmp.addEventListener("pointerdown", e => { drag = true; cmp.setPointerCapture(e.pointerId); mv(e); });
  cmp.addEventListener("pointermove", e => { if (drag) mv(e); });
  cmp.addEventListener("pointerup", () => drag = false);
  const step = d => { const k = cur + d; if (photos[k]) openViewer(k); };
  $("mPrev").onclick = () => step(-1); $("mNext").onclick = () => step(1);
  $("mClose").onclick = () => $("modal").classList.remove("open");
  $("mToggle").onclick = () => toggle(cur);
  document.addEventListener("keydown", e => {
    if ($("modal").classList.contains("open")) {
      if (e.key === "Escape") $("mClose").click();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === " " || e.key.toLowerCase() === "x") { e.preventDefault(); toggle(cur); }
    } else if ($("setup").classList.contains("open") && e.key === "Escape") $("setupClose").click();
  });

  /* ---------- Drive setup ---------- */
  function openSetup(){ $("setupMsg").textContent = ""; $("setup").classList.add("open"); }
  $("setupClose").onclick = () => $("setup").classList.remove("open");
  $("copyScript").onclick = async () => {
    const r = await api("/api/setup/script", {link: $("folderLink").value.trim()});
    if (!r.ok) { msg(r.error, "bad"); return; }
    try { await navigator.clipboard.writeText(r.script); msg("Script copied — now open Apps Script and paste it.", "ok"); }
    catch (e) { msg("Couldn't copy automatically.", "bad"); }
  };
  $("openScript").onclick = () => api("/api/open", {target: "https://script.google.com/home/projects/create"});
  $("setupTest").onclick = async () => {
    msg("Testing…", ""); $("setupTest").disabled = true;
    const r = await api("/api/setup/test", {url: $("scriptUrl").value.trim()});
    $("setupTest").disabled = false;
    if (!r.ok) { msg("Didn't work: " + r.error, "bad"); return; }
    msg(`✓ Connected to “${r.root}”. All set!`, "ok");
    S.drive.ok = true; S.drive.root = r.root;
    document.querySelector("input[name=mode][value=direct]").checked = true; paintDest(); saveSettings();
    setTimeout(() => $("setup").classList.remove("open"), 1300);
  };
  const msg = (t, c) => { const m = $("setupMsg"); m.textContent = t; m.className = "msg " + (c || ""); };

  /* ---------- updates + keep-alive ---------- */
  function paintUpdate(u){
    const el = $("updState"), b = $("updBtn");
    b.textContent = "Check for updates"; b.onclick = () => { api("/api/update/check", {}); el.textContent = "Checking…"; };
    if (!u) return;
    if (u.state === "checking") el.textContent = "Checking for updates…";
    else if (u.state === "current") el.textContent = "Up to date";
    else if (u.state === "offline") el.textContent = "Couldn't check (offline?)";
    else if (u.state === "downloading") el.textContent = `Downloading v${u.version}…`;
    else if (u.state === "failed") el.textContent = "Update failed";
    else if (u.state === "ready") {
      el.innerHTML = `<span class="pill ok">v${esc(u.version)} ready</span>`;
      b.textContent = "Restart to update";
      b.onclick = async () => { if (running) { toast("Wait until the current job finishes"); return; } await api("/api/restart", {}); document.body.innerHTML = '<div class="empty" style="padding-top:30vh"><div class="big">Restarting…</div></div>'; setTimeout(() => window.close(), 1500); };
    } else el.textContent = "";
  }
  setInterval(async () => { try { const r = await api("/api/ping", {}); paintUpdate(r.update); } catch (e) {} }, 4000);

  init();
})();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    # Command-line use (for testing): python rugby_photo_enhancer.py IN_DIR OUT_DIR [Preset]
    if len(sys.argv) >= 3:
        src, out = sys.argv[1], sys.argv[2]
        os.makedirs(out, exist_ok=True)
        s = PRESETS[sys.argv[3]] if len(sys.argv) > 3 else PRESETS["Balanced"]
        for p in list_photos(src):
            t = process_one(p, os.path.join(out, os.path.basename(p)), s)
            print(os.path.basename(p), t)
    elif len(sys.argv) == 2 and sys.argv[1] == "--serve":
        run_app(open_ui=False)          # for testing: print the URL instead of opening a window
    else:
        run_app()
