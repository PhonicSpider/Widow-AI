const { webSearch } = require('./web');
const { getTime, getClipboard, getSystemInfo, openApp, openNativeInPanel, moveWindow, moveRecluseToMonitor, getPanelBounds, getDisplayMap, getDisplayBounds, getSnapBounds } = require('./system');
const { readFile, writeFile, listDirectory, moveFile, copyFile, deleteFile } = require('./files');
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
    description: "List all connected monitors. Monitor 1 = rightmost (Recluse's home), Monitor 2 = Windows primary (center), Monitor 3 = leftmost. Use this to confirm layout before moving windows.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'move_window',
    description: "Move any open window to a specific monitor and snap zone. Monitor 1 = rightmost (Recluse's display), Monitor 2 = primary/center, Monitor 3 = leftmost. Use list_monitors if unsure.",
    input_schema: {
      type: 'object',
      properties: {
        window_title: {
          type: 'string',
          description: "Part of the window title to search for, e.g. 'Visual Studio Code', 'Discord', 'Minecraft'",
        },
        monitor: {
          description: "Which monitor: 1=rightmost, 2=primary/center, 3=leftmost. Or 'panel' to snap into Recluse's side panel.",
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
    description: "Launch an app and display it inside Recluse's UI panel. Web-capable apps (Spotify, Discord, YouTube, etc.) open as a web view inside the panel. Native apps and games are launched and their window is automatically resized and snapped over the panel so it appears embedded in the UI.",
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
    name: 'move_recluse',
    description: "Move Recluse herself to a different monitor. All active overlay windows follow automatically, preserving their relative positions. Monitor 1 = rightmost (her normal home), Monitor 2 = primary/center, Monitor 3 = leftmost.",
    input_schema: {
      type: 'object',
      properties: {
        monitor: { type: 'integer', minimum: 1, maximum: 3, description: 'Target monitor (1=rightmost, 2=primary/center, 3=leftmost)' },
      },
      required: ['monitor'],
    },
  },
  {
    name: 'delegate_to_agent',
    description: "Delegate a complex task to a specialized sub-agent. Use 'coding' for any programming task: writing scripts, debugging, editing files, explaining code, installing packages, or modifying Recluse's own source code. The agent runs its own tool-use loop and returns a plain-text result for you to synthesize into a spoken reply.",
    input_schema: {
      type: 'object',
      properties: {
        agent:   { type: 'string', enum: ['coding'], description: "Which agent to delegate to. Currently: 'coding'" },
        task:    { type: 'string', description: 'Full task description — be specific and include all relevant detail' },
        context: { type: 'string', description: 'Optional: any context the agent should know (e.g. file paths, prior conversation details, constraints)' },
      },
      required: ['agent', 'task'],
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

async function executeTool(name, input, onPanel) {
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
      const labels  = { 1: 'rightmost (Recluse)', 2: 'primary (center)', 3: 'leftmost' };
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
          // Register as a tracked overlay so it follows Recluse on monitor change
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

    case 'move_recluse':
      return moveRecluseToMonitor(input.monitor);

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
        // Register as a tracked overlay so it follows Recluse on monitor change
        const panel   = getPanelBounds();
        const content = { x: panel.x, y: panel.y + 44, width: panel.width, height: panel.height - 44 };
        const idx     = state.overlayWindows.findIndex(o => o.hint === hint);
        if (idx !== -1) state.overlayWindows.splice(idx, 1);
        state.overlayWindows.push({ hint, bounds: content });
      }
      return result;
    }

    case 'delegate_to_agent': {
      const AGENTS = { coding: () => require('../agents/coding') };
      const factory = AGENTS[input.agent];
      if (!factory) return { error: `Unknown agent: ${input.agent}` };
      return factory().run(input.task, input.context);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
