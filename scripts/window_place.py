#!/usr/bin/env python3
"""
window_place.py -- launch an app and snap its window to the given screen bounds.
Usage: python window_place.py <app> <x> <y> <w> <h> [window_title_hint]

Strategy:
  1. If a window matching the hint is already open, snap it immediately.
  2. Otherwise launch via PowerShell Start-Process -PassThru to capture the PID.
  3. Search for the window by PID (handles exact launch) and by title (handles
     launchers that spawn a child process with a different PID).
  4. Call SetWindowPos multiple times after finding the window to override apps
     that restore their saved position on startup (Discord, Electron apps, etc).

Prints PLACED or NOT_FOUND to stdout. Debug lines go to stderr.
"""
import sys
import os
import subprocess
import time
import ctypes
import ctypes.wintypes

user32   = ctypes.windll.user32
ENUM_CB  = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)

class POINT(ctypes.Structure):
    _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]

class RECT(ctypes.Structure):
    _fields_ = [('left', ctypes.c_long), ('top', ctypes.c_long),
                ('right', ctypes.c_long), ('bottom', ctypes.c_long)]

class WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [
        ('length',           ctypes.wintypes.UINT),
        ('flags',            ctypes.wintypes.UINT),
        ('showCmd',          ctypes.wintypes.UINT),
        ('ptMinPosition',    POINT),
        ('ptMaxPosition',    POINT),
        ('rcNormalPosition', RECT),
    ]

# ── Window enumeration ────────────────────────────────────────

def _get_title(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    if n <= 0:
        return ''
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value

def _get_pid(hwnd):
    pid = ctypes.wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value

def list_windows():
    """Return {hwnd: title} for all visible top-level windows with non-empty titles."""
    result = {}
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            t = _get_title(hwnd)
            if t:
                result[hwnd] = t
        return True
    user32.EnumWindows(ENUM_CB(cb), 0)
    return result

# ── Search helpers ────────────────────────────────────────────

def find_by_hint(hint, timeout=0):
    """Return the first hwnd whose title contains hint (case-insensitive)."""
    deadline = time.time() + max(timeout, 0)
    while True:
        for hwnd, title in list_windows().items():
            if hint.lower() in title.lower():
                return hwnd
        if time.time() >= deadline:
            return None
        time.sleep(0.4)

def find_by_pid(pid, timeout=10):
    """Return the most prominent visible window belonging to pid."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        matches = {}
        def cb(hwnd, _):
            if user32.IsWindowVisible(hwnd) and _get_pid(hwnd) == pid:
                t = _get_title(hwnd)
                if t:
                    matches[hwnd] = t
            return True
        user32.EnumWindows(ENUM_CB(cb), 0)
        if matches:
            # Prefer the window with the longest title — usually the main one
            return max(matches, key=lambda h: len(matches[h]))
        time.sleep(0.4)
    return None

def find_new_window(before, timeout=12):
    """Return any hwnd that appeared after `before` snapshot was taken."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        after = list_windows()
        for hwnd in after:
            if hwnd not in before and after[hwnd].strip():
                return hwnd
        time.sleep(0.4)
    return None

# ── Launch ────────────────────────────────────────────────────

def launch_and_get_pid(app):
    """
    Launch via PowerShell Start-Process -PassThru to capture the real PID.
    Returns int PID or None on failure.
    """
    safe = app.replace("'", "''")
    try:
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-Command',
             f"(Start-Process -PassThru '{safe}').Id"],
            capture_output=True, text=True, timeout=8,
        )
        pid_str = result.stdout.strip()
        if pid_str.isdigit():
            return int(pid_str)
        # Some apps print nothing (UWP, single-instance), that's fine
    except Exception as e:
        print(f"[wp] launch error: {e}", file=sys.stderr)
    return None

# ── Snap ─────────────────────────────────────────────────────

