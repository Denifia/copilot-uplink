import { AcpClient, ConnectionState } from './acp-client.js';
import { Conversation } from './conversation.js';
import { ChatList } from './ui/chat.js';
import { showPermissionRequest, cancelAllPermissions } from './ui/permission.js';
import { SessionsModal } from './ui/sessions.js';
import { CommandPalette, type PaletteItem } from './ui/command-palette.js';
import { getCompletions, setAvailableModels } from './slash-commands.js';
import { render, h } from 'preact';
import 'material-symbols/outlined.css';
import { handleSend, type AgentMode } from './prompt-controller.js';

// ─── DOM References ───────────────────────────────────────────────────

const chatArea = document.getElementById('chat-area')!;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const modelLabel = document.getElementById('model-label')!;

let yoloMode = localStorage.getItem('uplink-yolo') === 'true';

// ─── Mode ─────────────────────────────────────────────────────────────

let currentMode: AgentMode = 'chat';

function applyMode(mode: AgentMode): void {
  currentMode = mode;
  document.documentElement.setAttribute('data-mode', mode);
}

applyMode(currentMode);

// ─── Theme ────────────────────────────────────────────────────────────

function applyTheme(theme: string): void {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.className = prefersDark ? 'dark' : 'light';
  } else {
    document.documentElement.className = theme;
  }
  localStorage.setItem('uplink-theme', theme);
}

function initTheme(): void {
  const saved = localStorage.getItem('uplink-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved ?? (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

initTheme();

// ─── Service Worker ───────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('SW registration failed:', err);
  });
}

// ─── UI Components ────────────────────────────────────────────────────

const conversation = new Conversation();

// Mount all timeline components into a single chatContainer.
// ChatList renders messages, and child components (tool calls, permissions,
// plans) are passed as children so they appear inline in the message flow.
const chatContainer = document.createElement('div');
chatContainer.className = 'chat-container chat-messages';
chatArea.appendChild(chatContainer);

function renderChat(): void {
  render(
    h(ChatList, { conversation, scrollContainer: chatArea }),
    chatContainer,
  );
}
renderChat();

// Mount Preact sessions modal on body
const sessionsModalContainer = document.createElement('div');
document.body.appendChild(sessionsModalContainer);
render(h(SessionsModal, {}), sessionsModalContainer);

// ─── WebSocket / ACP Client ──────────────────────────────────────────

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

let client: AcpClient | null = null;
let clientCwd: string = '';

function updateConnectionStatus(state: ConnectionState): void {
  const el = document.getElementById('connection-status')!;
  // Show "ready" instead of "prompting" since we have the dots indicator
  const displayState = state === 'prompting' ? 'ready' : state;
  el.textContent = displayState;
  el.className = `status-${
    state === 'ready' || state === 'prompting'
      ? 'connected'
      : state === 'connecting' || state === 'initializing'
        ? 'reconnecting'
        : 'disconnected'
  }`;

  sendBtn.disabled = state !== 'ready';
  sendBtn.hidden = state === 'prompting';
  cancelBtn.hidden = state !== 'prompting';

  // On reconnect (initializing with existing content), clear conversation
  // to prevent duplication when replayed session/updates arrive.
  if (state === 'initializing' && conversation.timeline.value.length > 0) {
    conversation.clear();
  }

  conversation.prompting = state === 'prompting';
}

async function initializeClient() {
  const tokenResponse = await fetch('/api/token');
  const { token, cwd } = await tokenResponse.json();
  clientCwd = cwd;

  const wsUrl = `${wsProtocol}//${location.host}/ws?token=${encodeURIComponent(token)}`;

  return new AcpClient({
    wsUrl,
    cwd,
    onStateChange: (state) => updateConnectionStatus(state),
    onSessionUpdate: (update) => conversation.handleSessionUpdate(update),
    onModelsAvailable: (models, currentModelId) => {
      setAvailableModels(models);
      if (currentModelId) {
        const model = models.find((m) => m.modelId === currentModelId);
        modelLabel.textContent = model?.name ?? currentModelId;
        modelLabel.hidden = false;
      }
    },
    onPermissionRequest: (request, respond) => {
      const autoApproveId = yoloMode
        ? request.options.find(
            (o) => o.kind === 'allow_once' || o.kind === 'allow_always',
          )?.optionId
        : undefined;

      showPermissionRequest(
        conversation,
        request.id,
        request.toolCall.toolCallId,
        request.toolCall.title ?? 'Unknown action',
        request.options,
        respond,
        autoApproveId,
      );
    },
    onError: (error) => console.error('ACP error:', error),
  });
}

// ─── Input Handling ───────────────────────────────────────────────────

