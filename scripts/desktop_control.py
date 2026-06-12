#!/usr/bin/env python3
"""
desktop_control.py -- GUI automation via pyautogui + pywinauto

Usage: python desktop_control.py <command> [args...]

Commands:
  click    <x> <y> [button=left] [clicks=1]
  dblclick <x> <y>
  rclick   <x> <y>
  move     <x> <y>
  scroll   <x> <y> <amount>          # positive = up, negative = down
  drag     <x1> <y1> <x2> <y2>
  type     <text>
  key      <keys>                    # e.g. ctrl+c, enter, alt+tab
  pos                                # current mouse position
  screenshot [x y w h]              # full screen or region
  find_click <window_pattern> <control_text>   # pywinauto: click by label
"""

import sys
import json
import pyautogui
import time

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05


def out(data):
    print(json.dumps(data), flush=True)


cmd = sys.argv[1] if len(sys.argv) > 1 else ''

try:
    if cmd == 'click':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        button = sys.argv[4] if len(sys.argv) > 4 else 'left'
        clicks = int(sys.argv[5]) if len(sys.argv) > 5 else 1
        pyautogui.click(x, y, button=button, clicks=clicks, interval=0.1)
        out({'ok': True, 'action': 'click', 'x': x, 'y': y, 'button': button, 'clicks': clicks})

    elif cmd == 'dblclick':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        pyautogui.doubleClick(x, y)
        out({'ok': True, 'action': 'dblclick', 'x': x, 'y': y})

    elif cmd == 'rclick':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        pyautogui.rightClick(x, y)
        out({'ok': True, 'action': 'rclick', 'x': x, 'y': y})

    elif cmd == 'move':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        pyautogui.moveTo(x, y, duration=0.15)
        out({'ok': True, 'action': 'move', 'x': x, 'y': y})

    elif cmd == 'scroll':
        x, y, amount = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
        pyautogui.scroll(amount, x=x, y=y)
        out({'ok': True, 'action': 'scroll', 'x': x, 'y': y, 'amount': amount})

    elif cmd == 'drag':
        x1, y1, x2, y2 = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
        pyautogui.moveTo(x1, y1, duration=0.1)
        pyautogui.dragTo(x2, y2, duration=0.4, button='left')
        out({'ok': True, 'action': 'drag', 'from': [x1, y1], 'to': [x2, y2]})

    elif cmd == 'type':
        text = sys.argv[2]
        # Use pyperclip for reliable unicode typing
        import pyperclip
        pyperclip.copy(text)
        pyautogui.hotkey('ctrl', 'v')
        out({'ok': True, 'action': 'type', 'length': len(text)})

    elif cmd == 'key':
        combo = sys.argv[2].lower()
        keys = [k.strip() for k in combo.split('+')]
        pyautogui.hotkey(*keys)
        out({'ok': True, 'action': 'key', 'keys': combo})

    elif cmd == 'pos':
        x, y = pyautogui.position()
        out({'x': x, 'y': y})

    elif cmd == 'screenshot':
        import tempfile
        from PIL import Image
        if len(sys.argv) >= 6:
            region = (int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))
            img = pyautogui.screenshot(region=region)
        else:
            img = pyautogui.screenshot()
        # Downscale to max 1280px wide so the base64 payload stays under the
        # Anthropic 5 MB image limit.  Vision clarity at 1280px is still good.
        MAX_W = 1280
        if img.size[0] > MAX_W:
            ratio = MAX_W / img.size[0]
            img = img.resize((MAX_W, int(img.size[1] * ratio)), Image.LANCZOS)
        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        img.save(tmp.name, optimize=True)
        tmp.close()
        out({'ok': True, 'path': tmp.name, 'width': img.size[0], 'height': img.size[1]})

    elif cmd == 'find_click':
        # pywinauto: find a control by its visible text and click it
        import re as _re
        from pywinauto import Desktop
        window_pattern = sys.argv[2]
        control_text   = sys.argv[3]

        # Find the window
        desktop = Desktop(backend='uia')
        windows = desktop.windows()
        target_win = None
        pat = _re.compile(window_pattern, _re.IGNORECASE)
        for w in windows:
            try:
                if pat.search(w.window_text()):
                    target_win = w
                    break
            except Exception:
                continue

        if target_win is None:
            out({'ok': False, 'error': f"No window matching '{window_pattern}' found"})
            sys.exit(0)

        # Find the control by text
        from pywinauto import findwindows
        ctrl = target_win.child_window(title_re=_re.compile(control_text, _re.IGNORECASE), found_index=0)
        ctrl.set_focus()
        ctrl.click_input()
        out({'ok': True, 'action': 'find_click', 'window': target_win.window_text(), 'control': control_text})

    else:
        out({'ok': False, 'error': f"Unknown command: '{cmd}'"})
        sys.exit(1)

except Exception as e:
    out({'ok': False, 'error': str(e)})
    sys.exit(1)
