// Use wss:// if page is served over https://
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

const terminals = {
  a: null,
  b: null
};

const fitAddons = {
  a: null,
  b: null
};

const buffers = {
  a: [],
  b: []
};

let autoPipeline = false;
let lastCompleted = null;
let wsReady = false;

// Anti-loop protection (configurable via UI)
let conversationTurns = 0;
let lastSendTime = 0;

// UI Controls - will be initialized after DOM loads
let turnLimitCheckbox, maxTurnsInput, cooldownInput, turnCounterDisplay;

// Update turn counter display
function updateTurnCounter() {
  if (!turnCounterDisplay || !maxTurnsInput) {
    console.warn('[UI] Turn counter elements not ready');
    return;
  }

  const maxTurns = parseInt(maxTurnsInput.value) || 10;
  const percentage = (conversationTurns / maxTurns) * 100;

  turnCounterDisplay.textContent = `${conversationTurns} / ${maxTurns} turns`;
  turnCounterDisplay.className = 'turn-counter';

  if (percentage >= 80) {
    turnCounterDisplay.classList.add('danger');
  } else if (percentage >= 60) {
    turnCounterDisplay.classList.add('warning');
  }

  console.log(`[UI] Turn counter updated: ${conversationTurns} / ${maxTurns}`);
}

// Initialize UI controls when DOM is ready
function initializeUI() {
  turnLimitCheckbox = document.getElementById('turnLimitEnabled');
  maxTurnsInput = document.getElementById('maxTurns');
  cooldownInput = document.getElementById('cooldownMs');
  turnCounterDisplay = document.getElementById('turnCounter');

  if (!turnLimitCheckbox || !maxTurnsInput || !cooldownInput || !turnCounterDisplay) {
    console.error('[UI] Failed to find control elements');
    return;
  }

  // Enable/disable max turns input based on checkbox
  turnLimitCheckbox.addEventListener('change', () => {
    maxTurnsInput.disabled = !turnLimitCheckbox.checked;
    if (!turnLimitCheckbox.checked) {
      autoPipeline = true; // Re-enable if it was disabled
      console.log('[UI] Turn limit disabled, auto-pipeline re-enabled');
    }
  });

  // Update display when max turns changes
  maxTurnsInput.addEventListener('input', updateTurnCounter);

  // Initial display
  updateTurnCounter();
  console.log('[UI] Controls initialized');
}

// Initialize UI when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeUI);
} else {
  initializeUI();
}

// Initialize terminals
function initTerminal(id, elementId) {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4'
    }
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById(elementId));
  fitAddon.fit();

  terminals[id] = term;
  fitAddons[id] = fitAddon;

  // Handle terminal input
  term.onData((data) => {
    ws.send(JSON.stringify({
      type: 'input',
      id: id,
      data: data
    }));
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (wsReady) {
      ws.send(JSON.stringify({
        type: 'resize',
        id: id,
        cols: term.cols,
        rows: term.rows
      }));
    }
  });
  resizeObserver.observe(document.getElementById(elementId));

  return term;
}

// Initialize both terminals
initTerminal('a', 'terminal-a');
initTerminal('b', 'terminal-b');

// WebSocket message handler
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'output':
      if (terminals[data.id]) {
        terminals[data.id].write(data.data);
        buffers[data.id].push(data.data);
        // Keep last 1000 items
        if (buffers[data.id].length > 1000) {
          buffers[data.id].shift();
        }
      }
      break;
    case 'completion':
      // Hook-based completion detection with cooldown + turn limit
      if (!(autoPipeline && lastCompleted !== data.id)) break;
      console.log(`[Hook] Stop detected in ${data.id}`);
      const sourceId = data.id;
      const targetId = sourceId === 'a' ? 'b' : 'a';

      // Get current settings from UI (with defaults if UI not ready)
      const turnLimitEnabled = turnLimitCheckbox ? turnLimitCheckbox.checked : true;
      const maxTurns = maxTurnsInput ? parseInt(maxTurnsInput.value) : 10;
      const minCooldown = cooldownInput ? parseInt(cooldownInput.value) : 3000;

      // Check turn limit (if enabled)
      if (turnLimitEnabled && conversationTurns >= maxTurns) {
        console.log(`[Loop Prevention] Max turns (${maxTurns}) reached. Auto-pipeline paused.`);
        console.log('Uncheck "Turn Limit" or increase max turns to continue.');
        autoPipeline = false;
        break;
      }

      // Wait for buffer to settle and respect cooldown window
      const now = Date.now();
      const timeSinceLastSend = now - lastSendTime;
      const initialDelay = Math.max(2000, minCooldown - Math.max(0, timeSinceLastSend));

      const attemptSend = (attempt = 1, maxAttempts = 3) => {
        console.log(`[DEBUG] Buffer size for ${sourceId}:`, buffers[sourceId].length);
        const output = extractLastOutput(buffers[sourceId]);
        console.log(`[DEBUG] Extracted output length: ${output.length}, content:`, output.substring(0, 200));

        if (output && output.length > 15) {
          const turnInfo = turnLimitEnabled ? ` (turn ${conversationTurns + 1}/${maxTurns})` : '';
          console.log(`[Attempt ${attempt}] ${sourceId} → ${targetId}${turnInfo}:`, output.substring(0, 100));
          lastCompleted = sourceId;
          conversationTurns++;
          lastSendTime = Date.now();
          updateTurnCounter();
          typeMessageToTerminal(targetId, output);
        } else if (attempt < maxAttempts) {
          console.log(`[Attempt ${attempt}] Output too short (${output.length} chars), retrying...`);
          console.log(`[DEBUG] Current output:`, JSON.stringify(output));
          setTimeout(() => attemptSend(attempt + 1, maxAttempts), 1000);
        } else {
          console.log(`[Failed] No valid message after ${maxAttempts} attempts`);
          console.log(`[DEBUG] Final output was:`, JSON.stringify(output));
          console.log(`[DEBUG] Last 500 chars of buffer:`, buffers[sourceId].join('').slice(-500));
          lastCompleted = sourceId;
        }
      };

      setTimeout(() => attemptSend(), initialDelay);
      break;
    case 'exit':
      const statusId = data.id === 'a' ? 'status-a' : 'status-b';
      document.getElementById(statusId).textContent = 'Exited';
      document.getElementById(statusId).classList.remove('running');
      break;
  }
};

