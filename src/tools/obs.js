const crypto = require('crypto');

// ============================================================
// OBS WebSocket v5 client
// Requires OBS 28+ with WebSocket server enabled (Tools → WebSocket Server Settings).
//
// Env vars:
//   OBS_WS_URL      ws://localhost:4455  (default)
//   OBS_WS_PASSWORD leave blank if auth is disabled in OBS
// ============================================================

const OBS_URL      = () => process.env.OBS_WS_URL      || 'ws://localhost:4455';
const OBS_PASSWORD = () => process.env.OBS_WS_PASSWORD || '';

// Lazily require ws so the app still starts even if the package isn't installed.
function getWS() {
  try {
    return require('ws');
  } catch {
    return null;
  }
}

// Send a single OBS request and return the responseData.
// Opens a connection, authenticates, sends the request, then closes.
function obsRequest(requestType, requestData = {}) {
  return new Promise((resolve) => {
    const WS = getWS();
    if (!WS) {
      return resolve({ error: 'ws package not installed — run: npm install ws' });
    }

    const ws  = new WS(OBS_URL());
    const rid = Math.random().toString(36).slice(2, 10);
    let identified = false;
    let settled    = false;

    function done(val) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(val);
    }

    const timeout = setTimeout(() => {
      ws.terminate();
      done({ error: 'OBS WebSocket timeout — is OBS running with WebSocket server enabled?' });
    }, 12_000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const { op, d } = msg;

      if (op === 0) {
        // Hello — respond with Identify (+ auth if required)
        const auth   = d?.authentication;
        const secret = OBS_PASSWORD();
        let authStr;

        if (auth && secret) {
          const secretHash = crypto.createHash('sha256')
            .update(secret + auth.salt).digest('base64');
          authStr = crypto.createHash('sha256')
            .update(secretHash + auth.challenge).digest('base64');
        }

        ws.send(JSON.stringify({
          op: 1,
          d:  { rpcVersion: 1, eventSubscriptions: 0, ...(authStr && { authentication: authStr }) },
        }));
      }

      if (op === 2) {
        // Identified — send the actual request
        identified = true;
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: rid, requestData } }));
      }

      if (op === 7 && d?.requestId === rid) {
        // RequestResponse
        ws.close();
        if (!d.requestStatus?.result) {
          done({ error: `OBS: ${d.requestStatus?.comment || `code ${d.requestStatus?.code}`}` });
        } else {
          done(d.responseData ?? { success: true });
        }
      }
    });

    ws.on('error', (err) => {
      done({ error: `OBS WebSocket: ${err.message}` });
    });

    ws.on('close', () => {
      // Resolve with a descriptive error if the socket closed before we finished.
      // If already settled (normal op-7 flow) this is a no-op.
      done(identified
        ? { error: 'OBS connection closed before response — OBS may have crashed or restarted' }
        : { error: 'OBS connection closed — check URL and password' }
      );
    });
  });
}

// ── Scene control ─────────────────────────────────────────────────────────────

async function getScenes() {
  const data = await obsRequest('GetSceneList');
  if (data.error) return data;
  return {
    current: data.currentProgramSceneName,
    preview: data.currentPreviewSceneName || null,
    scenes:  (data.scenes || []).reverse().map(s => s.sceneName),
  };
}

async function setScene(sceneName) {
  const data = await obsRequest('SetCurrentProgramScene', { sceneName });
  return data.error ? data : { success: true, scene: sceneName };
}

// ── Recording ─────────────────────────────────────────────────────────────────

async function startRecording() {
  const data = await obsRequest('StartRecord');
  return data.error ? data : { success: true, recording: true };
}

async function stopRecording() {
  const data = await obsRequest('StopRecord');
  if (data.error) return data;
  return { success: true, recording: false, savedTo: data.outputPath || null };
}

async function toggleRecording() {
  const data = await obsRequest('ToggleRecord');
  return data.error ? data : { success: true, outputActive: data.outputActive };
}

// ── Streaming ─────────────────────────────────────────────────────────────────

async function startStream() {
  const data = await obsRequest('StartStream');
  return data.error ? data : { success: true, streaming: true };
}

async function stopStream() {
  const data = await obsRequest('StopStream');
  return data.error ? data : { success: true, streaming: false };
}

// ── Status ────────────────────────────────────────────────────────────────────

async function getStatus() {
  const [rec, stream, stats] = await Promise.all([
    obsRequest('GetRecordStatus'),
    obsRequest('GetStreamStatus'),
    obsRequest('GetStats'),
  ]);
  return {
    recording:   rec.outputActive   ?? false,
    streaming:   stream.outputActive ?? false,
    recordPaused: rec.outputPaused  ?? false,
    cpuUsage:    stats.cpuUsage     != null ? `${stats.cpuUsage.toFixed(1)}%`   : null,
    memoryMB:    stats.memoryUsage  != null ? Math.round(stats.memoryUsage)     : null,
    fps:         stats.activeFps    != null ? stats.activeFps.toFixed(1)        : null,
    droppedFrames: stats.renderSkippedFrames ?? null,
  };
}

// ── Source visibility ──────────────────────────────────────────────────────────

async function setSourceVisible(sceneName, sourceName, visible) {
  const items = await obsRequest('GetSceneItemList', { sceneName });
  if (items.error) return items;
  const item = (items.sceneItems || []).find(i => i.sourceName === sourceName);
  if (!item) return { error: `Source "${sourceName}" not found in scene "${sceneName}"` };
  const data = await obsRequest('SetSceneItemEnabled', {
    sceneName,
    sceneItemId: item.sceneItemId,
    sceneItemEnabled: visible,
  });
  return data.error ? data : { success: true, sourceName, visible };
}

module.exports = { getScenes, setScene, startRecording, stopRecording, toggleRecording, startStream, stopStream, getStatus, setSourceVisible };
