import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (s) => document.querySelector(s);
const authView = $('#authView'), appView = $('#appView');
let mode = 'login', user = null, profile = null, activeConversation = null, messageChannel = null, messageSubscription = null;
let conversations = [], friends = [];

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
  } catch (err) { notice(err.message || 'Terjadi kesalahan.', true); }
});

$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) return notice('Isi email kamu dulu, lalu klik Lupa password.', true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] });
  notice(error ? error.message : 'Link reset password dikirim jika email terdaftar.');
});
$('#signOut').addEventListener('click', async () => { await supabase.auth.signOut(); });

async function enterApp(currentUser) {
  user = currentUser;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  profile = data;
  authView.classList.add('hidden'); appView.classList.remove('hidden');
  $('#helloName').textContent = profile.display_name || 'teman';
  $('#myName').textContent = profile.display_name || 'BalBul User';
  $('#myEmail').textContent = user.email || '';
  $('#myCode').textContent = profile.friend_code || '—';
  $('#myAvatar').textContent = (profile.display_name || 'b').slice(0,1).toUpperCase();
  await loadFriends(); await loadConversations();
}
function showAuth() { appView.classList.add('hidden'); authView.classList.remove('hidden'); activeConversation = null; if (messageChannel) supabase.removeChannel(messageChannel); }
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') { notice('Sesi pemulihan password aktif. Fitur ubah password akan tersedia di pengaturan akun.'); return; }
  if (session?.user && session.user.email_confirmed_at) {
    if (!user || user.id !== session.user.id) { try { await enterApp(session.user); } catch (e) { notice(e.message, true); } }
  } else if (!session) { user = null; profile = null; showAuth(); }
});
const { data: initial } = await supabase.auth.getSession();
if (initial.session?.user?.email_confirmed_at) { try { await enterApp(initial.session.user); } catch (e) { notice(e.message, true); } }
if (location.hash.includes('error_description')) notice(decodeURIComponent(location.hash.split('error_description=')[1]?.replaceAll('+',' ') || 'Verifikasi gagal.'), true);

$('#copyCode').addEventListener('click', async () => { await navigator.clipboard.writeText(profile.friend_code); $('#copyCode').textContent='✓'; setTimeout(()=>$('#copyCode').textContent='⧉',1200); });

document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));
  const friendsMode=b.dataset.panel==='friends';
  $('#friendsPanel').classList.toggle('hidden',!friendsMode);
  $('#chatPanel').classList.toggle('hidden',friendsMode);
}));
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
function friendRow(p){const row=document.createElement('div');row.className='list-row';row.innerHTML='<div class="avatar"></div><div class="details"><strong></strong><small></small></div><button class="ghost">Chat</button>';row.querySelector('.avatar').textContent=(p.display_name||'b')[0].toUpperCase();row.querySelector('strong').textContent=p.display_name||'Teman';row.querySelector('small').textContent=p.username?'@'+p.username:p.friend_code;row.querySelector('button').onclick=()=>openDirect(p);return row;}
function friendRequestRow(req,p){const row=document.createElement('div');row.className='list-row';row.innerHTML='<div class="avatar"></div><div class="details"><strong></strong><small>Ingin berteman</small></div><div class="friend-actions"><button class="accept">Terima</button><button class="reject">Tolak</button></div>';row.querySelector('.avatar').textContent=(p?.display_name||'?')[0].toUpperCase();row.querySelector('strong').textContent=p?.display_name||'Pengguna balBul';row.querySelector('.accept').onclick=()=>respondRequest(req,p,true);row.querySelector('.reject').onclick=()=>respondRequest(req,p,false);return row;}
async function respondRequest(req,p,accept){let error;if(accept){({error}=await supabase.rpc('accept_friend_request',{p_request_id:req.id}));}else{({error}=await supabase.from('friend_requests').update({status:'rejected',responded_at:new Date().toISOString()}).eq('id',req.id));}if(error)return alert(error.message);await loadFriends();if(accept&&p)await openDirect(p);}
$('#friendForm').addEventListener('submit',async e=>{e.preventDefault();const code=$('#friendCode').value.trim().toUpperCase();const {data:target,error}=await supabase.from('profiles').select('id,display_name,friend_code').eq('friend_code',code).maybeSingle();if(error)return alert(error.message);if(!target)return alert('Kode teman tidak ditemukan.');if(target.id===user.id)return alert('Itu kode kamu sendiri 😄');const {error:err}=await supabase.from('friend_requests').insert({sender_id:user.id,receiver_id:target.id});if(err)return alert(err.code==='23505'?'Permintaan sudah pernah dikirim.':err.message);$('#friendCode').value='';alert('Permintaan pertemanan dikirim!');});

