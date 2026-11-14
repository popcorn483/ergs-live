"""
Rugby Photo Enhancer
--------------------
Reads photos from the camera card (e.g. E:\\DCIM\\100CANON), auto-enhances them
(colour balance, levels, exposure, contrast, vibrance, sharpening) and saves
full-size copies into a new, named folder inside your Google Drive Rugby folder
(via Google Drive for desktop, which uploads them in the background).

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
APP_VERSION = "1.1.0"
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
# Window
# --------------------------------------------------------------------------
def run_app():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox

    cfg = load_config()
    root = tk.Tk()
    root.title(f"{APP_NAME}  v{APP_VERSION}")
    root.geometry("720x620")
    root.minsize(640, 560)
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
    ttk.Label(frm, text="Card → enhance → new folder in your Rugby Drive folder. Originals on the card are never changed.",
              foreground="#555").grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 12))

    src_var = tk.StringVar(value=cfg.get("source", DEFAULT_SOURCE))
    dst_var = tk.StringVar(value=cfg.get("dest") or find_drive_rugby_folder())
    today = date.today()
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
    ttk.Label(frm, text="Rugby Drive folder").grid(row=r, column=0, sticky="w", pady=4)
    ttk.Entry(frm, textvariable=dst_var).grid(row=r, column=1, sticky="ew", padx=6)
    ttk.Button(frm, text="Browse…", command=lambda: browse(dst_var, "Choose your Rugby folder in Google Drive")).grid(row=r, column=2)
    r += 1
    dst_status = ttk.Label(frm, text="")
    dst_status.grid(row=r, column=1, columnspan=2, sticky="w", padx=6)
    r += 1
    ttk.Label(frm, text="New folder name").grid(row=r, column=0, sticky="w", pady=(10, 4))
    name_entry = ttk.Entry(frm, textvariable=name_var, font=("Segoe UI", 11))
    name_entry.grid(row=r, column=1, sticky="ew", padx=6, pady=(10, 4))
    ttk.Label(frm, text="e.g. Dungannon 14 11 26", foreground="#777").grid(row=r, column=2, sticky="w", pady=(10, 4))
    r += 1

    opts = ttk.LabelFrame(frm, text="Which photos", padding=10)
    opts.grid(row=r, column=0, columnspan=3, sticky="ew", pady=10)
    opts.columnconfigure(2, weight=1)
    ttk.Checkbutton(opts, text="Only photos taken on", variable=only_date_var, command=lambda: refresh()).grid(row=0, column=0, sticky="w")
    de = ttk.Entry(opts, textvariable=date_var, width=12)
    de.grid(row=0, column=1, sticky="w", padx=6)
    ttk.Checkbutton(opts, text="Skip photos I've already imported", variable=skip_var, command=lambda: refresh()).grid(row=1, column=0, columnspan=3, sticky="w", pady=(6, 0))
    ttk.Checkbutton(opts, text="Also keep untouched originals (in an 'Originals' subfolder)", variable=keep_orig_var).grid(row=2, column=0, columnspan=3, sticky="w", pady=(4, 0))
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
    go.grid(row=r, column=0, columnspan=3, sticky="ew", pady=(14, 6))
    r += 1
    prog = ttk.Progressbar(frm, mode="determinate")
    prog.grid(row=r, column=0, columnspan=3, sticky="ew")
    r += 1
    status = ttk.Label(frm, text="")
    status.grid(row=r, column=0, columnspan=3, sticky="w", pady=(6, 0))
    r += 1
    log = tk.Text(frm, height=7, font=("Consolas", 9), relief="flat", background="#f4f4f4", wrap="none")
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

    state = {"selected": [], "busy": False, "out": ""}

    def parse_date():
        try:
            return datetime.strptime(date_var.get().strip(), "%d/%m/%Y").date()
        except ValueError:
            return None

    def refresh(*_):
        if state["busy"]:
            return
        d = dst_var.get().strip()
        if d and os.path.isdir(d):
            dst_status.configure(text="✓ Folder found — new folders here sync to Google Drive automatically", style="Ok.TLabel")
        else:
            dst_status.configure(text="✗ Rugby folder not found. Install/sign in to Google Drive for desktop, then Browse to "
                                      "Shared drives › … › School Photos › 2026-27 › Rugby", style="Bad.TLabel")
        src = src_var.get().strip()
        photos = list_photos(src)
        if not os.path.isdir(src):
            count_lbl.configure(text="Camera folder not found — is the SD card in?")
            state["selected"] = []
            return
        sel = photos
        want = parse_date() if only_date_var.get() else None
        if only_date_var.get() and want is None:
            count_lbl.configure(text="Type the date as DD/MM/YYYY")
            state["selected"] = []
            return
        if want:
            sel = [p for p in sel if photo_date(p) == want]
        done = set(cfg.get("imported", []))
        skipped = 0
        if skip_var.get():
            keep = [p for p in sel if photo_key(p) not in done]
            skipped = len(sel) - len(keep); sel = keep
        state["selected"] = sel
        txt = f"{len(sel)} photo{'s' if len(sel) != 1 else ''} to enhance (of {len(photos)} on the card)"
        if skipped:
            txt += f" — {skipped} already imported"
        count_lbl.configure(text=txt)

    def logline(t):
        log.insert("end", t + "\n"); log.see("end")

    def start():
        if state["busy"]:
            return
        refresh()
        sel = state["selected"]
        dest_root = dst_var.get().strip()
        name = safe_folder_name(name_var.get())
        if not sel:
            messagebox.showinfo(APP_NAME, "There are no photos to enhance with these settings."); return
        if not os.path.isdir(dest_root):
            messagebox.showerror(APP_NAME, "Choose your Rugby folder in Google Drive first."); return
        if not name:
            messagebox.showerror(APP_NAME, "Give the new folder a name, e.g. 'Dungannon 14 11 26'."); name_entry.focus(); return
        out_dir = os.path.join(dest_root, name)
        if os.path.exists(out_dir):
            if not messagebox.askyesno(APP_NAME, f"A folder called '{name}' already exists in Rugby.\n\nAdd these photos into it?"):
                return
        os.makedirs(out_dir, exist_ok=True)
        orig_dir = os.path.join(out_dir, "Originals") if keep_orig_var.get() else None
        if orig_dir:
            os.makedirs(orig_dir, exist_ok=True)

        cfg.update(source=src_var.get().strip(), dest=dest_root, preset=preset_var.get(), quality=quality_var.get(),
                   only_date=only_date_var.get(), skip_imported=skip_var.get(), keep_originals=keep_orig_var.get())
        save_config(cfg)

        settings = PRESETS[preset_var.get()]
        quality = {"Good (88%)": 88, "High (93%)": 93, "Max (97%)": 97}.get(quality_var.get(), 93)
        state.update(busy=True, out=out_dir)
        go.configure(state="disabled"); open_btn.configure(state="disabled")
        log.delete("1.0", "end")
        prog.configure(maximum=len(sel), value=0)
        logline(f"Saving to: {out_dir}")

        def worker():
            ok, failed, t0 = 0, 0, time.time()
            jobs = {}
            n_workers = max(1, min(4, (os.cpu_count() or 2) - 1))
            with ProcessPoolExecutor(max_workers=n_workers) as ex:
                for p in sel:
                    base = os.path.splitext(os.path.basename(p))[0]
                    ext = ".png" if p.lower().endswith(".png") else ".jpg"
                    dst = os.path.join(out_dir, base + ext)
                    jobs[ex.submit(process_one, p, dst, settings, quality)] = p
                for fut in as_completed(jobs):
                    p = jobs[fut]; nm = os.path.basename(p)
                    try:
                        tags = fut.result()
                        if orig_dir:
                            shutil.copy2(p, os.path.join(orig_dir, nm))
                        ok += 1
                        cfg.setdefault("imported", []).append(photo_key(p))
                        msg = f"✓ {nm}  ({', '.join(tags)})"
                    except Exception as e:
                        failed += 1
                        msg = f"✗ {nm}  — {e}"
                    done = ok + failed
                    eta = (time.time() - t0) / done * (len(sel) - done)
                    root.after(0, lambda m=msg, d=done, e=eta: (logline(m), prog.configure(value=d),
                               status.configure(text=f"{d} of {len(sel)} done — about {int(e // 60)}m {int(e % 60)}s left")))
            cfg["imported"] = cfg.get("imported", [])[-20000:]
            save_config(cfg)

            def finish():
                state["busy"] = False
                go.configure(state="normal"); open_btn.configure(state="normal")
                status.configure(text=f"Finished: {ok} enhanced{f', {failed} failed' if failed else ''}. "
                                      "Google Drive is uploading them now — keep the PC on until the Drive icon says it's up to date.")
                logline("Done.")
                refresh()
            root.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def do_update_check(manual=False):
        def bg():
            try:
                info = check_for_update()
            except Exception as e:
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
                notes = info.get("notes", "")
                upd_lbl.configure(text=f"Updated to v{newv} — restart to use it")
                if state["busy"]:
                    return  # don't interrupt a run; the new version is used next time
                if messagebox.askyesno(APP_NAME, f"Updated to version {newv}.\n\n{notes}\n\nRestart now to use it?"):
                    restart_app(); root.destroy()
            root.after(0, ready)
        threading.Thread(target=bg, daemon=True).start()

    upd_btn.configure(command=lambda: (upd_lbl.configure(text="Checking for updates…"), do_update_check(True)))
    root.after(1500, do_update_check)

    go.configure(command=start)
    open_btn.configure(command=lambda: os.startfile(state["out"]) if state["out"] and hasattr(os, "startfile") else None)
    for v in (src_var, dst_var, date_var):
        v.trace_add("write", lambda *_: root.after(400, refresh))
    root.after(100, refresh)
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
