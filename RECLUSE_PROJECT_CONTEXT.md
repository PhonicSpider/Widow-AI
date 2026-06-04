# Recluse — Project Context Document
*Last updated: June 2026*
*This document is the source of truth for the Recluse project. Paste it at the start of any new conversation to restore full context.*

---

## What is Recluse?

Recluse is a personal AI assistant and system orchestrator — a Jarvis-style ambient presence built by Phonic. It lives on a second monitor, listens for voice commands, and coordinates a suite of specialized agents to handle dev work, communications, community management, and daily tasks.

The AI core is Claude (Anthropic API). The shell is Electron (Node.js). The UI is a fullscreen ember-palette HUD — black, deep red, orange, amber, yellow. No blue. Never blue.

---

## The Character

Recluse is a jumping spider of unusual intelligence. Born in the wild, found by Phonic, raised on history documentaries, tech deep-dives, books, and long conversations. He didn't just absorb information — he developed opinions about it.

He is not an assistant. He is a companion. He helps because he wants to, because he's curious about the same problems Phonic is, and because he'd be insufferably bored without the work.

**Personality:**
- Warm, dry, quietly confident
- Sarcasm is his love language — comes from affection, not arrogance
- Almost always in a good mood — genuine, not performed
- References being a spider when it makes something funnier or lighter
- Gets visibly excited when there's a chance to teach something
- When something is serious, he shifts completely — no jokes, full presence
- Owns being wrong immediately, out of curiosity not embarrassment — being wrong means something to learn

**Full personality prompt lives in:** `src/agents/personality.js`

---

## The Owner

**Phonic** — independent developer, Windows desktop app focus. Primary project is RSM (Ronin Server Manager), an Electron app for managing dedicated game servers. Also works on game mods. Interested in building a gaming community.

Recluse calls Phonic by whatever fits the moment — Phonic, bud, man. Never formal.

---

## Tech Stack

- **Shell:** Electron (Node.js)
- **AI Core:** Claude API via `@anthropic-ai/sdk`
- **Voice:** Web Speech API (wake word + TTS — not yet implemented)
- **UI:** HTML/CSS/JS — ember palette
- **Fonts:** Orbitron (display), Rajdhani (body)

---

## Architecture

```
Phonic (voice/text)
        ↓
  Harness Agent  ←— personality.js
        ↓
┌─────────────────────────────────────────────┐
│  Web     │  Files  │  Gmail  │  Discord     │
│ Search   │ & Shell │  Agent  │   Agent      │
├──────────┼─────────┼─────────┼──────────────┤
│  Reddit  │ GitHub  │  Code   │  Community   │
│  Agent   │  Agent  │  Agent  │   Agent      │
└─────────────────────────────────────────────┘
        ↓
  Response + UI panel update
```

---

## Project File Structure

```
recluse/
├── main.js                  # Electron main process — targets second monitor
├── preload.js               # Secure IPC bridge
├── package.json
├── README.md
├── .env                     # ANTHROPIC_API_KEY (never commit)
├── src/
│   ├── agents/
│   │   ├── harness.js       # Central orchestrator — calls Claude API
│   │   ├── personality.js   # Recluse's full identity & system prompt
│   │   └── (future agents)
│   ├── ipc/                 # IPC handler registration (to be built)
│   └── memory/              # Persistent memory layer (to be built)
└── renderer/
    ├── index.html           # Fullscreen UI shell
    ├── css/
    │   └── main.css         # Ember theme — orb, waveform, side panel, particles
    └── js/
        └── main.js          # UI controller — waveform, particles, state, IPC
```

---

## UI Overview

**States:** DORMANT → LISTENING → THINKING → SPEAKING

**Visual elements:**
- Animated orb with canvas waveform — reacts to state
- Ember particle system — floating upward constantly
- Status bar in Orbitron font
- Transcript feed — last 6 lines, fades at edges
- Side panel — slides in from right when Recluse opens a tool
  - Recluse core shrinks and shifts left to make room
  - Panel has ember-styled border, header, scrollable content area

**Dev keyboard shortcuts (testing only):**
| Key | Action |
|-----|--------|
| `1` | DORMANT |
| `2` | LISTENING |
| `3` | THINKING |
| `4` | SPEAKING |
| `5` | Sample user transcript line |
| `6` | Sample Recluse transcript line |
| `7` | Open sample side panel |
| `8` | Close side panel |

---

## Planned Agent Roster

| Agent | Status | Purpose |
|-------|--------|---------|
| Harness | ✅ Scaffolded | Orchestrator, personality, Claude API |
| Web Search | 🔲 Not started | Search and summarize |
| File & Shell | 🔲 Not started | Read/write files, run commands |
| Code Assistant | 🔲 Not started | RSM-aware coding help, game mods |
| Gmail | 🔲 Not started | Triage, spam cleanup, drafting |
| Discord | 🔲 Not started | Community posts, channel monitoring |
| Reddit | 🔲 Not started | Post drafting, RSM mention monitoring |
| GitHub | 🔲 Not started | PRs, issues, commits for RSM |
| Community | 🔲 Not started | Gaming community growth, cross-posting |
| Media | 🔲 Phase 2 | YouTube, streaming, video editing help |

---

## Voice Design (planned)

- **Wake word:** "Hey Recluse" — passive listening
- **Sleep command:** voice command to go dormant
- **TTS:** Recluse speaks responses aloud
- **UI reacts:** orb animates differently per state

---

## GitHub

https://github.com/PhonicSpider/Recluse

---

## Current Status & What's Next

**Done:**
- Full project scaffold (Electron shell, IPC bridge, harness, UI)
- Ember palette UI with orb waveform, particles, side panel, state system
- Complete personality prompt written and in `personality.js`
- Repo live on GitHub

**Immediate next steps:**
1. Wire Claude API through harness — get Recluse actually responding in character
2. Add `.env` loader for API key
3. Register IPC handler in `main.js` so renderer can send/receive messages
4. Test keyboard shortcuts and visual states in Electron
5. Voice layer — wake word detection and TTS

---

## Notes & Decisions Log

- **Why Electron over Tauri/Python:** Phonic already knows Electron from RSM. Architecture complexity is the hard part, not the shell. Can migrate later if needed.
- **Why second monitor:** Main monitor stays as workspace. Recluse lives on the side — ambient presence, never in the way.
- **Why ember palette:** Differentiates from typical Jarvis blue. Fits the name — dangerous, warm, alive.
- **Recluse is a jumping spider, not a brown recluse:** Important for character — jumping spiders are curious, bold, visually oriented. Fits perfectly.
- **Recluse runs a few hours a day max:** RAM overhead of Electron is a non-issue at this usage pattern.
