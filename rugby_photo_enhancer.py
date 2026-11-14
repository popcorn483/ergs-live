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
APP_VERSION = "1.4.0"
# Updates are published here (branch "photo-enhancer" of github.com/popcorn483/ergs-live)
UPDATE_BASE = "https://raw.githubusercontent.com/popcorn483/ergs-live/photo-enhancer/"
DEFAULT_SOURCE = r"E:\DCIM\100CANON"
# Where the Rugby folder lives inside Google Drive for desktop
DRIVE_SUBPATH = os.path.join("School Photos", "2026-27", "Rugby")
PHOTO_EXT = (".jpg", ".jpeg", ".png")

PRESETS = {
    "Gentle":   dict(strength=0.55, colour=0.45, exposure=0.45, contrast=0.20, vibrance=0.20, sharpen=0.25, shadows=0.45, highlights=0.35, bright=0.0, warmth=0.0),
    "Balanced": dict(strength=0.80, colour=0.60, exposure=0.65, contrast=0.35, vibrance=0.35, sharpen=0.40, shadows=0.65, highlights=0.50, bright=0.0, warmth=0.0),
    "Punchy":   dict(strength=1.00, colour=0.75, exposure=0.80, contrast=0.55, vibrance=0.60, sharpen=0.55, shadows=0.80, highlights=0.60, bright=0.0, warmth=0.0),
}
# order used when a look is sent as a list of numbers; bright/warmth run -1..1, the rest 0..1
LOOK_KEYS = ["strength", "colour", "exposure", "contrast", "vibrance", "sharpen", "shadows", "highlights", "bright", "warmth"]


def look_from_list(vals, fallback="Balanced"):
    """Turn a list of 8 numbers (from the window) into a validated settings dict."""
    try:
        vals = [float(v) for v in vals]
        if len(vals) != len(LOOK_KEYS):
            raise ValueError
    except (TypeError, ValueError):
        return dict(PRESETS[fallback])
    out = {}
    for k, v in zip(LOOK_KEYS, vals):
        lo = -1.0 if k in ("bright", "warmth") else 0.0
        out[k] = min(1.0, max(lo, v))
    return out


# --------------------------------------------------------------------------
# Enhancement maths
# --------------------------------------------------------------------------
def _pct(hist, p):
    c = np.cumsum(hist)
    return int(np.searchsorted(c, c[-1] * p))


def _small(arr, target=250_000):
    h, w, _ = arr.shape
    st = max(1, int((h * w / target) ** 0.5))
    return arr[::st, ::st]


def build_luts(arr, s):
    """Analyse an RGB uint8 array and return 3 lookup tables, light info and description tags."""
    sm_arr = _small(arr)
    sub = sm_arr.reshape(-1, 3)
    H = [np.bincount(sub[:, c], minlength=256).astype(np.float64) for c in range(3)]
    lum = (sub[:, 0].astype(np.uint32) * 77 + sub[:, 1].astype(np.uint32) * 150 + sub[:, 2].astype(np.uint32) * 29) >> 8
    HL = np.bincount(lum, minlength=256).astype(np.float64)
    total = HL.sum()
    S = s["strength"]
    tags = []

    # how backlit / contrasty is the scene?
    dark0 = float((lum < 70).mean())          # share of the picture that is shadow
    bright0 = float((lum > 215).mean())       # share that is near-white (sky, etc.)
    backlit = min(1.0, max(0.0, (dark0 - 0.08) / 0.2)) * min(1.0, bright0 / 0.15)

    lum_lo, lum_hi = _pct(HL, 0.005), _pct(HL, 0.995)
    # hazy photos get a strong black-point fix; photos with real shadows keep their shadow detail
    Lo = min(lum_lo, 80) * max(0.0, 1 - 5.0 * dark0)
    Hi = max(lum_hi, 170)
    c_lo, c_hi, cast = [], [], 0
    for c in range(3):
        lo, hi = min(_pct(H[c], 0.005), 110), max(_pct(H[c], 0.995), 70)
        if hi - lo < 50:
            m = (hi + lo) / 2; lo, hi = m - 25, m + 25
        c_lo.append(lo); c_hi.append(hi)
        cast = max(cast, abs(lo - lum_lo), abs(hi - lum_hi))

    i = np.arange(256, dtype=np.float64)
    colour = s["colour"] * (1 - 0.5 * backlit)        # backlit scenes fool colour correction - go easy

    def levels(c):
        a = np.clip((i - Lo) / (Hi - Lo), 0, 1)
        b = np.clip((i - c_lo[c]) / (c_hi[c] - c_lo[c]), 0, 1)
        x = a + (b - a) * colour
        return np.clip(i / 255 + (x - i / 255) * S, 0, 1)

    lv = [levels(c) for c in range(3)]
    m = [float(np.clip((H[c] * lv[c]).sum() / total, 0.03, 0.97)) for c in range(3)]
    avg = sum(m) / 3
    cg = [float(np.clip((np.log(avg) / np.log(m[c])) ** (colour * S * 0.6), 0.85, 1.18)) for c in range(3)]
    if colour > 0.1 and (cast > 14 or max(cg) - min(cg) > 0.06):
        tags.append("colour cast fixed")
    if lum_hi - lum_lo < 215 and S > 0.2:
        tags.append("levels")

    # Exposure: centre-weighted metering (the subject is usually near the middle)
    hs, ws = sm_arr.shape[:2]
    yy, xx = np.mgrid[0:hs, 0:ws]
    wgt = 0.4 + np.exp(-(((xx / ws - 0.5) ** 2) + ((yy / hs - 0.47) ** 2)) / (2 * 0.22 ** 2))
    mapped = [lv[c][sm_arr[..., c]] ** cg[c] for c in range(3)]
    Lm = 0.3 * mapped[0] + 0.59 * mapped[1] + 0.11 * mapped[2]
    target = 0.45
    subject = Lm < 0.85
    if backlit > 0.15 and subject.mean() > 0.05:
        # backlit: meter on the subject, not the bright sky behind it
        wgt = wgt * subject
        target = 0.36
    mean = float(np.clip((Lm * wgt).sum() / wgt.sum(), 0.02, 0.98))
    gamma = float(np.clip(np.log(target) / np.log(mean), 0.55, 1.6))
    if dark0 > 0.10:
        gamma = min(gamma, 1.0)                        # never darken a photo with a big dark subject
    gamma = gamma ** (s["exposure"] * (0.4 + 0.6 * S))
    bright, warmth = s.get("bright", 0.0), s.get("warmth", 0.0)
    gamma = float(np.clip(gamma * 2 ** (-0.8 * bright), 0.35, 2.5))
    if gamma < 0.93:
        tags.append("brightened")
    elif gamma > 1.07:
        tags.append("toned down")

    k = s["contrast"] * 0.55 * (1 - 0.75 * max(backlit, min(1.0, dark0 * 1.5)))   # don't crush shadows
    if k > 0.1:
        tags.append("contrast")
    if s["vibrance"] > 0.1:
        tags.append("vibrance")
    if warmth > 0.05:
        tags.append("warmer")
    elif warmth < -0.05:
        tags.append("cooler")
    warm = [1 + 0.10 * warmth, 1 + 0.02 * warmth, 1 - 0.10 * warmth]
    luts = []
    for c in range(3):
        x = lv[c] ** (cg[c] * gamma)
        smc = x * x * (3 - 2 * x)
        x = x + (smc - x) * k
        x = np.clip(x * warm[c], 0, 1)
        luts.append(np.round(x * 255).astype(np.uint8))

    # light info after the curves, used for shadow/highlight recovery
    after = [luts[c][sm_arr[..., c]].astype(np.float32) for c in range(3)]
    La = (0.299 * after[0] + 0.587 * after[1] + 0.114 * after[2]) / 255
    info = {"dark": float((La < 0.22).mean()), "bright": float((La > 0.88).mean()), "backlit": backlit}
    return luts, info, tags


