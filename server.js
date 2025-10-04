const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Map PID to terminal ID
const pidToTerminal = {};

// Store terminal instances
const terminals = {};
const terminalWebSockets = {};

// Hook endpoint
app.post('/hook', (req, res) => {
  const { type, pid, terminal_id } = req.body;
  console.log('Hook received:', { type, pid, terminal_id });

  if (type === 'stop' && terminal_id) {
    // Notify connected clients
    Object.values(terminalWebSockets).forEach(ws => {
      ws.send(JSON.stringify({
        type: 'completion',
        id: terminal_id
      }));
    });
  }

  res.json({ ok: true });
});

wss.on('connection', (ws) => {
  console.log('Client connected');
  const clientId = Math.random().toString(36).substring(7);
  terminalWebSockets[clientId] = ws;

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    console.log('Received message:', data.type, data.id);

    switch (data.type) {
      case 'create':
        createTerminal(ws, data.id);
        break;
      case 'input':
        const preview = data.data.substring(0, 50);
        const hasCarriageReturn = data.data.includes('\r');
        const hasNewline = data.data.includes('\n');
        console.log(`Input to ${data.id}:`, preview, `[CR:${hasCarriageReturn}, NL:${hasNewline}]`);
        if (terminals[data.id]) {
          terminals[data.id].write(data.data);
        } else {
          console.log(`Terminal ${data.id} not found!`);
        }
        break;
      case 'resize':
        if (terminals[data.id]) {
          terminals[data.id].resize(data.cols, data.rows);
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    delete terminalWebSockets[clientId];
    // Clean up terminals
    Object.keys(terminals).forEach(id => {
      if (terminals[id]) {
        terminals[id].kill();
        delete terminals[id];
      }
    });
  });
});

function createTerminal(ws, id) {
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const cwd = process.env.PROJECT_CWD || process.cwd();

  const term = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: cwd,
    env: { ...process.env, TERMINAL_ID: id }
  });

  terminals[id] = term;

  term.onData((data) => {
    ws.send(JSON.stringify({
      type: 'output',
      id: id,
      data: data
    }));
  });

  term.onExit(() => {
    ws.send(JSON.stringify({
      type: 'exit',
      id: id
    }));
    delete terminals[id];
  });

  console.log(`Created terminal: ${id}`);
}

const PORT = process.env.PORT || 3333;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
