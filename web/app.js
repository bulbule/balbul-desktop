import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (s) => document.querySelector(s);
const landingView = $('#landingView'), authView = $('#authView'), appView = $('#appView');
let mode = 'login', user = null, profile = null, activeConversation = null, messageChannel = null, messageSubscription = null;
let conversations = [], friends = [], conversationMembers = [];
const openingDirectIds = new Set();
let unreadChats = {}, soundEnabled = localStorage.getItem('balbul-chat-sound') !== 'off', audioContext = null, globalMessageChannel = null;
const seenMessageIds = new Set();
let receiptChannel = null;
function unreadStorageKey(){return 'balbul-unread-'+(user?.id||'guest');}
function loadUnread(){try{unreadChats=JSON.parse(localStorage.getItem(unreadStorageKey())||'{}')||{};}catch(_){unreadChats={};}}
function saveUnread(){localStorage.setItem(unreadStorageKey(),JSON.stringify(unreadChats));}
function setUnread(id,on){if(on)unreadChats[id]=true;else delete unreadChats[id];saveUnread();renderConversations();updateChatNavDot();}
function updateChatNavDot(){const nav=document.querySelector('.nav[data-panel="chats"]');if(!nav)return;let dot=nav.querySelector('.unread-dot');const hasUnread=Object.keys(unreadChats).length>0;if(hasUnread&&!dot){dot=document.createElement('i');dot.className='unread-dot';dot.setAttribute('aria-label','Pesan belum dibaca');nav.append(dot);}else if(!hasUnread&&dot)dot.remove();}
function playIncomingSound(){if(!soundEnabled)return;try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;audioContext ||= new Ctx();if(audioContext.state==='suspended')audioContext.resume();const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.setValueAtTime(880,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(660,audioContext.currentTime+.12);gain.gain.setValueAtTime(.0001,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.08,audioContext.currentTime+.015);gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+.2);osc.connect(gain);gain.connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.21);}catch(_){}}
function toggleChatSound(){soundEnabled=!soundEnabled;localStorage.setItem('balbul-chat-sound',soundEnabled?'on':'off');updateSoundButton();if(soundEnabled)playIncomingSound();}
function updateSoundButton(){const b=$('#chatSoundToggle');if(b){b.textContent=soundEnabled?'♫ Bunyi aktif':'♫ Bunyi mati';b.classList.toggle('sound-off',!soundEnabled);b.setAttribute('aria-pressed',String(soundEnabled));}}
function receiveIncomingMessage(message){if(!message?.id||seenMessageIds.has(message.id))return;seenMessageIds.add(message.id);if(seenMessageIds.size>500)seenMessageIds.delete(seenMessageIds.values().next().value);if(message.sender_id===user?.id)return;playIncomingSound();if(activeConversation?.id===message.conversation_id&&!appView.classList.contains('hidden')&&!$('#activeChat').classList.contains('hidden')){appendMessage(message);return;}setUnread(message.conversation_id,true);}

async function explainNetworkFailure() {
  if (!navigator.onLine) return 'Koneksi internet browser sedang offline. Sambungkan internet lalu coba lagi.';
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: 'GET', cache: 'no-store', headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    if (response.ok) return 'Server Supabase bisa dijangkau, tetapi permintaan akun gagal. Coba muat ulang halaman; jika berulang, kirim screenshot Console/Network agar penyebab CORS atau browser bisa dipastikan.';
    return `Koneksi ke Supabase berhasil, tetapi endpoint pemeriksaan merespons HTTP ${response.status}. Coba daftar sekali lagi; jika gagal, pesan error asli akan ditampilkan.`;
  } catch (_) {
    return 'Browser tidak dapat menjangkau server Supabase. Cek koneksi internet, VPN, DNS, atau ekstensi pemblokir iklan/privacy. Ini bukan error password atau database.';
  }
}