async function loadConversations(){
  const {data: memberships,error}=await supabase.from('conversation_members').select('conversation_id').eq('user_id',user.id);
  if(error)throw error;
  const ids=(memberships||[]).map(x=>x.conversation_id);
  if(!ids.length){conversations=[];renderConversations();return;}
  const {data: rows,error:e}=await supabase.from('conversations').select('*').in('id',ids).order('created_at',{ascending:false});
  if(e)throw e;
  const {data: members,error:mErr}=await supabase.from('conversation_members').select('conversation_id,user_id').in('conversation_id',ids);
  if(mErr)throw mErr;
  const otherIds=[...new Set((members||[]).filter(x=>x.user_id!==user.id).map(x=>x.user_id))];
  const {data: people,error:pErr}=otherIds.length?await supabase.from('profiles').select('id,display_name').in('id',otherIds):{data:[],error:null};
  if(pErr)throw pErr;
  const byId=Object.fromEntries((people||[]).map(p=>[p.id,p]));
  conversations=(rows||[]).map(c=>({...c,other:(members||[]).filter(m=>m.conversation_id===c.id&&m.user_id!==user.id).map(m=>byId[m.user_id]).filter(Boolean)}));
  renderConversations();
}
function renderConversations(){const list=$('#conversationList');list.replaceChildren();if(!conversations.length){const p=document.createElement('p');p.className='muted';p.textContent='Belum ada percakapan. Tambah teman dulu, yuk.';list.append(p);return;}for(const c of conversations){const p=c.other[0];const row=document.createElement('div');row.className='list-row'+(activeConversation?.id===c.id?' selected':'');row.innerHTML='<div class="avatar"></div><div class="details"><strong></strong><small>Mulai ngobrol</small></div>';row.querySelector('.avatar').textContent=(p?.display_name||c.title||'b')[0].toUpperCase();row.querySelector('strong').textContent=p?.display_name||c.title||'Grup balBul';row.onclick=()=>openConversation(c);list.append(row);}}
async function openDirect(p){let existing=conversations.find(c=>c.kind==='direct'&&c.other.some(x=>x.id===p.id));if(existing)return openConversation(existing);const {data:c,error}=await supabase.from('conversations').insert({kind:'direct',created_by:user.id}).select().single();if(error)return alert(error.message);const {error:mErr}=await supabase.from('conversation_members').insert([{conversation_id:c.id,user_id:user.id},{conversation_id:c.id,user_id:p.id}]);if(mErr)return alert(mErr.message);await loadConversations();const created=conversations.find(x=>x.id===c.id);if(created)await openConversation(created);}
async function openConversation(c){activeConversation=c;$('#emptyChat').classList.add('hidden');$('#activeChat').classList.remove('hidden');const p=c.other[0];$('#chatTitle').textContent=p?.display_name||c.title||'Percakapan';$('#chatAvatar').textContent=(p?.display_name||'b')[0].toUpperCase();renderConversations();if(messageChannel)await supabase.removeChannel(messageChannel);await loadMessages(c.id);messageChannel=supabase.channel('balbul-chat-'+c.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+c.id},payload=>appendMessage(payload.new)).subscribe();}
async function loadMessages(id){const {data,error}=await supabase.from('messages').select('*').eq('conversation_id',id).order('created_at',{ascending:true}).limit(150);if(error)return alert(error.message);$('#messages').replaceChildren();(data||[]).forEach(appendMessage);$('#messages').scrollTop=$('#messages').scrollHeight;}
function appendMessage(m){if(!activeConversation||m.conversation_id!==activeConversation.id)return;if($('#messages').querySelector('[data-id="'+m.id+'"]'))return;const el=document.createElement('div');el.className='bubble'+(m.sender_id===user.id?' mine':'');el.dataset.id=m.id;const body=document.createElement('div');body.textContent=m.body;const time=document.createElement('time');time.textContent=new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});el.append(body,time);$('#messages').append(el);$('#messages').scrollTop=$('#messages').scrollHeight;}
$('#messageForm').addEventListener('submit',async e=>{e.preventDefault();if(!activeConversation)return;const body=$('#messageInput').value.trim();if(!body)return;$('#messageInput').value='';const {error}=await supabase.from('messages').insert({conversation_id:activeConversation.id,sender_id:user.id,body});if(error){$('#messageInput').value=body;alert(error.message);}});