sendBtn.addEventListener('click', async () => {
  const text = promptInput.value.trim();
  if (!text || !client) return;

  promptInput.value = '';
  promptInput.style.height = 'auto';
  hidePalette();
  document.documentElement.setAttribute('data-mode', currentMode);

  await handleSend(text, {
    client,
    conversation,
    clientCwd,
    getMode: () => currentMode,
    setMode: applyMode,
    yoloMode: () => yoloMode,
    setYoloMode: (on) => { yoloMode = on; localStorage.setItem('uplink-yolo', String(on)); },
    modelLabel,
    applyTheme,
  });
});

cancelBtn.addEventListener('click', () => {
  client?.cancel();
  cancelAllPermissions(conversation);
  // Stop autopilot auto-continue loop by switching back to chat mode
  if (currentMode === 'autopilot') {
    applyMode('chat');
    conversation.addSystemMessage('Autopilot cancelled');
  }
});

promptInput.addEventListener('keydown', (e) => {
  // Palette keyboard navigation
  if (paletteVisible) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteSelectedIndex = Math.max(0, paletteSelectedIndex - 1);
      renderPalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteSelectedIndex = Math.min(paletteItems.length - 1, paletteSelectedIndex + 1);
      renderPalette();
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      if (paletteItems[paletteSelectedIndex]) {
        acceptCompletion(paletteItems[paletteSelectedIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hidePalette();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

/** Update the input border color to preview the mode implied by the current input text. */
function updateBorderPreview(): void {
  if (promptInput.value.startsWith('!')) {
    document.documentElement.setAttribute('data-mode', 'shell-input');
  } else if (promptInput.value.startsWith('/')) {
    const parts = promptInput.value.slice(1).split(/\s/, 1);
    const cmd = parts[0]?.toLowerCase();
    if (cmd === 'plan' || cmd === 'autopilot') {
      document.documentElement.setAttribute('data-mode', cmd);
    } else if (cmd === 'agent') {
      document.documentElement.setAttribute('data-mode', 'chat');
    } else {
      document.documentElement.setAttribute('data-mode', currentMode);
    }
  } else {
    document.documentElement.setAttribute('data-mode', currentMode);
  }
}

promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  const maxH = 150;
  const scrollH = promptInput.scrollHeight;
  promptInput.style.height = Math.min(scrollH, maxH) + 'px';
  promptInput.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';

  // Dynamic border preview based on input prefix
  updateBorderPreview();

  // Show/update command palette when typing /
  if (promptInput.value.startsWith('/')) {
    showPalette();
  } else {
    hidePalette();
  }
});

// ─── Command Palette ──────────────────────────────────────────────────

const paletteMount = document.getElementById('palette-mount')!;
let paletteItems: PaletteItem[] = [];
let paletteSelectedIndex = 0;
let paletteVisible = false;

function renderPalette(): void {
  if (!paletteVisible || paletteItems.length === 0) {
    render(null, paletteMount);
    return;
  }
  render(
    h(CommandPalette, {
      items: paletteItems,
      selectedIndex: paletteSelectedIndex,
      onSelect: (item) => acceptCompletion(item),
      onHover: (i) => { paletteSelectedIndex = i; renderPalette(); },
    }),
    paletteMount,
  );
}

function showPalette(): void {
  const text = promptInput.value;
  paletteItems = getCompletions(text);
  paletteSelectedIndex = 0;
  paletteVisible = paletteItems.length > 0;
  renderPalette();
}

function hidePalette(): void {
  paletteVisible = false;
  renderPalette();
}

function acceptCompletion(item: PaletteItem): void {
  promptInput.value = item.fill;
  promptInput.focus();
  updateBorderPreview();
  if (item.fill.endsWith(' ')) {
    // Top-level command selected — show sub-options or let user type more
    showPalette();
  } else {
    // Concrete sub-option selected — execute
    hidePalette();
    sendBtn.click();
  }
}

// ─── Mobile keyboard handling ─────────────────────────────────────────
// Chrome/Edge: VirtualKeyboard API gives env(keyboard-inset-height) in CSS.
// Safari/iOS:  dvh doesn't track the keyboard, so we sync #app to the
//              visual viewport — height for the keyboard, translateY for
//              the scroll offset iOS applies when focusing an input.
const appEl = document.getElementById('app')!;

if ('virtualKeyboard' in navigator) {
  (navigator as any).virtualKeyboard.overlaysContent = true;
} else if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => {
    appEl.style.height = `${vv.height}px`;
    appEl.style.transform = `translateY(${vv.offsetTop}px)`;
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
}

// ─── Connect ──────────────────────────────────────────────────────────

updateConnectionStatus('disconnected');

initializeClient().then((c) => {
  client = c;
  client.connect();
}).catch((err) => {
  console.error('Failed to initialize client:', err);
});
