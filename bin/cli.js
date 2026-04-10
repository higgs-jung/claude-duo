#!/usr/bin/env node
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const command = process.argv[2];
const forceFlag = process.argv.includes('--force') || process.argv.includes('-f');

if (command === 'init') {
  init(forceFlag);
} else if (command === 'start' || !command) {
  start();
} else {
  console.log('Usage:');
  console.log('  claude-duo init          - Initialize .claude/ configuration in current directory');
  console.log('  claude-duo init --force  - Force overwrite existing configuration');
  console.log('  claude-duo start         - Start orchestration server');
  process.exit(1);
}

function init(force = false) {
  const cwd = process.cwd();
  ensureStopHook(cwd, { force, log: true });

  // Handle CLAUDE.md (project root, not .claude directory)
  const claudeMdSource = path.join(__dirname, '..', 'CLAUDE.md');
  const claudeMdTarget = path.join(cwd, 'CLAUDE.md');

  if (fs.existsSync(claudeMdTarget)) {
    if (force) {
      // Force overwrite
      fs.copyFileSync(claudeMdSource, claudeMdTarget);
      console.log('✓ Updated CLAUDE.md (force overwrite)');
    } else {
      // Smart merge: prepend if not already present
      try {
        const existing = fs.readFileSync(claudeMdTarget, 'utf8');
        const orchestrationContent = fs.readFileSync(claudeMdSource, 'utf8');

        // Check if already has orchestration content
        if (existing.includes('Claude Code Orchestration Mode')) {
          console.log('⚠ CLAUDE.md already has orchestration content, skipping...');
        } else {
          // Prepend orchestration content
          const updated = orchestrationContent + '\n\n---\n\n' + existing;
          fs.writeFileSync(claudeMdTarget, updated);
          console.log('✓ Updated CLAUDE.md (prepended orchestration context)');
        }
      } catch (err) {
        console.log(`⚠ Could not update CLAUDE.md: ${err.message}`);
        console.log('  Use --force to overwrite');
      }
    }
  } else {
    // Create new file
    fs.copyFileSync(claudeMdSource, claudeMdTarget);
    console.log('✓ Created CLAUDE.md');
  }

  console.log('\n✅ Initialization complete!');
  console.log('\nNext steps:');
  console.log('1. Review .claude/settings.local.json and adjust if needed');
  console.log('2. Run: claude-duo start');
}

function getTemplateSettings() {
  const settingsTemplate = path.join(__dirname, '..', '.claude', 'settings.template.json');
  return JSON.parse(fs.readFileSync(settingsTemplate, 'utf8'));
}

function ensureStopHook(cwd, { force = false, log = false } = {}) {
  const claudeDir = path.join(cwd, '.claude');
  const settingsTarget = path.join(claudeDir, 'settings.local.json');
  const template = getTemplateSettings();
  const hadSettings = fs.existsSync(settingsTarget);

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    if (log) {
      console.log('✓ Created .claude/ directory');
    }
  }

  if (!hadSettings || force) {
    fs.writeFileSync(settingsTarget, JSON.stringify(template, null, 2));
    if (log) {
      console.log(force && hadSettings
        ? '✓ Updated .claude/settings.local.json (force overwrite)'
        : '✓ Created .claude/settings.local.json');
    }
    return { changed: true, created: !hadSettings };
  }

  try {
    const existing = JSON.parse(fs.readFileSync(settingsTarget, 'utf8'));
    const next = {
      ...existing,
      hooks: {
        ...(existing.hooks || {}),
        Stop: template.hooks.Stop
      }
    };

    const existingSerialized = JSON.stringify(existing);
    const nextSerialized = JSON.stringify(next);

    if (existingSerialized !== nextSerialized) {
      fs.writeFileSync(settingsTarget, JSON.stringify(next, null, 2));
      if (log) {
        console.log('✓ Updated .claude/settings.local.json (merged Stop hook)');
      }
      return { changed: true, created: false };
    }

    if (log) {
      console.log('✓ .claude/settings.local.json already has the orchestration Stop hook');
    }
    return { changed: false, created: false };
  } catch (err) {
    if (log) {
      console.log(`⚠ Could not merge settings.local.json: ${err.message}`);
      console.log('  Use claude-duo init --force to overwrite');
    }
    return { changed: false, created: false, error: err };
  }
}

function start() {
  const server = path.join(__dirname, '..', 'server.js');
  const preferredPort = process.env.PORT || 53333;
  const cwd = process.cwd();

  console.log(`Starting Claude Code Orchestration...`);
  console.log(`Working directory: ${cwd}`);

  const hookResult = ensureStopHook(cwd, { log: true });
  if (hookResult.error) {
    console.log('⚠ Start will continue, but auto-pipeline may not work until .claude/settings.local.json is fixed');
  }

  let actualPort = null;

  const serverProcess = spawn(process.execPath, [server], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, PORT: preferredPort, PROJECT_CWD: cwd }
  });

  // Parse stdout for actual port
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    // Extract port from "Server running on http://localhost:XXXX"
    const portMatch = output.match(/Server running on http:\/\/localhost:(\d+)/);
    if (portMatch && !actualPort) {
      actualPort = parseInt(portMatch[1]);

      // Open browser with actual port
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
