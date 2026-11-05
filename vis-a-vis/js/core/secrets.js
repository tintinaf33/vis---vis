/* Vis-à-vis : Clés et mots de passe (décodage $9$ local, jamais affiché) */
(function (V) {
  'use strict';

  /* ---------- Secrets Junos $9$ (décodage local, jamais affiché) ---------- */
  const J9 = (function () {
    const FAM = ['QzF3n6/9CAtpu0O', 'B1IREhcSyrleKvMW8LXx', '7N-dVbwsY2g4oaJZGUDj', 'iHkq.mPf5T'];
    const EXTRA = {}; FAM.forEach((f, i) => { for (const c of f) EXTRA[c] = 3 - i; });
    const NA = FAM.join('').split(''); const AN = {}; NA.forEach((c, i) => { AN[c] = i; });
    const ENC = [[1, 4, 32], [1, 16, 32], [1, 8, 32], [1, 64], [1, 32], [1, 4, 16, 128], [1, 32, 64]];
    const mod = (a, n) => ((a % n) + n) % n;
    function dec(s) {
      const m = /^\$9\$(\S+)$/.exec(s || ''); if (!m) return null;
      let ch = m[1]; const take = n => { const r = ch.slice(0, n); ch = ch.slice(n); return r; };
      const first = take(1); if (EXTRA[first] === undefined) return null;
      take(EXTRA[first]);
      let prev = first, out = '';
      while (ch.length) {
        const d = ENC[out.length % ENC.length]; const nib = take(d.length);
        if (nib.length < d.length) return null;
        let num = 0;
        for (let i = 0; i < nib.length; i++) {
          const c = nib[i]; if (AN[c] === undefined) return null;
          num += (mod(AN[c] - AN[prev], NA.length) - 1) * d[i]; prev = c;
        }
        out += String.fromCharCode(mod(num, 256));
      }
      return out;
    }
    function enc(plain, seed) {
      let r = seed || 7; const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
      const salt = NA[Math.floor(rnd() * NA.length)];
      let crypt = '$9$' + salt; for (let i = 0; i < EXTRA[salt]; i++) crypt += NA[Math.floor(rnd() * NA.length)];
      let prev = salt;
      for (let p = 0; p < plain.length; p++) {
        const e = ENC[p % ENC.length]; let ord = plain.charCodeAt(p); const gaps = [];
        for (let i = e.length - 1; i >= 0; i--) { gaps.unshift(Math.floor(ord / e[i])); ord = ord % e[i]; }
        for (let g of gaps) { g += AN[prev] + 1; const c = NA[mod(g, NA.length)]; crypt += c; prev = c; }
      }
      return crypt;
    }
    return { dec, enc };
  })();

  function secret(raw) {
    if (raw == null || raw === '') return null;
    if (/^\$9\$/.test(raw)) return { kind: 'junos9', raw, value: J9.dec(raw) };
    if (/^\$[1256]\$/.test(raw)) return { kind: 'hash', raw, value: null };
    return { kind: 'plain', raw, value: raw };
  }
  function cwSecret(mode, val) {
    if (val == null) return null;
    if (mode === 'plain' || mode === 'simple') return { kind: 'plain', raw: val, value: val };
    return { kind: 'cipher', raw: val, value: null };
  }
  function fmtSecret(s) {
    if (!s) return 'aucune';
    return { junos9: 'clé $9$ (masquée)', cipher: 'clé chiffrée $c$', plain: 'clé en clair (masquée)', hash: 'clé hachée' }[s.kind] || 'clé';
  }
  function cmpSecret(a, b) {
    if (!a && !b) return { sev: 'ok', msg: 'Aucune clé des deux côtés.' };
    if (!a || !b) return { sev: 'err', msg: 'Une clé est configurée d’un seul côté : l’authentification échouera.' };
    if (a.value != null && b.value != null) return a.value === b.value
      ? { sev: 'ok', msg: 'Clés identiques (comparées après décodage local, jamais affichées).' }
      : { sev: 'err', msg: 'Les clés sont différentes.' };
    if (a.raw === b.raw) return { sev: 'ok', msg: 'Chaînes chiffrées identiques.' };
    return { sev: 'info', msg: 'Une clé est chiffrée de façon non réversible (HPE $c$) : comparez-la à la main.' };
  }

  Object.assign(V, { J9, secret, cwSecret, fmtSecret, cmpSecret });
})(globalThis.VAV = globalThis.VAV || {});
