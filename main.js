const { app, BrowserWindow, ipcMain } = require('electron');
const { Server, Client } = require('node-osc');
const { WebSocketServer } = require('ws');
const path = require('path');

let mainWindow;
let wss;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

// Broadcast a message to all connected WebSocket clients
function broadcastToRemotes(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

app.whenReady().then(() => {
  createWindow();

  // --- WebSocket Server (Port 8080) ---
  wss = new WebSocketServer({ port: 8080 });
  console.log('Serveur WebSocket lancé sur le port 8080');

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`Client distant connecté via WebSocket: ${clientIp}`);

    mainWindow.webContents.send('ws-client-event', { connected: true, ip: clientIp });
    ws.send(JSON.stringify({ type: 'info', message: 'Connecté au bridge Electron' }));

    ws.on('message', (rawData) => {
      try {
        const data = JSON.parse(rawData.toString());
        console.log('Message reçu du client distant:', data);

        // Forward all remote commands to the Electron window
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
  // index.html sends scores: { scores: [{player, score}, ...] }
  ipcMain.on('send-scores', (event, scores) => {
    broadcastToRemotes({ type: 'scores', scores });
  });

  // index.html sends game state update: { state, remaining }
  ipcMain.on('send-game-state', (event, payload) => {
    broadcastToRemotes({ type: 'game_state', ...payload });
  });

  // index.html sends config sync (players count, duration)
  ipcMain.on('send-config', (event, config) => {
    broadcastToRemotes({ type: 'config', ...config });
  });

  // --- OSC Server (Port 3333) ---
  const oscServer = new Server(3333, '0.0.0.0', () => {
    console.log('Serveur OSC à l\'écoute sur le port 3333');
  });

  oscServer.on('message', (msg) => {
    console.log(`Message OSC reçu : ${msg}`);

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
  if (process.platform !== 'darwin') app.quit();
});
