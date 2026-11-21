'use strict';
const api = window.balbul;
const SPRITES = [
  'idle', 'happy', 'reminder', 'urgent', 'marah', 'thinking', 'working', 'proud',
  'encourage', 'wait', 'sleep', 'afk', 'overtime', 'error', 'offline',
];

const stage = document.getElementById('stage');
const wrap = document.getElementById('char-wrap');
const body = document.getElementById('body');
const img = document.getElementById('char');
const eyeEls = [document.getElementById('eye-0'), document.getElementById('eye-1')];
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleActions = document.getElementById('bubble-actions');
const btnDone = document.getElementById('btn-done');
let bubbleTimer = null;
let bubbleInfo = null; // { taskId, kind }
let incomingChat = null;
const replyForm = document.getElementById('bubble-reply');
const replyInput = document.getElementById('bubble-reply-input');

// kondisi tampilan saat ini
let size = 150;
let tracking = false;
let currentState = 'idle';
let look = { x: 0, y: 0 }; // arah kursor, -1..1

// ---------- gerakan mata & badan mengikuti kursor ----------
function applyLook() {
  // badan condong sedikit ke arah kursor
  wrap.style.transform = tracking
    ? `translate(${(look.x * size * 0.04).toFixed(1)}px, ${(look.y * size * 0.02).toFixed(1)}px) rotate(${(look.x * 4).toFixed(1)}deg)`
    : '';
  // mata (hanya ekspresi yang matanya terlihat utuh)
  const data = window.EYES && window.EYES[currentState];
  if (!tracking || !data) return;
  const r = data.range;
  const dx = look.x >= 0 ? look.x * r.r : look.x * r.l;
  const dy = look.y >= 0 ? look.y * r.d : look.y * r.u;
  eyeEls.forEach((el) => {
    el.style.transform = `translate(${(dx * size).toFixed(1)}px, ${(dy * size).toFixed(1)}px)`;
  });
}

// ---------- ekspresi ----------
function setState(state) {
  currentState = SPRITES.includes(state) ? state : 'idle';
  const data = window.EYES && window.EYES[currentState];
  const useEyes = (tracking || document.body.classList.contains('lifted')) && !!data;
  img.src = `../../assets/sprites/${currentState}${useEyes ? '-noeyes' : ''}.png`;
  body.className = `st-${currentState}`;
  eyeEls.forEach((el, i) => {
    const e = useEyes ? data.eyes[i] : null;
    if (!e) {
      el.classList.remove('on');
      return;
    }
    el.style.left = `${((e.cx - e.w / 2) * 100).toFixed(2)}%`;
    el.style.top = `${((e.cy - e.h / 2) * 100).toFixed(2)}%`;
    el.style.width = `${(e.w * 100).toFixed(2)}%`;
    el.style.height = `${(e.h * 100).toFixed(2)}%`;
    el.classList.add('on');
  });
  applyLook();
}

// kedip acak (hanya terlihat kalau mata buatan aktif)
function scheduleBlink() {
  setTimeout(() => {
    eyeEls.forEach((el) => {
      el.classList.remove('blink');
      void el.offsetWidth; // restart animasi
      el.classList.add('blink');
    });
    scheduleBlink();
  }, 2500 + Math.random() * 3500);
}
scheduleBlink();

function applySettings(s) {
  size = s.size;
  document.documentElement.style.setProperty('--size', `${s.size}px`);
  stage.style.opacity = String(s.opacity / 100);
  const was = tracking;
  tracking = !!s.trackCursor;
  document.body.classList.toggle('tracking', tracking);
  if (!tracking) look = { x: 0, y: 0 };
  if (was !== tracking) setState(currentState);
  else applyLook();
}

// ---------- bubble ----------
function hideBubble() {
  bubble.classList.add('hidden');
  replyForm.classList.add('hidden');
  incomingChat = null;
  bubbleActions.classList.add('hidden');
  bubbleInfo = null;
  clearTimeout(bubbleTimer);
}

function showBubble(text, ttl, taskId, kind) {
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text;
  bubbleInfo = taskId ? { taskId, kind } : null;
  btnDone.textContent = kind === 'reminder' ? 'Oke' : 'Selesai';
  bubbleActions.classList.toggle('hidden', !taskId);
  replyForm.classList.add('hidden');
  bubble.classList.remove('hidden');
  bubbleTimer = setTimeout(hideBubble, Math.max(2500,Math.min(Number(ttl)||8000,30000)));
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
  if (p.text) showBubble(p.text, p.ttl, p.taskId, p.kind);
  else hideBubble();
  if (p.sound) beep();
});
api.on('character:cursor', (v) => {
  look = { x: v.x, y: v.y };
  applyLook();
});
api.on('settings-changed', applySettings);
api.on('character:chat-message', (message) => {
  incomingChat = message; clearTimeout(bubbleTimer); setState('thinking');
  bubbleText.textContent = `✉ ${message.sender}: ${message.body}`;
  bubbleActions.classList.add('hidden'); replyForm.classList.remove('hidden'); bubble.classList.remove('hidden');
  look = { x: 0, y: -0.85 }; applyLook(); beep();
  bubbleTimer = setTimeout(hideBubble, 30000);
});
replyForm.addEventListener('submit', (event) => {
  event.preventDefault(); const body = replyInput.value.trim();
  if (!body || !incomingChat) return;
  api.sendQuickReply({ conversationId: incomingChat.conversationId, body });
  replyInput.value = ''; incomingChat = null; replyForm.classList.add('hidden');
  bubbleText.textContent = 'Balasan dikirim!'; bubbleTimer = setTimeout(hideBubble, 2500);
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
document.addEventListener('mouseleave', () => { setInteractive(false); document.body.classList.remove('lifted'); });

// ---------- geser & klik karakter ----------
let drag = null;
img.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  img.setPointerCapture(e.pointerId);
  drag = { sx: e.screenX, sy: e.screenY, moved: false };
  document.body.classList.add('lifted');
  setState(currentState);
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
  document.body.classList.toggle('facing-left', dx < -2);
});
img.addEventListener('pointerup', () => {
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  document.body.classList.remove('lifted');
  setState(currentState);
  if (moved) api.dragEnd();
  else api.clickCharacter();
});
img.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.characterMenu();
});

// ---------- tombol di bubble ----------
bubbleText.addEventListener('click', () => {
  api.openDashboard();
  hideBubble();
});
btnDone.addEventListener('click', () => {
  if (bubbleInfo) {
    if (bubbleInfo.kind === 'reminder') api.ackTask(bubbleInfo.taskId);
    else api.toggleTask(bubbleInfo.taskId);
  }
  hideBubble();
});
document.getElementById('btn-snooze').addEventListener('click', () => {
  if (bubbleInfo) api.snoozeTask(bubbleInfo.taskId, 10);
  hideBubble();
});

setState('idle');
api.getSettings().then(applySettings);
