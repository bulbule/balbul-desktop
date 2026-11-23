'use strict';
const api = window.balbul;
const SPRITES = [
  'idle', 'happy', 'reminder', 'urgent', 'marah', 'thinking', 'working', 'proud',
  'encourage', 'wait', 'sleep', 'afk', 'overtime', 'error', 'offline',
  'share_hover', 'share_receive', 'share_carry', 'share_deliver_done', 'share_error',
];
const SPRITE_ALIASES = { share_hover: 'happy', share_receive: 'happy', share_carry: 'proud', share_deliver_done: 'happy', share_error: 'error' };

const stage = document.getElementById('stage');
const wrap = document.getElementById('char-wrap');
const body = document.getElementById('body');
const img = document.getElementById('char');
const eyeEls = [document.getElementById('eye-0'), document.getElementById('eye-1')];
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleActions = document.getElementById('bubble-actions');
const btnDone = document.getElementById('btn-done');
const shareContent = document.getElementById('share-content');
const shareName = document.getElementById('share-name');
const shareSize = document.getElementById('share-size');
const shareQr = document.getElementById('share-qr');
const shareLoading = document.getElementById('share-loading');
const shareError = document.getElementById('share-error');
const shareErrorMessage = document.getElementById('share-error-message');
const shareFriend = document.getElementById('share-friend');
const shareDownload = document.getElementById('share-download');
const shareSender = document.getElementById('share-sender');
const shareCountdown = document.getElementById('share-countdown');
const shareBox = document.getElementById('share-box');
const shareTitle = document.getElementById('share-title');
const shareWarning = document.getElementById('share-warning');
let bubbleTimer = null;
let shareCountdownTimer = null;
let shareCloseTimer = null;
let shareExpiresAt = 0;
let shareMode = 'idle';
let lastSharePath = '';
let shareUrl = '';
let shareOwner = false;
let latestShare = null;
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
  const data = window.EYES && window.EYES[SPRITE_ALIASES[currentState] || currentState];
  if (!tracking || !data) return;
  const r = data.range;
  const dx = look.x >= 0 ? look.x * r.r : look.x * r.l;
  const dy = look.y >= 0 ? look.y * r.d : look.y * r.u;
  eyeEls.forEach((el) => {
    el.style.transform = `translate(${(dx * size).toFixed(1)}px, ${(dy * size).toFixed(1)}px)`;
  });
}

// ---------- ekspresi ----------
let spriteToken = 0;
let curColor = null;
function setState(state) {
  currentState = SPRITES.includes(state) ? state : 'idle';
  const spriteName = SPRITE_ALIASES[currentState] || currentState;
  const data = window.EYES && window.EYES[spriteName];
  const useEyes = (tracking || document.body.classList.contains('lifted')) && !!data;
  const token = ++spriteToken;
  const fallback = `../../assets/sprites/${spriteName}${useEyes ? '-noeyes' : ''}.png`;
  api.getSprite(spriteName, useEyes).then((url) => {
    if (token === spriteToken) img.src = url || fallback;
  }).catch(() => { if (token === spriteToken) img.src = fallback; });
  body.className = `st-${currentState.replaceAll('_', '-')}`;
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
  const colorChanged = s.color && s.color !== curColor;
  if (s.color && window.balbulColor) {
    const t = window.balbulColor.theme(s.color);
    const st = document.documentElement.style;
    st.setProperty('--accent', t.accent); st.setProperty('--accent-2', t.accent2);
    st.setProperty('--eye', t.eye); st.setProperty('--glow', t.glow);
    curColor = s.color;
  }
  document.body.classList.toggle('tracking', tracking);
  if (!tracking) look = { x: 0, y: 0 };
  if (was !== tracking || colorChanged) setState(currentState);
  else applyLook();
}

// ---------- bubble ----------
function hideBubble() {
  if (shareMode !== 'idle') { closeShare(); return; }
  bubble.classList.add('hidden');
  replyForm.classList.add('hidden');
  incomingChat = null;
  bubbleActions.classList.add('hidden');
  bubbleInfo = null;
  clearTimeout(bubbleTimer);
}

function setShareAnimation(mode) {
  document.body.classList.remove('share-hover', 'share-receive', 'share-carry', 'share-deliver-done', 'share-error');
  if (mode) document.body.classList.add(mode);
}