function notice(message, error = false) {
  const el = $('#authMessage'); el.textContent = message; el.classList.toggle('error', error);
}
function setMode(next) {
  mode = next;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === next));
  $('#authTitle').textContent = next === 'login' ? 'Welcome back!' : 'Join the circle!';
  $('#authSubtitle').textContent = next === 'login' ? 'Masuk lagi dan lanjutkan progresmu.' : 'Buat akun dan mulai perjalanan produktifmu.';
  $('#nameWrap').classList.toggle('hidden', next !== 'signup');
  $('#forgotBtn').classList.toggle('hidden', next !== 'login');
  $('#authSubmit').innerHTML = next === 'login' ? 'Masuk ke balBul <span>↗</span>' : 'Buat akun <span>↗</span>';
  $('#password').autocomplete = next === 'login' ? 'current-password' : 'new-password';
  notice('');
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setMode(b.dataset.tab)));
function showLanding() { landingView.classList.remove('hidden'); authView.classList.add('hidden'); appView.classList.add('hidden'); window.scrollTo(0,0); }
function showAuthMode(next='login') { landingView.classList.add('hidden'); appView.classList.add('hidden'); authView.classList.remove('hidden'); setMode(next); window.scrollTo(0,0); }
document.querySelectorAll('[data-open-auth]').forEach(b => b.addEventListener('click', () => showAuthMode(b.dataset.openAuth)));
$('#backHome').addEventListener('click', showLanding);
$('#menuToggle').addEventListener('click', () => $('.main-nav').classList.toggle('open'));
document.querySelectorAll('.main-nav a').forEach(a => a.addEventListener('click', () => $('.main-nav').classList.remove('open')));

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault(); notice('Sebentar, sedang memproses...');
  const email = $('#email').value.trim(), password = $('#password').value;
  try {
    if (mode === 'signup') {
      const display_name = $('#displayName').value.trim() || 'BalBul User';
      const { data, error } = await supabase.auth.signUp({
        email, password, options: {
          data: { display_name },
          emailRedirectTo: window.location.href.split('#')[0]
        }
      });
      if (error) throw error;
      if (data.session) await enterApp(data.session.user);
      else notice('Akun berhasil dibuat! Cek email kamu dan klik tautan verifikasi sebelum masuk.');
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user.email_confirmed_at) { await supabase.auth.signOut(); throw new Error('Email belum diverifikasi. Cek inbox atau kirim ulang email verifikasi.'); }
      await enterApp(data.user);
    }
  } catch (err) {
    const message = /failed to fetch|networkerror|load failed/i.test(err.message || '')
      ? await explainNetworkFailure()
      : (err.message || 'Terjadi kesalahan.');
    notice(message, true);
  }
});

$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) return notice('Isi email kamu dulu, lalu klik Lupa password.', true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] });
  notice(error ? error.message : 'Link reset password dikirim jika email terdaftar.');
});
$('#signOut').addEventListener('click', async () => { await supabase.auth.signOut(); });
$('#goHome')?.addEventListener('click',()=>{appView.classList.add('hidden');landingView.classList.remove('hidden');window.scrollTo(0,0);});

async function enterApp(currentUser) {
  user = currentUser;
  loadUnread();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  profile = data;
  landingView.classList.add('hidden'); authView.classList.add('hidden'); appView.classList.remove('hidden');
  $('#helloName').textContent = profile.display_name || 'teman';
  $('#myName').textContent = profile.display_name || 'BalBul User';
  $('#myEmail').textContent = user.email || '';
  $('#myCode').textContent = profile.friend_code || '—';
  $('#myAvatar').textContent = (profile.display_name || 'b').slice(0,1).toUpperCase();
  await loadFriends(); await loadConversations();
  if(globalMessageChannel)await supabase.removeChannel(globalMessageChannel);
  globalMessageChannel=supabase.channel('balbul-incoming-'+user.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>receiveIncomingMessage(payload.new)).subscribe();
  updateChatNavDot();updateSoundButton();
}
function showAuth() { showLanding(); activeConversation = null; if (messageChannel) supabase.removeChannel(messageChannel);if(globalMessageChannel){supabase.removeChannel(globalMessageChannel);globalMessageChannel=null;} }
// ---- Pemulihan password: tampilkan form password baru setelah klik tautan email ----
let recovering = /(^|[#&?])type=recovery/.test(location.hash);
function setRecoveryUi(on) {
  $('#recoveryForm').classList.toggle('hidden', !on);
  $('#authForm').classList.toggle('hidden', on);
  $('#forgotBtn').classList.toggle('hidden', on);
  document.querySelector('.tabs').classList.toggle('hidden', on);
}
function startRecovery() {
  recovering = true;
  showAuthMode('login');
  setRecoveryUi(true);
  $('#authTitle').textContent = 'Buat password baru';
  $('#authSubtitle').textContent = 'Masukkan password baru untuk akun kamu.';
  notice('');
  history.replaceState(null, '', location.pathname + location.search);
}
$('#recoveryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#newPassword').value, pw2 = $('#newPassword2').value;
  if (pw.length < 8) return notice('Password minimal 8 karakter.', true);
  if (pw !== pw2) return notice('Kedua password tidak sama.', true);
  notice('Menyimpan password baru...');
  const { data, error } = await supabase.auth.updateUser({ password: pw });
  if (error) return notice(error.message || 'Gagal menyimpan password.', true);
  recovering = false;
  setRecoveryUi(false);
  $('#recoveryForm').reset();
  try {
    if (data.user?.email_confirmed_at) await enterApp(data.user);
    else { showAuthMode('login'); notice('Password diperbarui. Silakan masuk.'); }
  } catch (err) { notice(err.message, true); }
});
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') { startRecovery(); return; }
  if (recovering) return;
  if (session?.user && session.user.email_confirmed_at) {
    if (!user || user.id !== session.user.id) { try { await enterApp(session.user); } catch (e) { notice(e.message, true); } }
  } else if (!session) { user = null; profile = null; showAuth(); }
});
const { data: initial } = await supabase.auth.getSession();
if (recovering) { startRecovery(); }
else if (initial.session?.user?.email_confirmed_at) { try { await enterApp(initial.session.user); } catch (e) { notice(e.message, true); } }
if (location.hash.includes('error_description')) notice(decodeURIComponent(location.hash.split('error_description=')[1]?.replaceAll('+',' ') || 'Verifikasi gagal.'), true);

