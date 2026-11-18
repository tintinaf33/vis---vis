/* Vis-à-vis : Modèle commun, registre des constructeurs, accès partagés */
(function (V) {
  'use strict';
  const { expandVlans } = V;

  /* ---------- Modèle commun ---------- */
  function newDev(vendor) {
    return {
      vendor, hostname: '', ifs: new Map(), vlans: new Map(), notes: [], vrfs: new Set(),
      // Anomalies de syntaxe ou de valeur relevées à la lecture : { sev, msg, ifname? }
      issues: [],
      routerId: null, lsrId: null, ldpGlobal: false,
      ospf: { rid: null, areas: {}, ifs: new Map(), procs: [] },
      ospf3: { rid: null, areas: {}, ifs: new Map(), procs: [] },
      isis: { enabled: false, nets: [], globalLevels: new Set([1, 2]), ifs: new Map(), procs: {} },
      ldp: new Set(), mpls: new Set(), rsvp: new Set(),
      bgp: { as: null, rid: null, neighbors: [] },
      lldp: { enabled: null, all: false, ifs: new Set() },
      // Services (VRF, VPLS…) : nom → { name, type, rd, rtImport, rtExport, ifaces, sites, vlanId }
      instances: new Map(),
      // Qualité de service par interface (nom exact ou motif à joker) → { scheduler, shaping, classifiers, rewrite }
      cos: new Map(),
      rsvpBw: new Map(), rsvpLP: new Set(),
      // Paramètres système comparés en mode « deux configurations »
      sys: { ntp: [], syslog: [], radius: [], snmp: [], tz: null, policies: [], filters: [], lsps: [], ospfTE: false },
      groups: { defined: [], applied: [], unused: [], inherited: 0 },
      // Objets nommés (prefix-lists, filtres, politiques, QoS, serveurs…) : clé → { show, lines: Set }
      objects: new Map()
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

  /* ---------- Anomalies de lecture ---------- */
  function issue(dev, sev, msg, ifname) { if (!dev.issues.some(x => x.msg === msg)) dev.issues.push({ sev, msg, ifname: ifname || null }); }
  // Vérificateurs de valeurs courants
  const isInt = (v, min, max) => /^\d+$/.test(String(v)) && +v >= min && +v <= max;
  const isAS = v => /^\d+$/.test(String(v)) ? (+v >= 1 && +v <= 4294967295) : /^\d+\.\d+$/.test(String(v));
  const isRT = v => /^target:((\d{1,3}\.){3}\d{1,3}|\d+L?):\d+$/.test(String(v));
  const isRD = v => /^((\d{1,3}\.){3}\d{1,3}|\d+L?):\d+$/.test(String(v));
  const isRate = v => /^\d+(\.\d+)?[kmgt]?$/i.test(String(v)) || /^\d+(\.\d+)?\s*(percent|%)$/i.test(String(v));

  /* ---------- Accès communs ---------- */
  // Interfaces de management (hors bande) : jamais considérées comme un lien entre voisins
  const isMgmt = i => /^(fxp\d|em\d|me\d|vme|re\d:mgmt|mgmt|M-GigabitEthernet|MGE|Management)/i.test(String(i && i.name || ''));
  // Une description cite-t-elle l'équipement « host » ? Accepte le nom complet ou ses mots distinctifs
  // (SITE_NORD-PK12_02 désigne bien SITE_NORD-PK12_DESSERTE_ROUT_02).
  const GENERIC = new Set(['rout', 'router', 'routeur', 'rtr', 'desserte', 'core', 'edge', 'switch', 'swi', 'access', 'acces', 'dist', 'agg', 'fo', 'liaison', 'vers', 'lien']);
  const words = h => String(h || '').toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 3 && !/^\d+$/.test(x));
  function mentions(desc, host, selfHost) {
    if (!desc || !host) return false;
    const d = desc.toLowerCase();
    if (host.length > 2 && d.includes(host.toLowerCase())) return true;
    const mine = new Set(words(selfHost));
    const keys = words(host).filter(x => !mine.has(x) && !GENERIC.has(x));
    if (!keys.length) return false;
    const hit = keys.filter(k => d.split(/[^a-z0-9]+/).includes(k) || d.includes(k));
    return hit.some(k => /[a-z]{4,}/.test(k)) && hit.length >= Math.ceil(keys.length / 2);
  }
  // Jokers Junos (« ge-1/1/* ») dans un nom d'interface
  const globMatch = (pat, s) => new RegExp('^' + String(pat).replace(/^<(.*)>$/, '$1').replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(s);
  const allAddr = i => [...i.v4, ...i.v6];
  const l3Ifs = dev => [...dev.ifs.values()].filter(i => allAddr(i).length);
  // Interface configurée pour le routage, même si son adresse est absente ou mal formée
  const l3Cfg = i => !!(allAddr(i).length || (i.badAddr && i.badAddr.length) || i.inet || i.inet6);
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

  Object.assign(V, { l3Cfg, issue, isInt, isAS, isRT, isRD, isRate, isMgmt, mentions, globMatch, newDev, getIf, vendors, registerVendor, adapter, detectVendor, parse, allAddr, l3Ifs, phys, name, R, resolveVlans });
})(globalThis.VAV = globalThis.VAV || {});
