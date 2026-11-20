'use strict';
const api = window.balbul;

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const REMIND_OPTIONS = ['0', '10', '30', '60', '1440'];
const REPEAT_LABEL = { daily: 'tiap hari', weekdays: 'hari kerja', weekly: 'tiap minggu' };
const KIND_HINT = {
  task: 'Punya deadline. balBul akan mengingatkan, dan ngomel kalau kamu telat.',
  reminder: 'Pengingat santai, misalnya "jam 17.00 pulang ke MBS". Tanpa deadline, balBul tidak marah.',
};
const isReminder = (t) => t.kind === 'reminder';

let tasks = [];
let settings = {};
let view = 'today';
let editingId = null;

// ---------- helper kecil untuk bikin elemen (aman dari HTML injection) ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), val);
    else if (val === true) el.setAttribute(key, '');
    else el.setAttribute(key, val);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);
const sameDay = (a, b) => a.toDateString() === b.toDateString();

function isToday(t) {
  const now = new Date();
  if (t.status === 'done') return sameDay(new Date(t.updated_at), now);
  if (isReminder(t)) {
    if (!t.reminder_at) return false;
    const r = new Date(t.reminder_at);
    return r <= now || sameDay(r, now);
  }
  if (!t.deadline) return true;
  const d = new Date(t.deadline);
  return d < now || sameDay(d, now);
}

function fmtWhen(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
    if (a.status === 'done') return Date.parse(b.updated_at) - Date.parse(a.updated_at);
    const key = (t) => {
      if (t.deadline) return Date.parse(t.deadline);
      return isReminder(t) && t.reminder_at ? Date.parse(t.reminder_at) : Infinity;
    };
    const da = key(a);
    const db = key(b);
    if (da !== db) return da - db;
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

// ---------- tampilan ----------
function ring(done, total) {
  const r = 29;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '70');
  svg.setAttribute('height', '70');
  svg.setAttribute('viewBox', '0 0 70 70');
  const mk = (cls) => {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '35');
    circle.setAttribute('cy', '35');
    circle.setAttribute('r', String(r));
    return circle;
  };
  const fg = mk('fg');
  fg.setAttribute('stroke-dasharray', String(c));
  fg.setAttribute('stroke-dashoffset', String(c * (1 - pct)));
  svg.append(mk('bg'), fg);
  return h('div', { class: 'ring' }, svg,
    h('div', { class: 'label' }, h('div', {}, `${done}/${total}`, h('small', {}, `${Math.round(pct * 100)}%`))));
}

function whenLabel(t) {
  if (isReminder(t)) {
    if (!t.reminder_at) return null;
    const past = t.status === 'pending' && Date.parse(t.reminder_at) <= Date.now();
    const rep = t.repeat && t.repeat !== 'none' ? ` · ${REPEAT_LABEL[t.repeat]}` : '';
    return h('span', { class: `when${past ? ' past' : ''}` }, `${past ? 'Sudah lewat · ' : ''}${fmtWhen(t.reminder_at)}${rep}`);
  }
  if (!t.deadline) return null;
  const late = t.status === 'pending' && Date.parse(t.deadline) < Date.now();
  return h('span', { class: `when${late ? ' late' : ''}` }, (late ? 'Telat · ' : '') + fmtWhen(t.deadline));
}

function taskRow(t) {
  return h('div', { class: `task ${t.status}` },
    h('input', { type: 'checkbox', checked: t.status === 'done', onchange: () => api.toggleTask(t.id) }),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, t.title),
      t.description ? h('div', { class: 'desc' }, t.description) : null),
    isReminder(t) ? h('span', { class: 'kind' }, 'Pengingat') : null,
    h('span', { class: `chip ${t.priority}` }, PRIORITY_LABEL[t.priority]),
    whenLabel(t),
    h('button', { class: 'icon-btn', type: 'button', onclick: () => openForm(t) }, 'Edit'),
    h('button', {
      class: 'icon-btn del',
      type: 'button',
      onclick: () => { if (confirm(`Hapus "${t.title}"?`)) api.deleteTask(t.id); },
    }, 'Hapus'));
}

