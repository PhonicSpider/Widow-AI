const { webSearch, httpRequest } = require('./web');
const { getTime, getClipboard, setClipboard, getSystemInfo, openApp, sendNotification, mediaControl, getVolume, setVolume, getWindowList, calculate, shellExec, openNativeInPanel, moveWindow, moveWidowToMonitor, getPanelBounds, getDisplayMap, getDisplayBounds, getSnapBounds, restartWidow, reloadRenderer } = require('./system');
const { readFile, writeFile, listDirectory, moveFile, copyFile, deleteFile, readFileRange, strReplace, appendFile, searchPath } = require('./files');
const { click, dblClick, rClick, moveMouse, scroll, drag, typeText, keyPress, getCursor, screenshot, findClick } = require('./desktop');
const { searchGitHub, getGitHubFile, createGitHubIssue, getGitHubIssues, getPRStatus } = require('./github');
const { getMessages: discordGetMessages, sendMessage: discordSendMessage, listChannels: discordListChannels, listServers: discordListServers } = require('./discord');
const { getScenes, setScene, startRecording, stopRecording, toggleRecording, startStream, stopStream, getStatus: obsGetStatus, setSourceVisible } = require('./obs');
const { searchVideos, searchChannels: ytSearchChannels, getVideo, getChannel: ytGetChannel, getRecentUploads } = require('./youtube');
const { sendEmail, verifySmtp, listEmails, getEmail, searchEmails, listFolders, deleteEmail, expungeEmail, moveEmail, markEmail, replyEmail, listEmailAccounts } = require('./email');
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
    name: 'set_clipboard',
    description: "Write text to Phonic's clipboard so he can paste it anywhere.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to put on the clipboard' },
      },
      required: ['text'],
    },
  },
  {
    name: 'send_notification',
    description: "Send a Windows desktop notification that appears in the system tray. Use to alert Phonic without speaking — handy when he's in a game, on a call, or has his mic muted.",
    input_schema: {
      type: 'object',
      properties: {
        title:   { type: 'string', description: 'Notification title (short, 1-6 words)' },
        message: { type: 'string', description: 'Notification body text' },
      },
      required: ['title', 'message'],
    },
  },
  {
    name: 'media_control',
    description: "Control media playback or system volume via keyboard media keys. Works with Spotify, YouTube, VLC, games — anything that responds to media keys.",
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play_pause', 'stop', 'next_track', 'prev_track', 'mute', 'volume_up', 'volume_down'],
          description: "Action to perform",
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'get_volume',
    description: "Get the current system master volume level (0–100).",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_volume',
    description: "Set the system master volume to a specific level (0–100).",
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'integer', minimum: 0, maximum: 100, description: 'Volume level 0–100' },
      },
      required: ['level'],
    },
  },
  {
    name: 'get_window_list',
    description: "List all open windows on the system with their titles and process names. Use before move_window or click_ui_control to confirm a window is open and find its exact title.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'http_request',
    description: "Make a raw HTTP/HTTPS request to any URL — local APIs, webhooks, home automation, external services. Returns status code, headers, and body (auto-parsed as JSON if possible).",
    input_schema: {
      type: 'object',
      properties: {
        method:    { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method' },
        url:       { type: 'string', description: 'Full URL including protocol, e.g. https://api.example.com/data or http://localhost:8080/status' },
        headers:   { type: 'object', description: 'Optional request headers as key-value pairs', additionalProperties: { type: 'string' } },
        body:      { description: 'Optional request body — string or JSON object', oneOf: [{ type: 'string' }, { type: 'object' }] },
        timeoutMs: { type: 'integer', description: 'Timeout in milliseconds (default: 15000)' },
      },
      required: ['method', 'url'],
    },
  },
  {
    name: 'calculate',
    description: "Evaluate a math expression reliably using Python. Use for anything numerical — arithmetic, percentages, square roots, unit conversions, powers, trig. More reliable than mental math. Examples: '1920 * 1080', 'sqrt(144)', '100 * 1.15 ** 5', 'sin(pi/4)'.",
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: "Math expression to evaluate, e.g. '(450 * 1.08) / 12' or 'sqrt(2) * 100'" },
      },
      required: ['expression'],
    },
  },
  {
    name: 'shell_exec',
    description: "Run a command in PowerShell or CMD on Phonic's system. Use for anything not covered by other tools: running scripts, git commands, npm/pip/python commands, querying system state, managing processes, compiling code, checking installed software, etc. Prefer PowerShell for most tasks.",
    input_schema: {
      type: 'object',
      properties: {
        command:   { type: 'string', description: 'The command to run' },
        shell:     { type: 'string', enum: ['powershell', 'cmd'], description: "Shell to use: 'powershell' (default) or 'cmd'" },
        cwd:       { type: 'string', description: 'Working directory to run the command in (optional)' },
        timeoutMs: { type: 'integer', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
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
    name: 'str_replace',
    description: "Make a surgical edit to a file — finds oldStr and replaces it with newStr. oldStr must match exactly once in the file. Use this for targeted changes to existing files instead of rewriting the whole file. Always read the relevant section first so oldStr matches exactly.",
    input_schema: {
      type: 'object',
      properties: {
        path:   { type: 'string', description: 'Absolute path to the file' },
        oldStr: { type: 'string', description: 'The exact text to replace. Must appear exactly once in the file. Include enough surrounding context (nearby lines, function signature) to make it unique.' },
        newStr: { type: 'string', description: 'The replacement text. Can be empty string to delete.' },
      },
      required: ['path', 'oldStr', 'newStr'],
    },
  },
  {
    name: 'read_file_range',
    description: "Read only a specific range of lines from a file. Use when you only need a section of a large file — avoids loading the whole file into context. Returns line numbers so you can read further chunks if needed.",
    input_schema: {
      type: 'object',
      properties: {
        path:      { type: 'string', description: 'Absolute path to the file' },
        startLine: { type: 'integer', description: 'First line to read (1-indexed)' },
        endLine:   { type: 'integer', description: 'Last line to read (inclusive). Omit to read to end of file.' },
      },
      required: ['path', 'startLine'],
    },
  },
  {
    name: 'write_file',
    description: "Write or overwrite a file on Phonic's system. Creates parent directories if needed. For editing existing files prefer str_replace instead — only use write_file for new files or complete rewrites.",
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
    name: 'search_path',
    description: "Search for a file or folder by name across drives without needing the full path. Use this whenever Phonic mentions a folder or file by name but doesn't give the full path — e.g. 'find Ronin_Disk_Manager' or 'where is my resume'. Searches C:\\ and D:\\ by default. Returns all matching full paths.",
    input_schema: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'File or folder name to search for. Supports wildcards e.g. "Ronin*" or "*.pdf"' },
        roots: { type: 'array', items: { type: 'string' }, description: 'Root paths to search from. Default: ["C:\\\\", "D:\\\\"]' },
        type:  { type: 'string', enum: ['any', 'file', 'folder'], description: 'Limit to files, folders, or both. Default: any' },
      },
      required: ['name'],
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
    description: "Delegate a complex task to a specialized sub-agent. Use 'coding' for programming tasks, 'research' for in-depth multi-source research, 'writing' for creative/long-form writing, 'image' for generating any image from a description, 'email' for reading/managing/analysing emails including spam and phishing detection. The agent runs on a cheaper model and returns a result.",
    input_schema: {
      type: 'object',
      properties: {
        agent:   { type: 'string', enum: ['coding', 'research', 'writing', 'image', 'email'], description: "Which agent: 'coding' for code/files, 'research' for deep web research, 'writing' for creative writing, 'image' for image generation, 'email' for email reading/sending/managing/phishing analysis" },
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
  {
    name: 'github_get_pr',
    description: "Get the status and details of a specific GitHub pull request — state, branch, merge status, author, and review checks.",
    input_schema: {
      type: 'object',
      properties: {
        owner:  { type: 'string', description: 'Repository owner' },
        repo:   { type: 'string', description: 'Repository name' },
        number: { type: 'integer', description: 'Pull request number' },
      },
      required: ['owner', 'repo', 'number'],
    },
  },

  // ── Discord ─────────────────────────────────────────────────────────────────
  {
    name: 'discord_list_servers',
    description: "List all Discord servers the bot is in. Run this first to get server IDs if you don't know them.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'discord_list_channels',
    description: "List text channels in a Discord server.",
    input_schema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Discord server (guild) ID' },
      },
      required: ['server_id'],
    },
  },
  {
    name: 'discord_get_messages',
    description: "Read recent messages from a Discord channel.",
    input_schema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: 'Discord channel ID' },
        limit:      { type: 'integer', description: 'Number of messages to fetch (1–100, default 20)' },
      },
      required: ['channel_id'],
    },
  },
  {
    name: 'discord_send_message',
    description: "Send a message to a Discord channel.",
    input_schema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: 'Discord channel ID' },
        content:    { type: 'string', description: 'Message text (max 2000 chars)' },
      },
      required: ['channel_id', 'content'],
    },
  },

  // ── OBS ──────────────────────────────────────────────────────────────────────
  {
    name: 'obs_get_status',
    description: "Get OBS status — whether it's recording or streaming, FPS, CPU usage.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'obs_get_scenes',
    description: "List all OBS scenes and which one is currently active.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'obs_set_scene',
    description: "Switch OBS to a different scene.",
    input_schema: {
      type: 'object',
      properties: {
        scene: { type: 'string', description: 'Exact scene name as shown in OBS' },
      },
      required: ['scene'],
    },
  },
  {
    name: 'obs_start_recording',
    description: "Start OBS recording.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'obs_stop_recording',
    description: "Stop OBS recording. Returns the path of the saved file.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'obs_toggle_recording',
    description: "Toggle OBS recording on or off.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'obs_start_stream',
    description: "Start OBS streaming.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'obs_stop_stream',
    description: "Stop OBS streaming.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'obs_set_source_visible',
    description: "Show or hide a source in an OBS scene.",
    input_schema: {
      type: 'object',
      properties: {
        scene:   { type: 'string',  description: 'Scene name' },
        source:  { type: 'string',  description: 'Source name' },
        visible: { type: 'boolean', description: 'true to show, false to hide' },
      },
      required: ['scene', 'source', 'visible'],
    },
  },

  // ── YouTube ──────────────────────────────────────────────────────────────────
  {
    name: 'youtube_search',
    description: "Search YouTube for videos. Returns title, channel, views, duration, and URL.",
    input_schema: {
      type: 'object',
      properties: {
        query:      { type: 'string',  description: 'Search query' },
        maxResults: { type: 'integer', description: 'Number of results (1–25, default 8)' },
        order:      { type: 'string',  enum: ['relevance', 'date', 'viewCount', 'rating'], description: "Sort order (default: 'relevance')" },
      },
      required: ['query'],
    },
  },
  {
    name: 'youtube_get_video',
    description: "Get detailed stats for a YouTube video — views, likes, comments, duration, description.",
    input_schema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: 'YouTube video ID (the part after ?v= in the URL)' },
      },
      required: ['video_id'],
    },
  },
  {
    name: 'youtube_get_channel',
    description: "Get a YouTube channel's info — subscriber count, total views, video count.",
    input_schema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: 'Channel ID (UCxxx) or handle (@handle)' },
      },
      required: ['channel_id'],
    },
  },
  {
    name: 'youtube_recent_uploads',
    description: "Get the most recent videos uploaded by a YouTube channel.",
    input_schema: {
      type: 'object',
      properties: {
        channel_id:  { type: 'string',  description: 'Channel ID (UCxxx)' },
        maxResults:  { type: 'integer', description: 'Number of videos (1–25, default 5)' },
      },
      required: ['channel_id'],
    },
  },

  // ── Email ────────────────────────────────────────────────────────────────────
  {
    name: 'send_email',
    description: "Send an email via SMTP. Requires SMTP settings in .env (see SMTP_HOST, SMTP_USER, SMTP_PASS). Works with Gmail app passwords, Outlook, and any SMTP server.",
    input_schema: {
      type: 'object',
      properties: {
        to:      { type: 'string', description: 'Recipient address or "Name <email>"' },
        subject: { type: 'string', description: 'Email subject line' },
        text:    { type: 'string', description: 'Plain-text body' },
        html:    { type: 'string', description: 'Optional HTML body (overrides text display in HTML-capable clients)' },
        cc:      { type: 'string', description: 'Optional CC address(es)' },
        bcc:     { type: 'string', description: 'Optional BCC address(es)' },
      },
      required: ['to', 'subject', 'text'],
    },
  },
  {
    name: 'verify_smtp',
    description: "Test the SMTP connection to confirm email is configured correctly before trying to send.",
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account name or number to test. Defaults to primary.' },
      },
    },
  },
  {
    name: 'list_email_accounts',
    description: "List all configured email accounts (IMAP and SMTP) with their names and addresses.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'email_list',
    description: "Quickly list recent emails from a mailbox folder. For richer email tasks (reading bodies, phishing analysis, bulk management) use delegate_to_agent with agent='email' instead.",
    input_schema: {
      type: 'object',
      properties: {
        folder:     { type: 'string',  description: "Folder to list — INBOX, Sent, Trash, Spam, etc. Default: INBOX" },
        limit:      { type: 'integer', description: 'Number of emails to return (default: 20)' },
        unreadOnly: { type: 'boolean', description: 'Return only unread messages' },
        account:    { type: 'string',  description: 'Account name (e.g. "personal", "work") or number. Defaults to primary.' },
      },
    },
  },
  {
    name: 'email_search',
    description: "Search emails by sender, subject, or keyword. For full email bodies and phishing analysis use delegate_to_agent with agent='email'.",
    input_schema: {
      type: 'object',
      properties: {
        folder:  { type: 'string',  description: 'Folder to search (default: INBOX)' },
        from:    { type: 'string',  description: 'Sender address or name fragment' },
        subject: { type: 'string',  description: 'Subject keyword' },
        query:   { type: 'string',  description: 'Full-text keyword (slow)' },
        unread:  { type: 'boolean', description: 'Only unread' },
        limit:   { type: 'integer', description: 'Max results (default: 20)' },
        account: { type: 'string',  description: 'Account name or number. Defaults to primary.' },
      },
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
  const path = require('path');
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

    case 'get_time':          return getTime();
    case 'get_clipboard':     return getClipboard();
    case 'set_clipboard':     return setClipboard(input.text);
    case 'send_notification': return sendNotification(input.title, input.message);
    case 'media_control':     return mediaControl(input.action);
    case 'get_volume':        return getVolume();
    case 'set_volume':        return setVolume(input.level);
    case 'get_window_list':   return getWindowList();
    case 'http_request':      return httpRequest(input.method, input.url, input.headers || {}, input.body || null, input.timeoutMs || 15_000);
    case 'calculate':         return calculate(input.expression);
    case 'shell_exec':        return shellExec(input.command, { shell: input.shell, cwd: input.cwd, timeoutMs: input.timeoutMs });
    case 'get_system_info':   return getSystemInfo();

    case 'read_file':         return readFile(input.path);
    case 'read_file_range':   return readFileRange(input.path, input.startLine, input.endLine);
    case 'str_replace':       return strReplace(input.path, input.oldStr, input.newStr);
    case 'write_file':        return writeFile(input.path, input.content);
    case 'list_directory':    return listDirectory(input.path);
    case 'search_path':       return searchPath(input.name, { roots: input.roots, type: input.type });
    case 'move_file':         return moveFile(input.from, input.to);
    case 'copy_file':         return copyFile(input.from, input.to);
    case 'delete_file':       return deleteFile(input.path);

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
        image:    () => require('../agents/image'),
        email:    () => require('../agents/email'),
      };
      const factory = AGENTS[input.agent];
      if (!factory) return { error: `Unknown agent: ${input.agent}` };

      // Pre-read any files mentioned in the task so the coding agent has full
      // context on turn 1 without spending a round-trip on read_file calls.
      let enrichedContext = input.context || '';
      if (input.agent === 'coding') {
        const WIDOW_ROOT   = path.resolve(__dirname, '../..');
        const pathPattern  = /([A-Za-z]:[\\/][\w\\/.\-]+\.\w+|(?:src|renderer|scripts|main|preload)[\\/][\w\\/.\-]+\.\w+)/g;
        const matches      = [...new Set([
          ...(input.task.match(pathPattern) || []),
          ...(enrichedContext.match(pathPattern) || []),
        ])];

        const fileSnippets = [];
        for (const rawPath of matches) {
          const absPath = path.isAbsolute(rawPath) ? rawPath : path.join(WIDOW_ROOT, rawPath);
          const result  = readFile(absPath);
          if (!result.error) {
            if (result.lines <= 300) {
              fileSnippets.push(`\n\n--- PRE-READ: ${absPath} (${result.lines} lines) ---\n${result.content}\n--- END ---`);
            } else {
              const preview = result.content.split('\n').slice(0, 150).join('\n');
              fileSnippets.push(`\n\n--- PRE-READ: ${absPath} (${result.lines} lines — large, showing first 150) ---\n${preview}\n--- Use read_file_range to read more sections ---`);
            }
          }
        }

        if (fileSnippets.length > 0) {
          enrichedContext = (enrichedContext ? enrichedContext + '\n' : '') +
            'Files referenced in this task (pre-read for you):' + fileSnippets.join('');
        }
      }

      return factory().run(input.task, enrichedContext, onConsoleLog, onPanel);
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
    case 'github_get_pr':
      return getPRStatus(input.owner, input.repo, input.number);

    // ── Discord ───────────────────────────────────────────────────────────────
    case 'discord_list_servers':    return discordListServers();
    case 'discord_list_channels':   return discordListChannels(input.server_id);
    case 'discord_get_messages':    return discordGetMessages(input.channel_id, input.limit || 20);
    case 'discord_send_message':    return discordSendMessage(input.channel_id, input.content);

    // ── OBS ───────────────────────────────────────────────────────────────────
    case 'obs_get_status':          return obsGetStatus();
    case 'obs_get_scenes':          return getScenes();
    case 'obs_set_scene':           return setScene(input.scene);
    case 'obs_start_recording':     return startRecording();
    case 'obs_stop_recording':      return stopRecording();
    case 'obs_toggle_recording':    return toggleRecording();
    case 'obs_start_stream':        return startStream();
    case 'obs_stop_stream':         return stopStream();
    case 'obs_set_source_visible':  return setSourceVisible(input.scene, input.source, input.visible);

    // ── YouTube ───────────────────────────────────────────────────────────────
    case 'youtube_search':          return searchVideos(input.query, { maxResults: input.maxResults, order: input.order });
    case 'youtube_get_video':       return getVideo(input.video_id);
    case 'youtube_get_channel':     return ytGetChannel(input.channel_id);
    case 'youtube_recent_uploads':  return getRecentUploads(input.channel_id, input.maxResults);

    // ── Email ─────────────────────────────────────────────────────────────────
    case 'send_email':           return sendEmail(input);
    case 'verify_smtp':          return verifySmtp(input.account);
    case 'email_list':           return listEmails({ folder: input.folder, limit: input.limit, unreadOnly: input.unreadOnly, account: input.account });
    case 'email_search':         return searchEmails(input);
    case 'list_email_accounts':  return listEmailAccounts();

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