def snap(hwnd, x, y, w, h, topmost=True):
    """
    Resize and move a window to virtual-screen coordinates (x, y, w, h).

    Key detail: SetWindowPlacement uses workspace-relative coords (primary
    monitor origin), NOT virtual screen coords — so it breaks cross-monitor
    moves.  We use it ONLY to un-maximize (changing showCmd), then rely on
    SetWindowPos for actual positioning, which always uses virtual screen coords.
    """
    SW_SHOWNORMAL    = 1
    HWND_TOPMOST     = -1
    HWND_NOTOPMOST   = -2
    SWP_FRAMECHANGED = 0x0020

    # Un-maximize only — do NOT change rcNormalPosition here
    wpl = WINDOWPLACEMENT()
    wpl.length = ctypes.sizeof(WINDOWPLACEMENT)
    user32.GetWindowPlacement(hwnd, ctypes.byref(wpl))
    if wpl.showCmd != SW_SHOWNORMAL:
        wpl.showCmd = SW_SHOWNORMAL
        user32.SetWindowPlacement(hwnd, ctypes.byref(wpl))
        time.sleep(0.3)

    insert_after = HWND_TOPMOST if topmost else HWND_NOTOPMOST

    # Repeat to override apps that restore their saved position after un-maximize
    for _ in range(4):
        user32.SetWindowPos(hwnd, insert_after, x, y, w, h, SWP_FRAMECHANGED)
        time.sleep(0.3)

    user32.SetForegroundWindow(hwnd)
    print(f"[wp] snapped hwnd={hwnd} to {x},{y} {w}x{h} topmost={topmost}", file=sys.stderr)

# ── Main ──────────────────────────────────────────────────────

def main():
    """
    Args: <app> <x> <y> <w> <h> [hint] [topmost]
    Pass app as '-' to skip launch and only find/move an existing window.
    topmost: '1' (default, panel use) or '0' (returning to main monitor).
    """
    if len(sys.argv) < 6:
        print("Usage: window_place.py <app|->> <x> <y> <w> <h> [hint] [topmost]", file=sys.stderr)
        sys.exit(1)

    app         = sys.argv[1]
    x, y, w, h = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
    hint        = sys.argv[6] if len(sys.argv) > 6 else os.path.splitext(os.path.basename(app))[0]
    topmost     = (sys.argv[7] != '0') if len(sys.argv) > 7 else True

    print(f"[wp] app='{app}' hint='{hint}' target={x},{y} {w}x{h} topmost={topmost}", file=sys.stderr)

    # ── Move-only mode (app == '-'): just find and snap ───────
    if app == '-':
        hwnd = find_by_hint(hint, timeout=6)
        if hwnd:
            print(f"[wp] move-only: hwnd={hwnd} title='{_get_title(hwnd)}'", file=sys.stderr)
            snap(hwnd, x, y, w, h, topmost=topmost)
            print("PLACED", flush=True)
        else:
            print(f"[wp] not found: '{hint}'", file=sys.stderr)
            print("NOT_FOUND", flush=True)
        return

    # ── 1. Already running? Snap immediately ──────────────────
    hwnd = find_by_hint(hint, timeout=0)
    if hwnd:
        print(f"[wp] already open: hwnd={hwnd} title='{_get_title(hwnd)}'", file=sys.stderr)
        snap(hwnd, x, y, w, h, topmost=topmost)
        print("PLACED", flush=True)
        return

    # ── 2. Launch and search ──────────────────────────────────
    before = list_windows()
    pid    = launch_and_get_pid(app)
    print(f"[wp] launched pid={pid}", file=sys.stderr)
    time.sleep(1.5)

    hwnd = None
    if pid:
        hwnd = find_by_pid(pid, timeout=8)
        if hwnd:
            print(f"[wp] found by pid: hwnd={hwnd} title='{_get_title(hwnd)}'", file=sys.stderr)

    if not hwnd:
        hwnd = find_by_hint(hint, timeout=8)
        if hwnd:
            print(f"[wp] found by hint: hwnd={hwnd} title='{_get_title(hwnd)}'", file=sys.stderr)

    if not hwnd:
        hwnd = find_new_window(before, timeout=6)
        if hwnd:
            print(f"[wp] found as new window: hwnd={hwnd} title='{_get_title(hwnd)}'", file=sys.stderr)

    if hwnd:
        snap(hwnd, x, y, w, h, topmost=topmost)
        print("PLACED", flush=True)
    else:
        print(f"[wp] window not found for '{hint}'", file=sys.stderr)
        print("NOT_FOUND", flush=True)

if __name__ == '__main__':
    main()
