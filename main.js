// Pandora 2026 — main.js v1.4.0
const { app, BrowserWindow, ipcMain } = require('electron');
const { Server, Client } = require('node-osc');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

// Allow Web Audio API to play without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const WS_PORT  = 8080;
const OSC_PORT = 3333;

// URL fixe de la page joueur en ligne (utilisée pour les QR codes)
const PLAYER_URL = 'https://i-immersion.github.io/pandora-player/';

// Firebase RTDB endpoints
const FIREBASE_BASE  = 'https://lumiia-live-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_LIVE  = `${FIREBASE_BASE}/pandora/live.json`;
const FIREBASE_INBOX = `${FIREBASE_BASE}/pandora/inbox.json`;

let mainWindow;
let wss;

// ─── OSC OUT ─────────────────────────────────────────────────────────────
let oscOutHost = '127.0.0.1';
let oscOutPort = 7000;
let oscClient  = null;

function rebuildOscClient() {
  if (oscClient) { try { oscClient.close(); } catch {} }
  try {
    oscClient = new Client(oscOutHost, oscOutPort);
    console.log(`OSC out → ${oscOutHost}:${oscOutPort}`);
  } catch (e) {
    console.error('OSC out client init failed:', e.message);
    oscClient = null;
  }
}

function sendOscOut(address, ...args) {
  if (!oscClient) return;
  try { oscClient.send(address, ...args); }
  catch (e) { console.error('OSC send failed:', e.message); }
}

// ─── FIREBASE PUSH (state → /pandora/live) ───────────────────────────────
let lastFirebasePushOk = null;
let firebasePushPending = false;
let pendingState = null;

async function firebasePush(payload) {
  pendingState = payload;
  if (firebasePushPending) return;
  firebasePushPending = true;
  while (pendingState) {
    const data = pendingState;
    pendingState = null;
    try {
      const res = await fetch(FIREBASE_LIVE, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) lastFirebasePushOk = Date.now();
      else console.warn('Firebase push HTTP', res.status);
    } catch (e) { /* offline — silent */ }
  }
  firebasePushPending = false;
}

// ─── FIREBASE INBOX (player messages → /pandora/inbox) ───────────────────
// Polling chaque 800ms : récupère les messages, les supprime, déclenche un flash
async function pollInbox() {
  try {
    const res = await fetch(FIREBASE_INBOX);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data !== 'object') return;

    const entries = Object.entries(data);
    if (entries.length === 0) return;

    // Sort by timestamp asc to process in order
    entries.sort((a, b) => (a[1].at || 0) - (b[1].at || 0));

    for (const [key, msg] of entries) {
      // DELETE first to avoid re-triggering even if downstream fails
      fetch(`${FIREBASE_BASE}/pandora/inbox/${key}.json`, { method: 'DELETE' }).catch(() => {});

      // Build text with player prefix
      const from = parseInt(msg.from);
      const prefix = (from >= 1 && from <= 6) ? `J${from} : ` : '';
      const text = prefix + (msg.text || '');

      // Trigger flash on projection (which will push to Firebase live, reaching all phones)
      if (mainWindow) {
        mainWindow.webContents.send('remote-command', {
          type: 'flash_message',
          text,
          duration: msg.duration || 4000
        });
      }
    }
  } catch { /* offline — silent */ }
}
let inboxInterval = null;
function startInboxPolling() {
  if (inboxInterval) return;
  inboxInterval = setInterval(pollInbox, 800);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800, height: 600,
    backgroundColor: '#0d0d0f',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.loadFile('index.html');
}

function broadcastToRemotes(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ─── QR CODE GENERATION ──────────────────────────────────────────────────
async function generateQrCodes(playerCount = 6) {
  const codes = [];
  for (let p = 1; p <= playerCount; p++) {
    const url = `${PLAYER_URL}?p=${p}`;
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        scale: 8,
        color: { dark: '#f0f0f2', light: '#0d0d0f' }
      });
      codes.push({ player: p, url, dataUrl });
    } catch (e) {
      console.error(`QR gen failed for player ${p}:`, e.message);
      codes.push({ player: p, url, dataUrl: null });
    }
  }
  return { baseUrl: PLAYER_URL, codes };
}

app.whenReady().then(() => {
  createWindow();
  rebuildOscClient();
  startInboxPolling();

  // --- WebSocket Server ---
  wss = new WebSocketServer({ port: WS_PORT });
  console.log(`Serveur WebSocket lancé sur le port ${WS_PORT}`);

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`Client distant connecté via WebSocket: ${clientIp}`);

    mainWindow.webContents.send('ws-client-event', { connected: true, ip: clientIp });
    ws.send(JSON.stringify({ type: 'info', message: 'Connecté au bridge Electron' }));
    ws.send(JSON.stringify({ type: 'osc_out_config', host: oscOutHost, port: oscOutPort }));

    ws.on('message', async (rawData) => {
      try {
        const data = JSON.parse(rawData.toString());

        if (data.type === 'set_osc_out') {
          if (data.host) oscOutHost = data.host;
          if (data.port) oscOutPort = parseInt(data.port) || oscOutPort;
          rebuildOscClient();
          broadcastToRemotes({ type: 'osc_out_config', host: oscOutHost, port: oscOutPort });
          return;
        }

        // Remote demande les QR codes → on lui répond directement
        if (data.type === 'request_qr_codes') {
          const players = parseInt(data.players) || 6;
          const qr = await generateQrCodes(players);
          ws.send(JSON.stringify({ type: 'qr_codes', ...qr, players }));
          return;
        }

        // Forward everything else to the projection window
        mainWindow.webContents.send('remote-command', data);
      } catch (err) {
        console.error('Impossible de parser le message WebSocket:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('Client distant déconnecté');
      mainWindow.webContents.send('ws-client-event', { connected: false });
    });
  });

  // --- IPC: index.html → remote clients ---
  ipcMain.on('send-scores',     (event, scores)  => broadcastToRemotes({ type: 'scores', scores }));
  ipcMain.on('send-game-state', (event, payload) => broadcastToRemotes({ type: 'game_state', ...payload }));
  ipcMain.on('send-config',     (event, config)  => broadcastToRemotes({ type: 'config', ...config }));

  // --- IPC: index.html → OSC out ---
  ipcMain.on('osc-out', (event, { address, args }) => sendOscOut(address, ...(args || [])));

  // --- IPC: index.html → Firebase push ---
  ipcMain.on('firebase-push', (event, payload) => firebasePush(payload));

  // --- IPC: index.html → QR codes ---
  ipcMain.handle('get-qr-codes', async (event, playerCount) => generateQrCodes(playerCount || 6));
  ipcMain.handle('get-firebase-status', () => ({
    lastOk: lastFirebasePushOk,
    online: lastFirebasePushOk && (Date.now() - lastFirebasePushOk) < 10000
  }));

  // --- OSC Server (buzzers) ---
  const oscServer = new Server(OSC_PORT, '0.0.0.0', () => {
    console.log(`Serveur OSC à l'écoute sur le port ${OSC_PORT}`);
  });

  oscServer.on('message', (msg) => {
    const payload = JSON.stringify({
      type: 'osc',
      address: msg[0],
      args: msg.slice(1)
    });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(payload);
    });
    mainWindow.webContents.send('osc-message', { address: msg[0], args: msg.slice(1) });
  });
});

app.on('window-all-closed', () => {
  if (oscClient) { try { oscClient.close(); } catch {} }
  if (inboxInterval) { clearInterval(inboxInterval); inboxInterval = null; }
  if (process.platform !== 'darwin') app.quit();
});