function renderTasksView() {
  const now = new Date();
  let list;
  let title;
  let subtitle = null;

  if (view === 'today') {
    list = tasks.filter(isToday);
    title = 'Tugas Hari Ini';
    subtitle = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } else if (view === 'done') {
    list = tasks.filter((t) => t.status === 'done');
    title = 'Selesai';
  } else {
    list = tasks;
    title = 'Semua Tugas';
  }

  const countable = list.filter((t) => !isReminder(t)); // pengingat tidak masuk progress
  const done = countable.filter((t) => t.status === 'done').length;
  const head = h('div', { class: 'head' },
    h('div', {}, h('h1', {}, title), subtitle ? h('div', { class: 'date' }, subtitle) : null),
    view === 'done' ? null : ring(done, countable.length));

  const rows = sortTasks(list).map(taskRow);
  const body = rows.length
    ? h('div', { class: 'list' }, rows)
    : h('div', { class: 'empty' }, view === 'done' ? 'Belum ada tugas yang selesai.' : 'Belum ada tugas atau pengingat. Klik tombol tambah di bawah.');

  const main = $('#main');
  main.replaceChildren(head, body,
    h('div', { class: 'add-row' },
      h('button', { class: 'add-btn', type: 'button', onclick: () => openForm(null, 'task') }, '+  Tambah Tugas'),
      h('button', { class: 'add-btn alt', type: 'button', onclick: () => openForm(null, 'reminder') }, '+  Tambah Pengingat')));

  const allDone = view === 'today' && countable.length > 0 && done === countable.length;
  $('#side-sprite').src = `../../assets/sprites/${allDone ? 'proud' : 'idle'}.png`;
}

function settingRow(name, hint, control) {
  return h('div', { class: 'setting' },
    h('div', {}, h('div', { class: 'name' }, name), hint ? h('div', { class: 'hint' }, hint) : null),
    h('div', { class: 'ctl' }, control));
}

function renderSettingsView() {
  const s = settings;
  const sizeVal = h('span', {}, `${s.size}px`);
  const opacityVal = h('span', {}, `${s.opacity}%`);

  const size = h('input', {
    type: 'range', min: '100', max: '260', step: '10', value: String(s.size),
    oninput: (e) => { sizeVal.textContent = `${e.target.value}px`; },
    onchange: (e) => api.setSettings({ size: Number(e.target.value) }),
  });
  const opacity = h('input', {
    type: 'range', min: '30', max: '100', step: '5', value: String(s.opacity),
    oninput: (e) => { opacityVal.textContent = `${e.target.value}%`; },
    onchange: (e) => api.setSettings({ opacity: Number(e.target.value) }),
  });
  const check = (key) => h('input', {
    type: 'checkbox', checked: !!s[key], onchange: (e) => api.setSettings({ [key]: e.target.checked }),
  });
  const time = (key) => h('input', {
    type: 'time', value: s[key], onchange: (e) => { if (e.target.value) api.setSettings({ [key]: e.target.value }); },
  });
  const encourage = h('select', { onchange: (e) => api.setSettings({ encourageEveryMin: Number(e.target.value) }) },
    [[0, 'Mati'], [30, 'Tiap 30 menit'], [60, 'Tiap 1 jam'], [120, 'Tiap 2 jam']].map(([v, label]) =>
      h('option', { value: String(v), selected: v === s.encourageEveryMin }, label)));

  $('#main').replaceChildren(
    h('div', { class: 'head' }, h('h1', {}, 'Pengaturan')),
    settingRow('Tampilkan karakter', 'Karakter balBul melayang di desktop.', check('showCharacter')),
    settingRow('Mata & badan ikut kursor', 'balBul diam di tempat, tapi matanya melirik dan badannya condong ke arah kursor.', check('trackCursor')),
    settingRow('Ukuran karakter', null, [size, sizeVal]),
    settingRow('Transparansi', null, [opacity, opacityVal]),
    settingRow('Posisi karakter', 'Tarik karakter dengan mouse untuk memindahkan.',
      h('button', { class: 'icon-btn', type: 'button', onclick: () => api.setSettings({ x: null, y: null }) }, 'Reset posisi')),
    settingRow('Suara notifikasi', null, check('sound')),
    settingRow('Kata semangat', 'balBul sesekali menyemangati kalau masih ada tugas.', encourage),
    settingRow('Jam tidur balBul', 'Saat jam ini balBul tidur (pengingat tetap bunyi).', [time('quietStart'), '–', time('quietEnd')]),
    settingRow('Jalan otomatis saat Windows nyala', 'Hanya berfungsi di versi .exe hasil build (npm run dist).', check('autoStart')));
}

function render() {
  for (const btn of document.querySelectorAll('#nav button')) {
    btn.classList.toggle('active', btn.dataset.view === view);
  }
  if (view === 'settings') renderSettingsView();
  else renderTasksView();
}

// ---------- form tambah / edit ----------
const dlg = $('#dlg');
const fRemind = $('#f-remind');
let formKind = 'task';

