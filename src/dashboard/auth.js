(function () {
'use strict';
// Paket UMD dari dependensi lokal; Electron membawanya bersama aplikasi.
const createClient = window.supabase && window.supabase.createClient;
if (!createClient) {
  const box = document.querySelector('#auth-message');
  if (box) {
    box.textContent = 'Komponen akun belum termuat. Tutup lalu buka ulang balBul. Jika masih muncul, pasang ulang aplikasi.';
    box.classList.add('error');
  }
  throw new Error('supabase-js UMD tidak ditemukan di dependensi aplikasi');
}

const SUPABASE_URL = 'https://okdckmorwoihndvzmhsx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_LUfyYbWQukN05lCYPsF5AQ_-9tsAMhJ';

const secureStorage = {
  getItem: () => window.balbul.authStorage.get(),
  setItem: (_key, value) => window.balbul.authStorage.set(value),
  removeItem: () => window.balbul.authStorage.remove(),
};

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: secureStorage,
    storageKey: 'balbul-desktop-auth',
  },
});

window.balbulCloud = { supabase };

const $ = (selector) => document.querySelector(selector);
const form = $('#auth-form');
const message = $('#auth-message');
let mode = 'login';
let activeUserId = null;

function say(text, isError = false) {
  message.textContent = text || '';
  message.classList.toggle('error', isError);
}
function setMode(next) {
  mode = next;
  $('#auth-title').textContent = mode === 'login' ? 'Selamat datang kembali!' : 'Buat akun balBul';
  $('#auth-name-wrap').classList.toggle('hidden', mode !== 'signup');
  $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-submit').textContent = mode === 'login' ? 'Masuk ke balBul' : 'Daftar akun';
  $('#auth-toggle').textContent = mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk';
  $('#auth-forgot').classList.toggle('hidden', mode !== 'login');
  say('');
}
function showSignedOut() {
  const hadUser = !!activeUserId;
  activeUserId = null;
  if (hadUser) window.dispatchEvent(new CustomEvent('balbul-auth-signed-out'));
  document.body.classList.remove('authenticated');
  $('#auth-screen').classList.remove('hidden');
  $('#app-shell').classList.add('hidden');
  say('');
}
async function showSignedIn(user) {
  if (!user?.email_confirmed_at) {
    showSignedOut();
    say('Email kamu belum diverifikasi. Buka email verifikasi terlebih dahulu.', true);
    return;
  }
  if (activeUserId === user.id) return;
  activeUserId = user.id;
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('display_name, friend_code, color, color_updated_at')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    document.body.classList.add('authenticated');
    $('#auth-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    $('#account-label').textContent = (profile.display_name || user.email) + ' · ' + user.email;
    window.dispatchEvent(new CustomEvent('balbul-auth-ready', { detail: { user, profile } }));
  } catch (error) {
    activeUserId = null;
    say(error.message || 'Gagal memuat profil akun.', true);
  }
}

$('#auth-toggle').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const displayName = $('#auth-name').value.trim();
  const submit = $('#auth-submit');
  submit.disabled = true;
  say('Sedang menghubungkan akun...');
  try {
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName || 'BalBul User' },
          emailRedirectTo: 'https://bulbule.github.io/balbul-desktop/',
        },
      });
      if (error) throw error;
      if (data.session?.user) await showSignedIn(data.session.user);
      else say('Akun berhasil dibuat. Cek inbox email dan klik tautan verifikasi sebelum masuk.');
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user?.email_confirmed_at) {
        await supabase.auth.signOut();
        throw new Error('Email belum diverifikasi. Cek inbox email kamu terlebih dahulu.');
      }
      await showSignedIn(data.user);
    }
  } catch (error) {
    say(error.message || 'Terjadi kesalahan. Coba lagi.', true);
  } finally {
    submit.disabled = false;
  }
});

$('#auth-forgot').addEventListener('click', async () => {
  const email = $('#auth-email').value.trim();
  if (!email) return say('Isi alamat email dulu, lalu tekan Lupa password.', true);
  say('Mengirim tautan pemulihan...');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://bulbule.github.io/balbul-desktop/',
  });
  say(error ? error.message : 'Jika email terdaftar, tautan pemulihan akan dikirim. Buka tautan melalui browser.');
});

$('#auth-signout').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) say(error.message, true);
  else showSignedOut();
});

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    showSignedOut();
  } else if (session.user?.email_confirmed_at) {
    queueMicrotask(() => showSignedIn(session.user));
  }
});

(async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user?.email_confirmed_at) await showSignedIn(data.session.user);
    else showSignedOut();
  } catch (error) {
    showSignedOut();
    say(error.message || 'Tidak bisa mengakses layanan akun. Periksa koneksi internet.', true);
  }
})();
})();
