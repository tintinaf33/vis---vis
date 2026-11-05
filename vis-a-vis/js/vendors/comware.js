/* Vis-à-vis : Constructeur : HPE Comware 7 */
(function (V) {
  'use strict';
  const { addAddr, allAddr, cwSecret, expandVlans, getIf, mapNet, maskLen, name, newDev, normArea, normSpeed, parse, phys, registerVendor, secret, tok, v4int, v6big } = V;

  /* ---------- HPE Comware 7 ---------- */
  const CW_NAMES = [
    [/^(ten-gigabitethernet|xge)/i, 'Ten-GigabitEthernet'], [/^(m-gigabitethernet|mge)/i, 'M-GigabitEthernet'],
    [/^(twenty-fivegige|wge)/i, 'Twenty-FiveGigE'], [/^(fortygige|fge)/i, 'FortyGigE'], [/^(hundredgige|hge)/i, 'HundredGigE'],
    [/^(gigabitethernet|ge)/i, 'GigabitEthernet'], [/^(bridge-aggregation|bagg)/i, 'Bridge-Aggregation'],
    [/^(route-aggregation|ragg)/i, 'Route-Aggregation'], [/^(vlan-interface|vlan-int|vlanif)/i, 'Vlan-interface'],
    [/^(loopback|loop)/i, 'LoopBack'], [/^(tunnel|tun)/i, 'Tunnel']
  ];
  const CW_ABBR = { 'Ten-GigabitEthernet': 'XGE', 'M-GigabitEthernet': 'MGE', 'Twenty-FiveGigE': 'WGE', FortyGigE: 'FGE', HundredGigE: 'HGE', GigabitEthernet: 'GE', 'Bridge-Aggregation': 'BAGG', 'Route-Aggregation': 'RAGG', 'Vlan-interface': 'Vlan-int', LoopBack: 'Loop' };
  function normCwIf(n) {
    n = String(n || '').replace(/\s+/g, '');
    for (const [re, full] of CW_NAMES) { const m = re.exec(n); if (m && /^[\d/.:]/.test(n.slice(m[0].length))) return full + n.slice(m[0].length); }
    return n;
  }
  function cwKind(n) {
    if (/^LoopBack/.test(n)) return 'loopback';
    if (/^Vlan-interface/.test(n)) return 'vlanif';
    if (/^(Bridge|Route)-Aggregation\d+$/.test(n)) return 'lag';
    if (/\.\d+$/.test(n)) return 'sub';
    return 'phys';
  }
  function cwTree(text) {
    const root = { children: [], indent: -1 }; const stack = [root];
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const l = raw.replace(/\t/g, ' '); const tr = l.trim();
      if (tr === '#' || tr === 'return' || /^<[^>]+>/.test(tr) || /^\[[^\]]+\]/.test(tr) || /^display\s/.test(tr) || /^(!|\*\*)/.test(tr)) continue;
      const ind = l.length - l.trimStart().length; const node = { text: tr, children: [], indent: ind };
      while (stack.length > 1 && stack[stack.length - 1].indent >= ind) stack.pop();
      stack[stack.length - 1].children.push(node); stack.push(node);
    }
    return root.children;
  }
  function cwAuth(t, i) {
    const type = t[i]; if (!type) return null;
    if (type === 'simple') return { type: 'simple', secret: cwSecret(t[i + 1], t[i + 2]) };
    if (type === 'keychain') return { type: 'keychain', name: t[i + 1] };
    if (/^\d+$/.test(t[i + 1] || '')) return { type, keyId: t[i + 1], secret: cwSecret(t[i + 2], t[i + 3]) };
    return { type, secret: cwSecret(t[i + 1], t[i + 2]) };
  }
  function normCwFam(t) {
    const s = t.join(' ');
    if (/^ipv4( unicast)?$/.test(s)) return 'ipv4-unicast';
    if (/^ipv6( unicast)?$/.test(s)) return 'ipv6-unicast';
    if (/^vpnv4/.test(s)) return 'vpnv4';
    if (/^vpnv6/.test(s)) return 'vpnv6';
    if (/^l2vpn evpn/.test(s)) return 'evpn';
    if (/^l2vpn/.test(s)) return 'l2vpn';
    if (/^ipv4 flowspec/.test(s)) return 'flowspec';
    if (/^ipv4 multicast/.test(s)) return 'ipv4-multicast';
    return s;
  }
  const lvl = s => ({ 'level-1': [1], 'level-2': [2], 'level-1-2': [1, 2] }[s] || [1, 2]);

  function parseComware(text) {
    const dev = newDev('comware'); dev.format = 'Comware';
    const tree = cwTree(text);
    let lldpUndo = false;
    for (const n of tree) {
      const t = tok(n.text), k = t[0];
      if (k === 'sysname') dev.hostname = t.slice(1).join(' ');
      else if (k === 'interface') cwInterface(dev, normCwIf(t.slice(1).join('')), n.children);
      else if (k === 'vlan') { for (const v of expandVlans(t.slice(1))) dev.vlans.set(String(v), v); }
      else if (k === 'ospf') cwOspf(dev, t, n.children, 'ospf');
      else if (k === 'ospfv3') cwOspf(dev, t, n.children, 'ospf3');
      else if (k === 'isis') cwIsis(dev, t, n.children);
      else if (k === 'bgp') cwBgp(dev, t, n.children);
      else if (k === 'mpls' && t[1] === 'lsr-id') dev.lsrId = t[2];
      else if (k === 'mpls' && t[1] === 'ldp' && t.length === 2) dev.ldpGlobal = true;
      else if (k === 'lldp' && t[1] === 'global' && t[2] === 'enable') dev.lldp.enabled = true;
      else if (k === 'undo' && t[1] === 'lldp' && t[2] === 'global') lldpUndo = true;
      else if (k === 'router' && t[1] === 'id') dev.routerId = t[2];
      else if (k === 'ip' && t[1] === 'vpn-instance') dev.vrfs.add(t[2]);
    }
    dev.lldp.enabled = lldpUndo ? false : true;
    dev.lldp.all = !lldpUndo;
    // Agrégats
    for (const i of dev.ifs.values()) {
      if (i.lagGroup) {
        const cand = ['Route-Aggregation' + i.lagGroup, 'Bridge-Aggregation' + i.lagGroup].find(x => dev.ifs.has(x)) || ((i.linkMode === 'route' ? 'Route' : 'Bridge') + '-Aggregation' + i.lagGroup);
        i.lag = cand; const p = getIf(dev, cand); p.kind = 'lag';
      }
    }
    for (const i of dev.ifs.values()) {
      if (i.kind === 'lag') {
        const mem = [...dev.ifs.values()].filter(m => m.lag === i.name);
        i.lacpMode = i.lagMode === 'dynamic' ? (mem.some(m => m.lacpPassive) ? 'passive' : 'active') : 'static';
        i.lacpPeriod = i.lacpMode === 'static' ? null : (mem.some(m => m.lacpPeriod === 'fast') ? 'fast' : 'slow');
      }
    }
    // OSPF : affectation par interface ou par commande network
    for (const which of ['ospf', 'ospf3']) {
      const O = dev[which];
      for (const i of dev.ifs.values()) {
        const c = i[which + 'Cfg'] || {};
        let area = c.area, proc = c.proc ? O.procs.find(p => p.proc === c.proc) : null;
        if (!area && which === 'ospf') {
          outer: for (const P of O.procs) for (const nw of P.networks) for (const a of i.v4) {
            const inv = (~nw.wild) >>> 0;
            if (((a.n & inv) >>> 0) === ((nw.ip & inv) >>> 0)) { area = nw.area; proc = P; break outer; }
          }
        }
        if (!area) continue;
        const ar = O.areas[area] = O.areas[area] || { type: 'normal' };
        const passive = !!(proc && (proc.silent.includes('all') || proc.silent.includes(i.name))) || !!c.silent;
        O.ifs.set(i.name, { area, vrf: proc && proc.vpn, network: c.network || null, hello: c.hello ?? null, dead: c.dead ?? null,
          auth: c.auth || null, passive, cost: c.cost ?? null, bfd: c.bfd || null, mtuEnable: !!c.mtuEnable, disabled: false, how: c.area ? 'interface' : 'network' });
        if (proc && proc.rid) O.rid = O.rid || proc.rid;
        void ar;
      }
    }
    // IS-IS, MPLS
    for (const i of dev.ifs.values()) {
      if (i.mpls) dev.mpls.add(i.name);
      if (i.ldp) dev.ldp.add(i.name);
      if (i.rsvp) dev.rsvp.add(i.name);
      if (!i.kind) i.kind = cwKind(i.name);
    }
    return dev;
  }

  function cwInterface(dev, name, children) {
    const i = getIf(dev, name); i.kind = cwKind(name);
    if (i.kind === 'sub') i.parent = name.replace(/\.\d+$/, '');
    if (i.kind === 'loopback') i.loopback = true;
    const oc = i.ospfCfg = i.ospfCfg || {}; const o3 = i.ospf3Cfg = i.ospf3Cfg || {};
    const ic = i.isisCfg = i.isisCfg || {};
    for (const c of children) {
      const t = tok(c.text); const a = t[0], b = t[1];
      if (a === 'description') i.desc = t.slice(1).join(' ');
      else if (a === 'ip' && b === 'address') {
        if (!v4int(t[2])) continue;
        const len = maskLen(t[3]) ?? (/^\d+$/.test(t[3] || '') ? +t[3] : 32);
        i.v4.push({ fam: 4, ip: t[2], len, n: v4int(t[2]), sub: t[4] === 'sub' });
      }
      else if (a === 'ipv6' && b === 'address' && t[2]) { if (/link-local/.test(c.text)) continue; addAddr(i, t[2].includes('/') ? t[2] : t[2] + '/' + (t[3] || 128)); }
      else if (a === 'ip' && b === 'binding' && t[2] === 'vpn-instance') i.vrf = t[3];
      else if (a === 'mtu') i.mtu = +b;
      else if (a === 'ip' && b === 'mtu') i.ipMtu = +t[2];
      else if (a === 'jumboframe' && b === 'enable') i.jumbo = t[2] ? +t[2] : true;
      else if (a === 'shutdown') i.disabled = true;
      else if (a === 'port' && b === 'link-mode') i.linkMode = t[2];
      else if (a === 'port' && b === 'link-type') i.linkType = t[2];
      else if (a === 'port' && b === 'access' && t[2] === 'vlan') i.accessVlan = +t[3];
      else if (a === 'port' && b === 'trunk' && t[2] === 'permit' && t[3] === 'vlan') {
        i.trunkPermit = i.trunkPermit || new Set([1]);
        if (t[4] === 'all') i.trunkAll = true; else expandVlans(t.slice(4)).forEach(v => i.trunkPermit.add(v));
      }
      else if (a === 'undo' && b === 'port' && t[2] === 'trunk' && t[3] === 'permit' && t[4] === 'vlan') {
        i.trunkPermit = i.trunkPermit || new Set([1]); expandVlans(t.slice(5)).forEach(v => i.trunkPermit.delete(v));
      }
      else if (a === 'port' && (b === 'trunk' || b === 'hybrid') && t[2] === 'pvid') i.pvid = +t[4];
      else if (a === 'port' && b === 'hybrid' && t[2] === 'vlan') {
        const kind = t[t.length - 1]; i.hybrid = i.hybrid || { tagged: new Set(), untagged: new Set() };
        expandVlans(t.slice(3, -1)).forEach(v => i.hybrid[kind === 'tagged' ? 'tagged' : 'untagged'].add(v));
      }
      else if (a === 'port' && b === 'link-aggregation' && t[2] === 'group') i.lagGroup = t[3];
      else if (a === 'link-aggregation' && b === 'mode') i.lagMode = t[2];
      else if (a === 'link-aggregation' && b === 'selected-port' && t[2] === 'minimum') i.minLinks = +t[3];
      else if (a === 'lacp' && b === 'period' && t[2] === 'short') i.lacpPeriod = 'fast';
      else if (a === 'lacp' && b === 'mode' && t[2] === 'passive') i.lacpPassive = true;
      else if (a === 'speed') i.speed = normSpeed(b);
      else if (a === 'duplex') i.duplex = b;
      else if (a === 'vlan-type' && b === 'dot1q' && t[2] === 'vid') i.vlanId = +t[3];
      else if (a === 'ospf' || a === 'ospfv3') {
        const C = a === 'ospf' ? oc : o3;
        if (/^\d+$/.test(b) && t[2] === 'area') { C.proc = b; C.area = normArea(t[3]); }
        else if (b === 'network-type') C.network = mapNet(t[2]);
        else if (b === 'timer' && t[2] === 'hello') C.hello = +t[3];
        else if (b === 'timer' && t[2] === 'dead') C.dead = +t[3];
        else if (b === 'cost') C.cost = +t[2];
        else if (b === 'authentication-mode') C.auth = cwAuth(t, 2);
        else if (b === 'bfd' && t[2] === 'enable') C.bfd = C.bfd || {};
        else if (b === 'mtu-enable') C.mtuEnable = true;
        else if (b === 'silent' || (b === 'silent-interface')) C.silent = true;
      }
      else if (a === 'isis') {
        if (b === 'enable') ic.proc = t[2] || '1';
        else if (b === 'circuit-type' && t[2] === 'p2p') ic.p2p = true;
        else if (b === 'circuit-level') ic.circuitLevel = t[2];
        else if (b === 'silent') ic.silent = true;
        else if (b === 'authentication-mode') ic.auth = { type: t[2], secret: cwSecret(t[3], t[4]) };
        else if (b === 'bfd' && t[2] === 'enable') ic.bfd = {};
      }
      else if (a === 'mpls' && b === 'enable') i.mpls = true;
      else if (a === 'mpls' && b === 'ldp' && t[2] === 'enable') i.ldp = true;
      else if (a === 'rsvp' && b === 'enable') i.rsvp = true;
      else if (a === 'bfd' && b === 'min-transmit-interval') { i.bfdT = i.bfdT || {}; i.bfdT.min = +t[2]; }
      else if (a === 'bfd' && b === 'detect-multiplier') { i.bfdT = i.bfdT || {}; i.bfdT.mult = +t[2]; }
      else if (a === 'undo' && b === 'lldp' && t[2] === 'enable') i.lldpOff = true;
    }
    if (oc.bfd && i.bfdT) Object.assign(oc.bfd, i.bfdT);
    if (ic.bfd && i.bfdT) Object.assign(ic.bfd, i.bfdT);
  }

  function cwOspf(dev, t, children, which) {
    const O = dev[which]; const P = { proc: t[1] || '1', vpn: null, rid: null, networks: [], silent: [] };
    for (let j = 2; j < t.length; j++) { if (t[j] === 'router-id') P.rid = t[j + 1]; if (t[j] === 'vpn-instance') P.vpn = t[j + 1]; }
    O.procs.push(P);
    for (const c of children) {
      const ct = tok(c.text);
      if (ct[0] === 'area') {
        const area = normArea(ct[1]); const ar = O.areas[area] = O.areas[area] || { type: 'normal' };
        for (const g of c.children) {
          const gt = tok(g.text);
          if (gt[0] === 'network') P.networks.push({ area, ip: v4int(gt[1]) || 0, wild: v4int(gt[2]) || 0 });
          else if (gt[0] === 'stub') ar.type = gt.includes('no-summary') ? 'stub (totally)' : 'stub';
          else if (gt[0] === 'nssa') ar.type = 'nssa';
          else if (gt[0] === 'authentication-mode') ar.auth = cwAuth(gt, 1);
        }
      } else if (ct[0] === 'silent-interface') P.silent.push(ct[1] === 'all' ? 'all' : normCwIf(ct[1]));
      else if (ct[0] === 'router-id') P.rid = ct[1];
    }
    if (P.rid && !O.rid) O.rid = P.rid;
  }
  function cwIsis(dev, t, children) {
    const proc = t[1] || '1'; dev.isis.enabled = true;
    const P = dev.isis.procs[proc] = { level: 'level-1-2', nets: [] };
    for (const c of children) {
      const ct = tok(c.text);
      if (ct[0] === 'network-entity') { P.nets.push(ct[1]); dev.isis.nets.push(ct[1]); }
      else if (ct[0] === 'is-level') P.level = ct[1];
    }
  }
  function cwBgp(dev, t, children) {
    dev.bgp.as = t[1];
    const peers = {}; const glob = {};
    const P = (key, vrf) => { const k = (vrf || '') + '|' + key; return peers[k] = peers[k] || { key, vrf, families: new Set() }; };
    function walk(lines, vrf, af) {
      for (const c of lines) {
        const ct = tok(c.text);
        if (ct[0] === 'router-id') { if (!vrf) dev.bgp.rid = ct[1]; }
        else if (ct[0] === 'group') { const g = P(ct[1], vrf); g.isGroup = true; if (ct[2] === 'internal' || ct[2] === 'external') g.gtype = ct[2]; }
        else if (ct[0] === 'timer' && ct[1] === 'keepalive') { glob[vrf || ''] = { keepalive: +ct[2], hold: +ct[4] }; }
        else if (ct[0] === 'peer') {
          const p = P(ct[1], vrf); const x = ct.slice(2);
          if (af) { if (x[0] === 'enable') p.families.add(af); continue; }
          switch (x[0]) {
            case 'as-number': p.peerAs = x[1]; break;
            case 'group': p.group = x[1]; if (x[2] === 'as-number') p.peerAs = x[3]; break;
            case 'connect-interface': p.connectIf = normCwIf(x[1]); break;
            case 'ebgp-max-hop': p.multihop = true; p.ttl = x[1] ? +x[1] : 64; break;
            case 'password': p.auth = cwSecret(x[1], x[2]); break;
            case 'bfd': p.bfd = {}; break;
            case 'timer':
              if (x[1] === 'keepalive') { p.keepalive = +x[2]; p.hold = +x[4]; } else if (x[1] === 'hold') p.hold = +x[2];
              break;
            case 'ignore': p.shutdown = true; break;
            case 'description': p.desc = x.slice(1).join(' '); break;
            case 'fake-as': case 'local-as': p.localAs = x[1]; break;
            case 'enable': p.families.add('ipv4-unicast'); break;
          }
        }
        else if (ct[0] === 'address-family') walk(c.children, vrf, normCwFam(ct.slice(1)));
        else if (ct[0] === 'ip' && ct[1] === 'vpn-instance') walk(c.children, ct[2], null);
      }
    }
    walk(children, null, null);
    for (const p of Object.values(peers)) {
      if (p.isGroup || (!v4int(p.key) && v6big(p.key) === null)) continue;
      const g = p.group ? peers[(p.vrf || '') + '|' + p.group] : null;
      const pick = k => p[k] !== undefined ? p[k] : (g && g[k] !== undefined ? g[k] : undefined);
      const G = glob[p.vrf || ''] || {};
      let peerAs = pick('peerAs');
      if (!peerAs && g && g.gtype === 'internal') peerAs = dev.bgp.as;
      dev.bgp.neighbors.push({
        ip: p.key, group: p.group || null, vrf: p.vrf, type: g && g.gtype ? g.gtype : null, peerAs, localAs: pick('localAs'),
        connectIf: pick('connectIf'), localAddress: null, auth: pick('auth') || null, multihop: !!pick('multihop'), ttl: pick('ttl'),
        families: new Set([...p.families, ...(g ? g.families : [])]), hold: pick('hold') ?? G.hold, bfd: pick('bfd') || null,
        desc: p.desc || '', shutdown: !!pick('shutdown')
      });
    }
  }

  /* ---------- Adaptateur HPE Comware 7 ---------- */
  function detectComware(text) {
    if (/^\s*sysname\s+/m.test(text) || /^\s*interface\s+(Ten-GigabitEthernet|GigabitEthernet|Vlan-interface|Bridge-Aggregation|Route-Aggregation|M-GigabitEthernet|FortyGigE|LoopBack)/m.test(text)) return 0.8;
    if (/^#\s*$/m.test(text) && /^\s*interface\s+/m.test(text)) return 0.4;
    return 0;
  }
  registerVendor({
    id: 'comware', label: 'HPE Comware 7', short: 'HPE', models: '5520, 5940, 5710, 7500…',
    exportCommand: 'display current-configuration',
    detect: detectComware,
    parse: parseComware,
    formatLabel: () => 'HPE Comware 7',
    ipMtu(dev, i) {
      if (i.ipMtu) return { v: i.ipMtu, how: 'ip mtu' };
      if (i.mtu) return { v: i.mtu, how: 'mtu' };
      const p = i.parent && dev.ifs.get(i.parent);
      if (p && p.mtu) return { v: p.mtu, how: 'mtu de l’interface parente' };
      return { v: 1500, how: 'valeur par défaut' };
    },
    isisOf(dev, i) {
      const c = i.isisCfg; if (!c || !c.proc) return null;
      const P = dev.isis.procs[c.proc] || { level: 'level-1-2' };
      const cl = lvl(c.circuitLevel || 'level-1-2');
      const levels = new Set(lvl(P.level).filter(l => cl.includes(l)));
      return { levels, p2p: !!c.p2p, passive: !!c.silent, auth: c.auth || null, bfd: c.bfd || null };
    },
    mplsOf: (dev, i) => ({ ldp: !!i.ldp, mplsFamily: !!i.mpls, mplsProto: true, rsvp: !!i.rsvp, ldpGlobal: dev.ldpGlobal, lsrId: dev.lsrId }),
    l2Profile(dev, p) {
      if (p.lag && dev.ifs.get(p.lag)) p = dev.ifs.get(p.lag);
      if (p.linkMode === 'route' || /^Route-Aggregation/.test(p.name)) {
        const subs = [...dev.ifs.values()].filter(u => u.parent === p.name && u.vlanId);
        return { mode: 'routé', untagged: allAddr(p).length ? 'L3' : null, tagged: new Set(subs.map(s => s.vlanId)) };
      }
      const lt = p.linkType || 'access';
      if (lt === 'trunk') {
        const pvid = p.pvid || 1;
        if (p.trunkAll) return { mode: 'trunk', untagged: pvid, tagged: 'all' };
        const perm = p.trunkPermit || new Set([1]);
        return { mode: 'trunk', untagged: perm.has(pvid) ? pvid : null, tagged: new Set([...perm].filter(v => v !== pvid)) };
      }
      if (lt === 'hybrid') {
        const h = p.hybrid || { tagged: new Set(), untagged: new Set([1]) }; const pvid = p.pvid || 1;
        return { mode: 'hybrid', untagged: h.untagged.has(pvid) ? pvid : null, tagged: h.tagged };
      }
      return { mode: 'access', untagged: p.accessVlan || 1, tagged: new Set() };
    },
    encapOf(dev, i) {
      if (i.kind === 'sub') return { tag: i.vlanId, label: i.vlanId != null ? 'VLAN ' + i.vlanId + ' tagué (sous-interface)' : 'sous-interface sans vlan-type', broken: i.vlanId == null };
      if (i.kind === 'vlanif') { const v = +i.name.replace(/\D+/g, ''); return { vlanif: v, label: 'Vlan-interface ' + v }; }
      return { tag: null, label: 'non tagué' };
    },
    ifAliases(n) {
      const v = [n.toLowerCase()];
      for (const [full, ab] of Object.entries(CW_ABBR)) if (n.startsWith(full)) { v.push((ab + n.slice(full.length)).toLowerCase()); v.push((ab + ' ' + n.slice(full.length)).toLowerCase()); }
      return v;
    },
    ospfAdvertisesMtu: o => !!(o && o.mtuEnable),
    ospfMtuHint: 'sans « ospf mtu-enable »',
    frameLabel: p => p.jumbo ? 'jumbo ' + (p.jumbo === true ? 'activé' : p.jumbo) : String(p.mtu || 1500),
    mplsLabel: m => m.ldp ? 'LDP' + (m.mplsFamily ? '' : ', mpls enable absent') : (m.mplsFamily ? 'mpls enable sans LDP' : 'non'),
    mplsProblems(m, nm) {
      const p = [];
      if (!m.mplsFamily) p.push(`${nm} : ajoutez « mpls enable » sur l’interface`);
      if (!m.ldpGlobal) p.push(`${nm} : « mpls ldp » global manquant`);
      if (!m.lsrId) p.push(`${nm} : « mpls lsr-id » manquant`);
      return p;
    },
    bgpRequiresGroupType: false,
    bgpRequiresAfEnable: true,
    bgpHoldDefault: 180,
    routerIds: dev => ({ global: dev.routerId, ospf: dev.ospf.rid || dev.routerId, bgp: dev.bgp.rid || dev.routerId, lsr: dev.lsrId }),
    lldpDefault: true
  });

  Object.assign(V, { CW_NAMES, CW_ABBR, normCwIf, cwKind, cwTree, cwAuth, normCwFam, lvl, parseComware, cwInterface, cwOspf, cwIsis, cwBgp, detectComware });
})(globalThis.VAV = globalThis.VAV || {});
