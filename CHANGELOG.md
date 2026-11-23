# Changelog

## v1.0.13 — 23 November 2026

- Tambahkan tanda pesan desktop sedang dikirim, terkirim, dan dibaca. Status dibaca mengikuti `last_read_at` anggota chat yang sudah dipakai web.

## v1.0.12 — 23 November 2026

- Sinkronkan warna BalBul dan tugas/pengingat personal antara desktop dan web memakai akun Supabase yang sama. Data tugas lokal dipisahkan per akun pada perangkat.
- Posisikan BalBul ke tepi layar dengan balon chat mengarah ke bagian dalam; gerakkan jendela dengan pembaruan per frame agar drag lebih ringan.
- Ganti scrollbar balon chat menjadi garis tipis minimalis dan tampilkan tautan pesan web sebagai banner yang bisa dibuka.

## BalBul Share

- Add drag-and-drop QR file sharing through a 10-minute Cloudflare Quick Tunnel.
- Bundle official Cloudflare `cloudflared` binaries for Windows x64 and macOS x64/arm64. Release binaries add about 55 MB raw to Windows and 82 MB raw to each Mac build before installer compression.
- Share one file at a time, with a random 128-bit download token, streamed transfer, expiry cleanup, and a friend-chat picker.
- Deliver shared files as rich chat cards with sender, filename, size, QR code, and a clickable download button in desktop and web chat; show the same QR and download action in the recipient's BalBul character notification.
- Add a BalBul Drop receiver in the desktop dashboard. A phone can scan a temporary QR, pick files in its browser, and upload directly into Downloads/BalBul Drop without installing an app or signing into a cloud drive.
- Limit receive links to 10 minutes, 95 MiB per file, 500 MiB total, and 20 files per session; stream uploads to disk and keep the local server bound to 127.0.0.1.
- Make ordinary HTTP and HTTPS URLs clickable in desktop and web chat, with a lightweight domain preview tile that does not contact a third-party preview service.
- Use the BalBul robot artwork on the Windows NSIS installer's welcome and completion sidebar.
- Load Supabase JS from the packaged dependency directly so the account screen works in both development and installed builds.
- Windows NSIS sidebar art is stored as a 164 × 314 BMP (154,542 bytes) to match the installer panel dimensions.
- Local Windows NSIS build with BalBul install artwork: `balBul-Setup.exe` is 139,097,513 bytes (132.66 MiB), about 202 KiB larger than the previous local build. No new npm dependency was added. The bundled Windows cloudflared binary itself is 55,483,112 bytes.
