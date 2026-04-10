const express = require('express');
const fs = require('fs');
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

// Store terminal instances
const terminals = {};
const terminalWebSockets = {};

// Store actual server port
let serverPort = null;

// Debounce hook requests to prevent duplicates
const lastHookTime = {};
const HOOK_DEBOUNCE_MS = 1000;

function buildTerminalPath(basePath = '') {
  const segments = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];

  if (basePath) {
    segments.push(...basePath.split(':'));
  }

  return [...new Set(segments.filter(Boolean))].join(':');
}

function resolveShell() {
  if (os.platform() === 'win32') {
    return {
      shell: 'powershell.exe',
      args: []
    };
  }

  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    'zsh',
    'bash',
    'sh'
  ].filter(Boolean);

  const shell = candidates.find(candidate => candidate.includes('/') ? fs.existsSync(candidate) : true) || 'sh';

  return {
    shell,
    args: ['-l']
  };
}

// Hook endpoint
app.post('/hook', (req, res) => {
  const { type, pid, terminal_id } = req.body;
  console.log('Hook received:', { type, pid, terminal_id });

  if (type === 'stop' && terminal_id) {
    const now = Date.now();
    const lastTime = lastHookTime[terminal_id] || 0;

    // Debounce: ignore if hook fired too recently
    if (now - lastTime < HOOK_DEBOUNCE_MS) {
      console.log(`[Debounced] Ignoring duplicate hook for ${terminal_id}`);
      res.json({ ok: true, debounced: true });
      return;
    }

    lastHookTime[terminal_id] = now;

    // Notify connected clients
    Object.values(terminalWebSockets).forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify({
          type: 'completion',
          id: terminal_id
        }));
      }
    });
  }

  res.json({ ok: true });
});

wss.on('connection', (ws) => {
  const clientId = Math.random().toString(36).substring(7);
  terminalWebSockets[clientId] = ws;
  console.log(`Client connected: ${clientId} (total: ${Object.keys(terminalWebSockets).length})`);

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
    delete terminalWebSockets[clientId];
    const remainingClients = Object.keys(terminalWebSockets).length;
    console.log(`Client disconnected: ${clientId} (remaining: ${remainingClients})`);

    // Only kill terminals when last client disconnects
    if (remainingClients === 0) {
      console.log('Last client disconnected, cleaning up terminals...');
      Object.keys(terminals).forEach(id => {
        if (terminals[id]) {
          terminals[id].kill();
          delete terminals[id];
        }
      });
    }
  });
});

function createTerminal(ws, id) {
  const { shell, args } = resolveShell();
  const cwd = process.env.PROJECT_CWD || process.cwd();
  const env = {
    ...process.env,
    PATH: buildTerminalPath(process.env.PATH),
    TERMINAL_ID: id,
    ORCHESTRATION_PORT: serverPort || 3333
  };

  let term;
  try {
    term = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: cwd,
      env
    });
  } catch (err) {
    const message = `Failed to create terminal ${id}: ${err.message}\r\n`;
    console.error(message.trim());
    ws.send(JSON.stringify({
      type: 'output',
      id: id,
      data: message
    }));
    return;
  }

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

  console.log(`Created terminal: ${id} (${shell})`);
}

// Find available port starting from preferred port
function findAvailablePort(startPort, maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attempts = 0;

    const tryPort = () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`No available port found after ${maxAttempts} attempts`));
        return;
      }

      const testServer = require('net').createServer();

      testServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${port} is busy, trying ${port + 1}...`);
          port++;
          attempts++;
          tryPort();
        } else {
          reject(err);
        }
      });

      testServer.once('listening', () => {
        testServer.close(() => {
          resolve(port);
        });
      });

      testServer.listen(port);
    };

    tryPort();
  });
}

const preferredPort = parseInt(process.env.PORT) || 53333;

findAvailablePort(preferredPort).then(PORT => {
  serverPort = PORT; // Store actual port globally

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (PORT !== preferredPort) {
      console.log(`Note: Preferred port ${preferredPort} was busy, using ${PORT} instead`);
    }
  });

  // Handle server errors
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`ERROR: Port ${PORT} is already in use`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('\nSIGINT received, closing server...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}).catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