$('#copyCode').addEventListener('click', async () => { await navigator.clipboard.writeText(profile.friend_code); $('#copyCode').textContent='✓'; setTimeout(()=>{$('#copyCode').innerHTML=ICON_COPY;},1200); });

document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));
  const friendsMode=b.dataset.panel==='friends';
  $('#friendsPanel').classList.toggle('hidden',!friendsMode);
  $('#chatPanel').classList.toggle('hidden',friendsMode);
}));
$('#chatSoundToggle')?.addEventListener('click',toggleChatSound);
$('#newChat').addEventListener('click', showFriendsPanel);
$('#emptyNewChat').addEventListener('click', showFriendsPanel);
function showFriendsPanel(){ document.querySelector('[data-panel="friends"]').click(); }

async function loadFriends() {
  const [{data: reqs,error:rErr},{data: links,error:lErr}] = await Promise.all([
    supabase.from('friend_requests').select('*').eq('receiver_id',user.id).eq('status','pending'),
    supabase.from('friendships').select('*').or(`user_low.eq.${user.id},user_high.eq.${user.id}`)
  ]);
  if (rErr) throw rErr; if (lErr) throw lErr;
  const ids=[...new Set([...(reqs||[]).map(x=>x.sender_id),...(links||[]).map(x=>x.user_low===user.id?x.user_high:x.user_low)])];
  const {data: people,error}=ids.length?await supabase.from('profiles').select('id,display_name,username,avatar_url,friend_code').in('id',ids):{data:[],error:null};
  if(error)throw error;
  const byId=Object.fromEntries((people||[]).map(p=>[p.id,p]));
  friends=(links||[]).map(x=>byId[x.user_low===user.id?x.user_high:x.user_low]).filter(Boolean);
  $('#incomingList').replaceChildren(...(reqs||[]).map(req=>friendRequestRow(req,byId[req.sender_id])));
  $('#friendsList').replaceChildren(...friends.map(p=>friendRow(p)));
  $('#requestCount').textContent=reqs?.length||0; $('#requestCount').classList.toggle('hidden',!reqs?.length);
}
function friendRow(p){const row=document.createElement('div');row.className='list-row';row.innerHTML='<div class="avatar"></div><div class="details"><strong></strong><small></small></div><button class="ghost chat-action" type="button">Chat</button>';row.querySelector('.avatar').textContent=(p.display_name||'b')[0].toUpperCase();row.querySelector('strong').textContent=p.display_name||'Teman';row.querySelector('small').textContent=p.username?'@'+p.username:p.friend_code;const button=row.querySelector('button');button.onclick=()=>openDirect(p,button);return row;}
function friendRequestRow(req,p){const row=document.createElement('div');row.className='list-row';row.innerHTML='<div class="avatar"></div><div class="details"><strong></strong><small>Ingin berteman</small></div><div class="friend-actions"><button class="accept">Terima</button><button class="reject">Tolak</button></div>';row.querySelector('.avatar').textContent=(p?.display_name||'?')[0].toUpperCase();row.querySelector('strong').textContent=p?.display_name||'Pengguna balBul';row.querySelector('.accept').onclick=()=>respondRequest(req,p,true);row.querySelector('.reject').onclick=()=>respondRequest(req,p,false);return row;}
async function respondRequest(req,p,accept){let error;if(accept){({error}=await supabase.rpc('accept_friend_request',{p_request_id:req.id}));}else{({error}=await supabase.from('friend_requests').update({status:'rejected',responded_at:new Date().toISOString()}).eq('id',req.id));}if(error)return alert(error.message);await loadFriends();if(accept&&p)await openDirect(p);}
$('#friendForm').addEventListener('submit',async e=>{e.preventDefault();const code=$('#friendCode').value.trim().toUpperCase();const {data:target,error}=await supabase.from('profiles').select('id,display_name,friend_code').eq('friend_code',code).maybeSingle();if(error)return alert(error.message);if(!target)return alert('Kode teman tidak ditemukan.');if(target.id===user.id)return alert('Itu kode kamu sendiri 😄');const {error:err}=await supabase.from('friend_requests').insert({sender_id:user.id,receiver_id:target.id});if(err)return alert(err.code==='23505'?'Permintaan sudah pernah dikirim.':err.message);$('#friendCode').value='';alert('Permintaan pertemanan dikirim!');});

