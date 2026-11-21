'use strict';
// Perhitungan warna balBul. Dipakai oleh main.js (Node) dan jendela tampilan (browser).
(function (root) {
  const DEFAULT = '#35e0ff';
  const BASE_HUE = 0.52; // warna biru-cyan sprite asli
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  function normalizeHex(v) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim());
    return m ? '#' + m[1].toLowerCase() : null;
  }
  function hexToRgb(hex) {
    const n = parseInt(normalizeHex(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 1e-9) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6; if (h < 0) h += 1;
    }
    return [h, mx === 0 ? 0 : d / mx, mx];
  }
  function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
    return [m[0] * 255, m[1] * 255, m[2] * 255];
  }

  // Pengaturan putar-warna dari satu warna pilihan
  function params(hex) {
    const [h, s, v] = rgbToHsv(...hexToRgb(normalizeHex(hex) || DEFAULT));
    let val = 0.9 + 0.25 * v;
    if (s < 0.35) val *= 1 + (0.35 - s) * 0.9; // putih/krem: lebih terang
    if (h > 0.08 && h < 0.2 && s >= 0.35) val *= 1.12; // kuning/gold gampang terlihat gelap-kehijauan
    return { hue: h, sat: clamp(s / 0.85, 0.1, 1.15), val };
  }

  // Ubah piksel biru sprite jadi warna pilihan; putih, abu-abu, dan aksen merah/kuning dibiarkan.
  // data: Uint8Array berisi piksel; order: 'rgba' (browser) atau 'bgra' (nativeImage di Electron).
  function recolorPixels(data, hex, order) {
    const norm = normalizeHex(hex);
    if (!norm || norm === DEFAULT) return data;
    const { hue, sat, val } = params(norm);
    const ri = order === 'bgra' ? 2 : 0, bi = order === 'bgra' ? 0 : 2;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const [h, s, v] = rgbToHsv(data[i + ri], data[i + 1], data[i + bi]);
      if (h < 0.45 || h > 0.72 || s <= 0.18) continue;
      const [r, g, b] = hsvToRgb((hue + clamp(h - BASE_HUE, -0.1, 0.2) * 0.3 + 1) % 1, clamp(s * sat, 0, 1), clamp(v * val, 0, 1));
      data[i + ri] = Math.round(r); data[i + 1] = Math.round(g); data[i + bi] = Math.round(b);
    }
    return data;
  }

  // Warna aksen untuk tampilan gelap: pastikan cukup terang
  function accent(hex) {
    const [h, s, v] = rgbToHsv(...hexToRgb(normalizeHex(hex) || DEFAULT));
    return rgbToHex(...hsvToRgb(h, s, Math.max(v, 0.78)));
  }
  function mix(hex, other, t) {
    const a = hexToRgb(hex), b = hexToRgb(other);
    return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }
  function theme(hex) {
    const ac = accent(hex);
    const [r, g, b] = hexToRgb(ac);
    return {
      accent: ac,
      accent2: mix(ac, '#ffffff', 0.4),
      eye: mix(ac, '#ffffff', 0.7),
      glow: `rgba(${r}, ${g}, ${b}, 0.75)`,
      ink: '#05232d',
    };
  }

  const api = { DEFAULT, normalizeHex, params, recolorPixels, theme };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.balbulColor = api;
})(typeof window !== 'undefined' ? window : globalThis);
