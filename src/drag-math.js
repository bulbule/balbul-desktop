'use strict';
// Hitung posisi saat karakter diseret. Fungsi murni (tanpa Electron) supaya bisa dites.
//
// Jendela karakter besar dan transparan (ruang untuk balon chat/QR). Menggeser jendela
// sebesar itu tiap frame berat, jadi selama diseret jendela dikecilkan menjadi sebesar
// robot saja. Robot menempel di sudut jendela (kiri/kanan, atas/bawah), jadi pengecilan
// ini tidak menggeser robot sedikit pun. Begitu dilepas, jendela dibesarkan lagi.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// posisi kiri-atas robot di layar, dari batas jendela besar + sisi tempat robot menempel
function robotFromBounds({ bounds, edge, below, size }) {
  return {
    left: bounds.x + (edge === 'right' ? bounds.width - size : 0),
    top: bounds.y + (below ? 0 : bounds.height - size),
  };
}

// posisi robot yang mengikuti kursor, tidak keluar dari area kerja layar
function followCursor({ cursor, offset, size, area }) {
  return {
    left: clamp(Math.round(cursor.x - offset.x), area.x, area.x + area.width - size),
    top: clamp(Math.round(cursor.y - offset.y), area.y, area.y + area.height - size),
  };
}

// sisi balon: robot di separuh kiri layar -> jendela melebar ke kanan, dan sebaliknya
function placementFor({ left, top, size, area, bubbleH }) {
  return {
    edge: left + size / 2 < area.x + area.width / 2 ? 'left' : 'right',
    below: top - area.y < bubbleH,
  };
}

// batas jendela besar (untuk balon) supaya robot tetap persis di (left, top)
function fullBounds({ left, top, edge, below, size, winW, bubbleH }) {
  return {
    x: left - (edge === 'right' ? winW - size : 0),
    y: below ? top : top - bubbleH,
    width: winW,
    height: size + bubbleH,
  };
}

const api = { clamp, robotFromBounds, followCursor, placementFor, fullBounds };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