def shadows_highlights(out, s, info, tags):
    """Local tone mapping: lift dark areas and pull back bright ones, keeping colours."""
    need_sh = min(1.0, max(0.0, (info["dark"] - 0.04) / 0.22))
    need_hl = min(1.0, max(0.0, (info["bright"] - 0.03) / 0.25))
    amt_sh = min(1.0, s.get("shadows", 0.0) * (0.25 + 0.75 * max(need_sh, info["backlit"])) * (1 + 0.35 * info["backlit"]))
    amt_hl = s.get("highlights", 0.0) * (0.2 + 0.8 * need_hl)
    if amt_sh < 0.02 and amt_hl < 0.02:
        return
    h, w, _ = out.shape
    lum8 = ((out[..., 0].astype(np.uint16) * 77 + out[..., 1].astype(np.uint16) * 150 + out[..., 2].astype(np.uint16) * 29) >> 8).astype(np.uint8)
    f = 8 if max(h, w) > 2000 else 4
    small = Image.fromarray(lum8).resize((max(1, w // f), max(1, h // f)), Image.BOX)
    small = small.filter(ImageFilter.GaussianBlur(max(2.0, max(small.size) / 45)))
    mask = np.asarray(small.resize((w, h), Image.BILINEAR))
    for y0 in range(0, h, 400):
        L = lum8[y0:y0 + 400].astype(np.float32) / 255
        msk = 0.65 * mask[y0:y0 + 400].astype(np.float32) / 255 + 0.35 * L
        gs = 1 - amt_sh * 0.72 * (1 - msk) ** 2          # < 1 brightens the shadows
        Ln = np.power(np.maximum(L, 1e-4), gs)
        gh = 1 - amt_hl * 0.45 * msk ** 2                # recovers the brightest areas
        Ln = 1 - np.power(np.maximum(1 - Ln, 1e-4), gh)
        ratio = np.minimum((Ln + 0.004) / (L + 0.004), 4.0)
        blk = out[y0:y0 + 400].astype(np.float32) * ratio[..., None]
        out[y0:y0 + 400] = np.clip(blk + 0.5, 0, 255).astype(np.uint8)
    if amt_sh >= 0.15:
        tags.append("shadows lifted")
    if amt_hl >= 0.15:
        tags.append("highlights recovered")


def enhance_array(arr, s):
    luts, info, tags = build_luts(arr, s)
    out = np.empty_like(arr)
    for c in range(3):
        out[..., c] = luts[c][arr[..., c]]
    shadows_highlights(out, s, info, tags)
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

UPLOADER_VERSION = 2
APPS_SCRIPT_TEMPLATE = r"""// Rugby Photo Enhancer - Drive uploader (v2). Runs in YOUR Google account.
// It can only work with folders and photos inside the folder below.
const KEY = '%KEY%';
const ROOT_ID = '%ROOT%';
const VERSION = 2;
const MARK = 'Enhanced by Rugby Photo Enhancer';

function doGet() { return out({ok: true, app: 'Rugby Photo Enhancer uploader', version: VERSION}); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.key !== KEY) return out({ok: false, error: 'Wrong key'});
    const root = DriveApp.getFolderById(ROOT_ID);
    const a = req.action;
    if (a === 'ping') return out({ok: true, root: root.getName(), version: VERSION});

    if (a === 'mkdir') {
      const parent = req.parent ? DriveApp.getFolderById(req.parent) : root;
      if (req.parent && !isUnder(parent, root)) return out({ok: false, error: 'Not allowed'});
      const name = String(req.name || '').slice(0, 200);
      if (!name) return out({ok: false, error: 'No name'});
      const it = parent.getFoldersByName(name);
      const existed = it.hasNext();
      const f = existed ? it.next() : parent.createFolder(name);
      return out({ok: true, id: f.getId(), url: f.getUrl(), existed: existed});
    }

    if (a === 'upload') {
      const folder = DriveApp.getFolderById(req.folder);
      if (!isUnder(folder, root)) return out({ok: false, error: 'Not allowed'});
      const same = folder.getFilesByName(req.name);
      while (same.hasNext()) {            // already there (e.g. a retry) - don't duplicate
        const f = same.next();
        if (f.getSize() === req.size) return out({ok: true, id: f.getId(), skipped: true});
      }
      const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'image/jpeg', req.name));
      f.setDescription(MARK);
      return out({ok: true, id: f.getId()});
    }

    if (a === 'folders') {                 // match folders inside Rugby
      const res = [];
      const it = root.getFolders();
      while (it.hasNext()) {
        const f = it.next();
        res.push({id: f.getId(), name: f.getName(), updated: f.getLastUpdated().getTime(), url: f.getUrl()});
      }
      res.sort((x, y) => y.updated - x.updated);
      return out({ok: true, folders: res});
    }

    if (a === 'files') {                   // photos in one folder
      const folder = DriveApp.getFolderById(req.folder);
      if (!isUnder(folder, root)) return out({ok: false, error: 'Not allowed'});
      const res = [];
      const it = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        const m = f.getMimeType();
        if (m !== 'image/jpeg' && m !== 'image/png') continue;
        res.push({id: f.getId(), name: f.getName(), size: f.getSize(), mime: m,
                  modified: f.getLastUpdated().getTime(), enhanced: (f.getDescription() || '').indexOf(MARK) === 0});
      }
      res.sort((x, y) => x.name < y.name ? -1 : 1);
      return out({ok: true, files: res});
    }

    if (a === 'thumb' || a === 'download') {
      const f = DriveApp.getFileById(req.file);
      if (!inRoot(f, root)) return out({ok: false, error: 'Not allowed'});
      let blob = null;
      if (a === 'thumb') { try { blob = f.getThumbnail(); } catch (err) {} }
      if (!blob) blob = f.getBlob();
      return out({ok: true, data: Utilities.base64Encode(blob.getBytes()), full: a === 'download' || !blob});
    }

    if (a === 'replace') {                 // put the enhanced photo in place of the original
      const old = DriveApp.getFileById(req.file);
      if (!inRoot(old, root)) return out({ok: false, error: 'Not allowed'});
      const parent = old.getParents().next();
      const nf = parent.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'image/jpeg', old.getName()));
      nf.setDescription(MARK);
      let trashed = true;
      try { old.setTrashed(true); } catch (err) { trashed = false; nf.setName(old.getName().replace(/(\.[^.]+)$/, '_enhanced$1')); }
      return out({ok: true, id: nf.getId(), trashed: trashed});
    }
    return out({ok: false, error: 'Unknown action - update the uploader script'});
  } catch (err) {
    return out({ok: false, error: String(err)});
  }
}

function inRoot(file, root) {
  const ps = file.getParents();
  while (ps.hasNext()) if (isUnder(ps.next(), root)) return true;
  return false;
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

    def folders(self):
        return self._call({"action": "folders"}, timeout=60)["folders"]

    def files(self, folder_id):
        return self._call({"action": "files", "folder": folder_id}, timeout=120)["files"]

    def fetch(self, file_id, thumb=False):
        import base64
        for attempt in range(3):
            try:
                res = self._call({"action": "thumb" if thumb else "download", "file": file_id}, timeout=60 if thumb else 300)
                return base64.b64decode(res["data"])
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))

    def replace(self, file_id, path):
        import base64
        with open(path, "rb") as f:
            data = f.read()
        mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
        # never retried automatically: a retry after a timeout could leave two copies
        return self._call({"action": "replace", "file": file_id, "mime": mime,
                           "data": base64.b64encode(data).decode("ascii")}, timeout=300)

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
        self.fetch_locks = {}
        self.cache_dir = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "RugbyPhotoEnhancer", "cache")
        os.makedirs(self.cache_dir, exist_ok=True)
        for n in os.listdir(self.cache_dir):            # start each session with an empty cache
            try:
                os.remove(os.path.join(self.cache_dir, n))
            except OSError:
                pass
        self.drive_version = self.cfg.get("uploader_version")
        if self.uploader():
            threading.Thread(target=self._probe_uploader, daemon=True).start()

    def _probe_uploader(self):
        try:
            res = self.uploader().ping()
            self.drive_version = res.get("version", 1)
            with self.cfg_lock:
                self.cfg["uploader_version"] = self.drive_version
                save_config(self.cfg)
        except Exception:
            pass

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
                      "version": self.drive_version or 1, "needed": UPLOADER_VERSION,
                      "action": self.cfg.get("drive_action", "replace"), "skipEnhanced": self.cfg.get("skip_enhanced", True),
                      "folderLink": self.cfg.get("folder_link") or f"https://drive.google.com/drive/folders/{DEFAULT_RUGBY_FOLDER_ID}"},
            "today": date.today().isoformat(), "update": self.update,
            "presets": {n: [v[k] for k in LOOK_KEYS] for n, v in PRESETS.items()},
            "lookKeys": LOOK_KEYS,
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

    def local_copy(self, ph, full):
        """Make sure a Drive photo (thumbnail or full size) is cached on this PC; return its path."""
        if not ph.get("drive"):
            return ph["path"]
        if full and ph.get("path"):
            return ph["path"]
        if not full and (ph.get("path") or ph.get("thumb")):
            return ph.get("path") or ph["thumb"]
        lk = self.fetch_locks.setdefault((ph["drive"], full), threading.Lock())
        with lk:
            if full and ph.get("path"):
                return ph["path"]
            if not full and ph.get("thumb"):
                return ph["thumb"]
            data = self.uploader().fetch(ph["drive"], thumb=not full)
            import hashlib
            fid = hashlib.sha1(ph["drive"].encode()).hexdigest()[:16]
            dst = os.path.join(self.cache_dir, ("full_" if full else "thumb_") + fid + (".png" if ph["name"].lower().endswith(".png") else ".jpg"))
            with open(dst, "wb") as f:
                f.write(data)
            ph["path" if full else "thumb"] = dst
            return dst

    def thumb(self, pid, kind, look, side):
        ph = self.photos.get(pid)
        if not ph:
            return None
        k = (ph["key"], kind, look if kind == "after" else "", side)
        cache = self.thumbs if side <= 600 else self.views
        hit = cache.get(k)
        if hit:
            return hit
        settings = look_from_list(look.split(",")) if kind == "after" else None
        src = self.local_copy(ph, full=side > 600)
        data, tags = make_preview(src, side, settings, quality=80 if side <= 600 else 88)
        if kind == "after":
            self.tags[(pid, look)] = tags
        cache.put(k, data)
        return data

    # ---------- previous uploads in Drive ----------
    def drive_folders(self):
        up = self.uploader()
        if not up:
            return {"ok": False, "error": "setup"}
        try:
            return {"ok": True, "folders": up.folders()}
        except Exception as e:
            if "Unknown action" in str(e):
                return {"ok": False, "error": "update"}
            return {"ok": False, "error": str(e)}

    def drive_load(self, folders, skip_enhanced):
        up = self.uploader()
        out, photos, total, skipped = [], {}, 0, 0
        try:
            for fo in folders:
                for f in up.files(fo["id"]):
                    total += 1
                    if skip_enhanced and f.get("enhanced"):
                        skipped += 1
                        continue
                    pid = "d" + f["id"]
                    photos[pid] = {"drive": f["id"], "folder": fo["id"], "folderName": fo["name"], "folderUrl": fo.get("url", ""),
                                   "name": f["name"], "key": "drive:" + f["id"] + ":" + str(f.get("modified")), "path": None, "thumb": None}
                    out.append({"id": pid, "name": f["name"], "time": fo["name"], "size": f["size"], "imported": False})
        except Exception as e:
            return {"ok": False, "error": str(e)}
        with self.cfg_lock:
            self.cfg["skip_enhanced"] = bool(skip_enhanced)
            save_config(self.cfg)
        self.photos = photos
        return {"ok": True, "photos": out, "total": total, "skipped": skipped}

    def _work_drive(self, ids, looks, quality, action):
        """Re-enhance photos already in Drive: download, enhance, then replace or save to an 'Enhanced' subfolder."""
        from concurrent.futures import ThreadPoolExecutor
        job, lock, up = self.job, threading.Lock(), self.uploader()
        staging = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "RugbyPhotoEnhancer", "staging", "drive")
        os.makedirs(staging, exist_ok=True)
        sub_ids, sub_lock = {}, threading.Lock()
        n_workers = max(1, min(4, (os.cpu_count() or 2) - 1))
        job["message"] = "Downloading…"
        with ProcessPoolExecutor(max_workers=n_workers) as ex:
            def one(pid):
                ph = self.photos[pid]
                try:
                    job["status"][pid] = "downloading"
                    src = self.local_copy(ph, full=True)
                    job["status"][pid] = "working"
                    base, ext = os.path.splitext(ph["name"])
                    import hashlib
                    dst = os.path.join(staging, hashlib.sha1(ph["drive"].encode()).hexdigest()[:16] + (".png" if ext.lower() == ".png" else ".jpg"))
                    tags = ex.submit(process_one, src, dst, looks[pid], quality).result()
                    with lock:
                        job["enh"] += 1
                    job["status"][pid] = "uploading"
                    if action == "subfolder":
                        with sub_lock:
                            if ph["folder"] not in sub_ids:
                                sub_ids[ph["folder"]] = up.mkdir("Enhanced", parent=ph["folder"])["id"]
                        named = os.path.join(staging, base + os.path.splitext(dst)[1])
                        os.replace(dst, named)
                        dst = named
                        up.upload(dst, sub_ids[ph["folder"]])
                        note = ""
                    else:
                        res = up.replace(ph["drive"], dst)
                        note = "" if res.get("trashed", True) else " (original kept - no permission to move it to the Bin)"
                    with lock:
                        job["up"] += 1
                    job["status"][pid] = "done"
                    self._log(f"✓ {ph['folderName']} / {ph['name']}  ({', '.join(tags)}){note}")
                    for pth in (dst, src):
                        try:
                            os.remove(pth)
                        except OSError:
                            pass
                    ph["path"] = None
                except Exception as e:
                    with lock:
                        job["fail"] += 1
                    job["status"][pid], job["errors"][pid] = "error", str(e)
                    self._log(f"✗ {ph['folderName']} / {ph['name']}: {e}")
            with ThreadPoolExecutor(max_workers=3) as pool:
                list(pool.map(one, ids))
        job["message"] = (f"{job['up']} of {job['total']} photos " + ("replaced in Google Drive" if action == "replace" else "saved to ‘Enhanced’ folders")
                          + (f" — {job['fail']} failed, run again to retry them" if job["fail"] else ""))
        job["running"] = False
        job["finished"] = True

    # ---------- the run ----------
    def run(self, req):
        with self.job_lock:
            if self.job.get("running"):
                return {"ok": False, "error": "Already running"}
            ids = [i for i in req.get("ids", []) if i in self.photos]
            if req.get("source") == "drive":
                if not ids:
                    return {"ok": False, "error": "No photos selected"}
                if not self.uploader():
                    return {"ok": False, "error": "setup"}
                s = req.get("settings", {})
                self.save_settings(s)
                action = "subfolder" if req.get("action") == "subfolder" else "replace"
                with self.cfg_lock:
                    self.cfg["drive_action"] = action
                    save_config(self.cfg)
                default = PRESETS.get(s.get("preset"), PRESETS["Balanced"])
                given = req.get("looks") or {}
                looks = {i: (look_from_list(given[i]) if i in given else dict(default)) for i in ids}
                folders = {self.photos[i]["folderUrl"] for i in ids}
                self.job = {"running": True, "total": len(ids), "enh": 0, "up": 0, "fail": 0, "direct": True,
                            "status": {i: "queued" for i in ids}, "errors": {}, "log": [], "name": "",
                            "open": folders.pop() if len(folders) == 1 else "", "started": time.time(), "message": "Starting…"}
                threading.Thread(target=self._work_drive, args=(ids, looks, int(s.get("quality", 93)), action), daemon=True).start()
                return {"ok": True}
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
        default = PRESETS.get(s.get("preset"), PRESETS["Balanced"])
        given = req.get("looks") or {}
        looks = {i: (look_from_list(given[i]) if i in given else dict(default)) for i in ids}
        threading.Thread(target=self._work, args=(ids, name, s, direct, up, out_dir, looks), daemon=True).start()
        return {"ok": True}

    def _log(self, t):
        self.job["log"] = (self.job["log"] + [t])[-200:]

    def _work(self, ids, name, s, direct, up, out_dir, looks):
        from concurrent.futures import ThreadPoolExecutor
        job, lock = self.job, threading.Lock()
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
                futs[ex.submit(process_one, ph["path"], dst, looks[pid], quality)] = (pid, dst)
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
        url = (url or "").strip() or self.cfg.get("upload_url", "")
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
            self.drive_version = res.get("version", 1)
            self.cfg.update(upload_url=url, upload_key=key, drive_root_name=res.get("root", ""), uploader_version=self.drive_version,
                            folder_link=self.cfg.get("pending_link") or self.cfg.get("folder_link"))
            self.cfg.pop("pending_key", None)
            save_config(self.cfg)
        return {"ok": True, "root": res.get("root", ""), "version": self.drive_version}

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
    from urllib.parse import urlparse, parse_qs, unquote

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
                pid = unquote(p[len("/img/"):])
                kind = q.get("kind", "before")
                side = 1600 if q.get("size") == "view" else 420
                look = q.get("s") or ",".join(str(PRESETS["Balanced"][k]) for k in LOOK_KEYS)
                try:
                    data = app.thumb(pid, kind, look, side)
                except Exception as e:
                    return self._send(500, {"error": str(e)})
                if data is None:
                    return self._send(404, {"error": "unknown photo"})
                return self._send(200, data, "image/jpeg", cache=True)
            if p.startswith("/api/info/"):
                pid = unquote(p[len("/api/info/"):])
                return self._send(200, {"tags": app.tags.get((pid, q.get("s", "")), [])})
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
            if p == "/api/drive/folders":
                return self._send(200, app.drive_folders())
            if p == "/api/drive/load":
                return self._send(200, app.drive_load(body.get("folders", []), body.get("skipEnhanced", True)))
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
  .cmp img{display:block;max-width:calc(100vw - 352px);max-height:calc(100vh - 92px);object-fit:contain}
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
  .tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:3px;margin-bottom:16px}
  .tabs button{border:0;background:transparent;border-radius:8px;padding:8px 0;cursor:pointer;color:var(--muted);font-weight:600}
  .tabs button.on{background:#33302a;color:var(--accent2);box-shadow:inset 0 0 0 1px #5b4a25}
  .flist{max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:9px;background:var(--panel2)}
  .flist label{display:flex;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line);cursor:pointer}
  .flist label:last-child{border-bottom:0}
  .flist label span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .flist label small{color:var(--muted)}
  .flist input{accent-color:var(--accent)}
  .note{color:var(--muted);font-size:12.5px;margin:6px 0}
  .lookchip{position:absolute;left:8px;bottom:8px;z-index:2;font-size:11px;padding:2px 7px;border-radius:20px;background:rgba(242,181,68,.9);color:#1b1404;font-weight:600}
  /* viewer with look panel */
  .mbody{flex:1;display:flex;min-height:0}
  .mbody .stage{flex:1}
  .panel{width:300px;flex:none;background:var(--panel);border-left:1px solid var(--line);padding:16px;overflow:auto}
  .panel h4{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
  .panel .seg{grid-template-columns:repeat(4,1fr);margin-bottom:6px}
  .panel .seg button{font-size:12.5px}
  .sl{margin:11px 0}
  .sl label{display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px}
  .sl label b{font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
  .sl input{width:100%;accent-color:var(--accent)}
  .sl.extra label{color:var(--accent2)}
  .upd{position:absolute;right:10px;bottom:10px;font-size:12px;background:rgba(0,0,0,.65);padding:3px 9px;border-radius:6px;display:none}
  .upd.on{display:block}
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand"><div class="logo">R</div><div><h1>Rugby Photo Enhancer</h1><small id="ver"></small></div></div>

    <div class="tabs" id="srcTabs"><button data-s="card" class="on">Camera card</button><button data-s="drive">Google Drive</button></div>

    <div class="sec gone" id="driveSec">
      <h2>Earlier uploads in Rugby</h2>
      <div id="driveFolders"><div class="note">Loading folders…</div></div>
      <label class="chk"><input type="checkbox" id="skipEnhanced"> Skip photos already enhanced</label>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="driveLoad">Load photos</button><button class="btn ghost sm" id="driveAll">Select all</button></div>
      <h2 style="margin-top:16px">When enhanced</h2>
      <label class="chk"><input type="radio" name="driveAction" value="replace"> Replace the photos in Drive</label>
      <div class="note" style="margin-left:23px">Originals go to Drive’s Bin (restore within 30 days).</div>
      <label class="chk"><input type="radio" name="driveAction" value="subfolder"> Save to an “Enhanced” subfolder</label>
    </div>

    <div class="sec" id="cardSec">
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

    <div class="sec" id="destSec">
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
      <div class="namebox" id="nameBox">
        <label for="folderName">New folder in Rugby</label>
        <input type="text" id="folderName" placeholder="e.g. Dungannon 14 11 26" spellcheck="false">
      </div>
      <div class="namebox gone" id="driveBox"><label>Improving earlier uploads</label><div style="font-size:18px;padding:9px 0" id="driveSummary">Pick folders on the left, then Load photos.</div></div>
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
  <div class="mbody">
    <div class="stage">
      <div class="cmp" id="cmp">
        <img id="imgAfter" alt="Enhanced">
        <img id="imgBefore" class="before" alt="Original">
        <div class="handle" id="handle"></div>
        <span class="lbl l">Original</span><span class="lbl r">Enhanced</span>
        <div class="loading" id="mLoad">Loading…</div>
        <div class="upd" id="mUpd">Updating…</div>
      </div>
    </div>
    <div class="panel">
      <h4>Look for this photo</h4>
      <div class="seg" id="mLooks"><button data-l="">Default</button><button data-l="Gentle">Gentle</button><button data-l="Balanced">Balanced</button><button data-l="Punchy">Punchy</button></div>
      <div class="note" id="mLookNote"></div>
      <div id="sliders"></div>
      <div class="row" style="margin-top:14px;flex-wrap:wrap">
        <button class="btn ghost sm" id="mReset">Reset</button>
        <button class="btn ghost sm" id="mApplyAll">Use on all selected</button>
      </div>
      <div class="note" style="margin-top:12px">Changes are used for this photo when you upload. Keys: ← → next/previous, X exclude.</div>
    </div>
  </div>
</div>

<div class="dlg" id="setup">
  <div class="card">
    <h3 id="setupTitle">Connect to Google Drive</h3>
    <p id="setupIntro">One-time setup, about 3 minutes. It creates a private uploader in your own Google account that can only add folders and photos inside your Rugby folder.</p>
    <div class="note gone" id="updateSteps" style="font-size:13.5px;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:14px">
      <b>Updating an existing uploader (about 1 minute):</b> click <b>Copy script</b> below, open your existing script at
      script.google.com, select all its code and paste over it, save, then <b>Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy</b>.
      The URL stays the same — just click <b>Test &amp; save</b>.
    </div>
    <div class="row gone" id="updLinkRow" style="margin-bottom:12px"><button class="btn sm" id="copyScript2">Copy new script</button><button class="btn ghost sm" id="openScript2">Open my Apps Script projects</button></div>
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

<div class="dlg" id="confirm">
  <div class="card" style="width:min(460px,94vw)">
    <h3>Replace photos in Drive?</h3>
    <p id="confirmText"></p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="confirmNo">Cancel</button><button class="btn" id="confirmYes">Replace</button></div>
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
  let S = null, photos = [], show = "after", running = false, lastStatus = {}, source = "card", driveFolderList = [];
  const fmtEta = s => s == null ? "" : s < 60 ? `about ${s}s left` : `about ${Math.floor(s/60)}m ${s%60}s left`;
  let tt; const toast = t => { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => e.classList.remove("show"), 3200); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  /* ---------- looks ---------- */
  const SL = [
    ["strength","Overall strength",0,100], ["colour","Colour correction",0,100], ["exposure","Exposure fix",0,100],
    ["contrast","Contrast",0,100], ["vibrance","Vibrance",0,100], ["sharpen","Sharpen",0,100],
    ["shadows","Shadows (lift dark areas)",0,100], ["highlights","Highlights (recover sky)",0,100],
    ["bright","Brightness",-100,100,true], ["warmth","Warmth",-100,100,true],
  ];
  const globalPreset = () => document.querySelector("#presets .on").dataset.p;
  const lookVals = p => (p.look && p.look.vals) || S.presets[(p.look && p.look.preset) || globalPreset()];
  const lookStr = p => lookVals(p).map(v => +(+v).toFixed(3)).join(",");
  const lookName = p => !p.look ? "" : p.look.vals ? "Custom" : p.look.preset;

  /* ---------- settings ---------- */
  function settings(){
    return {
      source: $("source").value.trim(), onlyDate: $("onlyDate").checked, skip: $("skip").checked,
      preset: globalPreset(), quality: +$("quality").value,
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
    $("driveState").innerHTML = S.drive.ok ? `<span class="pill ok">✓ Connected${S.drive.root ? " to “" + esc(S.drive.root) + "”" : ""}</span> <button class="link" id="reSetup">change</button>`
                                           : `<span class="pill bad">Not set up</span> <button class="link" id="reSetup">Set up…</button>`;
    $("reSetup").onclick = e => { e.stopPropagation(); openSetup(); };
    updateGo();
  }

  async function init(){
    S = await api("/api/state");
    const st = S.settings;
    $("ver").textContent = "Version " + S.version;
    $("source").value = st.source; $("onlyDate").checked = st.onlyDate; $("skip").checked = st.skip;
    $("day").value = S.today; $("quality").value = String(st.quality);
    $("keepLocal").checked = st.keepLocal; $("localDir").value = st.localDir; $("dest").value = st.dest;
    $("keepOriginals").checked = st.keepOriginals; $("skipEnhanced").checked = S.drive.skipEnhanced;
    document.querySelector(`input[name=driveAction][value=${S.drive.action === "subfolder" ? "subfolder" : "replace"}]`).checked = true;
    document.querySelector(`input[name=mode][value=${st.mode === "folder" ? "folder" : "direct"}]`).checked = true;
    $("presets").innerHTML = Object.keys(S.presets).map(p => `<button data-p="${p}" class="${p === st.preset ? "on" : ""}">${p}</button>`).join("");
    const d = new Date(); $("folderName").value = [d.getDate(), d.getMonth()+1, d.getFullYear()%100].map(n => String(n).padStart(2,"0")).join(" ");
    $("folderLink").value = S.drive.folderLink;
    buildSliders();
    paintDest(); paintUpdate(S.update);
    $("folderName").focus(); $("folderName").setSelectionRange(0, 0);
    scan();
    if (st.mode !== "folder" && !S.drive.ok) setTimeout(() => openSetup(), 500);
  }

  /* ---------- sidebar events ---------- */
  ["source","day","onlyDate","skip"].forEach(id => $(id).addEventListener("change", () => { saveSettings(); scan(); }));
  ["quality","keepLocal","localDir","dest","keepOriginals"].forEach(id => $(id).addEventListener("change", saveSettings));
  $("presets").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#presets button").forEach(x => x.classList.toggle("on", x === b));
    saveSettings(); refreshImages(p => !p.look);
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
  document.querySelectorAll("input[name=driveAction]").forEach(r => r.addEventListener("change", updateGo));

  /* ---------- source switch ---------- */
  $("srcTabs").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || running) return;
    source = b.dataset.s;
    $("srcTabs").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    const drive = source === "drive";
    $("driveSec").classList.toggle("gone", !drive); $("cardSec").classList.toggle("gone", drive); $("destSec").classList.toggle("gone", drive);
    $("nameBox").classList.toggle("gone", drive); $("driveBox").classList.toggle("gone", !drive);
    $("rescan").classList.toggle("gone", drive);
    photos = []; lastStatus = {}; $("openBtn").classList.add("gone"); $("bar").style.width = "0";
    if (drive) { $("grid").innerHTML = `<div class="empty"><div class="big">Choose earlier match folders</div>Tick folders on the left, then click Load photos.</div>`; setStatus(""); loadDriveFolders(); }
    else scan();
    updateCount();
  });

  async function loadDriveFolders(){
    if (!S.drive.ok) { $("driveFolders").innerHTML = `<div class="note">Connect Google Drive first. <button class="link" onclick="">Set up…</button></div>`; $("driveFolders").querySelector("button").onclick = () => openSetup(); return; }
    if ((S.drive.version || 1) < S.drive.needed) { needUpdate(); return; }
    $("driveFolders").innerHTML = `<div class="note">Loading folders…</div>`;
    const r = await api("/api/drive/folders", {});
    if (!r.ok) { if (r.error === "update") needUpdate(); else $("driveFolders").innerHTML = `<div class="note">${esc(r.error)}</div>`; return; }
    driveFolderList = r.folders;
    if (!r.folders.length) { $("driveFolders").innerHTML = `<div class="note">No folders in Rugby yet.</div>`; return; }
    $("driveFolders").innerHTML = `<div class="flist">` + r.folders.map((f, i) => `<label><input type="checkbox" data-i="${i}"><span>${esc(f.name)}</span><small>${new Date(f.updated).toLocaleDateString("en-GB")}</small></label>`).join("") + `</div>`;
  }
  function needUpdate(){
    $("driveFolders").innerHTML = `<div class="note" style="color:var(--accent2)">Your Drive uploader needs a 1-minute update to read earlier uploads.</div><button class="btn sm" id="doUpd">Update uploader…</button>`;
    $("doUpd").onclick = () => openSetup(true);
  }
  $("driveAll").onclick = () => document.querySelectorAll("#driveFolders input[type=checkbox]").forEach(c => c.checked = true);
  $("driveLoad").onclick = async () => {
    const chosen = [...document.querySelectorAll("#driveFolders input[type=checkbox]:checked")].map(c => driveFolderList[+c.dataset.i]);
    if (!chosen.length) { toast("Tick at least one folder"); return; }
    $("grid").innerHTML = `<div class="empty"><div class="big">Reading ${chosen.length} folder${chosen.length > 1 ? "s" : ""} from Drive…</div></div>`;
    const r = await api("/api/drive/load", {folders: chosen, skipEnhanced: $("skipEnhanced").checked});
    lastStatus = {};
    if (!r.ok) { photos = []; $("grid").innerHTML = `<div class="empty"><div class="big">${esc(r.error)}</div></div>`; updateCount(); return; }
    photos = r.photos.map(p => Object.assign(p, {include: true, look: null}));
    $("driveSummary").textContent = `${chosen.length === 1 ? chosen[0].name : chosen.length + " folders"} · ${r.total} photos` + (r.skipped ? ` (${r.skipped} already enhanced)` : "");
    if (!photos.length) $("grid").innerHTML = `<div class="empty"><div class="big">Nothing to improve</div>${r.skipped ? "Every photo there has already been enhanced. Untick “Skip photos already enhanced” to redo them." : "No JPG/PNG photos in those folders."}</div>`;
    else renderGrid();
    setStatus(photos.length ? "Click any photo to compare and fine-tune. Previews come from Drive, so they may take a moment." : "");
    updateCount();
  };

  /* ---------- photos (card) ---------- */
  async function scan(){
    if (running || source !== "card") return;
    $("grid").innerHTML = `<div class="empty"><div class="big">Reading the card…</div></div>`;
    const s = settings();
    const r = await api("/api/scan", {source: s.source, onlyDate: s.onlyDate, date: $("day").value, skip: s.skip});
    lastStatus = {};
    if (!r.ok) { photos = []; $("grid").innerHTML = `<div class="empty"><div class="big">${esc(r.error)}</div>Check the card is in, or click Browse to pick the folder.</div>`; setStatus(""); updateCount(); return; }
    photos = r.photos.map(p => Object.assign(p, {include: true, look: null}));
    if (!photos.length) {
      const why = s.onlyDate ? "No photos taken on that date" + (s.skip ? " that haven't already been imported" : "") : "No new photos on the card";
      $("grid").innerHTML = `<div class="empty"><div class="big">${why}</div>${r.total} photos on the card in total. Try another date, or untick the filters on the left.</div>`;
    } else renderGrid();
    setStatus(photos.length ? "Click any photo to compare before/after and fine-tune it. Untick any you don't want." : "");
    updateCount();
  }
  const imgURL = (p, kind, size) => `/img/${encodeURIComponent(p.id)}?t=${T}&kind=${kind}&s=${lookStr(p)}${size ? "&size=" + size : ""}`;

  function renderGrid(){
    const g = $("grid"); g.innerHTML = "";
    const io = new IntersectionObserver(ents => ents.forEach(en => {
      if (!en.isIntersecting) return;
      const img = en.target; io.unobserve(img); img.src = img.dataset.src;
    }), {root: g, rootMargin: "400px"});
    photos.forEach((p, i) => {
      const t = document.createElement("div"); t.className = "tile" + (p.include ? "" : " off");
      t.innerHTML = `<div class="thumb"><img alt=""><div class="sel" title="Include / exclude"></div><span class="badge gone"></span><span class="lookchip gone"></span></div>
        <div class="meta"><span class="n"></span><span class="tm"></span></div>`;
      t.querySelector(".n").textContent = p.name; t.querySelector(".tm").textContent = p.time;
      const img = t.querySelector("img"); img.dataset.src = imgURL(p, show);
      img.onload = () => img.classList.add("ld");
      io.observe(img);
      t.querySelector(".sel").onclick = e => { e.stopPropagation(); toggle(i); };
      t.querySelector(".thumb").onclick = () => openViewer(i);
      p.el = t; g.appendChild(t);
      paintBadge(p); paintChip(p);
    });
  }
  function refreshTile(p){
    const img = p.el && p.el.querySelector("img"); if (!img) return;
    const u = imgURL(p, show);
    if (img.src) { img.classList.remove("ld"); img.src = u; } else img.dataset.src = u;
    paintChip(p);
  }
  function refreshImages(filter){
    photos.forEach(p => { if (!filter || filter(p)) refreshTile(p); });
    if ($("modal").classList.contains("open")) openViewer(cur, true);
  }
  function paintChip(p){
    const c = p.el && p.el.querySelector(".lookchip"); if (!c) return;
    const n = lookName(p); c.textContent = n; c.classList.toggle("gone", !n);
  }
  function toggle(i){
    if (running) return;
    const p = photos[i]; if (!p || p.done) return;
    p.include = !p.include; p.el.classList.toggle("off", !p.include);
    updateCount(); if (cur === i) $("mToggle").textContent = p.include ? "Exclude" : "Include";
  }
  $("selAll").onclick = () => { if (running) return; photos.forEach(p => { if (p.done) return; p.include = true; p.el.classList.remove("off"); }); updateCount(); };
  $("selNone").onclick = () => { if (running) return; photos.forEach(p => { p.include = false; p.el.classList.add("off"); }); updateCount(); };
  $("rescan").onclick = () => scan();
  $("showSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    show = b.dataset.k;
    $("showSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    refreshImages();
  });
  function updateCount(){
    const n = photos.filter(p => p.include).length;
    $("count").innerHTML = photos.length ? `<b>${n}</b> of ${photos.length} selected` : "";
    updateGo();
  }
  function updateGo(){
    if (!S) return;
    const n = photos.filter(p => p.include).length;
    let verb;
    if (source === "drive") verb = document.querySelector("input[name=driveAction]:checked").value === "replace" ? "replace" : "save";
    else verb = settings().mode === "direct" ? "upload" : "save";
    $("go").textContent = running ? "Working…" : n ? `Enhance & ${verb} ${n} photo${n === 1 ? "" : "s"}` : `Enhance & ${verb}`;
    $("go").disabled = running || !n || (source === "card" && !$("folderName").value.trim());
  }
  const BADGE = {queued:["Queued","work"], downloading:["Downloading…","up"], working:["Enhancing…","work"], uploading:["Uploading…","up"], done:["✓ Done","ok"], error:["✗ Failed","bad"]};
  function paintBadge(p){
    const b = p.el && p.el.querySelector(".badge"); if (!b) return;
    const st = lastStatus[p.id];
    p.el.classList.toggle("isdone", st === "done");
    if (!st) { b.className = "badge gone"; return; }
    const [txt, cls] = BADGE[st] || [st, ""];
    b.className = "badge " + cls;
    b.textContent = st === "done" ? (source === "drive" ? "✓ Improved" : settings().mode === "direct" ? "✓ In Drive" : "✓ Saved") : txt;
    b.title = st === "error" && p.err ? p.err : "";
  }
  function setStatus(t, eta){ $("status").textContent = t || ""; $("eta").textContent = eta || ""; }

  /* ---------- run ---------- */
  $("go").onclick = async () => {
    const chosen = photos.filter(p => p.include);
    const looks = {}; chosen.forEach(p => looks[p.id] = lookVals(p));
    const body = {ids: chosen.map(p => p.id), looks, settings: settings(), source};
    if (source === "drive") {
      body.action = document.querySelector("input[name=driveAction]:checked").value;
      if (body.action === "replace" && !confirmReplace) { askReplace(chosen.length); return; }
    } else body.name = $("folderName").value.trim();
    confirmReplace = false;
    const r = await api("/api/run", body);
    if (!r.ok) { if (r.error === "setup") openSetup(); else toast(r.error); return; }
    running = true; updateGo(); $("openBtn").classList.add("gone");
    poll();
  };
  let confirmReplace = false;
  function askReplace(n){
    $("setupMsg").textContent = "";
    $("confirmText").textContent = `Replace ${n} photo${n === 1 ? "" : "s"} in Google Drive with enhanced versions? The originals go to Drive’s Bin, where you can restore them for 30 days.`;
    $("confirm").classList.add("open");
  }
  $("confirmNo").onclick = () => $("confirm").classList.remove("open");
  $("confirmYes").onclick = () => { $("confirm").classList.remove("open"); confirmReplace = true; $("go").click(); };

  async function poll(){
    const j = await api("/api/job");
    lastStatus = j.status || {};
    photos.forEach(p => { p.err = (j.errors || {})[p.id]; paintBadge(p); });
    $("bar").style.width = ((j.running ? j.progress || 0 : (j.finished ? 1 : 0)) * 100) + "%";
    if (j.running) {
      const t = j.direct ? `Enhanced ${j.enh} of ${j.total} · Uploaded ${j.up} of ${j.total}` : `Enhanced ${j.enh} of ${j.total}`;
      setStatus(j.enh === 0 && j.up === 0 ? j.message : t, fmtEta(j.eta));
      setTimeout(poll, 700);
    } else {
      running = false;
      photos.forEach(p => { if (lastStatus[p.id] === "done") { p.include = false; p.done = true; } });
      updateCount(); updateGo();
      setStatus(j.message || "Done.", "");
      if (j.open) { $("openBtn").classList.remove("gone"); $("openBtn").textContent = j.direct ? "Open in Google Drive" : "Open folder"; $("openBtn").onclick = () => api("/api/open", {target: j.open}); }
      if (j.finished) toast(j.fail ? "Finished with some failures — click the button again to retry them" : "All done!");
    }
  }

  /* ---------- viewer ---------- */
  let cur = -1, split = 50, sliderT = null, viewSeq = 0;
  function buildSliders(){
    $("sliders").innerHTML = SL.map(([k, label, mn, mx, extra]) =>
      `<div class="sl${extra ? " extra" : ""}"><label>${label} <b id="v_${k}"></b></label><input type="range" min="${mn}" max="${mx}" id="s_${k}"></div>`).join("");
    SL.forEach(([k]) => $("s_" + k).addEventListener("input", () => {
      const p = photos[cur]; if (!p) return;
      p.look = {vals: SL.map(([kk]) => +$("s_" + kk).value / 100)};
      paintPanel(p);
      clearTimeout(sliderT); sliderT = setTimeout(() => { loadAfter(p); refreshTile(p); }, 220);
    }));
  }
  function paintPanel(p){
    const vals = lookVals(p);
    SL.forEach(([k], i) => { const v = Math.round(vals[i] * 100); $("s_" + k).value = v; $("v_" + k).textContent = (SL[i][2] < 0 && v > 0 ? "+" : "") + v; });
    const cur = p.look ? (p.look.vals ? "custom" : p.look.preset) : "";
    $("mLooks").querySelectorAll("button").forEach(b => b.classList.toggle("on", cur !== "custom" && b.dataset.l === cur));
    $("mLookNote").textContent = !p.look ? `Following the default look (${globalPreset()}).` : p.look.vals ? "Custom look for this photo." : `${p.look.preset} look for this photo.`;
  }
  $("mLooks").addEventListener("click", e => {
    const b = e.target.closest("button"); const p = photos[cur]; if (!b || !p) return;
    p.look = b.dataset.l ? {preset: b.dataset.l} : null;
    paintPanel(p); loadAfter(p); refreshTile(p);
  });
  $("mReset").onclick = () => { const p = photos[cur]; if (!p) return; p.look = null; paintPanel(p); loadAfter(p); refreshTile(p); };
  $("mApplyAll").onclick = () => {
    const p = photos[cur]; if (!p) return;
    const lk = p.look ? JSON.parse(JSON.stringify(p.look)) : null; let n = 0;
    photos.forEach(q => { if (q.include && q !== p && !q.done) { q.look = lk ? JSON.parse(JSON.stringify(lk)) : null; refreshTile(q); n++; } });
    toast(`Look copied to ${n} other selected photo${n === 1 ? "" : "s"}`);
  };
  function loadAfter(p){
    const seq = ++viewSeq; $("mUpd").classList.add("on");
    const im = new Image();
    im.onload = () => { if (seq !== viewSeq) return; $("imgAfter").src = im.src; $("mUpd").classList.remove("on"); loadTags(p); };
    im.onerror = () => { if (seq === viewSeq) $("mUpd").classList.remove("on"); };
    im.src = imgURL(p, "after", "view");
  }
  function loadTags(p){
    const i = cur;
    api(`/api/info/${encodeURIComponent(p.id)}?s=${lookStr(p)}`).then(r => { if (cur === i) $("mTags").textContent = r.tags.length ? "Changes: " + r.tags.join(", ") : "No changes"; });
  }
  function openViewer(i, keepSplit){
    const p = photos[i]; if (!p) return;
    cur = i;
    $("mName").textContent = `${p.name} · ${p.time} · ${(p.size/1048576).toFixed(1)} MB`;
    $("mTags").textContent = "";
    $("mToggle").textContent = p.include ? "Exclude" : "Include";
    $("mLoad").style.display = "";
    paintPanel(p);
    let n = 0; const done = () => { if (++n === 2) { $("mLoad").style.display = "none"; loadTags(p); } };
    $("imgAfter").onload = done; $("imgBefore").onload = done;
    $("imgAfter").src = imgURL(p, "after", "view"); $("imgBefore").src = imgURL(p, "before", "view");
    $("modal").classList.add("open"); if (!keepSplit) setSplit(split);
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
    if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if ($("modal").classList.contains("open")) {
      if (e.key === "Escape") $("mClose").click();
      if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      if (e.key.toLowerCase() === "x") { e.preventDefault(); toggle(cur); }
    } else if ($("setup").classList.contains("open") && e.key === "Escape") $("setupClose").click();
  });

  /* ---------- Drive setup / update ---------- */
  function openSetup(update){
    update = update === true;
    $("setupTitle").textContent = update ? "Update your Drive uploader" : "Connect to Google Drive";
    $("setupIntro").classList.toggle("gone", update); $("updateSteps").classList.toggle("gone", !update);
    document.querySelector("#setup .steps").classList.toggle("gone", update);
    $("updLinkRow").classList.toggle("gone", !update);
    $("setupMsg").textContent = ""; $("setup").classList.add("open");
  }
  $("setupClose").onclick = () => $("setup").classList.remove("open");
  const copyScript = async () => {
    const r = await api("/api/setup/script", {link: $("folderLink").value.trim()});
    if (!r.ok) { msg(r.error, "bad"); return; }
    try { await navigator.clipboard.writeText(r.script); msg("Script copied — now paste it into Apps Script.", "ok"); }
    catch (e) { msg("Couldn't copy automatically.", "bad"); }
  };
  $("copyScript").onclick = copyScript; $("copyScript2").onclick = copyScript;
  $("openScript").onclick = () => api("/api/open", {target: "https://script.google.com/home/projects/create"});
  $("openScript2").onclick = () => api("/api/open", {target: "https://script.google.com/home/my"});
  $("setupTest").onclick = async () => {
    msg("Testing…", ""); $("setupTest").disabled = true;
    const url = $("scriptUrl").value.trim() || (S.drive.url || "");
    const r = await api("/api/setup/test", {url: url || ""});
    $("setupTest").disabled = false;
    if (!r.ok) { msg("Didn't work: " + r.error, "bad"); return; }
    if ((r.version || 1) < S.drive.needed) { msg("Connected, but it's still the old script — paste the new code and deploy a New version.", "bad"); return; }
    msg(`✓ Connected to “${r.root}”. All set!`, "ok");
    S.drive.ok = true; S.drive.root = r.root; S.drive.version = r.version;
    paintDest(); saveSettings();
    if (source === "drive") loadDriveFolders();
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