// Auto-start function
function startTerminals() {
  ws.send(JSON.stringify({ type: 'create', id: 'a' }));
  ws.send(JSON.stringify({ type: 'create', id: 'b' }));

  document.getElementById('status-a').textContent = 'Running';
  document.getElementById('status-a').classList.add('running');
  document.getElementById('status-b').textContent = 'Running';
  document.getElementById('status-b').classList.add('running');

  // Start Claude Code in both terminals
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'input', id: 'a', data: 'claude\r' }));
    ws.send(JSON.stringify({ type: 'input', id: 'b', data: 'claude\r' }));
  }, 500);
}

// Auto-start on connection
ws.onopen = () => {
  console.log('WebSocket connected, auto-starting terminals...');
  wsReady = true;
  autoPipeline = true; // Enable auto-pipeline by default
  // Reset counters on refresh
  conversationTurns = 0;
  lastSendTime = 0;
  updateTurnCounter();
  startTerminals();
};

// Remove ANSI escape codes (improved)
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // CSI sequences
            .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC sequences (more robust)
            .replace(/\x1b[>=()]/g, '')               // Other escapes
            .replace(/\x1b\?[0-9;]+[hl]/g, '')       // DEC private modes
            .replace(/\[[0-9;?]+[hl]/g, '')          // Leftover bracket sequences
            .replace(/\x1b_[^\x1b]*\x1b\\/g, '')     // Application Program Command
            .replace(/\r/g, '')                       // Carriage returns
            .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '');  // Control chars (keep \n)
}

// Extract last meaningful output
function extractLastOutput(buffer) {
  const text = stripAnsi(buffer.join(''));

  console.log('=== EXTRACT DEBUG ===');
  console.log('Raw text (last 500 chars):', text.slice(-500));

  // Find the last ⏺ position
  const lastRecordIndex = text.lastIndexOf('⏺');

  if (lastRecordIndex !== -1) {
    // Extract from ⏺ to the next status indicator or prompt
    let response = text.substring(lastRecordIndex + 1);

    // Stop at the next status indicator or prompt
    const stopPatterns = [
      /[✻✳✶✢✦·✽]/,  // Status indicators
      /^>/m,         // Prompt line
      /^─+$/m        // Separator lines
    ];

    for (const pattern of stopPatterns) {
      const match = response.match(pattern);
      if (match) {
        response = response.substring(0, match.index);
        break;
      }
    }

    // Clean up
    response = response
      .replace(/\(esc to interrupt\)/g, '')
      .replace(/\? for shortcuts/g, '')
      .replace(/Thinking (on|off)/g, '')
      .replace(/ctrl-r to search/g, '')
      .replace(/toggle\)/g, '')
      .replace(/\s+/g, ' ')  // Replace multiple spaces/newlines with single space
      .trim();

    console.log('Extracted response:', response);
    console.log('===================');
    return response;
  }

  console.log('No ⏺ found');
  console.log('===================');
  return '';
}

// Type message to terminal character by character
function typeMessageToTerminal(targetId, message) {
  console.log(`Typing to ${targetId}:`, message.substring(0, 100) + '...');

  if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[Error] WebSocket not ready, cannot send message');
    return;
  }

  let charIndex = 0;
  const typeInterval = setInterval(() => {
    if (charIndex < message.length) {
      try {
        ws.send(JSON.stringify({ type: 'input', id: targetId, data: message[charIndex] }));
        charIndex++;
      } catch (err) {
        console.error('[Error] Failed to send character:', err);
        clearInterval(typeInterval);
      }
    } else {
      clearInterval(typeInterval);
      // Submit the message
      setTimeout(() => {
        try {
          ws.send(JSON.stringify({ type: 'input', id: targetId, data: '\r' }));
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'input', id: targetId, data: '\n' }));
            console.log(`[Success] Message sent to ${targetId}`);
          }, 50);
        } catch (err) {
          console.error('[Error] Failed to submit message:', err);
        }
      }, 50);
    }
  }, 1); // 1ms between each character
}

// Handle window resize
window.addEventListener('resize', () => {
  fitAddons.a.fit();
  fitAddons.b.fit();
});