async function loadConversations(){
  const {data: memberships,error}=await supabase.from('conversation_members').select('conversation_id').eq('user_id',user.id);
  if(error)throw error;
  const ids=[...new Set((memberships||[]).map(x=>x.conversation_id))];
  if(!ids.length){conversations=[];renderConversations();return;}
  const {data: rows,error:e}=await supabase.from('conversations').select('*').in('id',ids).order('created_at',{ascending:false});
  if(e)throw e;
  const {data: members,error:mErr}=await supabase.from('conversation_members').select('conversation_id,user_id').in('conversation_id',ids);
  if(mErr)throw mErr;
  // Chat langsung yang ditinggal temannya: pasangan tetap bisa dikenali dari direct_key.
  const keyOther=c=>c.kind==='direct'&&c.direct_key?c.direct_key.split(':').find(x=>x!==user.id):null;
  const otherIds=[...new Set([...(members||[]).filter(x=>x.user_id!==user.id).map(x=>x.user_id),...(rows||[]).map(keyOther).filter(Boolean)])];
  const {data: people,error:pErr}=otherIds.length?await supabase.from('profiles').select('id,display_name').in('id',otherIds):{data:[],error:null};
  if(pErr)throw pErr;
  const byId=Object.fromEntries((people||[]).map(p=>[p.id,p]));
  const mapped=(rows||[]).map(conv=>{let other=(members||[]).filter(m=>m.conversation_id===conv.id&&m.user_id!==user.id).map(m=>byId[m.user_id]).filter(Boolean);if(!other.length&&keyOther(conv)&&byId[keyOther(conv)])other=[byId[keyOther(conv)]];return {...conv,other};});
  // Existing duplicate direct threads are represented by one row per friend.
  const seen=new Set();
  conversations=mapped.filter(conv=>{
    if(conv.kind!=='direct')return true;
    const otherId=conv.other[0]?.id;
    if(!otherId)return true;
    if(seen.has(otherId))return false;
    seen.add(otherId);return true;
  });
  if(activeConversation&&!conversations.some(x=>x.id===activeConversation.id))activeConversation=null;
  renderConversations();
}
function renderConversations(){const list=$('#conversationList');list.replaceChildren();if(!conversations.length){const p=document.createElement('p');p.className='muted';p.textContent='Belum ada percakapan. Tambah teman dulu, yuk.';list.append(p);return;}for(const c of conversations){const p=c.other[0];const row=document.createElement('div');row.className='list-row'+(activeConversation?.id===c.id?' selected':'')+(unreadChats[c.id]?' has-unread':'');row.innerHTML='<div class="avatar"></div><div class="details"><strong></strong><small>Mulai ngobrol</small></div>'+(unreadChats[c.id]?'<i class="unread-dot" aria-label="Pesan belum dibaca"></i>':'');row.querySelector('.avatar').textContent=(p?.display_name||c.title||'b')[0].toUpperCase();row.querySelector('strong').textContent=p?.display_name||c.title||'Grup balBul';row.onclick=()=>openConversation(c);list.append(row);}}
async function openDirect(p,button){
  if(openingDirectIds.has(p.id))return;
  openingDirectIds.add(p.id);
  const original=button?.textContent;
  if(button){button.disabled=true;button.textContent='Membuka…';button.classList.add('is-loading');}
  try{
    const {data:conversationId,error}=await supabase.rpc('open_direct_conversation',{p_friend_id:p.id});
    if(error)throw error;
    await loadConversations();
    const conversation=conversations.find(x=>x.id===conversationId)||conversations.find(x=>x.kind==='direct'&&x.other.some(y=>y.id===p.id));
    hubPanel('chats');if(conversation)await openConversation(conversation);
  }catch(err){alert(err.message||'Gagal membuka chat.');}
  finally{openingDirectIds.delete(p.id);if(button){button.disabled=false;button.textContent=original||'Chat';button.classList.remove('is-loading');}}
}
async function openConversation(c){
  activeConversation=c;setUnread(c.id,false);openChatRoomUi();
  $('#emptyChat').classList.add('hidden');$('#activeChat').classList.remove('hidden');
  const p=c.other[0];$('#chatTitle').textContent=p?.display_name||c.title||'Percakapan';$('#chatAvatar').textContent=(p?.display_name||'b')[0].toUpperCase();
  let leave=$('#leaveChat');if(!leave){leave=document.createElement('button');leave.id='leaveChat';leave.className='chat-leave-btn';leave.type='button';leave.textContent='Hapus chat';$('#activeChat .room-head').append(leave);leave.onclick=leaveCurrentConversation;}
  renderConversations();
  if(messageChannel){await supabase.removeChannel(messageChannel);messageChannel=null;}
  if(receiptChannel){await supabase.removeChannel(receiptChannel);receiptChannel=null;}
  const {data: members,error:memberError}=await supabase.from('conversation_members').select('user_id,last_read_at').eq('conversation_id',c.id);
  if(memberError)console.warn('Gagal memuat status baca:',memberError.message);
  conversationMembers=members||[];
  await loadMessages(c.id);
  await markConversationRead(c.id);
  messageChannel=supabase.channel('web-chat-'+c.id+'-'+user.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+c.id},payload=>receiveConversationMessage(payload.new))
    .subscribe();
  receiptChannel=supabase.channel('web-receipts-'+c.id+'-'+user.id)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversation_members',filter:'conversation_id=eq.'+c.id},async payload=>{
      const idx=conversationMembers.findIndex(x=>x.user_id===payload.new.user_id);
      if(idx>=0)conversationMembers[idx]=payload.new;else conversationMembers.push(payload.new);
      renderAllReadStatuses();
    }).subscribe();
}
async function leaveCurrentConversation(){
  if(!activeConversation||!confirm('Hapus chat ini dari daftar kamu? Riwayat pesan temanmu tidak akan dihapus.'))return;
  const id=activeConversation.id;
  const {error}=await supabase.from('conversation_members').delete().eq('conversation_id',id).eq('user_id',user.id);
  if(error){alert(error.message);return;}
  if(messageChannel){await supabase.removeChannel(messageChannel);messageChannel=null;}
  if(receiptChannel){await supabase.removeChannel(receiptChannel);receiptChannel=null;}
  conversationMembers=[];activeConversation=null;closeChatRoomUi();$('#activeChat').classList.add('hidden');$('#emptyChat').classList.remove('hidden');
  await loadConversations();
}
async function loadMessages(id){
  const {data,error}=await supabase.from('messages').select('*').eq('conversation_id',id).order('created_at',{ascending:true}).limit(150);
  if(error)return alert(error.message);
  $('#messages').replaceChildren();(data||[]).forEach(appendMessage);renderAllReadStatuses();$('#messages').scrollTop=$('#messages').scrollHeight;
}
function getPeerReadAt(){const peers=conversationMembers.filter(m=>m.user_id!==user?.id);if(!peers.length||peers.some(m=>!m.last_read_at))return null;return peers.map(m=>m.last_read_at).sort()[0]||null;}
function setMessageStatus(el,status){
  if(!el)return;el.dataset.status=status;
  let meta=el.querySelector('.message-meta');
  if(!meta){meta=document.createElement('div');meta.className='message-meta';el.append(meta);}
  const time=el.dataset.timeLabel||'';
  const labels={pending:'◷ Mengirim',failed:'Gagal · klik untuk coba lagi',sent:'✓ Terkirim',read:'✓✓ Dibaca'};
  meta.innerHTML='<time></time><span class="delivery-status"></span>';
  meta.querySelector('time').textContent=time;
  const mark=meta.querySelector('.delivery-status');mark.textContent=labels[status]||'';
  mark.className='delivery-status '+status;
}
function renderAllReadStatuses(){
  const readAt=getPeerReadAt();
  document.querySelectorAll('#messages .bubble.mine[data-status="sent"],#messages .bubble.mine[data-status="read"]').forEach(el=>{
    const created=Date.parse(el.dataset.createdAt||'');
    setMessageStatus(el,readAt&&created&&Date.parse(readAt)>=created?'read':'sent');
  });
}
function appendMessage(m){
  if(!activeConversation||m.conversation_id!==activeConversation.id)return;
  let existing=$('#messages').querySelector('[data-id="'+m.id+'"]');
  if(!existing&&m.sender_id===user.id){
    existing=[...$('#messages').querySelectorAll('.bubble.mine[data-status="pending"]')].find(el=>el.querySelector('.message-body')?.textContent===m.body);
    if(existing){existing.dataset.id=m.id;existing.dataset.createdAt=m.created_at;existing.dataset.timeLabel=new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});setMessageStatus(existing,'sent');renderAllReadStatuses();return;}
  }
  if(existing)return;
  const el=document.createElement('div');el.className='bubble'+(m.sender_id===user.id?' mine':'');el.dataset.id=m.id;el.dataset.createdAt=m.created_at;
  el.dataset.timeLabel=new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const body=document.createElement('div');body.className='message-body';body.textContent=m.body;el.append(body);
  $('#messages').append(el);
  if(m.sender_id===user.id)setMessageStatus(el,'sent');else{setMessageStatus(el,'received');markConversationRead(m.conversation_id);}
  $('#messages').scrollTop=$('#messages').scrollHeight;
  renderAllReadStatuses();
}
function receiveConversationMessage(message){
  if(!message?.id||seenMessageIds.has(message.id))return;
  seenMessageIds.add(message.id);if(seenMessageIds.size>500)seenMessageIds.delete(seenMessageIds.values().next().value);
  if(message.sender_id===user.id){appendMessage(message);return;}
  if(appView.classList.contains('hidden')||$('#activeChat').classList.contains('hidden')){setUnread(message.conversation_id,true);playIncomingSound();return;}
  appendMessage(message);playIncomingSound();
}
async function markConversationRead(conversationId){
  if(!user||!conversationId||document.visibilityState==='hidden'||appView.classList.contains('hidden')||$('#activeChat').classList.contains('hidden')||activeConversation?.id!==conversationId)return;
  const now=new Date().toISOString();
  const {error}=await supabase.from('conversation_members').update({last_read_at:now}).eq('conversation_id',conversationId).eq('user_id',user.id);
  if(!error){const me=conversationMembers.find(m=>m.user_id===user.id);if(me)me.last_read_at=now;}
  else console.warn('Gagal memperbarui status baca:',error.message);
}
async function retryWebMessage(el,body,conversationId){
  if(!el||el.dataset.status!=='failed')return;
  setMessageStatus(el,'pending');
  const {data,error}=await supabase.from('messages').insert({conversation_id:conversationId,sender_id:user.id,body}).select().single();
  if(error){setMessageStatus(el,'failed');return;}
  el.dataset.id=data.id;el.dataset.createdAt=data.created_at;el.dataset.timeLabel=new Date(data.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});setMessageStatus(el,'sent');renderAllReadStatuses();
}
$('#messageForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!activeConversation)return;
  const input=$('#messageInput'),body=input.value.trim();if(!body)return;
  const conversationId=activeConversation.id,tempId='pending-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  input.value='';
  const el=document.createElement('div');el.className='bubble mine';el.dataset.id=tempId;el.dataset.createdAt=new Date().toISOString();el.dataset.timeLabel=new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const text=document.createElement('div');text.className='message-body';text.textContent=body;el.append(text);$('#messages').append(el);setMessageStatus(el,'pending');$('#messages').scrollTop=$('#messages').scrollHeight;input.focus();
  const {data,error}=await supabase.from('messages').insert({conversation_id:conversationId,sender_id:user.id,body}).select().single();
  if(error){setMessageStatus(el,'failed');el.querySelector('.delivery-status').addEventListener('click',()=>retryWebMessage(el,body,conversationId));el.querySelector('.delivery-status').title=error.message;return;}
  el.dataset.id=data.id;el.dataset.createdAt=data.created_at;el.dataset.timeLabel=new Date(data.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});setMessageStatus(el,'sent');renderAllReadStatuses();
});

