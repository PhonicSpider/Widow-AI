const { webSearch } = require('./web');
const { getTime, getClipboard, getSystemInfo, openApp, openNativeInPanel, moveWindow, moveWidowToMonitor, getPanelBounds, getDisplayMap, getDisplayBounds, getSnapBounds, restartWidow, reloadRenderer } = require('./system');
const { readFile, writeFile, listDirectory, moveFile, copyFile, deleteFile } = require('./files');
const { click, dblClick, rClick, moveMouse, scroll, drag, typeText, keyPress, getCursor, screenshot, findClick } = require('./desktop');
const { searchGitHub, getGitHubFile, createGitHubIssue, getGitHubIssues, getPRStatus } = require('./github');
const state = require('../state');

const TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description: 'Search the web for current information, news, or facts. Opens the results visually in the side panel and returns a summary for you to read.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_url',
    description: 'Open any URL in the side panel so Phonic can see it — articles, docs, videos, anything web-based.',
    input_schema: {
      type: 'object',
      properties: {
        url:   { type: 'string', description: 'Full URL to open' },
        title: { type: 'string', description: 'Short label for the panel header' },
      },
      required: ['url', 'title'],
    },
  },
  {
    name: 'get_time',
    description: "Get the current date and time on Phonic's system.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_clipboard',
    description: "Read whatever text is currently on Phonic's clipboard.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_system_info',
    description: "Get Phonic's system stats: CPU, RAM, hostname, uptime.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_file',
    description: "Read the contents of a file on Phonic's system.",
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: "Write or overwrite a file on Phonic's system. Creates parent directories if needed.",
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Absolute path to write to' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: "List files and folders in a directory.",
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: "Move or rename a file or folder.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source path' },
        to:   { type: 'string', description: 'Destination path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'copy_file',
    description: "Copy a file to a new location.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source path' },
        to:   { type: 'string', description: 'Destination path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'delete_file',
    description: "Delete a file or folder. Deletes directories recursively. Use with care — no recycle bin.",
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_monitors',
    description: "List all connected monitors. Monitor 1 = rightmost (Widow's home), Monitor 2 = Windows primary (center), Monitor 3 = leftmost. Use this to confirm layout before moving windows.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'move_window',
    description: "Move any open window to a specific monitor and snap zone. Monitor 1 = rightmost (Widow's display), Monitor 2 = primary/center, Monitor 3 = leftmost. Use list_monitors if unsure.",
    input_schema: {
      type: 'object',
      properties: {
        window_title: {
          type: 'string',
          description: "Part of the window title to search for, e.g. 'Visual Studio Code', 'Discord', 'Minecraft'",
        },
        monitor: {
          description: "Which monitor: 1=rightmost, 2=primary/center, 3=leftmost. Or 'panel' to snap into Widow's side panel.",
          oneOf: [{ type: 'integer' }, { type: 'string', enum: ['panel'] }],
        },
        position: {
          type: 'string',
          enum: ['center', 'full', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'left-third', 'center-third', 'right-third'],
          description: "Snap zone on the target monitor. Default: 'center'",
        },
      },
      required: ['window_title', 'monitor'],
    },
  },
  {
    name: 'open_app',
    description: "Launch an app and display it inside Widow's UI panel. Web-capable apps (Spotify, Discord, YouTube, etc.) open as a web view inside the panel. Native apps and games are launched and their window is automatically resized and snapped over the panel so it appears embedded in the UI.",
    input_schema: {
      type: 'object',
      properties: {
        name:         { type: 'string', description: "App name, executable path, or URI (e.g. 'notepad', 'D:\\Games\\game.exe', 'spotify')" },
        window_title: { type: 'string', description: "Optional: part of the window title to search for. Use when the window title differs from the app name (e.g. a game's actual title)." },
      },
      required: ['name'],
    },
  },
  {
    name: 'move_widow',
    description: "Move Widow herself to a different monitor. All active overlay windows follow automatically, preserving their relative positions. Monitor 1 = rightmost (her normal home), Monitor 2 = primary/center, Monitor 3 = leftmost.",
    input_schema: {
      type: 'object',
      properties: {
        monitor: { type: 'integer', minimum: 1, maximum: 3, description: 'Target monitor (1=rightmost, 2=primary/center, 3=leftmost)' },
      },
      required: ['monitor'],
    },
  },
  {
    name: 'restart_widow',
    description: "Restart Widow's Electron process. Use after editing any main-process file (harness.js, personality.js, tools, main.js, speaker.js) so the new code is loaded. Widow will be back in ~5 seconds.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'reload_renderer',
    description: "Reload Widow's renderer UI without a full restart. Use after editing renderer files only (HTML, CSS, renderer/js/*.js). Faster than a full restart.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delegate_to_agent',
    description: "Delegate a complex task to a specialized sub-agent. Use 'coding' for programming tasks, 'research' for in-depth multi-source research, 'writing' for creative/long-form writing tasks. The agent runs its own tool loop and returns a plain-text result.",
    input_schema: {
      type: 'object',
      properties: {
        agent:   { type: 'string', enum: ['coding', 'research', 'writing'], description: "Which agent: 'coding' for code/files, 'research' for deep web research, 'writing' for creative writing" },
        task:    { type: 'string', description: 'Full task description — be specific and include all relevant detail' },
        context: { type: 'string', description: 'Optional: any context the agent should know' },
      },
      required: ['agent', 'task'],
    },
  },

  // ── Desktop automation ──────────────────────────────────────────────────────
  {
    name: 'mouse_click',
    description: "Click the mouse at screen coordinates. Use screenshot first if you are unsure where to click.",
    input_schema: {
      type: 'object',
      properties: {
        x:      { type: 'integer', description: 'Screen X coordinate' },
        y:      { type: 'integer', description: 'Screen Y coordinate' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: "Mouse button (default: 'left')" },
        clicks: { type: 'integer', description: '1 = single click, 2 = double click (default: 1)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_scroll',
    description: "Scroll at a screen position. Positive amount scrolls up, negative scrolls down.",
    input_schema: {
      type: 'object',
      properties: {
        x:      { type: 'integer', description: 'Screen X coordinate to scroll at' },
        y:      { type: 'integer', description: 'Screen Y coordinate to scroll at' },
        amount: { type: 'integer', description: 'Scroll amount: positive = up, negative = down (e.g. -5 to scroll down)' },
      },
      required: ['x', 'y', 'amount'],
    },
  },
  {
    name: 'mouse_drag',
    description: "Click and drag from one screen position to another.",
    input_schema: {
      type: 'object',
      properties: {
        x1: { type: 'integer', description: 'Start X' },
        y1: { type: 'integer', description: 'Start Y' },
        x2: { type: 'integer', description: 'End X' },
        y2: { type: 'integer', description: 'End Y' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'type_text',
    description: "Type text into the currently focused field or application. Focus the target field first with mouse_click if needed.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'key_press',
    description: "Press a key or keyboard shortcut. Use '+' to combine keys (e.g. 'ctrl+c', 'alt+tab', 'enter', 'escape', 'ctrl+shift+t').",
    input_schema: {
      type: 'object',
      properties: {
        keys: { type: 'string', description: "Key or combo, e.g. 'enter', 'ctrl+c', 'alt+f4', 'ctrl+shift+t'" },
      },
      required: ['keys'],
    },
  },
  {
    name: 'take_screenshot',
    description: "Take a screenshot of the full screen or a region. Returns the file path. Use before clicking to see current screen state.",
    input_schema: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: 'Optional region to capture',
          properties: {
            x:      { type: 'integer' },
            y:      { type: 'integer' },
            width:  { type: 'integer' },
            height: { type: 'integer' },
          },
        },
      },
    },
  },
  {
    name: 'get_cursor_pos',
    description: "Get the current mouse cursor position in screen coordinates. Useful for calibrating clicks.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'click_ui_control',
    description: "Click a UI control (button, checkbox, link, etc.) by its visible text label in a window. More reliable than coordinates for native Windows apps. Use when you know the button/control text but not its exact position.",
    input_schema: {
      type: 'object',
      properties: {
        window: {  type: 'string', description: "Part of the window title to target, e.g. 'Notepad', 'Discord', 'Chrome'" },
        control: { type: 'string', description: "Visible text of the control to click, e.g. 'OK', 'Send', 'Submit'" },
      },
      required: ['window', 'control'],
    },
  },

  // ── GitHub ──────────────────────────────────────────────────────────────────
  {
    name: 'github_search',
    description: "Search GitHub for repositories, code, issues, or pull requests.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (GitHub search syntax supported)' },
        type:  { type: 'string', enum: ['repositories', 'code', 'issues', 'users'], description: "What to search (default: 'repositories')" },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_get_file',
    description: "Read a file from any public (or your own private) GitHub repository.",
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or org)' },
        repo:  { type: 'string', description: 'Repository name' },
        path:  { type: 'string', description: 'File path within the repo, e.g. README.md or src/index.js' },
        ref:   { type: 'string', description: 'Branch, tag, or commit SHA (default: default branch)' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'github_create_issue',
    description: "Create a GitHub issue on a repository you have access to.",
    input_schema: {
      type: 'object',
      properties: {
        owner:  { type: 'string', description: 'Repository owner' },
        repo:   { type: 'string', description: 'Repository name' },
        title:  { type: 'string', description: 'Issue title' },
        body:   { type: 'string', description: 'Issue body (markdown supported)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Optional label names' },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'github_list_issues',
    description: "List open issues or pull requests for a GitHub repository.",
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo:  { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: "Filter by state (default: 'open')" },
        type:  { type: 'string', enum: ['issues', 'pulls'], description: "List issues or pull requests (default: 'issues')" },
      },
      required: ['owner', 'repo'],
    },
  },
];

// Apps with a usable web version — open these in the panel instead of a native window
const WEB_APP_MAP = {
  spotify:      'https://open.spotify.com',
  youtube:      'https://youtube.com',
  gmail:        'https://mail.google.com',
  github:       'https://github.com',
  reddit:       'https://reddit.com',
  twitter:      'https://twitter.com',
  x:            'https://x.com',
  twitch:       'https://twitch.tv',
  netflix:      'https://netflix.com',
  notion:       'https://notion.so',
  figma:        'https://figma.com',
  'google docs':'https://docs.google.com',
  'google drive':'https://drive.google.com',
  trello:       'https://trello.com',
  linear:       'https://linear.app',
  vercel:       'https://vercel.com',
};

async function executeTool(name, input, onPanel, onConsoleLog) {
  switch (name) {

    case 'web_search': {
      onPanel?.({
        url:   `https://duckduckgo.com/?q=${encodeURIComponent(input.query)}`,
        title: `SEARCH — ${input.query.toUpperCase()}`,
      });
      return webSearch(input.query);
    }

    case 'open_url': {
      onPanel?.({ url: input.url, title: input.title.toUpperCase() });
      return { opened: input.url };
    }

    case 'list_monitors': {
      const map     = getDisplayMap();
      const labels  = { 1: 'rightmost (Widow)', 2: 'primary (center)', 3: 'leftmost' };
      const primary = require('electron').screen.getPrimaryDisplay();
      return Object.entries(map)
        .filter(([, d]) => d !== null)
        .map(([num, d]) => ({
          monitor:     Number(num),
          label:       labels[num],
          primary:     d.id === primary.id,
          width:       d.bounds.width,
          height:      d.bounds.height,
          scaleFactor: d.scaleFactor,
        }));
    }

    case 'move_window': {
      const position = input.position || 'center';
      const hint     = input.window_title;

      if (input.monitor === 'panel') {
        const panel   = getPanelBounds();
        const content = { x: panel.x, y: panel.y + 44, width: panel.width, height: panel.height - 44 };
        onPanel?.({ title: hint.toUpperCase(), content: '' });
        const result = await moveWindow(hint, content, true);
        if (result.success) {
          // Register as a tracked overlay so it follows Widow on monitor change
          const idx = state.overlayWindows.findIndex(o => o.hint === hint);
          if (idx !== -1) state.overlayWindows.splice(idx, 1);
          state.overlayWindows.push({ hint, bounds: content });
        }
        return result;
      }

      // Moving away from panel — remove from overlay tracking
      const idx = state.overlayWindows.findIndex(o => o.hint === hint);
      if (idx !== -1) state.overlayWindows.splice(idx, 1);

      const workArea = getDisplayBounds(input.monitor);
      const target   = getSnapBounds(workArea, position);
      return moveWindow(hint, target, false);
    }

    case 'move_widow':
      return moveWidowToMonitor(input.monitor);

    case 'restart_widow':  return restartWidow();
    case 'reload_renderer': return reloadRenderer();

    case 'get_time':        return getTime();
    case 'get_clipboard':   return getClipboard();
    case 'get_system_info': return getSystemInfo();

    case 'read_file':       return readFile(input.path);
    case 'write_file':      return writeFile(input.path, input.content);
    case 'list_directory':  return listDirectory(input.path);
    case 'move_file':       return moveFile(input.from, input.to);
    case 'copy_file':       return copyFile(input.from, input.to);
    case 'delete_file':     return deleteFile(input.path);

    case 'open_app': {
      const key    = input.name.toLowerCase().trim();
      const webUrl = WEB_APP_MAP[key];

      if (webUrl) {
        onPanel?.({ url: webUrl, title: input.name.toUpperCase() });
        return { opened: input.name, via: 'panel', url: webUrl };
      }

      // Open the panel frame so the orb shifts and the header title shows
      onPanel?.({ title: input.name.toUpperCase(), content: '' });

      // Native app — launch and snap its window over the panel content area
      const hint   = input.window_title || input.name;
      const result = await openNativeInPanel(input.name, hint);
      if (result.success) {
        // Register as a tracked overlay so it follows Widow on monitor change
        const panel   = getPanelBounds();
        const content = { x: panel.x, y: panel.y + 44, width: panel.width, height: panel.height - 44 };
        const idx     = state.overlayWindows.findIndex(o => o.hint === hint);
        if (idx !== -1) state.overlayWindows.splice(idx, 1);
        state.overlayWindows.push({ hint, bounds: content });
      }
      return result;
    }

    case 'delegate_to_agent': {
      const AGENTS = {
        coding:   () => require('../agents/coding'),
        research: () => require('../agents/research'),
        writing:  () => require('../agents/writing'),
      };
      const factory = AGENTS[input.agent];
      if (!factory) return { error: `Unknown agent: ${input.agent}` };
      return factory().run(input.task, input.context, onConsoleLog);
    }

    // ── Desktop automation ────────────────────────────────────────────────────
    case 'mouse_click':
      return click(input.x, input.y, input.button || 'left', input.clicks || 1);
    case 'mouse_scroll':
      return scroll(input.x, input.y, input.amount);
    case 'mouse_drag':
      return drag(input.x1, input.y1, input.x2, input.y2);
    case 'type_text':
      return typeText(input.text);
    case 'key_press':
      return keyPress(input.keys);
    case 'take_screenshot':
      return screenshot(input.region || null);
    case 'get_cursor_pos':
      return getCursor();
    case 'click_ui_control':
      return findClick(input.window, input.control);

    // ── GitHub ────────────────────────────────────────────────────────────────
    case 'github_search':
      return searchGitHub(input.query, input.type || 'repositories');
    case 'github_get_file':
      return getGitHubFile(input.owner, input.repo, input.path, input.ref);
    case 'github_create_issue':
      return createGitHubIssue(input.owner, input.repo, input.title, input.body, input.labels);
    case 'github_list_issues':
      return getGitHubIssues(input.owner, input.repo, input.state || 'open', input.type || 'issues');

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
