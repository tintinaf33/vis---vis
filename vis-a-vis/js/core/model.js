/* Vis-à-vis : Modèle commun, registre des constructeurs, accès partagés */
(function (V) {
  'use strict';
  const { expandVlans } = V;

  /* ---------- Modèle commun ---------- */
  function newDev(vendor) {
    return {
      vendor, hostname: '', ifs: new Map(), vlans: new Map(), notes: [], vrfs: new Set(),
      routerId: null, lsrId: null, ldpGlobal: false,
      ospf: { rid: null, areas: {}, ifs: new Map(), procs: [] },
      ospf3: { rid: null, areas: {}, ifs: new Map(), procs: [] },
      isis: { enabled: false, nets: [], globalLevels: new Set([1, 2]), ifs: new Map(), procs: {} },
      ldp: new Set(), mpls: new Set(), rsvp: new Set(),
      bgp: { as: null, rid: null, neighbors: [] },
      lldp: { enabled: null, all: false, ifs: new Set() }
    };
  }
  function getIf(dev, name) {
    let i = dev.ifs.get(name);
    if (!i) {
      i = { name, desc: '', v4: [], v6: [], disabled: false, mtu: null, ipMtu: null, vlanId: null, tagging: null,
        native: null, lag: null, lacp: null, lacpPeriod: null, minLinks: null, speed: null, duplex: null,
        l2: null, iso: false, isoAddr: [], mpls: false, vrf: null, parent: null, unit: null, kind: null };
      dev.ifs.set(name, i);
    }
    return i;
  }

  /* ---------- Registre des constructeurs ----------
   * Chaque constructeur s'enregistre avec registerVendor() : voir docs/ajouter-un-constructeur.md */
  const vendors = [];
  function registerVendor(def) {
    const k = vendors.findIndex(v => v.id === def.id);
    if (k >= 0) vendors[k] = def; else vendors.push(def);
  }
  const adapter = dev => vendors.find(v => v.id === (typeof dev === 'string' ? dev : dev.vendor)) || null;
  function detectVendor(text) {
    if (!text || !text.trim()) return null;
    let best = null, score = 0;
    for (const v of vendors) { const s = v.detect(text) || 0; if (s > score) { score = s; best = v.id; } }
    return best;
  }
  function parse(text, vendor) {
    const id = vendor && vendor !== 'auto' ? vendor : detectVendor(text);
    const ad = id ? adapter(id) : null;
    if (!ad) return null;
    const dev = ad.parse(text);
    dev.detected = !vendor || vendor === 'auto';
    return dev;
  }

  /* ---------- Accès communs ---------- */
  const allAddr = i => [...i.v4, ...i.v6];
  const l3Ifs = dev => [...dev.ifs.values()].filter(i => allAddr(i).length);
  const phys = (dev, i) => (i.parent ? dev.ifs.get(i.parent) : i) || i;
  const name = d => d.hostname || (adapter(d) ? adapter(d).short : '?');
  const R = (cat, label, sev, a, b, msg) => ({ cat, label, sev, a: a == null ? '—' : String(a), b: b == null ? '—' : String(b), msg: msg || '' });
  function resolveVlans(dev, list) {
    const out = [];
    for (const x of list || []) {
      if (/^\d+(-\d+)?$/.test(String(x))) out.push(...expandVlans([x]));
      else if (dev.vlans.has(x)) out.push(dev.vlans.get(x));
    }
    return out;
  }

  Object.assign(V, { newDev, getIf, vendors, registerVendor, adapter, detectVendor, parse, allAddr, l3Ifs, phys, name, R, resolveVlans });
})(globalThis.VAV = globalThis.VAV || {});