function resetShareBubble() {
  clearTimeout(shareCloseTimer); clearInterval(shareCountdownTimer); clearTimeout(bubbleTimer);
  shareMode = 'idle'; shareUrl = ''; shareExpiresAt = 0; lastSharePath = ''; shareOwner = false; latestShare = null;
  bubble.classList.remove('share-bubble'); bubble.classList.add('hidden');
  shareContent.classList.add('hidden'); shareQr.classList.add('hidden'); shareLoading.classList.add('hidden');
  shareError.classList.add('hidden'); shareFriend.classList.add('hidden'); shareDownload.classList.add('hidden'); shareSender.classList.add('hidden'); shareCountdown.classList.add('hidden');
  document.getElementById('share-toast').classList.add('hidden');
  shareBox.classList.add('hidden'); shareTitle.textContent = 'Scan me!'; shareWarning.classList.remove('hidden');
  setShareAnimation(''); setState('idle'); setInteractive(false);
}

function closeShare() {
  if (shareMode === 'idle' || shareMode === 'closing') return;
  shareMode = 'closing';
  clearInterval(shareCountdownTimer); clearTimeout(bubbleTimer);
  setShareAnimation('share-deliver-done');
  setState('share_deliver_done');
  if (shareOwner) api.stopShare().catch(() => {});
  clearTimeout(shareCloseTimer);
  shareCloseTimer = setTimeout(resetShareBubble, 520);
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
}

function middleEllipsis(name, limit = 34) {
  if (name.length <= limit) return name;
  const extIndex = name.lastIndexOf('.');
  const ext = extIndex > 0 ? name.slice(extIndex) : '';
  const base = ext ? name.slice(0, extIndex) : name;
  const room = Math.max(10, limit - ext.length - 1);
  const left = Math.ceil(room / 2); const right = Math.floor(room / 2);
  return `${base.slice(0, left)}…${base.slice(-right)}${ext}`;
}

function showShareLoading(filePath) {
  shareMode = 'loading'; lastSharePath = filePath; shareUrl = '';
  clearTimeout(bubbleTimer); clearInterval(shareCountdownTimer);
  bubbleInfo = null; incomingChat = null;
  bubble.classList.add('share-bubble'); bubble.classList.remove('hidden');
  bubbleText.textContent = ''; bubbleActions.classList.add('hidden'); replyForm.classList.add('hidden');
  shareContent.classList.remove('hidden'); shareLoading.classList.remove('hidden');
  shareQr.classList.add('hidden'); shareError.classList.add('hidden'); shareFriend.classList.add('hidden'); shareCountdown.classList.add('hidden');
  shareTitle.textContent = 'Scan me!'; shareName.textContent = middleEllipsis(filePath.split(/[\\/]/).pop() || 'File');
  shareName.title = filePath.split(/[\\/]/).pop() || 'File'; shareSize.textContent = '';
  shareWarning.classList.remove('hidden'); shareBox.classList.remove('hidden');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setShareAnimation(reduced ? 'share-carry' : 'share-receive');
  setState(reduced ? 'share_carry' : 'share_receive');
}

function showShareError(message) {
  shareMode = 'error'; clearInterval(shareCountdownTimer);
  bubble.classList.add('share-bubble'); bubble.classList.remove('hidden');
  shareContent.classList.remove('hidden'); shareLoading.classList.add('hidden'); shareQr.classList.add('hidden');
  shareFriend.classList.add('hidden'); shareCountdown.classList.add('hidden'); shareWarning.classList.add('hidden');
  shareErrorMessage.textContent = message || 'Fitur share belum bisa jalan'; shareError.classList.remove('hidden');
  setShareAnimation('share-error'); setState('share_error');
}

