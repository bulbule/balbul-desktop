'use strict';
const api = window.balbul;
const SPRITES = [
  'idle', 'happy', 'reminder', 'urgent', 'marah', 'thinking', 'working', 'proud',
  'encourage', 'wait', 'sleep', 'afk', 'overtime', 'error', 'offline',
];

const stage = document.getElementById('stage');
const img = document.getElementById('char');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleActions = document.getElementById('bubble-actions');
let bubbleTimer = null;
let currentTaskId = null;

// ---------- ekspresi ----------
function setState(state) {
  const s = SPRITES.includes(state) ? state : 'idle';
  img.src = `../../assets/sprites/${s}.png`;
  img.className = `st-${s}`;
}

function hideBubble() {
  bubble.classList.add('hidden');
  bubbleActions.classList.add('hidden');
  currentTaskId = null;
  clearTimeout(bubbleTimer);
}

function showBubble(text, ttl, taskId) {
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text;
  currentTaskId = taskId || null;
  bubbleActions.classList.toggle('hidden', !taskId);
  bubble.classList.remove('hidden');
  bubbleTimer = setTimeout(hideBubble, ttl);
}

// ---------- suara ----------
let audio = null;
function beep() {
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.05, t + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.1);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.11);
    });
  } catch (_) { /* suara opsional */ }
}

// ---------- event dari main.js ----------
api.on('character:state', (p) => {
  setState(p.state);
  if (p.text) showBubble(p.text, p.ttl, p.taskId);
  else hideBubble();
  if (p.sound) beep();
});

api.on('settings-changed', (s) => {
  document.documentElement.style.setProperty('--size', `${s.size}px`);
  stage.style.opacity = String(s.opacity / 100);
});

// ---------- klik tembus: hanya karakter & bubble yang bisa diklik ----------
let interactive = false;
function setInteractive(value) {
  if (value === interactive) return;
  interactive = value;
  api.ignoreMouse(!value);
}
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  setInteractive(!!el && (el.id === 'char' || !!el.closest('#bubble')));
});
document.addEventListener('mouseleave', () => setInteractive(false));

// ---------- geser & klik karakter ----------
let drag = null;
img.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  img.setPointerCapture(e.pointerId);
  drag = { sx: e.screenX, sy: e.screenY, moved: false };
});
img.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.sx;
  const dy = e.screenY - drag.sy;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    api.dragStart();
  }
  api.dragMove(dx, dy);
});
img.addEventListener('pointerup', () => {
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  if (moved) api.dragEnd();
  else api.clickCharacter();
});
img.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.characterMenu();
});

// ---------- bubble ----------
bubbleText.addEventListener('click', () => {
  api.openDashboard();
  hideBubble();
});
document.getElementById('btn-done').addEventListener('click', () => {
  if (currentTaskId) api.toggleTask(currentTaskId);
  hideBubble();
});
document.getElementById('btn-snooze').addEventListener('click', () => {
  if (currentTaskId) api.snoozeTask(currentTaskId, 10);
  hideBubble();
});

setState('idle');
api.getSettings().then((s) => {
  document.documentElement.style.setProperty('--size', `${s.size}px`);
  stage.style.opacity = String(s.opacity / 100);
});
