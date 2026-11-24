'use strict';
const assert = require('assert');
const { robotFromBounds, followCursor, placementFor, fullBounds } = require('../src/drag-math');

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const size = 150, winW = 420, bubbleH = 440;

// robot tidak bergeser saat jendela besar <-> kecil, untuk keempat kombinasi sisi
for (const edge of ['left', 'right']) {
  for (const below of [false, true]) {
    for (const [left, top] of [[0, 0], [1770, 890], [300, 700], [1000, 100]]) {
      const big = fullBounds({ left, top, edge, below, size, winW, bubbleH });
      assert.deepStrictEqual(robotFromBounds({ bounds: big, edge, below, size }), { left, top }, `${edge}/${below} @${left},${top}`);
    }
  }
}

// mengikuti kursor tanpa selisih: robot = kursor - offset
const off = { x: 40, y: 60 };
assert.deepStrictEqual(followCursor({ cursor: { x: 540, y: 460 }, offset: off, size, area }), { left: 500, top: 400 });
// ditarik keluar layar: mentok di tepi (robot bisa sampai pojok)
assert.deepStrictEqual(followCursor({ cursor: { x: -999, y: -999 }, offset: off, size, area }), { left: 0, top: 0 });
assert.deepStrictEqual(followCursor({ cursor: { x: 9999, y: 9999 }, offset: off, size, area }), { left: 1770, top: 890 });

// monitor kedua di kiri (koordinat negatif)
const left2 = { x: -1920, y: 0, width: 1920, height: 1080 };
assert.deepStrictEqual(followCursor({ cursor: { x: -5000, y: 10 }, offset: off, size, area: left2 }), { left: -1920, top: 0 });

// sisi dan penempatan balon
assert.deepStrictEqual(placementFor({ left: 100, top: 900, size, area, bubbleH }), { edge: 'left', below: false });
assert.deepStrictEqual(placementFor({ left: 1700, top: 900, size, area, bubbleH }), { edge: 'right', below: false });
assert.deepStrictEqual(placementFor({ left: 1700, top: 10, size, area, bubbleH }), { edge: 'right', below: true });

// jendela besar hasil akhir tetap membuat robot persis di posisi lepas, di pojok mana pun
for (const [left, top] of [[0, 0], [1770, 0], [0, 890], [1770, 890]]) {
  const p = placementFor({ left, top, size, area, bubbleH });
  const b = fullBounds({ left, top, ...p, below: p.below, size, winW, bubbleH });
  assert.deepStrictEqual(robotFromBounds({ bounds: b, edge: p.edge, below: p.below, size }), { left, top });
}

console.log('drag-math.test.js OK');
