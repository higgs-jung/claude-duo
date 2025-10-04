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
  const claudeDir = path.join(cwd, '.claude');

  // Create .claude directory if it doesn't exist
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    console.log('✓ Created .claude/ directory');
  }

  // Handle settings.local.json
  const settingsTemplate = path.join(__dirname, '..', '.claude', 'settings.template.json');
  const settingsTarget = path.join(claudeDir, 'settings.local.json');

  if (fs.existsSync(settingsTarget)) {
    if (force) {
      // Force overwrite
      fs.copyFileSync(settingsTemplate, settingsTarget);
      console.log('✓ Updated .claude/settings.local.json (force overwrite)');
    } else {
      // Smart merge: only update Stop hook
      try {
        const existing = JSON.parse(fs.readFileSync(settingsTarget, 'utf8'));
        const template = JSON.parse(fs.readFileSync(settingsTemplate, 'utf8'));

        // Initialize hooks if not exists
        if (!existing.hooks) existing.hooks = {};

        // Update only Stop hook
        existing.hooks.Stop = template.hooks.Stop;

        fs.writeFileSync(settingsTarget, JSON.stringify(existing, null, 2));
        console.log('✓ Updated .claude/settings.local.json (merged Stop hook)');
      } catch (err) {
        console.log(`⚠ Could not merge settings.local.json: ${err.message}`);
        console.log('  Use --force to overwrite');
      }
    }
  } else {
    // Create new file
    fs.copyFileSync(settingsTemplate, settingsTarget);
    console.log('✓ Created .claude/settings.local.json');
  }

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

function start() {
  const server = path.join(__dirname, '..', 'server.js');
  const port = process.env.PORT || 3333;
  const cwd = process.cwd();

  console.log(`Starting Claude Code Orchestration on http://localhost:${port}`);
  console.log(`Working directory: ${cwd}`);

  const serverProcess = spawn('node', [server], {
    stdio: 'inherit',
    env: { ...process.env, PORT: port, PROJECT_CWD: cwd }
  });

  serverProcess.on('exit', (code) => {
    process.exit(code);
  });

  // Open browser after 1 second
  setTimeout(() => {
    const url = `http://localhost:${port}`;
    const start = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${start} ${url}`);
  }, 1000);
}
