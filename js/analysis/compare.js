/* Vis-à-vis : comparaison complète de deux configurations
 * (même équipement avant/après, ou deux équipements censés être configurés pareil).
 * Compare toutes les interfaces par nom, les paramètres de routage, chaque voisin BGP,
 * puis toutes les lignes de configuration, pour que rien ne passe entre les mailles. */
(function (V) {
  'use strict';
  const { cosOf, lldpOn, isMgmt, typeLabel, R, adapter, allAddr, cidr, cmpSecret, fmtSecret, fmtSpeed, fmtVlans, ipMtu, isisOf, l2Profile, members, mplsOf, name, natSort, ospfOf, parse, J9 } = V;

  const S = v => (v == null || v === '') ? null : String(v);

  /* ---------- Faits comparables ---------- */
  function ifFacts(dev, i) {
    const f = [];
    const add = (cat, label, v, x) => f.push(Object.assign({ cat, label, v: S(v) }, x || {}));
    add('Général', 'Description', i.desc || null);
    add('Général', 'État', i.disabled ? 'désactivée' : 'active');
    add('Général', 'VRF', i.vrf, { def: 'globale' });
    add('Adressage', 'IPv4', i.v4.map(cidr).sort().join(', ') || null);
    add('Adressage', 'IPv6', i.v6.map(cidr).sort().join(', ') || null);
    if (allAddr(i).length) add('Adressage', 'MTU IP', ipMtu(dev, i).v);
    add('Interface', 'MTU', i.mtu, { def: 'défaut' });
    add('Interface', 'VLAN', i.vlanId);
    add('Interface', 'Tagging VLAN', i.tagging, { def: 'aucun' });
    add('Interface', 'Vitesse', i.speed != null ? fmtSpeed(i.speed) : null, { def: 'auto' });
    add('Interface', 'Duplex', i.duplex, { def: 'auto' });
    add('Interface', 'Agrégat parent', i.lag, { def: 'aucun' });
    add('Interface', 'Filtre en entrée', i.filterIn, { def: 'aucun' });
    add('Interface', 'Filtre en sortie', i.filterOut, { def: 'aucun' });
    if ((i.kind === 'phys' || i.kind === 'lag') && !isMgmt(i)) { const l = lldpOn(dev, i); if (l !== null) add('Interface', 'LLDP', l ? 'activé' : 'non activé'); }
    const q = cosOf(dev, i);
    if (q) {
      const fm = m => Object.entries(m).map(([k, v]) => k + ' ' + v).join(', ') || null;
      add('QoS', 'Ordonnancement', q.scheduler, { def: 'aucun' });
      add('QoS', 'Shaping', q.shaping, { def: 'aucun' });
      add('QoS', 'Classification', fm(q.classifiers), { def: 'aucune' });
      add('QoS', 'Marquage', fm(q.rewrite), { def: 'aucun' });
    }
    if (i.kind === 'lag') {
      add('Agrégat', 'Mode LACP', i.lacpMode || 'static');
      add('Agrégat', 'Cadence LACP', i.lacpPeriod, { def: 'défaut' });
      add('Agrégat', 'Membres', members(dev, i).join(', ') || 'aucun');
      add('Agrégat', 'Liens minimum', i.minLinks, { def: '1' });
    }
    if ((i.kind === 'phys' || i.kind === 'lag') && !i.lag) {
      const p = l2Profile(dev, i);
      if (p && p.mode !== 'non configuré' && p.mode !== 'routé') {
        add('Niveau 2', 'Mode du port', p.mode);
        add('Niveau 2', 'VLAN non tagué', p.untagged, { def: 'aucun' });
        add('Niveau 2', 'VLAN tagués', p.tagged === 'all' ? 'toutes' : (p.tagged.size ? fmtVlans(p.tagged) : null), { def: 'aucun' });
      }
    }
    const o = ospfOf(dev, i);
    add('OSPF', 'OSPF', o ? 'actif' : null, { gate: true });
    if (o) {
      add('OSPF', 'Area', o.area);
      add('OSPF', 'Type de réseau', o.network);
      add('OSPF', 'Hello / dead', `${o.hello} s / ${o.dead} s`);
      add('OSPF', 'Passive', o.passive ? 'oui' : 'non');
      add('OSPF', 'Coût', o.cost ?? 'auto');
      add('OSPF', 'Authentification', o.auth ? o.auth.type + (o.auth.keyId ? ' clé ' + o.auth.keyId : '') : 'aucune', { secret: o.auth && o.auth.secret });
      add('OSPF', 'BFD', o.bfd ? (o.bfd.min ? `${o.bfd.min} ms × ${o.bfd.mult || 3}` : 'oui') : 'non');
    }
    const o3 = ospfOf(dev, i, 'ospf3');
    add('OSPFv3', 'OSPFv3', o3 ? 'actif, area ' + o3.area : null, { gate: true });
    const s = isisOf(dev, i);
    add('IS-IS', 'IS-IS', s ? 'actif' : null, { gate: true });
    if (s) {
      add('IS-IS', 'Niveaux', [...s.levels].sort().map(l => 'L' + l).join(' + ') || 'aucun');
      add('IS-IS', 'Type de circuit', s.p2p ? 'point à point' : 'broadcast');
      add('IS-IS', 'Passive', s.passive ? 'oui' : 'non');
      add('IS-IS', 'Authentification', s.auth && s.auth.secret ? (s.auth.type || 'md5') : 'aucune', { secret: s.auth && s.auth.secret });
    }
    const m = mplsOf(dev, i);
    if (m.ldp) add('MPLS', 'LDP', 'oui', { def: 'non' });
    if (m.mplsFamily) add('MPLS', 'MPLS', 'oui', { def: 'non' });
    if (m.rsvp) add('MPLS', 'RSVP', 'oui', { def: 'non' });
    if (m.rsvpBw) add('MPLS', 'Bande passante RSVP', m.rsvpBw, { def: 'débit du lien' });
    if (m.linkProtection) add('MPLS', 'Protection de lien', 'oui', { def: 'non' });
    return f;
  }

  function devFacts(dev) {
    const f = [];
    const add = (cat, label, v, x) => f.push(Object.assign({ cat, label, v: S(v) }, x || {}));
    const ids = adapter(dev).routerIds(dev);
    add('Système', 'Nom d’hôte', dev.hostname, { soft: true });
    add('Système', 'Router-ID', ids.global);
    add('Système', 'LLDP', dev.lldp.enabled ? 'activé' : 'désactivé');
    add('Système', 'VLAN déclarés', dev.vlans.size ? fmtVlans(new Set([...dev.vlans.values()].filter(Number.isFinite))) : null, { def: 'aucun' });
    add('Système', 'VRF', dev.vrfs.size ? [...dev.vrfs].sort(natSort).join(', ') : null, { def: 'aucune' });
    if (dev.ospf.ifs.size) add('OSPF', 'Router-ID OSPF', ids.ospf, { def: 'automatique' });
    for (const [a, ar] of Object.entries(dev.ospf.areas)) add('OSPF', 'Area ' + a, ar.type + (ar.auth && ar.auth.type ? ', authentification ' + ar.auth.type : ''), { def: 'absente' });
    add('OSPF', 'Interfaces OSPF', [...dev.ospf.ifs.keys()].sort(natSort).join(', ') || null, { def: 'aucune' });
    if (dev.isis.enabled || dev.isis.nets.length) {
      add('IS-IS', 'NET', dev.isis.nets.join(', ') || null, { def: 'absent' });
      add('IS-IS', 'Interfaces IS-IS', [...dev.ifs.values()].filter(i => isisOf(dev, i)).map(i => i.name).sort(natSort).join(', ') || null, { def: 'aucune' });
    }
    if (dev.ldp.size || ids.lsr) {
      add('MPLS', 'LSR-ID', ids.lsr, { def: 'non défini' });
      add('MPLS', 'Interfaces LDP', [...dev.ifs.values()].filter(i => mplsOf(dev, i).ldp).map(i => i.name).sort(natSort).join(', ') || null, { def: 'aucune' });
    }
    const list = (a, def) => a && a.length ? a.slice().sort(natSort).join(', ') : null;
    add('Système', 'Fuseau horaire', dev.sys.tz, { def: 'défaut' });
    add('Système', 'Serveurs NTP', list(dev.sys.ntp), { def: 'aucun' });
    add('Système', 'Serveurs syslog', list(dev.sys.syslog), { def: 'aucun' });
    add('Système', 'Serveurs RADIUS', list(dev.sys.radius), { def: 'aucun' });
    if (dev.sys.snmp.length) add('Système', 'Communautés SNMP', dev.sys.snmp.map(c => hash(c)).sort().join(','), { show: dev.sys.snmp.length + ' communauté(s), valeurs masquées' });
    add('Gabarits', 'Groupes appliqués', list(dev.groups.applied), { def: 'aucun' });
    add('Gabarits', 'Groupes définis non appliqués', list(dev.groups.unused), { def: 'aucun' });
    add('Politiques', 'Politiques de routage', list(dev.sys.policies), { def: 'aucune' });
    add('Politiques', 'Filtres / ACL', list(dev.sys.filters), { def: 'aucun' });
    add('MPLS', 'LSP et modèles', list(dev.sys.lsps), { def: 'aucun' });
    if (dev.ospf.ifs.size) { add('OSPF', 'Traffic-engineering', dev.sys.ospfTE ? 'activé' : 'non'); add('OSPF', 'Reference-bandwidth', dev.ospf.refBw, { def: 'défaut' }); }
    if (dev.bgp.as || dev.bgp.neighbors.length) {
      add('BGP', 'AS local', dev.bgp.as);
      add('BGP', 'Router-ID BGP', ids.bgp, { def: 'automatique' });
      add('BGP', 'Nombre de voisins', dev.bgp.neighbors.length);
    }
    return f;
  }

  const FAM = { 'ipv4-unicast': 'IPv4', 'ipv6-unicast': 'IPv6', vpnv4: 'VPNv4', vpnv6: 'VPNv6', evpn: 'EVPN', l2vpn: 'L2VPN', 'ipv4-labeled': 'IPv4 labeled', 'ipv6-labeled': '6PE', flowspec: 'Flowspec', rtc: 'RT-constraint' };
  function bgpFacts(dev, n) {
    const f = [];
    const add = (cat, label, v, x) => f.push(Object.assign({ cat, label, v: S(v) }, x || {}));
    add('BGP', 'Groupe', n.group, { def: 'aucun' });
    add('BGP', 'Type', n.type, { def: 'non précisé' });
    add('BGP', 'AS distant', n.peerAs, { def: 'non défini' });
    add('BGP', 'AS local forcé', n.localAs, { def: 'aucun' });
    add('BGP', 'Adresse source', n.localAddress || n.connectIf, { def: 'automatique' });
    add('BGP', 'Familles', n.families && n.families.size ? [...n.families].map(x => FAM[x] || x).sort().join(', ') : null, { def: 'défaut' });
    add('BGP', 'Mot de passe', n.auth ? 'oui' : 'aucun', { secret: n.auth });
    add('BGP', 'Multihop', n.multihop ? 'oui' + (n.ttl ? ', ttl ' + n.ttl : '') : null, { def: 'non' });
    add('BGP', 'Hold time', n.hold, { def: 'défaut' });
    add('BGP', 'BFD', n.bfd ? 'oui' : null, { def: 'non' });
    add('BGP', 'État', n.shutdown ? 'désactivée' : 'active');
    add('BGP', 'Ouverture TCP', n.passive ? 'passive' : null, { def: 'active' });
    add('BGP', 'Description', n.desc || null);
    return f;
  }

  /* ---------- Comparaison de deux listes de faits ---------- */
  function compareFacts(fa, fb, nA, nB) {
    const res = [], keys = [];
    for (const x of [...fa, ...fb]) { const k = x.cat + '|' + x.label; if (!keys.includes(k)) keys.push(k); }
    const get = (list, k) => list.find(x => x.cat + '|' + x.label === k);
    const skip = new Set();
    for (const k of keys) {
      const [cat, label] = k.split('|');
      if (skip.has(cat)) continue;
      const x = get(fa, k), y = get(fb, k);
      const def = (x && x.def) || (y && y.def) || null;
      const va = x && x.v != null ? x.v : def, vb = y && y.v != null ? y.v : def;
      const da = x && x.show != null ? x.show : va, db = y && y.show != null ? y.show : vb;
      if (va == null && vb == null) continue;
      const gate = (x && x.gate) || (y && y.gate);
      if (gate && (va == null || vb == null)) {
        skip.add(cat);
        res.push(R(cat, label, 'warn', va || 'non', vb || 'non', `${label} n’est actif que sur ${va ? nA : nB}.`));
        continue;
      }
      const sa = x && x.secret, sb = y && y.secret;
      if ((sa || sb) && va === vb) {
        const c = cmpSecret(sa, sb);
        res.push(R(cat, label, c.sev === 'err' ? 'warn' : c.sev, va + (sa ? ', ' + fmtSecret(sa) : ''), vb + (sb ? ', ' + fmtSecret(sb) : ''), c.sev === 'ok' ? '' : c.msg));
        continue;
      }
      if (va === vb) { res.push(R(cat, label, 'ok', da, db, '')); continue; }
      const soft = (x && x.soft) || (y && y.soft);
      res.push(R(cat, label, soft ? 'info' : 'warn', da ?? '—', db ?? '—',
        va == null || vb == null ? `Défini uniquement sur ${va != null ? nA : nB}.` : 'Valeurs différentes.'));
    }
    return res;
  }

  /* ---------- Lignes de configuration ---------- */
  function hash(s) { let h = 5381; for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0; return h.toString(36); }
  function maskLine(text) {
    let id = text, show = text;
    id = id.replace(/\$9\$[^\s"]+/g, m => { const d = J9.dec(m); return d != null ? '$9$#' + hash(d) : m; });
    show = show.replace(/\$9\$[^\s"]+/g, '$9$•••').replace(/\$[156]\$[^\s"]+/g, m => m.slice(0, 3) + '•••').replace(/\$c\$[^\s"]+/g, '$c$•••')
      .replace(/\b(simple|plain)(\s+)(\S+)/g, '$1$2•••');
    return { id, show };
  }
  function diffLines(A, tA, B, tB) {
    if (A.vendor !== B.vendor) return { available: false, reason: 'La comparaison ligne à ligne n’est possible qu’entre deux configurations du même constructeur.' };
    const ad = adapter(A);
    if (!ad.lines) return { available: false, reason: 'Ce constructeur ne fournit pas encore de lecture ligne à ligne.' };
    const la = ad.lines(tA).map(l => Object.assign({ section: l.section }, maskLine(l.text)));
    const lb = ad.lines(tB).map(l => Object.assign({ section: l.section }, maskLine(l.text)));
    const count = list => { const m = new Map(); for (const l of list) m.set(l.id, (m.get(l.id) || 0) + 1); return m; };
    const ca = count(la), cb = count(lb);
    const removed = [], added = [];
    const seenA = new Map(), seenB = new Map();
    for (const l of la) { const n = (seenA.get(l.id) || 0) + 1; seenA.set(l.id, n); if (n > (cb.get(l.id) || 0)) removed.push(l); }
    for (const l of lb) { const n = (seenB.get(l.id) || 0) + 1; seenB.set(l.id, n); if (n > (ca.get(l.id) || 0)) added.push(l); }
    const order = [], groups = new Map();
    const put = (l, kind) => { if (!groups.has(l.section)) { groups.set(l.section, { section: l.section, removed: [], added: [] }); order.push(l.section); } groups.get(l.section)[kind].push(l.show); };
    removed.forEach(l => put(l, 'removed')); added.forEach(l => put(l, 'added'));
    return { available: true, groups: order.map(s => groups.get(s)), nRemoved: removed.length, nAdded: added.length, nA: la.length, nB: lb.length };
  }

  /* ---------- Point d'entrée ---------- */
  function compareConfigs(textA, textB, vendorA, vendorB) {
    const A = parse(textA, vendorA), B = parse(textB, vendorB);
    if (!A || !B) return { error: !A && !B ? 'both' : (!A ? 'A' : 'B'), A, B };
    const nA = name(A), nB = name(B);
    const names = [...new Set([...A.ifs.keys(), ...B.ifs.keys()])].sort(natSort);
    const ifaces = [];
    for (const n of names) {
      const ia = A.ifs.get(n), ib = B.ifs.get(n);
      if (ia && ib) ifaces.push({ name: n, status: 'both', checks: compareFacts(ifFacts(A, ia), ifFacts(B, ib), nA, nB) });
      else {
        const i = ia || ib, D = ia ? A : B;
        const sum = [allAddr(i).map(cidr).join(', '), i.desc].filter(Boolean).join(', ') || 'configurée';
        ifaces.push({ name: n, status: ia ? 'A' : 'B', checks: [R('Présence', 'Interface', 'warn', ia ? 'présente : ' + sum : 'absente', ib ? 'présente : ' + sum : 'absente', `L’interface n’existe que dans la configuration de ${name(D)}.`)] });
      }
    }
    const bk = n => (n.vrf ? n.vrf + ' / ' : '') + n.ip;
    const peers = [...new Set([...A.bgp.neighbors.map(bk), ...B.bgp.neighbors.map(bk)])].sort(natSort);
    const bgp = peers.map(k => {
      const x = A.bgp.neighbors.find(n => bk(n) === k), y = B.bgp.neighbors.find(n => bk(n) === k);
      if (x && y) return { name: k, status: 'both', checks: compareFacts(bgpFacts(A, x), bgpFacts(B, y), nA, nB) };
      return { name: k, status: x ? 'A' : 'B', checks: [R('Présence', 'Voisin BGP', 'warn', x ? 'déclaré' + (x.peerAs ? ', AS ' + x.peerAs : '') : 'absent', y ? 'déclaré' + (y.peerAs ? ', AS ' + y.peerAs : '') : 'absent', `Ce voisin n’est déclaré que sur ${x ? nA : nB}.`)] };
    });
    const iFacts = I => {
      const f = []; const add = (label, v, x) => f.push(Object.assign({ cat: 'Service', label, v: S(v) }, x || {}));
      const rt = st => [...st].sort().join(', ') || null;
      add('Type', typeLabel(I.type)); add('Route-distinguisher', I.rd, { def: 'absent' });
      add('Route-targets importés', rt(I.rtImport), { def: 'aucun' }); add('Route-targets exportés', rt(I.rtExport), { def: 'aucun' });
      add('Politique d’import', I.importPol.join(', ') || null, { def: 'aucune' }); add('Politique d’export', I.exportPol.join(', ') || null, { def: 'aucune' });
      add('Interfaces', I.ifaces.slice().sort(natSort).join(', ') || null, { def: 'aucune' });
      add('Sites VPLS', I.sites.map(x => `${x.name} (id ${x.id || '?'})`).join(', ') || null, { def: 'aucun' });
      add('Normalisation VLAN', I.vlanId, { def: 'aucune' });
      return f;
    };
    const inames = [...new Set([...A.instances.keys(), ...B.instances.keys()])].sort(natSort);
    const instances = inames.map(k => {
      const x = A.instances.get(k), y = B.instances.get(k);
      if (x && y) return { name: k, status: 'both', checks: compareFacts(iFacts(x), iFacts(y), nA, nB) };
      const I = x || y;
      return { name: k, status: x ? 'A' : 'B', checks: [R('Présence', 'Instance', 'warn', x ? `présente : ${typeLabel(I.type)}` : 'absente', y ? `présente : ${typeLabel(I.type)}` : 'absente', `L’instance n’existe que sur ${x ? nA : nB}.`)] };
    });
    const system = compareFacts(devFacts(A), devFacts(B), nA, nB);
    for (const d of [A, B]) for (const x of d.issues) system.push(R('Syntaxe', 'Lecture de ' + name(d), x.sev, d === A ? x.msg : '—', d === B ? x.msg : '—', x.msg));
    for (const d of [A, B]) for (const nt of d.notes) system.push(R('Lecture', 'Configuration ' + name(d), nt.sev, d === A ? nt.msg : '', d === B ? nt.msg : '', nt.msg));
    return { mode: 'diff', A, B, ifaces, bgp, instances, system, lines: diffLines(A, textA, B, textB) };
  }

  /* Deux configurations qui partagent beaucoup de noms d'interfaces ressemblent plus à
   * « même équipement » ou « même gabarit » qu'à deux voisins. */
  function similarity(A, B) {
    if (A.vendor !== B.vendor) return { common: 0, ratio: 0 };
    const pick = d => [...d.ifs.values()].filter(i => i.kind !== 'loopback' && !/^(fxp|em|me|lo|M-GigabitEthernet)/.test(i.name)).map(i => i.name);
    const a = pick(A), b = new Set(pick(B));
    const common = a.filter(n => b.has(n)).length;
    return { common, ratio: common / Math.max(1, Math.min(a.length, b.size)) };
  }

  Object.assign(V, { compareConfigs, similarity, diffLines, maskLine });
})(globalThis.VAV = globalThis.VAV || {});
