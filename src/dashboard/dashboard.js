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
let cloud = null, cloudUser = null, cloudProfile = null;
let friendRows = [], incomingRequests = [], conversations = [], activeConversation = null;
let sharedTasks = [], taskMembersById = {};
let realtimeChannels = [];

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
  else if (view === 'friends') renderFriendsView();
  else if (view === 'shared') renderSharedTasksView();
  else if (view === 'chat') renderChatView();
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


function cloudNotice(message, isError = false) {
  const el = $('#cloud-notice'); if (!el) return;
  el.textContent = message || ''; el.classList.toggle('error', isError);
}
function renderFriendsView() {
  const code = cloudProfile?.friend_code || '—';
  const incoming = incomingRequests.length ? incomingRequests.map(req => h('div',{class:'cloud-person'},
    h('div',{class:'cloud-avatar'},(req.sender?.display_name||'?').slice(0,1).toUpperCase()),
    h('div',{class:'cloud-person-info'},h('strong',{},req.sender?.display_name||'Pengguna balBul'),h('small',{},'Meminta untuk berteman')),
    h('button',{class:'cloud-btn small',type:'button',onclick:()=>respondFriendRequest(req,true)},'Terima'),
    h('button',{class:'cloud-btn ghost small',type:'button',onclick:()=>respondFriendRequest(req,false)},'Tolak')))
    : [h('div',{class:'cloud-empty'},'Belum ada permintaan pertemanan.')];
  const friends = friendRows.length ? friendRows.map(p=>h('div',{class:'cloud-person'},
    h('div',{class:'cloud-avatar'},(p.display_name||'B').slice(0,1).toUpperCase()),
    h('div',{class:'cloud-person-info'},h('strong',{},p.display_name||'Teman'),h('small',{},p.friend_code||'')),
    h('button',{class:'cloud-btn small',type:'button',onclick:()=>openDirectChat(p)},'Chat')))
    : [h('div',{class:'cloud-empty'},'Belum ada teman. Bagikan Friend ID kamu!')];
  const codeBox=h('div',{class:'cloud-code'},h('strong',{},code),
    h('button',{class:'cloud-btn',type:'button',onclick:async()=>{try{await navigator.clipboard.writeText(code);cloudNotice('Friend ID berhasil disalin.');}catch(_){cloudNotice('Friend ID: '+code,true);}}},'Salin ID'));
  const form=h('form',{class:'cloud-add-form',onsubmit:async e=>{
    e.preventDefault();const input=$('#friend-id-input');const friendCode=input.value.trim().toUpperCase();if(!friendCode)return;
    cloudNotice('Mencari Friend ID...');
    try{
      const {data:target,error}=await cloud.from('profiles').select('id,display_name,friend_code').eq('friend_code',friendCode).maybeSingle();
      if(error)throw error;if(!target)throw new Error('Friend ID tidak ditemukan.');
      if(target.id===cloudUser.id)throw new Error('Itu Friend ID kamu sendiri 😄');
      const {error:sendError}=await cloud.from('friend_requests').insert({sender_id:cloudUser.id,receiver_id:target.id});
      if(sendError)throw new Error(sendError.code==='23505'?'Permintaan sudah pernah dikirim.':sendError.message);
      input.value='';cloudNotice('Permintaan pertemanan berhasil dikirim.');await loadFriendData();
    }catch(err){cloudNotice(err.message||'Gagal mengirim permintaan.',true);}
  }},h('input',{id:'friend-id-input',placeholder:'BUL-XXXXXX',maxlength:'20',autocomplete:'off'}),
    h('button',{class:'cloud-btn',type:'submit'},'Kirim Permintaan'));
  $('#main').replaceChildren(
    h('div',{class:'head'},h('div',{},h('h1',{},'Teman'),h('div',{class:'date'},'Bangun circle produktifmu.'))),
    h('div',{id:'cloud-notice',class:'cloud-notice'}),
    h('section',{class:'cloud-card'},h('h2',{},'Friend ID kamu'),codeBox),
    h('section',{class:'cloud-card'},h('h2',{},'Tambah teman baru'),h('p',{class:'cloud-muted'},'Masukkan Friend ID temanmu.'),form),
    h('div',{class:'cloud-columns'},
      h('section',{class:'cloud-card'},h('h2',{},'Permintaan masuk'),h('div',{class:'cloud-list'},incoming)),
      h('section',{class:'cloud-card'},h('h2',{},'Teman kamu'),h('div',{class:'cloud-list'},friends))));
}
async function loadFriendData(){
  if(!cloudUser)return;
  const [{data:reqs,error:rErr},{data:links,error:lErr}]=await Promise.all([
    cloud.from('friend_requests').select('*').eq('receiver_id',cloudUser.id).eq('status','pending'),
    cloud.from('friendships').select('*').or('user_low.eq.'+cloudUser.id+',user_high.eq.'+cloudUser.id)
  ]);
  if(rErr)throw rErr;if(lErr)throw lErr;
  const ids=[...new Set([...(reqs||[]).map(x=>x.sender_id),...(links||[]).map(x=>x.user_low===cloudUser.id?x.user_high:x.user_low)])];
  const {data:people,error:pErr}=ids.length?await cloud.from('profiles').select('id,display_name,friend_code').in('id',ids):{data:[],error:null};
  if(pErr)throw pErr;const byId=Object.fromEntries((people||[]).map(p=>[p.id,p]));
  incomingRequests=(reqs||[]).map(req=>({...req,sender:byId[req.sender_id]}));
  friendRows=(links||[]).map(x=>byId[x.user_low===cloudUser.id?x.user_high:x.user_low]).filter(Boolean);
  if(view==='friends')renderFriendsView();
}
async function respondFriendRequest(req,accept){
  try{
    if(accept){const {error}=await cloud.rpc('accept_friend_request',{p_request_id:req.id});if(error)throw error;}
    else{const {error}=await cloud.from('friend_requests').update({status:'rejected',responded_at:new Date().toISOString()}).eq('id',req.id);if(error)throw error;}
    await loadFriendData();if(accept&&req.sender)await openDirectChat(req.sender);
  }catch(err){cloudNotice(err.message||'Gagal memproses permintaan.',true);}
}
async function loadCloudConversations(){
  const {data:memberships,error}=await cloud.from('conversation_members').select('conversation_id').eq('user_id',cloudUser.id);
  if(error)throw error;const ids=[...new Set((memberships||[]).map(x=>x.conversation_id))];
  if(!ids.length){conversations=[];if(view==='chat')renderChatView();return;}
  const {data:rows,error:e}=await cloud.from('conversations').select('*').in('id',ids).order('created_at',{ascending:false});if(e)throw e;
  const {data:members,error:m}=await cloud.from('conversation_members').select('conversation_id,user_id').in('conversation_id',ids);if(m)throw m;
  const otherIds=[...new Set((members||[]).filter(x=>x.user_id!==cloudUser.id).map(x=>x.user_id))];
  const {data:people,error:p}=otherIds.length?await cloud.from('profiles').select('id,display_name').in('id',otherIds):{data:[],error:null};if(p)throw p;
  const byId=Object.fromEntries((people||[]).map(x=>[x.id,x]));
  conversations=(rows||[]).map(conv=>({...conv,other:(members||[]).filter(x=>x.conversation_id===conv.id&&x.user_id!==cloudUser.id).map(x=>byId[x.user_id]).filter(Boolean)}));
  if(view==='chat')renderChatView();
}
function renderChatView(){
  const list=conversations.length?conversations.map(conv=>{
    const person=conv.other[0];
    return h('button',{class:'chat-conversation'+(activeConversation?.id===conv.id?' selected':''),type:'button',onclick:()=>openCloudConversation(conv)},
      h('span',{class:'cloud-avatar'},(person?.display_name||'B').slice(0,1).toUpperCase()),
      h('span',{},h('strong',{},person?.display_name||'Percakapan'),h('small',{},'Chat pribadi')));
  }):[h('div',{class:'cloud-empty'},'Belum ada percakapan. Tambahkan teman dulu.')];
  const pane=h('section',{class:'chat-pane'});
  if(!activeConversation)pane.append(h('div',{class:'cloud-empty chat-placeholder'},'Pilih teman untuk mulai ngobrol.'));
  else pane.append(h('div',{class:'chat-pane-head'},h('strong',{},activeConversation.other[0]?.display_name||'Chat')),
    h('div',{id:'desktop-messages',class:'desktop-messages'}),
    h('form',{class:'desktop-message-form',onsubmit:sendDesktopMessage},
      h('input',{id:'desktop-message-input',maxlength:'4000',placeholder:'Tulis pesan...',autocomplete:'off'}),
      h('button',{class:'cloud-btn',type:'submit'},'Kirim')));
  $('#main').replaceChildren(h('div',{class:'head'},h('div',{},h('h1',{},'Chat realtime'),h('div',{class:'date'},'Ngobrol langsung dengan teman balBul.'))),
    h('div',{id:'cloud-notice',class:'cloud-notice'}),h('div',{class:'desktop-chat-layout'},h('div',{class:'chat-conversation-list'},list),pane));
  if(activeConversation){loadCloudMessages(activeConversation.id);startChatRealtime(activeConversation.id);}
}
async function openDirectChat(person){
  try{
    const existing=conversations.find(x=>x.kind==='direct'&&x.other.some(p=>p.id===person.id));
    if(existing){activeConversation=existing;view='chat';render();return;}
    const {data:conv,error}=await cloud.from('conversations').insert({kind:'direct',created_by:cloudUser.id}).select().single();if(error)throw error;
    const {error:mErr}=await cloud.from('conversation_members').insert([{conversation_id:conv.id,user_id:cloudUser.id},{conversation_id:conv.id,user_id:person.id}]);if(mErr)throw mErr;
    await loadCloudConversations();activeConversation=conversations.find(x=>x.id===conv.id)||null;view='chat';render();
  }catch(err){cloudNotice(err.message||'Gagal membuka chat.',true);}
}
function openCloudConversation(conv){activeConversation=conv;view='chat';render();}
async function loadCloudMessages(id){
  const box=$('#desktop-messages');if(!box)return;
  const {data,error}=await cloud.from('messages').select('*').eq('conversation_id',id).order('created_at',{ascending:true}).limit(150);
  if(error){cloudNotice(error.message,true);return;}if(!$('#desktop-messages')||activeConversation?.id!==id)return;
  box.replaceChildren(...(data||[]).map(messageElement));box.scrollTop=box.scrollHeight;
}
function messageElement(message){
  const el=h('div',{class:'desktop-message'+(message.sender_id===cloudUser.id?' mine':'')});
  el.dataset.messageId=message.id;
  el.append(h('div',{},message.body),h('time',{},new Date(message.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})));
  return el;
}
function appendCloudMessage(message){
  if(!activeConversation||message.conversation_id!==activeConversation.id)return;
  const box=$('#desktop-messages');if(!box||box.querySelector('[data-message-id="'+message.id+'"]'))return;
  box.append(messageElement(message));box.scrollTop=box.scrollHeight;
}
async function sendDesktopMessage(e){
  e.preventDefault();const input=$('#desktop-message-input');const body=input?.value.trim();if(!body||!activeConversation)return;
  input.value='';const {error}=await cloud.from('messages').insert({conversation_id:activeConversation.id,sender_id:cloudUser.id,body});
  if(error){input.value=body;cloudNotice(error.message,true);}
}
function startCloudRealtime(){
  realtimeChannels.forEach(ch=>cloud.removeChannel(ch));realtimeChannels=[];
  const friendsChannel=cloud.channel('balbul-desktop-friends-'+cloudUser.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'friend_requests',filter:'receiver_id=eq.'+cloudUser.id},()=>loadFriendData().catch(console.error))
    .on('postgres_changes',{event:'*',schema:'public',table:'friendships'},()=>loadFriendData().catch(console.error)).subscribe();
  const tasksChannel=cloud.channel('balbul-desktop-tasks-'+cloudUser.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},()=>loadSharedTasks().catch(console.error))
    .on('postgres_changes',{event:'*',schema:'public',table:'task_members',filter:'user_id=eq.'+cloudUser.id},()=>loadSharedTasks().catch(console.error)).subscribe();
  const membersChannel=cloud.channel('balbul-desktop-members-'+cloudUser.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'conversation_members',filter:'user_id=eq.'+cloudUser.id},()=>loadCloudConversations().catch(console.error)).subscribe();
  realtimeChannels.push(friendsChannel,membersChannel,tasksChannel);
}
function startChatRealtime(id){
  const channelName='balbul-desktop-chat-'+id;
  realtimeChannels.filter(ch=>ch.topic==='realtime:'+channelName).forEach(ch=>{cloud.removeChannel(ch);realtimeChannels=realtimeChannels.filter(x=>x!==ch);});
  const ch=cloud.channel(channelName).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+id},payload=>appendCloudMessage(payload.new)).subscribe();
  realtimeChannels.push(ch);
}
window.addEventListener('balbul-auth-ready',async event=>{
  cloud=window.balbulCloud?.supabase;cloudUser=event.detail.user;cloudProfile=event.detail.profile;
  try{await Promise.all([loadFriendData(),loadCloudConversations(),loadSharedTasks()]);startCloudRealtime();}
  catch(err){console.error('Friend/chat init failed:',err);cloudNotice(err.message||'Gagal memuat teman dan chat.',true);}
});


