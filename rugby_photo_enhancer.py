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
APP_VERSION = "1.2.0"
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
# Window
# --------------------------------------------------------------------------
def run_app():
    import secrets
    import tkinter as tk
    import webbrowser
    from concurrent.futures import ThreadPoolExecutor
    from tkinter import ttk, filedialog, messagebox

    cfg = load_config()
    root = tk.Tk()
    root.title(f"{APP_NAME}  v{APP_VERSION}")
    root.geometry("760x720")
    root.minsize(680, 640)
    try:
        root.tk.call("tk", "scaling", 1.3)
    except Exception:
        pass
    style = ttk.Style()
    if "vista" in style.theme_names():
        style.theme_use("vista")
    style.configure("Big.TButton", font=("Segoe UI", 11, "bold"), padding=8)
    style.configure("Head.TLabel", font=("Segoe UI", 16, "bold"))
    style.configure("Ok.TLabel", foreground="#1e7d3c")
    style.configure("Bad.TLabel", foreground="#b3261e")

    frm = ttk.Frame(root, padding=16)
    frm.pack(fill="both", expand=True)
    frm.columnconfigure(1, weight=1)

    ttk.Label(frm, text=APP_NAME, style="Head.TLabel").grid(row=0, column=0, columnspan=3, sticky="w")
    ttk.Label(frm, text="Card → enhance → new folder in your Rugby Google Drive folder. Photos on the card are never changed.",
              foreground="#555").grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 10))

    today = date.today()
    src_var = tk.StringVar(value=cfg.get("source", DEFAULT_SOURCE))
    mode_var = tk.StringVar(value=cfg.get("mode", "direct"))
    dst_var = tk.StringVar(value=cfg.get("dest") or find_drive_rugby_folder())
    local_var = tk.StringVar(value=cfg.get("local_copy_dir") or os.path.join(os.path.expanduser("~"), "Pictures", "Rugby Photos"))
    keep_local_var = tk.BooleanVar(value=cfg.get("keep_local", True))
    name_var = tk.StringVar(value=today.strftime("%d %m %y"))
    only_date_var = tk.BooleanVar(value=cfg.get("only_date", True))
    date_var = tk.StringVar(value=today.strftime("%d/%m/%Y"))
    skip_var = tk.BooleanVar(value=cfg.get("skip_imported", True))
    keep_orig_var = tk.BooleanVar(value=cfg.get("keep_originals", False))
    preset_var = tk.StringVar(value=cfg.get("preset", "Balanced"))
    quality_var = tk.StringVar(value=cfg.get("quality", "High (93%)"))

    def browse(var, title):
        d = filedialog.askdirectory(title=title, initialdir=var.get() or "C:\\")
        if d:
            var.set(os.path.normpath(d)); refresh()

    r = 2
    ttk.Label(frm, text="Photos from").grid(row=r, column=0, sticky="w", pady=4)
    ttk.Entry(frm, textvariable=src_var).grid(row=r, column=1, sticky="ew", padx=6)
    ttk.Button(frm, text="Browse…", command=lambda: browse(src_var, "Choose the camera folder")).grid(row=r, column=2)
    r += 1

    # ---- destination ----
    dest = ttk.LabelFrame(frm, text="Upload to", padding=10)
    dest.grid(row=r, column=0, columnspan=3, sticky="ew", pady=(8, 0))
    dest.columnconfigure(1, weight=1)
    ttk.Radiobutton(dest, text="Google Drive directly (no Drive app needed)", value="direct", variable=mode_var,
                    command=lambda: refresh()).grid(row=0, column=0, columnspan=2, sticky="w")
    setup_btn = ttk.Button(dest, text="Set up…")
    setup_btn.grid(row=0, column=2, sticky="e")
    direct_status = ttk.Label(dest, text="")
    direct_status.grid(row=1, column=0, columnspan=3, sticky="w", padx=(22, 0))
    keep_cb = ttk.Checkbutton(dest, text="Also keep a copy on this PC in", variable=keep_local_var)
    keep_cb.grid(row=2, column=0, sticky="w", padx=(22, 0), pady=(4, 0))
    ttk.Entry(dest, textvariable=local_var).grid(row=2, column=1, sticky="ew", padx=6, pady=(4, 0))
    ttk.Button(dest, text="Browse…", command=lambda: browse(local_var, "Where to keep local copies")).grid(row=2, column=2, pady=(4, 0))
    ttk.Radiobutton(dest, text="A folder on this PC (e.g. Google Drive for desktop)", value="folder", variable=mode_var,
                    command=lambda: refresh()).grid(row=3, column=0, columnspan=3, sticky="w", pady=(10, 0))
    ttk.Entry(dest, textvariable=dst_var).grid(row=4, column=0, columnspan=2, sticky="ew", padx=(22, 6))
    ttk.Button(dest, text="Browse…", command=lambda: browse(dst_var, "Choose your Rugby folder")).grid(row=4, column=2)
    folder_status = ttk.Label(dest, text="")
    folder_status.grid(row=5, column=0, columnspan=3, sticky="w", padx=(22, 0))
    r += 1

    ttk.Label(frm, text="New folder name").grid(row=r, column=0, sticky="w", pady=(10, 4))
    name_entry = ttk.Entry(frm, textvariable=name_var, font=("Segoe UI", 11))
    name_entry.grid(row=r, column=1, sticky="ew", padx=6, pady=(10, 4))
    ttk.Label(frm, text="e.g. Dungannon 14 11 26", foreground="#777").grid(row=r, column=2, sticky="w", pady=(10, 4))
    r += 1

    opts = ttk.LabelFrame(frm, text="Which photos", padding=10)
    opts.grid(row=r, column=0, columnspan=3, sticky="ew", pady=8)
    ttk.Checkbutton(opts, text="Only photos taken on", variable=only_date_var, command=lambda: refresh()).grid(row=0, column=0, sticky="w")
    ttk.Entry(opts, textvariable=date_var, width=12).grid(row=0, column=1, sticky="w", padx=6)
    ttk.Checkbutton(opts, text="Skip photos I've already imported", variable=skip_var, command=lambda: refresh()).grid(row=1, column=0, columnspan=3, sticky="w", pady=(6, 0))
    ttk.Checkbutton(opts, text="Also upload untouched originals (into an 'Originals' subfolder)", variable=keep_orig_var).grid(row=2, column=0, columnspan=3, sticky="w", pady=(4, 0))
    count_lbl = ttk.Label(opts, text="", foreground="#333")
    count_lbl.grid(row=3, column=0, columnspan=3, sticky="w", pady=(8, 0))
    r += 1

    look = ttk.LabelFrame(frm, text="Enhancement", padding=10)
    look.grid(row=r, column=0, columnspan=3, sticky="ew")
    for j, p in enumerate(PRESETS):
        ttk.Radiobutton(look, text=p, value=p, variable=preset_var).grid(row=0, column=j, padx=(0, 18))
    ttk.Label(look, text="Quality").grid(row=0, column=4, padx=(20, 6))
    ttk.Combobox(look, textvariable=quality_var, values=["Good (88%)", "High (93%)", "Max (97%)"], width=11, state="readonly").grid(row=0, column=5)
    r += 1

    go = ttk.Button(frm, text="Enhance & upload", style="Big.TButton")
    go.grid(row=r, column=0, columnspan=3, sticky="ew", pady=(12, 6))
    r += 1
    prog = ttk.Progressbar(frm, mode="determinate")
    prog.grid(row=r, column=0, columnspan=3, sticky="ew")
    r += 1
    status = ttk.Label(frm, text="")
    status.grid(row=r, column=0, columnspan=3, sticky="w", pady=(6, 0))
    r += 1
    log = tk.Text(frm, height=6, font=("Consolas", 9), relief="flat", background="#f4f4f4", wrap="none")
    log.grid(row=r, column=0, columnspan=3, sticky="nsew", pady=(6, 0))
    frm.rowconfigure(r, weight=1)
    r += 1
    bottom = ttk.Frame(frm)
    bottom.grid(row=r, column=0, columnspan=3, sticky="ew", pady=(8, 0))
    bottom.columnconfigure(0, weight=1)
    upd_lbl = ttk.Label(bottom, text=f"Version {APP_VERSION}", foreground="#777")
    upd_lbl.grid(row=0, column=0, sticky="w")
    upd_btn = ttk.Button(bottom, text="Check for updates")
    upd_btn.grid(row=0, column=1, padx=6)
    open_btn = ttk.Button(bottom, text="Open the new folder", state="disabled")
    open_btn.grid(row=0, column=2)

    state = {"selected": [], "busy": False, "open": ""}

    # ---------------- Drive setup dialog ----------------
    def uploader():
        if cfg.get("upload_url") and cfg.get("upload_key"):
            return DriveUploader(cfg["upload_url"], cfg["upload_key"])
        return None

    def open_setup():
        win = tk.Toplevel(root)
        win.title("Set up direct Google Drive upload")
        win.geometry("700x560")
        win.transient(root)
        f = ttk.Frame(win, padding=16)
        f.pack(fill="both", expand=True)
        f.columnconfigure(0, weight=1)
        key = cfg.get("upload_key") or secrets.token_urlsafe(24)
        folder_var = tk.StringVar(value=cfg.get("folder_link") or f"https://drive.google.com/drive/folders/{DEFAULT_RUGBY_FOLDER_ID}")
        url_var = tk.StringVar(value=cfg.get("upload_url", ""))

        steps = (
            "One-time setup (about 3 minutes). This creates a private uploader in your own Google account.\n\n"
            "1. Check the Rugby folder link below, then click 'Copy script'.\n"
            "2. Click 'Open Apps Script' → New project. Delete what's there and paste (Ctrl+V). Save (Ctrl+S).\n"
            "3. Deploy → New deployment → cog ⚙ → Web app.\n"
            "      Execute as: Me      Who has access: Anyone      → Deploy.\n"
            "4. Google asks for permission: Authorise access → choose your account →\n"
            "      'Advanced' → 'Go to … (unsafe)' → Allow.  (It's your own script, so this is expected.)\n"
            "5. Copy the Web app URL, paste it below and click 'Test & save'."
        )
        ttk.Label(f, text=steps, justify="left").grid(row=0, column=0, columnspan=3, sticky="w")
        ttk.Label(f, text="Rugby folder link").grid(row=1, column=0, sticky="w", pady=(14, 2))
        ttk.Entry(f, textvariable=folder_var).grid(row=2, column=0, columnspan=3, sticky="ew")
        btns = ttk.Frame(f)
        btns.grid(row=3, column=0, columnspan=3, sticky="w", pady=10)
        msg = ttk.Label(f, text="", wraplength=640)

        def copy_script():
            fid = folder_id_from(folder_var.get())
            if not fid:
                msg.configure(text="That doesn't look like a Drive folder link.", style="Bad.TLabel"); return
            code = APPS_SCRIPT_TEMPLATE.replace("%KEY%", key).replace("%ROOT%", fid)
            win.clipboard_clear(); win.clipboard_append(code); win.update()
            msg.configure(text="Script copied — paste it into Apps Script.", style="Ok.TLabel")

        ttk.Button(btns, text="1. Copy script", command=copy_script).pack(side="left")
        ttk.Button(btns, text="2. Open Apps Script", command=lambda: webbrowser.open("https://script.google.com/home/projects/create")).pack(side="left", padx=8)
        ttk.Label(f, text="Web app URL").grid(row=4, column=0, sticky="w", pady=(6, 2))
        ttk.Entry(f, textvariable=url_var).grid(row=5, column=0, columnspan=3, sticky="ew")
        msg.grid(row=7, column=0, columnspan=3, sticky="w", pady=(10, 0))

        def test_save():
            url = url_var.get().strip()
            if not url.startswith("https://script.google.com/"):
                msg.configure(text="Paste the Web app URL (it starts with https://script.google.com/macros/s/…/exec).", style="Bad.TLabel"); return
            msg.configure(text="Testing…", style="TLabel"); win.update()

            def bg():
                try:
                    res = DriveUploader(url, key).ping()
                except Exception as e:
                    err = str(e)
                    win.after(0, lambda: msg.configure(text=f"Didn't work: {err}", style="Bad.TLabel"))
                    return

                def ok():
                    cfg.update(upload_url=url, upload_key=key, folder_link=folder_var.get().strip(), drive_root_name=res.get("root", ""))
                    save_config(cfg)
                    msg.configure(text=f"✓ Connected to “{res.get('root')}”. All set!", style="Ok.TLabel")
                    refresh()
                    win.after(1200, win.destroy)
                win.after(0, ok)
            threading.Thread(target=bg, daemon=True).start()

        ttk.Button(f, text="Test & save", command=test_save).grid(row=6, column=0, sticky="w", pady=(8, 0))

    setup_btn.configure(command=open_setup)

    # ---------------- photo selection ----------------
    def parse_date():
        try:
            return datetime.strptime(date_var.get().strip(), "%d/%m/%Y").date()
        except ValueError:
            return None

    def refresh(*_):
        if state["busy"]:
            return
        if uploader():
            direct_status.configure(text=f"✓ Set up — uploads go to “{cfg.get('drive_root_name') or 'Rugby'}”", style="Ok.TLabel")
        else:
            direct_status.configure(text="Not set up yet — click 'Set up…' (one time, ~3 minutes)", style="Bad.TLabel")
        d = dst_var.get().strip()
        if d and os.path.isdir(d):
            folder_status.configure(text="✓ Folder found", style="Ok.TLabel")
        else:
            folder_status.configure(text="Folder not found", style="Bad.TLabel")
        src = src_var.get().strip()
        if not os.path.isdir(src):
            count_lbl.configure(text="Camera folder not found — is the SD card in?")
            state["selected"] = []
            return
        photos = list_photos(src)
        sel = photos
        if only_date_var.get():
            want = parse_date()
            if want is None:
                count_lbl.configure(text="Type the date as DD/MM/YYYY"); state["selected"] = []; return
            sel = [p for p in sel if photo_date(p) == want]
        skipped = 0
        if skip_var.get():
            done = set(cfg.get("imported", []))
            keep = [p for p in sel if photo_key(p) not in done]
            skipped = len(sel) - len(keep); sel = keep
        state["selected"] = sel
        txt = f"{len(sel)} photo{'s' if len(sel) != 1 else ''} to enhance (of {len(photos)} on the card)"
        if skipped:
            txt += f" — {skipped} already imported"
        count_lbl.configure(text=txt)

    def logline(t):
        log.insert("end", t + "\n"); log.see("end")

    # ---------------- the run ----------------
    def start():
        if state["busy"]:
            return
        refresh()
        sel = state["selected"]
        name = safe_folder_name(name_var.get())
        direct = mode_var.get() == "direct"
        up = uploader() if direct else None
        if not sel:
            messagebox.showinfo(APP_NAME, "There are no photos to enhance with these settings."); return
        if not name:
            messagebox.showerror(APP_NAME, "Give the new folder a name, e.g. 'Dungannon 14 11 26'."); name_entry.focus(); return
        if direct and not up:
            messagebox.showinfo(APP_NAME, "Set up direct Google Drive upload first (click 'Set up…')."); open_setup(); return
        if not direct and not os.path.isdir(dst_var.get().strip()):
            messagebox.showerror(APP_NAME, "Choose the folder to save into first."); return

        if direct:
            base_dir = local_var.get().strip() if keep_local_var.get() else os.path.join(
                os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "RugbyPhotoEnhancer", "staging")
        else:
            base_dir = dst_var.get().strip()
        out_dir = os.path.join(base_dir, name)
        if not direct and os.path.exists(out_dir):
            if not messagebox.askyesno(APP_NAME, f"A folder called '{name}' already exists.\n\nAdd these photos into it?"):
                return
        try:
            os.makedirs(out_dir, exist_ok=True)
        except OSError as e:
            messagebox.showerror(APP_NAME, f"Couldn't create {out_dir}\n\n{e}"); return
        orig_dir = os.path.join(out_dir, "Originals") if keep_orig_var.get() else None
        if orig_dir:
            os.makedirs(orig_dir, exist_ok=True)

        cfg.update(source=src_var.get().strip(), dest=dst_var.get().strip(), mode=mode_var.get(), preset=preset_var.get(),
                   quality=quality_var.get(), only_date=only_date_var.get(), skip_imported=skip_var.get(),
                   keep_originals=keep_orig_var.get(), keep_local=keep_local_var.get(), local_copy_dir=local_var.get().strip())
        save_config(cfg)

        settings = PRESETS[preset_var.get()]
        quality = {"Good (88%)": 88, "High (93%)": 93, "Max (97%)": 97}.get(quality_var.get(), 93)
        state.update(busy=True, open="")
        go.configure(state="disabled"); open_btn.configure(state="disabled"); setup_btn.configure(state="disabled")
        log.delete("1.0", "end")
        steps_total = len(sel) * (2 if direct else 1)
        prog.configure(maximum=steps_total, value=0)
        status.configure(text="Starting…")

        def worker():
            t0 = time.time()
            counts = {"enh": 0, "up": 0, "fail": 0}
            lock = threading.Lock()
            folder_id = sub_id = None
            if direct:
                try:
                    res = up.mkdir(name)
                    folder_id = res["id"]; state["open"] = res.get("url", "")
                    root.after(0, lambda: logline(("Adding to existing" if res.get("existed") else "Created") + f" Drive folder: {name}"))
                    if orig_dir:
                        sub_id = up.mkdir("Originals", parent=folder_id)["id"]
                except Exception as e:
                    err = str(e)

                    def fail():
                        state["busy"] = False
                        go.configure(state="normal"); setup_btn.configure(state="normal")
                        status.configure(text=f"Couldn't create the Drive folder: {err}")
                        logline(f"✗ {err}")
                    root.after(0, fail)
                    return
            else:
                state["open"] = out_dir

            def tick(msg):
                with lock:
                    done = counts["enh"] + counts["up"] + counts["fail"] * (2 if direct else 1)
                elapsed = time.time() - t0
                eta = elapsed / max(done, 1) * max(steps_total - done, 0)
                txt = (f"Enhanced {counts['enh']}/{len(sel)}" + (f" · Uploaded {counts['up']}/{len(sel)}" if direct else "")
                       + f" — about {int(eta // 60)}m {int(eta % 60)}s left")
                root.after(0, lambda: (logline(msg) if msg else None, prog.configure(value=min(done, steps_total)), status.configure(text=txt)))

            def do_upload(path, src_path, fid, is_orig=False):
                try:
                    up.upload(path, fid)
                    if not is_orig:
                        with lock:
                            counts["up"] += 1
                            cfg.setdefault("imported", []).append(photo_key(src_path))
                        if not keep_local_var.get():
                            try:
                                os.remove(path)
                            except OSError:
                                pass
                        tick("")
                except Exception as e:
                    with lock:
                        counts["fail"] += 0 if is_orig else 1
                    tick(f"✗ upload {os.path.basename(path)} — {e}")

            n_workers = max(1, min(4, (os.cpu_count() or 2) - 1))
            jobs = {}
            with ThreadPoolExecutor(max_workers=3) as uploads, ProcessPoolExecutor(max_workers=n_workers) as ex:
                for p in sel:
                    base = os.path.splitext(os.path.basename(p))[0]
                    ext = ".png" if p.lower().endswith(".png") else ".jpg"
                    jobs[ex.submit(process_one, p, os.path.join(out_dir, base + ext), settings, quality)] = (p, os.path.join(out_dir, base + ext))
                for fut in as_completed(jobs):
                    p, dst = jobs[fut]
                    nm = os.path.basename(p)
                    try:
                        tags = fut.result()
                        with lock:
                            counts["enh"] += 1
                        if orig_dir:
                            shutil.copy2(p, os.path.join(orig_dir, nm))
                            if direct:
                                uploads.submit(do_upload, os.path.join(orig_dir, nm), p, sub_id, True)
                        if direct:
                            uploads.submit(do_upload, dst, p, folder_id)
                        else:
                            with lock:
                                cfg.setdefault("imported", []).append(photo_key(p))
                        tick(f"✓ {nm}  ({', '.join(tags)})")
                    except Exception as e:
                        with lock:
                            counts["fail"] += 1
                        tick(f"✗ {nm} — {e}")
            cfg["imported"] = cfg.get("imported", [])[-20000:]
            save_config(cfg)

            def finish():
                state["busy"] = False
                go.configure(state="normal"); setup_btn.configure(state="normal")
                open_btn.configure(state="normal" if state["open"] else "disabled")
                prog.configure(value=steps_total)
                if direct:
                    txt = f"Finished: {counts['up']} of {len(sel)} photos uploaded to Google Drive › {name}"
                else:
                    txt = f"Finished: {counts['enh']} photos saved to {out_dir}"
                if counts["fail"]:
                    txt += f" ({counts['fail']} failed — run again to retry them)"
                status.configure(text=txt)
                logline("Done.")
                refresh()
            root.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def open_result():
        tgt = state["open"]
        if not tgt:
            return
        if tgt.startswith("http"):
            webbrowser.open(tgt)
        elif hasattr(os, "startfile"):
            os.startfile(tgt)

    # ---------------- updates ----------------
    def do_update_check(manual=False):
        def bg():
            try:
                info = check_for_update()
            except Exception:
                root.after(0, lambda: upd_lbl.configure(
                    text=f"Version {APP_VERSION} — couldn't check for updates" if manual else f"Version {APP_VERSION}"))
                return
            if not info:
                root.after(0, lambda: upd_lbl.configure(text=f"Version {APP_VERSION} — up to date"))
                return
            root.after(0, lambda: upd_lbl.configure(text=f"Downloading update v{info.get('version')}…"))
            try:
                newv = install_update(info)
            except Exception as e:
                err = str(e)
                root.after(0, lambda: upd_lbl.configure(text=f"Version {APP_VERSION} — update failed ({err})"))
                return

            def ready():
                upd_lbl.configure(text=f"Updated to v{newv} — restart to use it")
                if state["busy"]:
                    return
                if messagebox.askyesno(APP_NAME, f"Updated to version {newv}.\n\n{info.get('notes', '')}\n\nRestart now to use it?"):
                    restart_app(); root.destroy()
            root.after(0, ready)
        threading.Thread(target=bg, daemon=True).start()

    upd_btn.configure(command=lambda: (upd_lbl.configure(text="Checking for updates…"), do_update_check(True)))
    root.after(1500, do_update_check)
    go.configure(command=start)
    open_btn.configure(command=open_result)
    for v in (src_var, dst_var, date_var):
        v.trace_add("write", lambda *_: root.after(400, refresh))
    root.after(100, refresh)
    if mode_var.get() == "direct" and not uploader():
        root.after(600, open_setup)
    name_entry.focus(); name_entry.icursor(0)
    root.mainloop()


if __name__ == "__main__":
    # Command-line use (for testing): python rugby_photo_enhancer.py IN_DIR OUT_DIR [Preset]
    if len(sys.argv) >= 3:
        src, out = sys.argv[1], sys.argv[2]
        os.makedirs(out, exist_ok=True)
        s = PRESETS[sys.argv[3]] if len(sys.argv) > 3 else PRESETS["Balanced"]
        for p in list_photos(src):
            t = process_one(p, os.path.join(out, os.path.basename(p)), s)
            print(os.path.basename(p), t)
    else:
        run_app()
