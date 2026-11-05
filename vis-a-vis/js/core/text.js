/* Vis-à-vis : Outils texte (découpage, VLAN, vitesses) */
(function (V) {
  'use strict';
  const { v4str } = V;

  /* ---------- Outils texte ---------- */
  function tok(line) {
    const out = []; const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g; let m;
    while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }
  function expandVlans(tokens) {
    const out = [];
    for (let k = 0; k < tokens.length; k++) {
      const x = String(tokens[k]);
      if (tokens[k + 1] === 'to' && /^\d+$/.test(x)) {
        const a = +x, b = +tokens[k + 2];
        for (let v = a; v <= b && v - a < 4095; v++) out.push(v); k += 2;
      } else if (/^\d+-\d+$/.test(x)) {
        const [a, b] = x.split('-').map(Number); for (let v = a; v <= b && v - a < 4095; v++) out.push(v);
      } else if (/^\d+$/.test(x)) out.push(+x);
    }
    return out;
  }
  function fmtVlans(set) {
    if (set === 'all') return 'toutes';
    const a = [...set].map(Number).sort((x, y) => x - y); if (!a.length) return 'aucun';
    const r = []; let s = a[0], p = a[0];
    for (let i = 1; i <= a.length; i++) {
      if (a[i] === p + 1) { p = a[i]; continue; }
      r.push(s === p ? String(s) : s + '-' + p); s = p = a[i];
    }
    return r.join(', ');
  }
  function normSpeed(s) {
    if (!s) return null; s = String(s).toLowerCase();
    if (s === 'auto') return 'auto';
    const m = /^(\d+(?:\.\d+)?)([mg]?)$/.exec(s); if (!m) return s;
    return m[2] === 'g' ? Math.round(+m[1] * 1000) : +m[1];
  }
  const fmtSpeed = v => v == null ? 'auto (défaut)' : (v === 'auto' ? 'auto' : (v >= 1000 ? v / 1000 + ' Gb/s' : v + ' Mb/s'));
  function normArea(a) { if (a == null) return null; return /^\d+$/.test(a) ? v4str(+a >>> 0) : a; }
  const natSort = (a, b) => a.localeCompare(b, 'fr', { numeric: true });
  const mapNet = x => ({ p2p: 'p2p', 'point-to-point': 'p2p', broadcast: 'broadcast', nbma: 'nbma', p2mp: 'p2mp' }[x] || x);

  Object.assign(V, { tok, expandVlans, fmtVlans, normSpeed, fmtSpeed, normArea, natSort, mapNet });
})(globalThis.VAV = globalThis.VAV || {});