async function loadSharedTasks(){
  if(!cloudUser)return;
  const {data:mine,error:mineError}=await cloud.from('tasks').select('*').eq('owner_id',cloudUser.id).eq('visibility','shared').order('created_at',{ascending:false});
  if(mineError)throw mineError;
  const {data:memberships,error:memError}=await cloud.from('task_members').select('task_id,user_id,added_by').eq('user_id',cloudUser.id);
  if(memError)throw memError;
  const memberTaskIds=[...new Set((memberships||[]).map(x=>x.task_id))];
  const other=memberTaskIds.length?await cloud.from('tasks').select('*').in('id',memberTaskIds).eq('visibility','shared'):{data:[],error:null};
  if(other.error)throw other.error;
  const byId=new Map([...(mine||[]),...(other.data||[])].map(t=>[t.id,t]));
  sharedTasks=[...byId.values()].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  const ids=sharedTasks.map(t=>t.id);
  taskMembersById={};
  if(ids.length){
    const {data:allMembers,error}=await cloud.from('task_members').select('task_id,user_id,added_by').in('task_id',ids);
    if(error)throw error;
    const userIds=[...new Set((allMembers||[]).map(x=>x.user_id))];
    const {data:people,error:pErr}=userIds.length?await cloud.from('profiles').select('id,display_name').in('id',userIds):{data:[],error:null};
    if(pErr)throw pErr;
    const names=Object.fromEntries((people||[]).map(p=>[p.id,p.display_name]));
    for(const m of allMembers||[])(taskMembersById[m.task_id] ||= []).push({user_id:m.user_id,name:names[m.user_id]||'Teman'});
  }
  if(view==='shared')renderSharedTasksView();
}
function renderSharedTasksView(){
  const friendOptions=friendRows.map(p=>h('option',{value:p.id},p.display_name||p.friend_code||'Teman'));
  const form=h('form',{class:'shared-create-form',onsubmit:async e=>{
    e.preventDefault();
    const title=$('#shared-title').value.trim(), friendId=$('#shared-friend').value;
    if(!title||!friendId)return cloudNotice('Isi judul dan pilih teman dulu.',true);
    const due=$('#shared-due').value;
    cloudNotice('Membuat tugas bersama...');
    try{
      const {data:task,error}=await cloud.from('tasks').insert({
        owner_id:cloudUser.id,created_by:cloudUser.id,title,
        description:$('#shared-description').value.trim()||null,
        priority:$('#shared-priority').value,
        due_at:due?new Date(due).toISOString():null,
        visibility:'shared'
      }).select().single();
      if(error)throw error;
      const {error:memberError}=await cloud.from('task_members').insert({
        task_id:task.id,user_id:friendId,added_by:cloudUser.id
      });
      if(memberError){
        await cloud.from('tasks').delete().eq('id',task.id);
        throw memberError;
      }
      await loadSharedTasks();
      cloudNotice('Tugas bersama berhasil dibuat dan dibagikan!');
      $('#shared-create-form').reset();
    }catch(err){cloudNotice(err.message||'Gagal membuat tugas bersama.',true);}
  }});
  form.id='shared-create-form';
  form.append(
    h('input',{id:'shared-title',required:true,maxlength:'200',placeholder:'Contoh: Selesaikan desain brosur'}),
    h('textarea',{id:'shared-description',rows:'2',maxlength:'2000',placeholder:'Catatan tugas (opsional)'}),
    h('select',{id:'shared-friend',required:true},h('option',{value:''},'Pilih teman...'),friendOptions),
    h('select',{id:'shared-priority'},['low','medium','high','urgent'].map(x=>h('option',{value:x},({low:'Low',medium:'Medium',high:'High',urgent:'Urgent'})[x]))),
    h('input',{id:'shared-due',type:'datetime-local'}),
    h('button',{class:'cloud-btn',type:'submit'},'Buat & Bagikan'));
  const cards=sharedTasks.map(task=>{
    const members=taskMembersById[task.id]||[];
    const status=h('select',{class:'shared-status',value:task.status,onchange:async e=>{
      const next=e.target.value;
      const {error}=await cloud.from('tasks').update({status:next,updated_at:new Date().toISOString(),completed_at:next==='completed'?new Date().toISOString():null}).eq('id',task.id);
      if(error){cloudNotice(error.message,true);e.target.value=task.status;}else{cloudNotice('Status tugas berhasil disinkronkan.');await loadSharedTasks();}
    }},[
      h('option',{value:'pending',selected:task.status==='pending'},'Belum mulai'),
      h('option',{value:'in_progress',selected:task.status==='in_progress'},'Sedang dikerjakan'),
      h('option',{value:'completed',selected:task.status==='completed'},'Selesai'),
      h('option',{value:'cancelled',selected:task.status==='cancelled'},'Dibatalkan')
    ]);
    const owner=task.owner_id===cloudUser.id;
    return h('article',{class:'shared-task-card'},
      h('div',{class:'shared-task-top'},h('div',{},h('h3',{},task.title),h('p',{class:'cloud-muted'},task.description||'Tidak ada catatan')),
        h('span',{class:'shared-owner'},owner?'Dibuat kamu':'Dibagikan ke kamu')),
      h('div',{class:'shared-task-meta'},
        h('span',{},'Prioritas: '+task.priority),
        h('span',{},task.due_at?'Deadline: '+new Date(task.due_at).toLocaleString('id-ID'):'Tanpa deadline')),
      h('div',{class:'shared-task-members'},'Anggota: '+members.map(m=>m.name).join(', ')),
      h('label',{class:'shared-status-label'},'Status bersama ',status));
  });
  $('#main').replaceChildren(
    h('div',{class:'head'},h('div',{},h('h1',{},'Tugas Bersama'),h('div',{class:'date'},'Kerjakan bareng, progres tersinkron otomatis.'))),
    h('div',{id:'cloud-notice',class:'cloud-notice'}),
    h('section',{class:'cloud-card'},h('h2',{},'Buat tugas bersama'),friendRows.length?form:h('p',{class:'cloud-muted'},'Tambahkan teman terlebih dahulu untuk membuat tugas bersama.')),
    h('section',{class:'cloud-card'},h('h2',{},'Daftar tugas bersama'),cards.length?h('div',{class:'shared-task-list'},cards):h('div',{class:'cloud-empty'},'Belum ada tugas bersama.')));
}

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