function updateShareCountdown() {
  const seconds = Math.max(0, Math.ceil((shareExpiresAt - Date.now()) / 1000));
  shareCountdown.textContent = `Aktif ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  if (seconds <= 0 && (shareMode === 'ready' || shareMode === 'received')) showShareExpired();
}

function showShareExpired() {
  if (shareMode === 'expired' || shareMode === 'idle') return;
  shareMode = 'expired'; clearInterval(shareCountdownTimer);
  shareTitle.textContent = 'Link sudah kedaluwarsa';
  shareQr.classList.add('hidden'); shareLoading.classList.add('hidden'); shareError.classList.add('hidden');
  shareFriend.classList.add('hidden'); shareCountdown.classList.add('hidden'); shareWarning.classList.add('hidden');
  setShareAnimation('share-error'); setState('share_error');
  clearTimeout(shareCloseTimer);
  shareCloseTimer = setTimeout(() => { if (shareOwner) api.stopShare().catch(() => {}); resetShareBubble(); }, 2000);
}

function receiveDrop(files) {
  if (!files || !files.length) return;
  if (files.length > 1) showBubble('Satu file dulu ya. BalBul akan kirim file pertama.', 2600);
  const file = files[0];
  let filePath = '';
  try { filePath = api.getPathForFile(file); } catch (_) { /* tampilkan error aman */ }
  if (!filePath) { showShareError('File-nya lagi dipakai app lain'); return; }
  showShareLoading(filePath);
  api.startShare(filePath).then((result) => {
    if (!result?.ok && shareMode === 'loading') showShareError('Fitur share belum bisa jalan');
  }).catch(() => { if (shareMode === 'loading') showShareError('Fitur share belum bisa jalan'); });
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
  if (shareMode !== 'idle') { if (p.sound) beep(); return; }
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
  if (shareMode !== 'idle') return;
  incomingChat = message; clearTimeout(bubbleTimer); setState('thinking');
  bubbleText.textContent = `✉ ${message.sender}: ${message.body}`;
  bubbleActions.classList.add('hidden'); replyForm.classList.remove('hidden'); bubble.classList.remove('hidden');
  look = { x: 0, y: -0.85 }; applyLook(); beep();
  bubbleTimer = setTimeout(hideBubble, 30000);
});
api.on('share:ready', (share) => {
  if (shareMode !== 'loading') return;
  shareMode = 'ready'; shareOwner = true; shareUrl = share.url || '';
  latestShare = { sender: 'Saya', name: share.name, size: Number(share.size), url: share.url, qr: share.qr, expiresAt: Number(share.expiresAt) || Date.now()+600000 };
  shareTitle.textContent = 'Scan me!';
  shareName.textContent = middleEllipsis(share.name || 'File'); shareName.title = share.name || 'File';
  shareSize.textContent = formatFileSize(Number(share.size) || 0);
  shareWarning.textContent = Number(share.size) > 500 * 1024 * 1024
    ? 'File besar: komputer harus tetap nyala sampai selesai. Siapa pun yang punya link bisa mengunduhnya; jangan bagikan sembarangan.'
    : 'Siapa pun yang punya link bisa unduh file ini. Jangan bagikan ke sembarang orang.';
  shareQr.src = share.qr; shareQr.classList.remove('hidden');
  shareLoading.classList.add('hidden'); shareError.classList.add('hidden'); shareFriend.classList.remove('hidden');
  shareWarning.classList.remove('hidden'); shareCountdown.classList.remove('hidden');
  setShareAnimation('share-carry'); setState('share_carry');
  shareExpiresAt = Number(share.expiresAt) || (Date.now() + 10 * 60 * 1000);
  updateShareCountdown(); shareCountdownTimer = setInterval(updateShareCountdown, 1000);
});
api.on('share:error', (result) => {
  if (shareMode === 'closing' || shareMode === 'idle') return;
  showShareError(result?.message || 'Fitur share belum bisa jalan');
});
api.on('share:expired', showShareExpired);
api.on('share:closed', () => {
  if (!shareOwner || shareMode === 'expired' || shareMode === 'closing') return;
  resetShareBubble();
});
api.on('character:share-received', (share) => {
  const card=window.BalbulShareCard.normalize(share);
  if(!card||card.expiresAt<=Date.now())return;
  if(shareOwner)api.stopShare().catch(()=>{});
  clearTimeout(bubbleTimer);clearInterval(shareCountdownTimer);clearTimeout(shareCloseTimer);
  shareOwner=false;latestShare=card;shareUrl=card.url;shareExpiresAt=card.expiresAt;shareMode='received';lastSharePath='';
  bubbleInfo=null;incomingChat=null;bubble.classList.add('share-bubble');bubble.classList.remove('hidden');
  bubbleText.textContent='';bubbleActions.classList.add('hidden');replyForm.classList.add('hidden');
  shareContent.classList.remove('hidden');shareLoading.classList.add('hidden');shareError.classList.add('hidden');
  shareTitle.textContent='Scan me!';shareSender.textContent=`Ada File dari ${card.sender} !!`;shareSender.classList.remove('hidden');
  shareName.textContent=middleEllipsis(card.name);shareName.title=card.name;shareSize.textContent=formatFileSize(card.size);
  shareQr.src=card.qr;shareQr.classList.remove('hidden');shareFriend.classList.add('hidden');shareDownload.classList.remove('hidden');
  shareCountdown.classList.remove('hidden');shareWarning.classList.add('hidden');shareBox.classList.remove('hidden');
  setShareAnimation('share-receive');setState('share_receive');setInteractive(true);
  updateShareCountdown();shareCountdownTimer=setInterval(updateShareCountdown,1000);beep();
});
api.on('share:copied', () => {
  shareTitle.textContent = 'Link disalin!';
  setTimeout(() => { if (shareMode === 'ready') shareTitle.textContent = 'Scan me!'; }, 1800);
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
  setInteractive(!!drag || shareMode !== 'idle' || (!!el && (el.id === 'char' || !!el.closest('#bubble'))));
});
document.addEventListener('mouseleave', () => {
  if (drag || shareMode !== 'idle') return;
  setInteractive(false);
  document.body.classList.remove('lifted');
});

// File drop target: only accept a file when the pointer is over the robot.
let fileDragOver = false;
function isRobotDrop(event) {
  const r = wrap.getBoundingClientRect();
  return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
}
function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}
document.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event) || !isRobotDrop(event)) return;
  event.preventDefault(); fileDragOver = true; setInteractive(true);
  document.body.classList.add('share-hover'); setState('share_hover');
});
document.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  if (!isRobotDrop(event)) {
    if (fileDragOver) { fileDragOver = false; document.body.classList.remove('share-hover'); setState('idle'); setInteractive(false); }
    return;
  }
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  if (!fileDragOver) { fileDragOver = true; setInteractive(true); document.body.classList.add('share-hover'); setState('share_hover'); }
});
document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget || !fileDragOver) return;
  fileDragOver = false; document.body.classList.remove('share-hover'); setState('idle'); setInteractive(false);
});
document.addEventListener('drop', (event) => {
  if (!isFileDrag(event) || !isRobotDrop(event)) return;
  event.preventDefault(); fileDragOver = false; document.body.classList.remove('share-hover');
  const files = Array.from(event.dataTransfer.files || []);
  if (files.length > 1) {
    // The first file is still shared; the inline toast makes the single-file limit clear.
    const toast = document.getElementById('share-toast');
    if (toast) { toast.textContent = 'Satu file dulu ya'; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 2400); }
  }
  receiveDrop(files);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shareMode !== 'idle') { event.preventDefault(); closeShare(); }
});
document.addEventListener('pointerdown', (event) => {
  if (shareMode !== 'idle' && !bubble.contains(event.target)) closeShare();
});
document.getElementById('share-close').addEventListener('click', closeShare);
document.getElementById('share-retry').addEventListener('click', () => {
  if (lastSharePath) showShareLoading(lastSharePath);
  if (lastSharePath) api.startShare(lastSharePath).then((result) => { if (!result?.ok && shareMode === 'loading') showShareError('Fitur share belum bisa jalan'); }).catch(() => showShareError('Fitur share belum bisa jalan'));
});
shareFriend.addEventListener('click', () => { if (latestShare) api.shareToFriend(latestShare); });
shareDownload.addEventListener('click', () => { if (shareUrl) api.openShareDownload(shareUrl); });

// ---------- geser & klik karakter ----------
let drag = null;
let dragFrame = 0;
let pendingDragPoint = null;
api.on('character:edge', (edge) => {
  document.body.classList.toggle('edge-left', edge === 'left');
  document.body.classList.toggle('edge-right', edge === 'right');
});
api.on('character:placement', (placement) => {
  document.body.classList.toggle('bubble-below', !!placement?.bubbleBelow);
});
img.addEventListener('pointerenter', () => setInteractive(true));
img.addEventListener('mouseenter', () => setInteractive(true));
img.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  setInteractive(true); // jangan menunggu mousemove pertama untuk mengaktifkan klik
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
    api.dragStart(drag.sx, drag.sy);
  }
  pendingDragPoint = { x: e.screenX, y: e.screenY };
  if (!dragFrame) dragFrame = requestAnimationFrame(() => {
    dragFrame = 0;
    if (pendingDragPoint && drag?.moved) api.dragMove(pendingDragPoint.x, pendingDragPoint.y);
  });
  document.body.classList.toggle('facing-left', dx < -2);
});
function finishCharacterDrag() {
  if (!drag) return;
  const { moved } = drag;
  if (dragFrame) cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  if (moved && pendingDragPoint) api.dragMove(pendingDragPoint.x, pendingDragPoint.y);
  pendingDragPoint = null;
  drag = null;
  document.body.classList.remove('lifted');
  setState(currentState);
  if (moved) api.dragEnd();
  else api.clickCharacter();
  setInteractive(false);
}
img.addEventListener('pointerup', finishCharacterDrag);
img.addEventListener('pointercancel', finishCharacterDrag);
img.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.characterMenu();
});

// ---------- tombol di bubble ----------
bubbleText.addEventListener('click', () => {
  if (incomingChat) { replyInput.focus(); return; }
  api.openDashboard();
  hideBubble();
});
replyInput.addEventListener('focus', () => { clearTimeout(bubbleTimer); });
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
