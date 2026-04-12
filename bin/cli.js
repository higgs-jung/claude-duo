#!/usr/bin/env node
const { exec, execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const command = process.argv[2];
const forceFlag = process.argv.includes('--force') || process.argv.includes('-f');
const fullAccessFlag = process.argv.includes('--full-access');
const startArgs = command === 'start' ? process.argv.slice(3) : [];
const yoloFlag = startArgs.includes('yolo');
const tmuxModeFlag = startArgs.includes('tmux');

if (command === 'init') {
  init(forceFlag);
} else if (command === 'backup') {
  backup();
} else if (command === 'uninstall') {
  uninstall();
} else if (command === '__tmux-relay') {
  runTmuxRelay();
} else if (command === 'start' || !command) {
  start().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else {
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log('Usage:');
  console.log('  cduo init          - Initialize orchestration files in current directory');
  console.log('  cduo init --force  - Force overwrite orchestration settings');
  console.log('  cduo backup        - Backup current orchestration-related files');
  console.log('  cduo uninstall     - Remove orchestration hook/context from current directory');
  console.log('  cduo start         - Start orchestration server');
  console.log('  cduo start tmux    - Run cduo in a local tmux session');
  console.log('  cduo start --full-access  - Launch Claude in bypass-permissions mode');
  console.log('  cduo start yolo    - Launch Claude with --dangerously-skip-permissions');
}

function resolveClaudeLaunchMode() {
  if (yoloFlag) {
    return {
      label: 'yolo',
      command: 'claude --dangerously-skip-permissions'
    };
  }

  if (fullAccessFlag) {
    return {
      label: 'full access',
      command: 'claude --permission-mode bypassPermissions'
    };
  }

  return {
    label: null,
    command: 'claude'
  };
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

  const shell = candidates.find((candidate) => (
    candidate.includes('/') ? fs.existsSync(candidate) : true
  )) || 'sh';

  return {
    shell,
    args: ['-l']
  };
}

function hasCommand(commandName) {
  const result = spawnSync(commandName, ['-V'], {
    stdio: 'ignore'
  });

  if (result.error && result.error.code === 'ENOENT') {
    return false;
  }

  return result.status === 0 || result.status === 1 || !result.error;
}

function getTmuxInstallHint() {
  if (process.platform === 'darwin') {
    return 'Install tmux first: brew install tmux';
  }

  if (process.platform === 'linux') {
    return 'Install tmux first: sudo apt install tmux  # or sudo dnf install tmux / sudo pacman -S tmux';
  }

  return 'Install tmux first and retry.';
}

function findAvailablePort(startPort, maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attempts = 0;

    const tryPort = () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`No available port found after ${maxAttempts} attempts`));
        return;
      }

      const testServer = net.createServer();

      testServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${port} is busy, trying ${port + 1}...`);
          port += 1;
          attempts += 1;
          tryPort();
        } else {
          reject(err);
        }
      });

      testServer.once('listening', () => {
        testServer.close(() => resolve(port));
      });

      testServer.listen(port);
    };

    tryPort();
  });
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }

  return process.argv[index + 1];
}

function getProjectPaths(cwd) {
  return {
    cwd,
    claudeDir: path.join(cwd, '.claude'),
    settingsTarget: path.join(cwd, '.claude', 'settings.local.json'),
    claudeMdTarget: path.join(cwd, 'CLAUDE.md'),
    backupRoot: path.join(cwd, '.cduo', 'backups')
  };
}

function getTemplateSettings() {
  const settingsTemplate = path.join(__dirname, '..', '.claude', 'settings.template.json');
  return JSON.parse(fs.readFileSync(settingsTemplate, 'utf8'));
}

function getOrchestrationSourcePath() {
  const candidates = [
    path.join(__dirname, '..', 'CLAUDE.md'),
    path.join(__dirname, '..', 'claude.md')
  ];

  const source = candidates.find(candidate => fs.existsSync(candidate));
  if (!source) {
    throw new Error('Could not find orchestration template (CLAUDE.md or claude.md)');
  }

  return source;
}

function getOrchestrationContent() {
  return fs.readFileSync(getOrchestrationSourcePath(), 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function inspectSettings(cwd) {
  const { settingsTarget } = getProjectPaths(cwd);

  if (!fs.existsSync(settingsTarget)) {
    return {
      exists: false,
      hasStopHook: false
    };
  }

  try {
    const content = JSON.parse(fs.readFileSync(settingsTarget, 'utf8'));
    const stopHooks = content?.hooks?.Stop;
    return {
      exists: true,
      hasStopHook: Array.isArray(stopHooks) && stopHooks.length > 0,
      content
    };
  } catch (error) {
    return {
      exists: true,
      hasStopHook: false,
      error
    };
  }
}

function inspectClaudeMd(cwd) {
  const { claudeMdTarget } = getProjectPaths(cwd);

  if (!fs.existsSync(claudeMdTarget)) {
    return {
      exists: false,
      hasOrchestration: false
    };
  }

  const content = fs.readFileSync(claudeMdTarget, 'utf8');
  return {
    exists: true,
    hasOrchestration: content.includes('Claude Code Orchestration Mode'),
    content
  };
}

function createBackup(cwd, {
  reason = 'manual',
  includeSettings = true,
  includeClaudeMd = true,
  log = false
} = {}) {
  const { settingsTarget, claudeMdTarget, backupRoot } = getProjectPaths(cwd);
  const files = [];

  if (includeSettings && fs.existsSync(settingsTarget)) {
    files.push({
      source: settingsTarget,
      name: 'settings.local.json',
      target: '.claude/settings.local.json'
    });
  }

  if (includeClaudeMd && fs.existsSync(claudeMdTarget)) {
    files.push({
      source: claudeMdTarget,
      name: 'CLAUDE.md',
      target: 'CLAUDE.md'
    });
  }

  if (files.length === 0) {
    if (log) {
      console.log('⚠ Nothing to backup in the current directory');
    }
    return { created: false };
  }

  ensureDir(backupRoot);

  let backupDir = path.join(backupRoot, createTimestamp());
  let suffix = 1;
  while (fs.existsSync(backupDir)) {
    backupDir = path.join(backupRoot, `${createTimestamp()}-${suffix}`);
    suffix += 1;
  }

  ensureDir(backupDir);

  for (const file of files) {
    fs.copyFileSync(file.source, path.join(backupDir, file.name));
  }

  writeJson(path.join(backupDir, 'manifest.json'), {
    createdAt: new Date().toISOString(),
    reason,
    cwd,
    files: files.map(file => file.target)
  });

  if (log) {
    console.log(`✓ Created backup at ${path.relative(cwd, backupDir)}`);
  }

  return {
    created: true,
    dir: backupDir,
    files: files.map(file => file.target)
  };
}

function ensureStopHook(cwd, {
  force = false,
  log = false,
  backupReason = null
} = {}) {
  const { claudeDir, settingsTarget } = getProjectPaths(cwd);
  const template = getTemplateSettings();
  const inspection = inspectSettings(cwd);

  if (!fs.existsSync(claudeDir)) {
    ensureDir(claudeDir);
    if (log) {
      console.log('✓ Created .claude/ directory');
    }
  }

  if (!inspection.exists || force) {
    if (backupReason && inspection.exists) {
      createBackup(cwd, {
        reason: backupReason,
        includeSettings: true,
        includeClaudeMd: false,
        log
      });
    }

    writeJson(settingsTarget, template);
    if (log) {
      console.log(force && inspection.exists
        ? '✓ Updated .claude/settings.local.json (force overwrite)'
        : '✓ Created .claude/settings.local.json');
    }
    return { changed: true, created: !inspection.exists };
  }

  if (inspection.error) {
    if (log) {
      console.log(`⚠ Could not merge settings.local.json: ${inspection.error.message}`);
      console.log('  Use cduo init --force to overwrite');
    }
    return { changed: false, created: false, error: inspection.error };
  }

  const next = {
    ...inspection.content,
    hooks: {
      ...(inspection.content.hooks || {}),
      Stop: template.hooks.Stop
    }
  };

  const existingSerialized = JSON.stringify(inspection.content);
  const nextSerialized = JSON.stringify(next);

  if (existingSerialized !== nextSerialized) {
    if (backupReason) {
      createBackup(cwd, {
        reason: backupReason,
        includeSettings: true,
        includeClaudeMd: false,
        log
      });
    }

    writeJson(settingsTarget, next);
    if (log) {
      console.log('✓ Updated .claude/settings.local.json (merged Stop hook)');
    }
    return { changed: true, created: false };
  }

  if (log) {
    console.log('✓ .claude/settings.local.json already has the orchestration Stop hook');
  }

  return { changed: false, created: false };
}

function ensureClaudeMd(cwd, {
  force = false,
  log = false,
  backupReason = null
} = {}) {
  const { claudeMdTarget } = getProjectPaths(cwd);
  const orchestrationContent = getOrchestrationContent();
  const inspection = inspectClaudeMd(cwd);

  if (!inspection.exists) {
    fs.writeFileSync(claudeMdTarget, orchestrationContent);
    if (log) {
      console.log('✓ Created CLAUDE.md');
    }
    return { changed: true, created: true };
  }

  if (force) {
    if (backupReason) {
      createBackup(cwd, {
        reason: backupReason,
        includeSettings: false,
        includeClaudeMd: true,
        log
      });
    }

    fs.writeFileSync(claudeMdTarget, orchestrationContent);
    if (log) {
      console.log('✓ Updated CLAUDE.md (force overwrite)');
    }
    return { changed: true, created: false };
  }

  if (inspection.hasOrchestration) {
    if (log) {
      console.log('⚠ CLAUDE.md already has orchestration content, skipping...');
    }
    return { changed: false, created: false };
  }

  if (backupReason) {
    createBackup(cwd, {
      reason: backupReason,
      includeSettings: false,
      includeClaudeMd: true,
      log
    });
  }

  const updated = `${orchestrationContent}\n\n---\n\n${inspection.content}`;
  fs.writeFileSync(claudeMdTarget, updated);
  if (log) {
    console.log('✓ Updated CLAUDE.md (prepended orchestration context)');
  }
  return { changed: true, created: false };
}

function removeStopHook(cwd, { log = false } = {}) {
  const { settingsTarget } = getProjectPaths(cwd);
  const inspection = inspectSettings(cwd);

  if (!inspection.exists) {
    if (log) {
      console.log('✓ .claude/settings.local.json not found, nothing to uninstall');
    }
    return { changed: false };
  }

  if (inspection.error) {
    if (log) {
      console.log(`⚠ Could not parse settings.local.json: ${inspection.error.message}`);
    }
    return { changed: false, error: inspection.error };
  }

  const next = { ...inspection.content };
  if (next.hooks && Object.prototype.hasOwnProperty.call(next.hooks, 'Stop')) {
    delete next.hooks.Stop;
    if (Object.keys(next.hooks).length === 0) {
      delete next.hooks;
    }
  } else {
    if (log) {
      console.log('✓ Stop hook not present, nothing to remove from settings.local.json');
    }
    return { changed: false };
  }

  if (Object.keys(next).length === 0) {
    fs.unlinkSync(settingsTarget);
    if (log) {
      console.log('✓ Removed .claude/settings.local.json');
    }
    return { changed: true, removed: true };
  }

  writeJson(settingsTarget, next);
  if (log) {
    console.log('✓ Removed orchestration Stop hook from .claude/settings.local.json');
  }
  return { changed: true };
}

function removeOrchestrationContent(cwd, { log = false } = {}) {
  const { claudeMdTarget } = getProjectPaths(cwd);
  const orchestrationContent = getOrchestrationContent();
  const inspection = inspectClaudeMd(cwd);
  const prefixedContent = `${orchestrationContent}\n\n---\n\n`;

  if (!inspection.exists) {
    if (log) {
      console.log('✓ CLAUDE.md not found, nothing to uninstall');
    }
    return { changed: false };
  }

  if (inspection.content === orchestrationContent) {
    fs.unlinkSync(claudeMdTarget);
    if (log) {
      console.log('✓ Removed CLAUDE.md');
    }
    return { changed: true, removed: true };
  }

  if (inspection.content.startsWith(prefixedContent)) {
    fs.writeFileSync(claudeMdTarget, inspection.content.slice(prefixedContent.length));
    if (log) {
      console.log('✓ Removed orchestration content from CLAUDE.md');
    }
    return { changed: true };
  }

  if (inspection.hasOrchestration) {
    if (log) {
      console.log('⚠ CLAUDE.md contains orchestration text in a custom format and was left unchanged');
    }
    return { changed: false };
  }

  if (log) {
    console.log('✓ CLAUDE.md has no orchestration content to remove');
  }
  return { changed: false };
}

function init(force = false) {
  const cwd = process.cwd();

  ensureStopHook(cwd, {
    force,
    log: true,
    backupReason: 'before-init-settings'
  });

  ensureClaudeMd(cwd, {
    force,
    log: true,
    backupReason: 'before-init-claude-md'
  });

  console.log('\n✅ Initialization complete!');
  console.log('\nNext steps:');
  console.log('1. Review .claude/settings.local.json and adjust if needed');
  console.log('2. Run: cduo start');
}

function backup() {
  const cwd = process.cwd();
  const result = createBackup(cwd, {
    reason: 'manual-backup',
    log: true
  });

  if (!result.created) {
    process.exit(1);
  }
}

function uninstall() {
  const cwd = process.cwd();

  console.log('Removing cduo orchestration settings...');
  createBackup(cwd, {
    reason: 'before-uninstall',
    log: true
  });

  const settingsResult = removeStopHook(cwd, { log: true });
  const claudeResult = removeOrchestrationContent(cwd, { log: true });

  if (settingsResult.error) {
    process.exitCode = 1;
  }

  if (!settingsResult.changed && !claudeResult.changed) {
    console.log('✓ Nothing to uninstall');
    return;
  }

  console.log('✓ cduo orchestration settings removed');
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[>=()]/g, '')
    .replace(/\x1b\?[0-9;]+[hl]/g, '')
    .replace(/\[[0-9;?]+[hl]/g, '')
    .replace(/\x1b_[^\x1b]*\x1b\\/g, '')
    .replace(/\r/g, '')
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '');
}

function extractLastOutput(buffer) {
  const text = stripAnsi(buffer);
  const lastRecordIndex = text.lastIndexOf('⏺');

  if (lastRecordIndex === -1) {
    return '';
  }

  let response = text.substring(lastRecordIndex + 1);
  const stopPatterns = [
    /[✻✳✶✢✦·✽]/,
    /^>/m,
    /^─+$/m
  ];

  for (const pattern of stopPatterns) {
    const match = response.match(pattern);
    if (match) {
      response = response.substring(0, match.index);
      break;
    }
  }

  return response
    .replace(/\(esc to interrupt\)/g, '')
    .replace(/\? for shortcuts/g, '')
    .replace(/Thinking (on|off)/g, '')
    .replace(/ctrl-r to search/g, '')
    .replace(/toggle\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function runTmux(args, options = {}) {
  return execFileSync('tmux', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function tmuxHasSession(sessionName) {
  const result = spawnSync('tmux', ['has-session', '-t', sessionName], {
    stdio: 'ignore'
  });
  return result.status === 0;
}

function capturePane(paneId) {
  return runTmux(['capture-pane', '-p', '-t', paneId, '-S', '-2000']);
}

function sendMessageToPane(paneId, message) {
  runTmux(['send-keys', '-t', paneId, '-l', message]);
  runTmux(['send-keys', '-t', paneId, 'Enter']);
}

function createTmuxSession(sessionName, cwd, claudeLaunchCommand, port) {
  const { shell, args } = resolveShell();

  runTmux(['new-session', '-d', '-s', sessionName, '-c', cwd, shell, ...args]);
  runTmux(['split-window', '-h', '-t', `${sessionName}:0`, '-c', cwd, shell, ...args]);
  runTmux(['select-layout', '-t', `${sessionName}:0`, 'even-horizontal']);
  runTmux(['set-option', '-t', sessionName, 'remain-on-exit', 'on']);

  const paneLines = runTmux(['list-panes', '-t', `${sessionName}:0`, '-F', '#{pane_index} #{pane_id}'])
    .trim()
    .split('\n')
    .filter(Boolean);

  const panes = {};
  for (const line of paneLines) {
    const [paneIndex, paneId] = line.split(' ');
    panes[paneIndex] = paneId;
  }

  if (!panes['0'] || !panes['1']) {
    throw new Error('Failed to create both tmux panes');
  }

  const paneMap = {
    a: panes['0'],
    b: panes['1']
  };

  for (const [terminalId, paneId] of Object.entries(paneMap)) {
    runTmux(['send-keys', '-t', paneId, '-l', `export TERMINAL_ID=${terminalId} ORCHESTRATION_PORT=${port}`]);
    runTmux(['send-keys', '-t', paneId, 'Enter']);
    runTmux(['send-keys', '-t', paneId, '-l', claudeLaunchCommand]);
    runTmux(['send-keys', '-t', paneId, 'Enter']);
  }

  return paneMap;
}

function spawnTmuxRelay(sessionName, port, paneA, paneB) {
  const relayProcess = spawn(process.execPath, [
    __filename,
    '__tmux-relay',
    '--session', sessionName,
    '--port', String(port),
    '--pane-a', paneA,
    '--pane-b', paneB
  ], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  });

  relayProcess.unref();
}

async function startTmux(cwd, launchMode) {
  if (!hasCommand('tmux')) {
    throw new Error(getTmuxInstallHint());
  }

  const preferredPort = parseInt(process.env.PORT || '53333', 10);
  const port = await findAvailablePort(preferredPort);
  const sessionName = `cduo-${Date.now().toString(36)}`;

  console.log('Starting cduo in tmux mode...');
  console.log(`Working directory: ${cwd}`);
  if (launchMode.label) {
    console.log(`Claude launch mode: ${launchMode.label}`);
  }

  const hookResult = ensureStopHook(cwd, {
    log: true,
    backupReason: 'before-start-hook-update'
  });
  if (hookResult.error) {
    console.log('⚠ Start will continue, but auto-pipeline may not work until .claude/settings.local.json is fixed');
  }

  const panes = createTmuxSession(sessionName, cwd, launchMode.command, port);
  spawnTmuxRelay(sessionName, port, panes.a, panes.b);

  console.log(`tmux session: ${sessionName}`);
  console.log(`relay port: ${port}`);

  const attach = spawnSync('tmux', ['attach-session', '-t', sessionName], {
    stdio: 'inherit'
  });

  if (attach.error) {
    throw attach.error;
  }
}

function runTmuxRelay() {
  const sessionName = getArgValue('--session');
  const port = parseInt(getArgValue('--port') || '', 10);
  const paneA = getArgValue('--pane-a');
  const paneB = getArgValue('--pane-b');

  if (!sessionName || !port || !paneA || !paneB) {
    process.exit(1);
  }

  const paneMap = { a: paneA, b: paneB };
  const state = {
    autoPipeline: true,
    conversationTurns: 0,
    lastCompleted: null,
    lastSendTime: 0,
    maxTurns: 10,
    cooldownMs: 3000
  };

  const maybeForwardCompletion = (sourceId) => {
    if (!(state.autoPipeline && state.lastCompleted !== sourceId)) {
      return;
    }

    if (state.conversationTurns >= state.maxTurns) {
      state.autoPipeline = false;
      return;
    }

    const targetId = sourceId === 'a' ? 'b' : 'a';
    const now = Date.now();
    const timeSinceLastSend = now - state.lastSendTime;
    const initialDelay = Math.max(2000, state.cooldownMs - Math.max(0, timeSinceLastSend));

    setTimeout(() => {
      const output = extractLastOutput(capturePane(paneMap[sourceId]));
      if (!output || output.length <= 15) {
        state.lastCompleted = sourceId;
        return;
      }

      sendMessageToPane(paneMap[targetId], output);
      state.lastCompleted = sourceId;
      state.conversationTurns += 1;
      state.lastSendTime = Date.now();
    }, initialDelay);
  };

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.type === 'stop' && paneMap[payload.terminal_id]) {
          maybeForwardCompletion(payload.terminal_id);
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
      }
    });
  });

  server.listen(port, () => {
    const interval = setInterval(() => {
      if (!tmuxHasSession(sessionName)) {
        clearInterval(interval);
        server.close(() => process.exit(0));
      }
    }, 3000);
    interval.unref();
  });
}

async function start() {
  const server = path.join(__dirname, '..', 'server.js');
  const preferredPort = process.env.PORT || 53333;
  const cwd = process.cwd();
  const launchMode = resolveClaudeLaunchMode();
  const claudeLaunchCommand = launchMode.command;

  if (tmuxModeFlag) {
    await startTmux(cwd, launchMode);
    return;
  }

  console.log('Starting cduo...');
  console.log(`Working directory: ${cwd}`);
  if (launchMode.label) {
    console.log(`Claude launch mode: ${launchMode.label}`);
  }

  const hookResult = ensureStopHook(cwd, {
    log: true,
    backupReason: 'before-start-hook-update'
  });
  if (hookResult.error) {
    console.log('⚠ Start will continue, but auto-pipeline may not work until .claude/settings.local.json is fixed');
  }

  let actualPort = null;

  const serverProcess = spawn(process.execPath, [server], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: preferredPort,
      PROJECT_CWD: cwd,
      CDUO_AUTO_COMMAND: claudeLaunchCommand
    }
  });

  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    const portMatch = output.match(/Server running on http:\/\/localhost:(\d+)/);
    if (portMatch && !actualPort) {
      actualPort = parseInt(portMatch[1], 10);

      setTimeout(() => {
        const url = `http://localhost:${actualPort}`;
        const startCmd = process.platform === 'darwin' ? 'open' :
          process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${startCmd} ${url}`);
        console.log(`Opening browser at ${url}`);
      }, 500);
    }
  });

  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  serverProcess.on('exit', (code) => {
    process.exit(code);
  });
}
