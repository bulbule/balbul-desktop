# balBul Desktop Assistant

Robot pixel art kecil yang melayang di desktop Windows kamu. Tugasnya: nyimpen to-do list, ngingetin deadline, dan ngomel kalau tugas kamu ditunda-tunda.

## Fitur v1.0

- Karakter floating, selalu di atas jendela lain, bisa digeser pakai mouse
- 15 ekspresi (idle, happy, reminder, urgent, marah, thinking, working, proud, encourage, wait, sleep, AFK, lembur, error, offline) yang berubah sesuai kondisi tugas
- To-do list: tambah, edit, hapus, centang selesai
- Prioritas: Low, Medium, High, Urgent
- **Tugas** (ada deadline): diingatkan sebelum deadline, dan balBul marah kalau telat
- **Pengingat biasa** (tanpa deadline), misalnya "17.00 pulang ke MBS" atau "20.00 ke gym": balBul cuma ngingetin dengan santai, tidak pernah marah. Bisa diulang sekali saja, tiap hari, hari kerja, atau tiap minggu
- Mata & badan balBul bisa mengikuti kursor (aktifkan di Pengaturan)
- Notifikasi Windows + bubble chat dari balBul, ada tombol **Selesai** dan **Tunda 10 mnt**
- Ringkasan hari ini (progress selesai / total)
- Pengaturan: ukuran, transparansi, suara, jam tidur, kata semangat
- Data tersimpan lokal di laptop (tanpa internet, tanpa akun)

## Cara menjalankan (pertama kali)

Syarat: Node.js sudah terpasang (cek dengan `node -v`).

1. Buka folder proyek ini di VS Code.
2. Buka terminal: menu **Terminal → New Terminal**.
3. Pasang bahan-bahannya (cukup sekali, butuh internet, agak lama):
   ```
   npm install
   ```
4. Jalankan balBul:
   ```
   npm start
   ```

Setelah jalan, balBul muncul di pojok kanan bawah layar. Klik dia untuk membuka dashboard. Klik kanan untuk menu. Ikon kecil di system tray (dekat jam) juga bisa dipakai membuka atau keluar.

Tombol **X** di dashboard hanya menyembunyikan jendela, balBul tetap jalan supaya pengingat tetap bunyi. Untuk benar-benar keluar: klik kanan balBul → **Keluar**.

## Jadikan aplikasi .exe (opsional)

Supaya balBul bisa dipasang seperti aplikasi biasa dan jalan otomatis saat Windows nyala:

```
npm run dist
```

Hasilnya ada di folder `dist/` (file installer `balBul Setup ... .exe`). Windows mungkin menampilkan peringatan "SmartScreen" karena aplikasinya belum ditandatangani. Klik **More info → Run anyway**.

Opsi **Jalan otomatis saat Windows nyala** di Pengaturan hanya berfungsi di versi .exe ini.

## Kalau ada masalah

| Masalah | Solusi |
|---|---|
| `npm` tidak dikenali | Tutup dan buka lagi VS Code, atau install ulang Node.js |
| `npm install` error / lama sekali | Cek internet, lalu coba lagi. Kalau masih gagal, copy pesan errornya dan tanya Claude |
| Karakter tidak kelihatan | Klik ikon balBul di system tray → **Tampilkan karakter**, atau Pengaturan → **Reset posisi** |
| Notifikasi tidak muncul | Cek Windows: Settings → System → Notifications, pastikan tidak dalam mode Focus/Do Not Disturb |
| Mau lihat/hapus data | Data ada di `%APPDATA%\balbul-desktop\` (file `tasks.json` dan `settings.json`) |

## Struktur proyek

```
balbul-desktop/
├─ assets/
│  ├─ icon.png            # ikon aplikasi
│  └─ sprites/            # 15 ekspresi karakter (PNG transparan)
├─ src/
│  ├─ main.js             # otak: jendela, penyimpanan, pengingat, notifikasi
│  ├─ preload.js          # jembatan aman antara tampilan dan otak
│  ├─ character/          # tampilan karakter + bubble chat
│  └─ dashboard/          # tampilan to-do list dan pengaturan
└─ package.json
```

## Struktur data tugas

Dibuat sama dengan rencana tabel Supabase, supaya nanti gampang dipindah ke cloud.

| Field | Isi |
|---|---|
| `id` | UUID |
| `title` | judul tugas |
| `description` | catatan (boleh kosong) |
| `priority` | `low` / `medium` / `high` / `urgent` |
| `status` | `pending` / `done` |
| `deadline` | waktu deadline (boleh kosong) |
| `reminder_at` | waktu pengingat (boleh kosong) |
| `created_at`, `updated_at` | waktu dibuat dan diubah |

## Rencana berikutnya

- Sinkronisasi ke Supabase (login + tabel `tasks`) supaya data ada di banyak perangkat
- Animasi multi-frame (sekarang tiap ekspresi satu gambar dengan gerakan CSS)
- Tugas berulang (harian / mingguan)
