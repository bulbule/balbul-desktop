// Menyalin supabase-js (build UMD) dari node_modules ke src/dashboard/vendor/
// supaya aplikasi desktop tidak bergantung pada CDN saat dijalankan (bisa offline).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'src', 'dashboard', 'vendor', 'supabase.js');

let pkgDir;
try {
  pkgDir = path.dirname(require.resolve('@supabase/supabase-js/package.json', { paths: [root] }));
} catch (_) {
  console.error('[vendor-supabase] @supabase/supabase-js belum terpasang. Jalankan: npm install');
  process.exit(1);
}
const source = path.join(pkgDir, 'dist', 'umd', 'supabase.js');
if (!fs.existsSync(source)) {
  console.error('[vendor-supabase] File UMD tidak ditemukan: ' + source);
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log('[vendor-supabase] OK -> ' + path.relative(root, target));