// When the user returns to the active conversation, refresh the read receipt.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&activeConversation)markConversationRead(activeConversation.id);});
window.addEventListener('focus',()=>{if(activeConversation)markConversationRead(activeConversation.id);});

let personalTasks=[],taskFilter='all',editingTaskId=null,taskChannel=null;
// Di HP, ruang chat dibuka layar penuh supaya kolom ketik tidak tertutup toolbar browser.
const phoneChat=()=>window.matchMedia('(max-width:650px)').matches;
function openChatRoomUi(){if(!phoneChat())return;$('#chatPanel').classList.add('chat-open');document.body.classList.add('chat-open');}
function closeChatRoomUi(){$('#chatPanel').classList.remove('chat-open');document.body.classList.remove('chat-open');}
$('#chatBack')?.addEventListener('click',closeChatRoomUi);
const ICON_COPY=$('#copyCode')?.innerHTML||'';
function hubPanel(name){closeChatRoomUi();if(name==='profile')refreshPushUi();for(const [k,s] of Object.entries({tasks:'#tasksPanel',chats:'#chatPanel',friends:'#friendsPanel',profile:'#profilePanel'}))$(s).classList.toggle('hidden',k!==name);document.querySelectorAll('.nav[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));if(name==='tasks')loadHubTasks();if(name==='profile')renderHubProfile();}
document.querySelectorAll('.nav[data-panel]').forEach(b=>b.addEventListener('click',()=>hubPanel(b.dataset.panel)));
function renderHubProfile(){if(!profile)return;const n=profile.display_name||'BalBul User';$('#profileDisplayName').textContent=n;$('#profileEmail').textContent=user.email||'';$('#profileFriendCode').textContent=profile.friend_code||'';$('#profileAvatarLarge').textContent=n[0].toUpperCase();$('#profileNameInput').value=n;$('#profileUsernameInput').value=profile.username||'';}
$('#profileForm').addEventListener('submit',async e=>{e.preventDefault();const display_name=$('#profileNameInput').value.trim(),username=$('#profileUsernameInput').value.trim().toLowerCase()||null,msg=$('#profileMessage');if(username&&!/^[a-z0-9_]{3,24}$/.test(username)){msg.textContent='Username 3–24 karakter: huruf, angka, underscore.';return;}const {data,error}=await supabase.from('profiles').update({display_name,username}).eq('id',user.id).select().single();if(error){msg.textContent=error.code==='23505'?'Username sudah dipakai.':error.message;return;}profile=data;$('#helloName').textContent=display_name;$('#myName').textContent=display_name;$('#myAvatar').textContent=display_name[0].toUpperCase();msg.textContent='Profil diperbarui.';});
function openHubTask(t=null){editingTaskId=t?.id||null;$('#taskForm').classList.remove('hidden');$('#taskFormTitle').textContent=t?'Edit reminder':'Reminder baru';$('#taskTitle').value=t?.title||'';$('#taskDescription').value=t?.description||'';$('#taskDue').value=t?.due_at?new Date(new Date(t.due_at).getTime()-new Date(t.due_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';$('#taskPriority').value=t?.priority||'medium';$('#saveTask').textContent=t?'Simpan perubahan':'Simpan reminder';}
$('#addTaskBtn').onclick=()=>openHubTask();$('#cancelTask').onclick=()=>{$('#taskForm').reset();$('#taskForm').classList.add('hidden');editingTaskId=null;};
document.querySelectorAll('.task-filter').forEach(b=>b.onclick=()=>{taskFilter=b.dataset.filter;document.querySelectorAll('.task-filter').forEach(x=>x.classList.toggle('active',x===b));renderHubTasks();});
$('#taskForm').addEventListener('submit',async e=>{e.preventDefault();const due=$('#taskDue').value,p={title:$('#taskTitle').value.trim(),description:$('#taskDescription').value.trim()||null,due_at:due?new Date(due).toISOString():null,priority:$('#taskPriority').value,updated_at:new Date().toISOString()};$('#saveTask').disabled=true;let r=editingTaskId?await supabase.from('tasks').update(p).eq('id',editingTaskId).eq('owner_id',user.id):await supabase.from('tasks').insert({...p,owner_id:user.id,created_by:user.id,status:'pending',visibility:'personal'});$('#saveTask').disabled=false;if(r.error){alert(r.error.message);return;}$('#cancelTask').click();await loadHubTasks();});
async function loadHubTasks(){if(!user)return;$('#taskSyncStatus').textContent='● Memuat…';const {data,error}=await supabase.from('tasks').select('*').eq('owner_id',user.id).order('due_at',{ascending:true,nullsFirst:false});if(error){$('#taskSyncStatus').textContent='● Gagal sinkron';$('#taskList').textContent=error.message;return;}personalTasks=data||[];renderHubTasks();$('#taskSyncStatus').textContent='● Tersinkron';}
function renderHubTasks(){const pending=personalTasks.filter(t=>t.status!=='completed'&&t.status!=='cancelled'),today=new Date().toDateString();$('#pendingTaskCount').textContent=pending.length;$('#todayTaskCount').textContent=pending.filter(t=>t.due_at&&new Date(t.due_at).toDateString()===today).length;$('#doneTaskCount').textContent=personalTasks.filter(t=>t.status==='completed').length;$('#taskCount').textContent=pending.length;$('#taskCount').classList.toggle('hidden',!pending.length);const rows=personalTasks.filter(t=>taskFilter==='all'||(taskFilter==='completed'?t.status==='completed':t.status!=='completed'&&t.status!=='cancelled')),list=$('#taskList');list.replaceChildren();if(!rows.length){const e=document.createElement('div');e.className='task-empty';e.textContent='Belum ada reminder. Klik “Tambah reminder” untuk mencatat sesuatu.';list.append(e);return;}for(const t of rows){const card=document.createElement('article');card.className='task-card'+(t.status==='completed'?' is-complete':'');const done=document.createElement('button');done.className='task-check';done.textContent=t.status==='completed'?'✓':'';done.onclick=async()=>{const completed=t.status!=='completed';const {error}=await supabase.from('tasks').update({status:completed?'completed':'pending',completed_at:completed?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',t.id).eq('owner_id',user.id);if(error)alert(error.message);else loadHubTasks();};const body=document.createElement('div');body.className='task-card-body';const title=document.createElement('strong');title.textContent=t.title;const desc=document.createElement('p');desc.textContent=t.description||'';const meta=document.createElement('div');meta.className='task-meta';meta.textContent=(t.due_at?new Date(t.due_at).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'Tanpa deadline')+' · '+({low:'Santai',medium:'Normal',high:'Penting',urgent:'Mendesak'}[t.priority]||'Normal');body.append(title);if(t.description)body.append(desc);body.append(meta);const actions=document.createElement('div');actions.className='task-actions';const edit=document.createElement('button');edit.textContent='Edit';edit.onclick=()=>openHubTask(t);const del=document.createElement('button');del.textContent='Hapus';del.onclick=async()=>{if(!confirm('Hapus reminder ini?'))return;const {error}=await supabase.from('tasks').delete().eq('id',t.id).eq('owner_id',user.id);if(error)alert(error.message);else loadHubTasks();};actions.append(edit,del);card.append(done,body,actions);list.append(card);}}

async function startPersonalHubSync(){if(!user)return;await loadHubTasks();if(taskChannel)supabase.removeChannel(taskChannel);taskChannel=supabase.channel('balbul-tasks-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:'owner_id=eq.'+user.id},()=>loadHubTasks()).subscribe();}
supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'&&session?.user){setTimeout(()=>startPersonalHubSync(),0);}});
if(user)startPersonalHubSync();


// ---- Web Push (notifikasi chat + reminder di HP / browser) ----
const VAPID_PUBLIC='BJDJ-z0pniySysQodWexW7ApIBMIY5izAZE-tTe5ZiIkLr7FCiqA1FhAopfjkJAnM8x8tFgN9IuNSRy-6yL5nwA';
const pushKey=()=>{const p='='.repeat((4-VAPID_PUBLIC.length%4)%4),b=(VAPID_PUBLIC+p).replace(/-/g,'+').replace(/_/g,'/'),r=atob(b);return Uint8Array.from(r,c=>c.charCodeAt(0));};
const isStandalone=()=>window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
async function currentPushSub(){try{const reg=await navigator.serviceWorker.ready;return await reg.pushManager.getSubscription();}catch(_){return null;}}
async function refreshPushUi(){
  const hint=$('#pushHint'),btn=$('#pushToggle');if(!hint||!btn)return;
  btn.disabled=false;
  if(!('serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window)){
    btn.classList.add('hidden');
    hint.textContent=isIOS()?'Di iPhone: buka web ini lewat Safari, tekan Share → Add to Home Screen, lalu buka balBul dari ikon di Home Screen. Setelah itu tombol notifikasi muncul di sini.':'Browser ini belum mendukung notifikasi.';return;}
  btn.classList.remove('hidden');
  if(Notification.permission==='denied'){btn.disabled=true;hint.textContent='Notifikasi diblokir. Aktifkan lagi lewat Pengaturan → Notifikasi → balBul.';btn.textContent='Notifikasi diblokir';return;}
  const sub=await currentPushSub();
  btn.textContent=sub?'Matikan notifikasi':'Aktifkan notifikasi';
  hint.textContent=sub?'Notifikasi aktif di perangkat ini: pesan chat dan reminder akan masuk walau web ditutup.':'Dapat notifikasi pesan chat dan reminder di perangkat ini.';
}
$('#pushToggle')?.addEventListener('click',async()=>{
  const btn=$('#pushToggle'),hint=$('#pushHint');btn.disabled=true;
  try{
    const existing=await currentPushSub();
    if(existing){await supabase.from('push_subscriptions').delete().eq('endpoint',existing.endpoint);await existing.unsubscribe();}
    else{
      if(await Notification.requestPermission()!=='granted')throw new Error('Izin notifikasi tidak diberikan.');
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKey()});
      await supabase.from('push_subscriptions').delete().eq('endpoint',sub.endpoint);
      const {error}=await supabase.from('push_subscriptions').insert({user_id:user.id,endpoint:sub.endpoint,subscription:sub.toJSON(),device_label:(isIOS()?'iPhone':'Browser')+(isStandalone()?' (app)':'')});
      if(error)throw error;
    }
  }catch(e){hint.textContent='Gagal: '+(e.message||e);}
  await refreshPushUi();
});

// Install lightweight PWA service worker for Home Screen and incoming push events.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch(error => console.warn('balBul service worker:', error));
  }, { once: true });
}