function showError(msg) {
  const el = $('#form-error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function setKind(kind, resetPriority) {
  formKind = kind;
  for (const btn of document.querySelectorAll('#seg button')) btn.classList.toggle('on', btn.dataset.kind === kind);
  for (const el of document.querySelectorAll('.only-task')) el.classList.toggle('hidden', kind !== 'task');
  for (const el of document.querySelectorAll('.only-reminder')) el.classList.toggle('hidden', kind !== 'reminder');
  $('#kind-hint').textContent = KIND_HINT[kind];
  if (resetPriority) $('#f-priority').value = kind === 'reminder' ? 'low' : 'medium';
  showError('');
}

function openForm(task, kind) {
  editingId = task ? task.id : null;
  const k = task ? (isReminder(task) ? 'reminder' : 'task') : (kind || 'task');
  $('#form-title').textContent = `${task ? 'Edit' : 'Tambah'} ${k === 'reminder' ? 'Pengingat' : 'Tugas'}`;
  $('#f-title').value = task ? task.title : '';
  $('#f-desc').value = task && task.description ? task.description : '';
  $('#f-priority').value = task ? task.priority : (k === 'reminder' ? 'low' : 'medium');

  // isian tugas
  $('#f-deadline').value = task ? toLocalInput(task.deadline) : '';
  let remind = 'none';
  let custom = '';
  if (task && !isReminder(task) && task.reminder_at) {
    const diff = task.deadline ? Math.round((Date.parse(task.deadline) - Date.parse(task.reminder_at)) / 60000) : null;
    if (diff !== null && REMIND_OPTIONS.includes(String(diff))) remind = String(diff);
    else { remind = 'custom'; custom = toLocalInput(task.reminder_at); }
  }
  fRemind.value = remind;
  $('#f-custom').value = custom;
  $('#custom-wrap').classList.toggle('hidden', remind !== 'custom');

  // isian pengingat biasa (default: jam bulat berikutnya)
  const nextHour = new Date();
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  $('#f-rtime').value = task && isReminder(task) ? toLocalInput(task.reminder_at) : toLocalInput(nextHour.toISOString());
  $('#f-repeat').value = task && isReminder(task) ? task.repeat || 'none' : 'none';

  setKind(k, false);
  dlg.showModal();
  $('#f-title').focus();
}

$('#seg').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-kind]');
  if (btn) setKind(btn.dataset.kind, !editingId);
});
fRemind.addEventListener('change', () => {
  $('#custom-wrap').classList.toggle('hidden', fRemind.value !== 'custom');
});
$('#btn-cancel').addEventListener('click', () => dlg.close());

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#f-title').value.trim();
  if (!title) return showError('Judul tidak boleh kosong.');

  const base = { title, description: $('#f-desc').value, priority: $('#f-priority').value };
  let data;

  if (formKind === 'reminder') {
    const value = $('#f-rtime').value;
    if (!value) return showError('Isi waktu pengingatnya dulu.');
    const repeat = $('#f-repeat').value;
    const when = new Date(value);
    if (repeat === 'none' && when.getTime() <= Date.now()) {
      return showError('Waktunya sudah lewat. Pilih waktu ke depan, atau atur ulangi.');
    }
    data = { ...base, kind: 'reminder', deadline: null, reminder_at: when.toISOString(), repeat };
  } else {
    const deadlineVal = $('#f-deadline').value;
    const deadline = deadlineVal ? new Date(deadlineVal).toISOString() : null;
    let reminderAt = null;
    if (fRemind.value === 'custom') {
      if (!$('#f-custom').value) return showError('Isi waktu pengingatnya dulu.');
      reminderAt = new Date($('#f-custom').value).toISOString();
    } else if (fRemind.value !== 'none') {
      if (!deadline) return showError('Isi deadline dulu supaya bisa diingatkan sebelum deadline.');
      reminderAt = new Date(Date.parse(deadline) - Number(fRemind.value) * 60000).toISOString();
    }
    data = { ...base, kind: 'task', deadline, reminder_at: reminderAt, repeat: 'none' };
  }

  if (editingId) await api.updateTask(editingId, data);
  else await api.addTask(data);
  dlg.close();
});

// ---------- navigasi & event ----------
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  view = btn.dataset.view;
  render();
});

api.on('tasks-changed', (list) => {
  tasks = list;
  if (view !== 'settings') render();
});
api.on('settings-changed', (s) => {
  settings = s;
  if (view === 'settings') render();
});

// perbarui label "Telat" tiap 30 detik
setInterval(() => { if (view !== 'settings' && !dlg.open) render(); }, 30000);

let dashboardReady = false;
window.addEventListener('balbul-auth-ready', async () => {
  try {
    const [list, s] = await Promise.all([api.listTasks(), api.getSettings()]);
    tasks = list;
    settings = s;
    dashboardReady = true;
    render();
  } catch (error) {
    console.error('Gagal memuat dashboard:', error);
  }
});

