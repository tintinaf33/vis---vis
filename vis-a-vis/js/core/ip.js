/* Vis-à-vis : Adresses IPv4 / IPv6 */
(function (V) {
  'use strict';

  /* ---------- IP ---------- */
  function v4int(s) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s || '')) return null;
    const p = s.split('.').map(Number);
    if (p.some(x => x > 255)) return null;
    return ((p[0] * 16777216) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
  }
  function v4str(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  function maskLen(m) {
    const n = v4int(m); if (n === null) return null;
    let l = 0; while (l < 32 && (n & (0x80000000 >>> l))) l++;
    return l;
  }
  function lenMask(l) { return l <= 0 ? 0 : (l >= 32 ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - l)) >>> 0)); }
  function net4(n, l) { return (n & lenMask(l)) >>> 0; }
  function v6big(s) {
    s = String(s || '').toLowerCase().split('%')[0];
    if (!/^[0-9a-f:]+$/.test(s) || s.indexOf(':') < 0) return null;
    const halves = s.split('::'); if (halves.length > 2) return null;
    const hp = halves[0] ? halves[0].split(':') : [];
    const tp = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    let parts;
    if (halves.length === 1) { parts = hp; if (parts.length !== 8) return null; }
    else { const fill = 8 - hp.length - tp.length; if (fill < 0) return null; parts = [...hp, ...Array(fill).fill('0'), ...tp]; }
    let b = 0n;
    for (const p of parts) { if (!/^[0-9a-f]{1,4}$/.test(p)) return null; b = (b << 16n) + BigInt(parseInt(p, 16)); }
    return b;
  }
  function net6(b, l) { const all = (1n << 128n) - 1n; const mask = l <= 0 ? 0n : (all ^ ((1n << BigInt(128 - l)) - 1n)); return b & mask; }
  function sameNet(x, y, l) { return x.fam === 4 ? net4(x.n, l) === net4(y.n, l) : net6(x.n, l) === net6(y.n, l); }
  function addAddr(i, cidr, extra) {
    if (!cidr) return;
    const [ip, l] = cidr.split('/');
    if (ip.includes(':')) { const b = v6big(ip); if (b !== null) i.v6.push(Object.assign({ fam: 6, ip, len: l ? +l : 128, n: b }, extra || {})); }
    else { const n = v4int(ip); if (n !== null) i.v4.push(Object.assign({ fam: 4, ip, len: l ? +l : 32, n }, extra || {})); }
  }
  const cidr = a => a.ip + '/' + a.len;

  Object.assign(V, { v4int, v4str, maskLen, lenMask, net4, v6big, net6, sameNet, addAddr, cidr });
})(globalThis.VAV = globalThis.VAV || {});
