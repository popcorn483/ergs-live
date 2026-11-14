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
APP_VERSION = "1.5.0"
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
                    out.append({"id": pid, "name": f["name"], "time": "", "folder": fo["name"], "size": f["size"], "imported": False})
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
            if u.path in ("/favicon.ico", "/favicon.png"):
                import base64
                return self._send(200, base64.b64decode(FAVICON_PNG_B64), "image/png", cache=True)
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
    threading.Thread(target=install_icon, args=(app.cfg,), daemon=True).start()
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


ICON_VERSION = 1
ICON_ICO_B64 = "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"
FAVICON_PNG_B64 = "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"


def install_icon(cfg):
    """Write the app icon next to the app and point the Desktop/Start-menu shortcuts at it (once per icon version)."""
    if os.name != "nt":
        return
    import base64
    import subprocess
    try:
        d = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "RugbyPhotoEnhancer")
        os.makedirs(d, exist_ok=True)
        ico = os.path.join(d, "app.ico")
        data = base64.b64decode(ICON_ICO_B64)
        if not os.path.exists(ico) or os.path.getsize(ico) != len(data):
            with open(ico, "wb") as f:
                f.write(data)
        if cfg.get("icon_version") == ICON_VERSION:
            return
        ps = ("$ws=New-Object -ComObject WScript.Shell;"
              "foreach($p in @([Environment]::GetFolderPath('Desktop'),(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))){"
              "$f=Join-Path $p 'Rugby Photo Enhancer.lnk'; if(Test-Path $f){$s=$ws.CreateShortcut($f); $s.IconLocation='" + ico + ",0'; $s.Save()}}")
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=30, check=False)
        cfg["icon_version"] = ICON_VERSION
        save_config(cfg)
    except Exception:
        pass


UI_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rugby Photo Enhancer</title>
<link rel="icon" type="image/png" href="/favicon.png">
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
  .grid{flex:1;min-height:0;overflow:auto;padding:4px 22px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));grid-auto-rows:max-content;gap:12px;align-content:start}
  .tile{min-height:max-content}
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
  .ghead{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:10px 2px 2px;border-bottom:1px solid var(--line);margin-top:6px}
  .ghead:first-child{margin-top:0}
  .ghead b{font-size:15px}
  .ghead .count{flex:1}
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
    <div class="brand"><img src="/favicon.png" alt="" style="width:38px;height:38px;border-radius:9px"><div><h1>Rugby Photo Enhancer</h1><small id="ver"></small></div></div>

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
      <div class="note" style="margin-left:23px">Each photo stays with its own match folder, even when several folders are selected.</div>
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
    const multi = new Set(photos.map(p => p.folder || "")).size > 1;
    let lastFolder = null;
    photos.forEach((p, i) => {
      if (multi && p.folder !== lastFolder) {
        lastFolder = p.folder;
        const n = photos.filter(q => q.folder === p.folder).length;
        const h = document.createElement("div"); h.className = "ghead";
        h.innerHTML = `<b></b><span class="count">${n} photo${n === 1 ? "" : "s"}</span><button class="btn ghost sm">Select all</button><button class="btn ghost sm">None</button>`;
        h.querySelector("b").textContent = "📁 " + p.folder;
        const [all, none] = h.querySelectorAll("button"), f = p.folder;
        all.onclick = () => setFolder(f, true); none.onclick = () => setFolder(f, false);
        g.appendChild(h);
      }
      const t = document.createElement("div"); t.className = "tile" + (p.include ? "" : " off");
      t.innerHTML = `<div class="thumb"><img alt=""><div class="sel" title="Include / exclude"></div><span class="badge gone"></span><span class="lookchip gone"></span></div>
        <div class="meta"><span class="n"></span><span class="tm"></span></div>`;
      t.querySelector(".n").textContent = p.name; t.querySelector(".tm").textContent = p.time || (multi ? "" : p.folder || "");
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
  function setFolder(f, on){
    if (running) return;
    photos.forEach(p => { if (p.folder === f && !p.done) { p.include = on; p.el.classList.toggle("off", !on); } });
    updateCount();
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
    $("mName").textContent = `${p.folder ? p.folder + " / " : ""}${p.name}${p.time ? " · " + p.time : ""} · ${(p.size/1048576).toFixed(1)} MB`;
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
