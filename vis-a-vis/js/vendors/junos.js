/* Vis-à-vis : Constructeur : Juniper Junos (lecture hiérarchique et display set) */
(function (V) {
  'use strict';
  const { addAddr, allAddr, getIf, mapNet, name, newDev, normArea, normSpeed, parse, phys, registerVendor, resolveVlans, secret, tok } = V;

  /* ---------- Junos ---------- */
  function junosToSet(text) {
    let s = text.replace(/\/\*[\s\S]*?\*\//g, '');
    s = s.split(/\r?\n/).filter(l => !/^\s*\{(master|backup|primary|secondary|linecard)[^}]*\}\s*$/i.test(l) && !/^\s*[\w.-]+@[\w.-]+[>#%]/.test(l)).join('\n');
    const toks = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if ('{};[]'.includes(c)) { toks.push({ t: c }); i++; continue; }
      if (c === '"') {
        let j = i + 1, v = '';
        while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2; continue; } v += s[j]; j++; }
        toks.push({ w: v, q: true }); i = j + 1; continue;
      }
      let j = i; while (j < s.length && !/[\s{};[\]"]/.test(s[j])) j++;
      toks.push({ w: s.slice(i, j) }); i = j;
    }
    const out = [], stack = []; let cur = [], list = null;
    const fmt = w => (w.q || /\s/.test(w.w) || w.w === '') ? '"' + w.w + '"' : w.w;
    const stripPrefixes = () => {
      let inact = false;
      while (cur.length && cur[0].w && /^(inactive|protect|replace|delete):$/.test(cur[0].w)) { if (cur[0].w === 'inactive:') inact = true; cur.shift(); }
      return inact;
    };
    for (const k of toks) {
      if (k.t === '[') { list = []; continue; }
      if (k.t === ']') { cur.push({ list: list || [] }); list = null; continue; }
      if (list && k.w !== undefined) { list.push(k); continue; }
      if (k.t === '{') { const inact = stripPrefixes(); stack.push({ words: cur.map(fmt).join(' '), inactive: inact }); cur = []; continue; }
      if (k.t === '}') { stack.pop(); cur = []; continue; }
      if (k.t === ';') {
        const inact = stripPrefixes();
        if (cur.length) {
          const anyInactive = inact || stack.some(x => x.inactive);
          const prefix = stack.map(x => x.words).filter(Boolean).join(' ');
          const li = cur.findIndex(x => x.list);
          const variants = li >= 0 ? cur[li].list.map(v => [...cur.slice(0, li), v, ...cur.slice(li + 1)]) : [cur];
          for (const v of variants) {
            const line = ('set ' + prefix + ' ' + v.map(fmt).join(' ')).replace(/\s+/g, ' ').trim();
            out.push(anyInactive ? '#inactive ' + line : line);
          }
        }
        cur = []; continue;
      }
      cur.push(k);
    }
    return out;
  }
  function junosLines(text) {
    const raw = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const setCount = raw.filter(l => /^(set|deactivate) /.test(l)).length;
    const isSet = setCount > 0 && setCount >= raw.filter(l => !l.startsWith('#')).length * 0.5;
    const lines = isSet ? raw.filter(l => /^(set|deactivate) /.test(l)) : junosToSet(text);
    const deact = lines.filter(l => l.startsWith('deactivate ')).map(l => 'set ' + l.slice(11));
    const res = [], inactive = [];
    for (const l of lines) {
      if (l.startsWith('deactivate ')) continue;
      if (l.startsWith('#inactive ')) { inactive.push(l.slice(10)); continue; }
      if (deact.some(d => l === d || l.startsWith(d + ' '))) { inactive.push(l); continue; }
      res.push(l);
    }
    return { lines: res, inactive, format: isSet ? 'set' : 'hiérarchique' };
  }
  const normJIf = n => (!n || n === 'all' || n.includes('.')) ? n : n + '.0';
  function normJFam(f, s) {
    const m = { 'inet-vpn': 'vpnv4', 'inet6-vpn': 'vpnv6', evpn: 'evpn', l2vpn: 'l2vpn', 'route-target': 'rtc', 'inet-mvpn': 'mvpn', 'inet6-mvpn': 'mvpn6' };
    if (m[f]) return m[f];
    if (f === 'inet') return s === 'labeled-unicast' ? 'ipv4-labeled' : s === 'flow' ? 'flowspec' : s === 'multicast' ? 'ipv4-multicast' : 'ipv4-unicast';
    if (f === 'inet6') return s === 'labeled-unicast' ? 'ipv6-labeled' : s === 'flow' ? 'flowspec-v6' : 'ipv6-unicast';
    return f + (s ? ' ' + s : '');
  }

  function parseJunos(text) {
    const dev = newDev('junos');
    const { lines, inactive, format } = junosLines(text);
    dev.format = format;
    if (inactive.length) dev.notes.push({ sev: 'info', msg: `${inactive.length} ligne(s) désactivée(s) (inactive / deactivate) ignorée(s).` });
    const groups = new Set(), bgpGroups = {}, bgpGlob = {};
    let applyGroups = false;
    for (const line of lines) {
      let t = tok(line); if (t[0] !== 'set') continue; t = t.slice(1);
      if (t[0] === 'groups') { groups.add(t[1]); continue; }
      if (t.includes('apply-groups')) applyGroups = true;
      if (t[0] === 'logical-systems') t = t.slice(2);
      let vrf = null;
      if (t[0] === 'routing-instances') {
        vrf = t[1]; dev.vrfs.add(vrf); t = t.slice(2);
        if (t[0] === 'interface') { getIf(dev, normJIf(t[1])).vrf = vrf; continue; }
      }
      jStatement(dev, t, vrf, bgpGroups, bgpGlob);
    }
    if (groups.size || applyGroups) dev.notes.push({ sev: 'info', msg: `Groupes de configuration (${[...groups].join(', ') || 'apply-groups'}) non dépliés : collez plutôt la sortie de « show configuration | display inheritance | display set ».` });
    // BGP : héritage global > groupe > voisin
    for (const g of Object.values(bgpGroups)) {
      const G = bgpGlob[g.vrf || ''] || {};
      for (const n of Object.values(g.neighbors)) {
        const pick = k => n[k] !== undefined ? n[k] : (g[k] !== undefined ? g[k] : G[k]);
        const type = pick('type') || null;
        let peerAs = pick('peerAs');
        if (!peerAs && type === 'internal') peerAs = dev.bgp.as;
        dev.bgp.neighbors.push({
          ip: n.ip, group: g.name, vrf: g.vrf, type, peerAs, localAs: pick('localAs'), localAddress: pick('localAddress'),
          auth: pick('auth') || null, multihop: !!pick('multihop'), ttl: pick('ttl'), families: pick('families') || null,
          hold: pick('hold'), bfd: pick('bfd') || null, desc: n.desc || '', shutdown: !!pick('shutdown'), passive: !!pick('passive')
        });
      }
    }
    // Agrégats
    for (const i of dev.ifs.values()) if (i.lag) { const p = getIf(dev, i.lag); p.kind = 'lag'; }
    for (const i of dev.ifs.values()) {
      if (/^ae\d+$/.test(i.name)) {
        i.kind = 'lag';
        i.lacpMode = i.lacp || 'static';
        if (!i.lacpPeriod) i.lacpPeriod = i.lacp ? 'fast' : null;
      }
      if (!i.kind) i.kind = /^lo\d/.test(i.name) ? 'loopback' : 'phys';
      if (i.kind === 'unit' && /^lo\d/.test(i.parent)) i.loopback = true;
    }
    // NET IS-IS
    for (const i of dev.ifs.values()) for (const a of i.isoAddr) dev.isis.nets.push(a);
    if (dev.lldp.enabled === null) dev.lldp.enabled = false;
    return dev;
  }

  function jStatement(dev, t, vrf, bgpGroups, bgpGlob) {
    const k = t[0];
    if (k === 'system' && t[1] === 'host-name') { dev.hostname = t[2]; return; }
    if (k === 'routing-options') {
      if (vrf) return;
      if (t[1] === 'router-id') dev.routerId = t[2];
      if (t[1] === 'autonomous-system') dev.bgp.as = t[2];
      return;
    }
    if (k === 'vlans' || k === 'bridge-domains') { if (t[2] === 'vlan-id') dev.vlans.set(t[1], +t[3]); return; }
    if (k === 'interfaces') return jInterface(dev, t);
    if (k !== 'protocols') return;
    const p = t[1], r = t.slice(2);
    if (p === 'ospf' || p === 'ospf3') {
      const O = p === 'ospf' ? dev.ospf : dev.ospf3;
      if (r[0] !== 'area') return;
      const area = normArea(r[1]);
      const ar = O.areas[area] = O.areas[area] || { type: 'normal' };
      const rr = r.slice(2);
      if (rr[0] === 'stub') ar.type = rr.includes('no-summaries') ? 'stub (totally)' : 'stub';
      else if (rr[0] === 'nssa') ar.type = 'nssa';
      else if (rr[0] === 'authentication-type') ar.auth = { type: rr[1] };
      else if (rr[0] === 'interface') {
        const ifn = normJIf(rr[1]);
        let oi = O.ifs.get(ifn);
        if (!oi) { oi = { area, vrf, network: null, hello: null, dead: null, auth: null, passive: false, cost: null, bfd: null, disabled: false }; O.ifs.set(ifn, oi); }
        const x = rr.slice(2);
        switch (x[0]) {
          case 'interface-type': oi.network = mapNet(x[1]); break;
          case 'hello-interval': oi.hello = +x[1]; break;
          case 'dead-interval': oi.dead = +x[1]; break;
          case 'passive': oi.passive = true; break;
          case 'metric': oi.cost = +x[1]; break;
          case 'disable': oi.disabled = true; break;
          case 'authentication':
            if (x[1] === 'md5') oi.auth = { type: 'md5', keyId: x[2], secret: secret(x[4]) };
            else if (x[1] === 'simple-password') oi.auth = { type: 'simple', secret: secret(x[2]) };
            else if (x[1] === 'keychain') oi.auth = { type: 'keychain', name: x[2] };
            break;
          case 'bfd-liveness-detection':
            oi.bfd = oi.bfd || {};
            if (x[1] === 'minimum-interval') oi.bfd.min = +x[2];
            if (x[1] === 'multiplier') oi.bfd.mult = +x[2];
            break;
        }
      }
      return;
    }
    if (p === 'isis') {
      dev.isis.enabled = true;
      if (r[0] === 'level' && r[2] === 'disable') dev.isis.globalLevels.delete(+r[1]);
      if (r[0] === 'interface') {
        const ifn = normJIf(r[1]);
        if (!dev.isis.ifs.has(ifn)) dev.isis.ifs.set(ifn, { levels: new Set([1, 2]), p2p: false, auth: null, passive: false, bfd: null, disabled: false });
        const ii = dev.isis.ifs.get(ifn); const x = r.slice(2);
        if (x[0] === 'point-to-point') ii.p2p = true;
        else if (x[0] === 'passive') ii.passive = true;
        else if (x[0] === 'disable') ii.disabled = true;
        else if (x[0] === 'level') {
          if (x[2] === 'disable') ii.levels.delete(+x[1]);
          else if (x[2] === 'passive') ii.passive = true;
          else if (x[2] === 'hello-authentication-key') { ii.auth = ii.auth || { type: 'md5' }; ii.auth.secret = secret(x[3]); }
          else if (x[2] === 'hello-authentication-type') { ii.auth = ii.auth || {}; ii.auth.type = x[3]; }
        } else if (x[0] === 'hello-authentication-key') { ii.auth = ii.auth || { type: 'md5' }; ii.auth.secret = secret(x[1]); }
        else if (x[0] === 'bfd-liveness-detection') {
          ii.bfd = ii.bfd || {}; if (x[1] === 'minimum-interval') ii.bfd.min = +x[2]; if (x[1] === 'multiplier') ii.bfd.mult = +x[2];
        }
      }
      return;
    }
    if (p === 'ldp' && r[0] === 'interface') { dev.ldp.add(normJIf(r[1])); return; }
    if (p === 'mpls' && r[0] === 'interface') { dev.mpls.add(normJIf(r[1])); return; }
    if (p === 'rsvp' && r[0] === 'interface') { dev.rsvp.add(normJIf(r[1])); return; }
    if (p === 'lldp') {
      if (r[0] === 'disable') dev.lldp.enabled = false;
      else {
        if (dev.lldp.enabled !== false) dev.lldp.enabled = true;
        if (r[0] === 'interface') { if (r[1] === 'all') dev.lldp.all = r[2] !== 'disable'; else if (r[2] !== 'disable') dev.lldp.ifs.add(r[1]); }
      }
      return;
    }
    if (p === 'bgp') {
      const gk = vrf || '';
      const G = bgpGlob[gk] = bgpGlob[gk] || {};
      if (r[0] === 'group') {
        const key = gk + '|' + r[1];
        const g = bgpGroups[key] = bgpGroups[key] || { name: r[1], vrf, neighbors: {} };
        const x = r.slice(2);
        if (x[0] === 'neighbor') { const n = g.neighbors[x[1]] = g.neighbors[x[1]] || { ip: x[1] }; jBgpAttr(n, x.slice(2)); }
        else jBgpAttr(g, x);
      } else jBgpAttr(G, r);
    }
  }
  function jBgpAttr(o, x) {
    switch (x[0]) {
      case 'type': o.type = x[1]; break;
      case 'peer-as': o.peerAs = x[1]; break;
      case 'local-as': o.localAs = x[1]; break;
      case 'local-address': o.localAddress = x[1]; break;
      case 'authentication-key': o.auth = secret(x[1]); break;
      case 'multihop': o.multihop = true; if (x[1] === 'ttl') o.ttl = +x[2]; break;
      case 'family': { if (!o.families) o.families = new Set(); o.families.add(normJFam(x[1], x[2])); break; }
      case 'hold-time': o.hold = +x[1]; break;
      case 'bfd-liveness-detection':
        o.bfd = o.bfd || {}; if (x[1] === 'minimum-interval') o.bfd.min = +x[2]; if (x[1] === 'multiplier') o.bfd.mult = +x[2]; break;
      case 'description': o.desc = x.slice(1).join(' '); break;
      case 'shutdown': o.shutdown = true; break;
      case 'passive': o.passive = true; break;
    }
  }
  function jInterface(dev, t) {
    const pn = t[1]; if (!pn || pn === 'interface-range' || pn === 'traceoptions') return;
    const p = getIf(dev, pn); let r = t.slice(2);
    if (r[0] === 'unit') {
      const u = getIf(dev, pn + '.' + r[1]); u.parent = pn; u.unit = r[1]; u.kind = 'unit';
      r = r.slice(2);
      switch (r[0]) {
        case 'description': u.desc = r.slice(1).join(' '); break;
        case 'vlan-id': u.vlanId = +r[1]; break;
        case 'disable': u.disabled = true; break;
        case 'family': {
          const f = r[1], rr = r.slice(2);
          if (f === 'inet') { u.inet = true; if (rr[0] === 'address') addAddr(u, rr[1]); else if (rr[0] === 'mtu') u.ipMtu = +rr[1]; }
          else if (f === 'inet6') { u.inet6 = true; if (rr[0] === 'address') addAddr(u, rr[1]); }
          else if (f === 'iso') { u.iso = true; if (rr[0] === 'address') u.isoAddr.push(rr[1]); }
          else if (f === 'mpls') u.mpls = true;
          else if (f === 'bridge' || f === 'ethernet-switching') {
            u.l2 = u.l2 || { mode: null, vlans: [], native: null };
            if (rr[0] === 'interface-mode' || rr[0] === 'port-mode') u.l2.mode = rr[1];
            else if (rr[0] === 'vlan-id-list' || rr[0] === 'vlan-id') u.l2.vlans.push(rr[1]);
            else if (rr[0] === 'vlan' && rr[1] === 'members') u.l2.vlans.push(rr[2]);
            else if (rr[0] === 'native-vlan-id') u.l2.native = rr[1];
          }
          break;
        }
      }
      return;
    }
    switch (r[0]) {
      case 'description': p.desc = r.slice(1).join(' '); break;
      case 'mtu': p.mtu = +r[1]; break;
      case 'disable': p.disabled = true; break;
      case 'vlan-tagging': case 'flexible-vlan-tagging': p.tagging = 'single'; break;
      case 'stacked-vlan-tagging': p.tagging = 'stacked'; break;
      case 'native-vlan-id': p.native = +r[1]; break;
      case 'speed': p.speed = normSpeed(r[1]); break;
      case 'link-mode': p.duplex = String(r[1]).replace('-duplex', ''); break;
      case 'gigether-options': case 'ether-options':
        if (r[1] === '802.3ad') p.lag = r[2] === 'bundle' ? r[3] : r[2];
        else if (r[1] === 'no-auto-negotiation') p.autoneg = false;
        else if (r[1] === 'speed') p.speed = normSpeed(r[2]);
        else if (r[1] === 'link-mode') p.duplex = String(r[2]).replace('-duplex', '');
        break;
      case 'aggregated-ether-options':
        if (r[1] === 'lacp') { if (r[2] === 'active' || r[2] === 'passive') p.lacp = r[2]; else if (r[2] === 'periodic') p.lacpPeriod = r[3]; }
        else if (r[1] === 'minimum-links') p.minLinks = +r[2];
        else if (r[1] === 'link-speed') p.speed = normSpeed(r[2]);
        break;
    }
  }

  /* ---------- Adaptateur Junos ---------- */
  function detectJunos(text) {
    const setL = (text.match(/^\s*set\s+(interfaces|system|protocols|routing-options|policy-options|chassis|firewall|vlans|routing-instances|snmp)\b/gm) || []).length;
    if (setL >= 1) return 0.9;
    if (/^\s*(interfaces|system|protocols|routing-options)\s*\{/m.test(text) || /^\s*version\s+[\w.-]+;/m.test(text)) return 0.9;
    return 0;
  }
  registerVendor({
    id: 'junos', label: 'Juniper Junos', short: 'Juniper', models: 'MX, EX, QFX, SRX, ACX',
    exportCommand: 'show configuration | display set',
    detect: detectJunos,
    parse: parseJunos,
    formatLabel: dev => 'Junos (' + dev.format + ')',
    ipMtu(dev, i) {
      if (i.ipMtu) return { v: i.ipMtu, how: 'family inet mtu' };
      const p = phys(dev, i);
      const tag = p && p.tagging ? (p.tagging === 'stacked' ? 8 : 4) : 0;
      if (p && p.mtu) return { v: p.mtu - 14 - tag, how: `mtu physique ${p.mtu} − ${14 + tag} octets d’en-tête` };
      return { v: 1500, how: 'valeur par défaut' };
    },
    isisOf(dev, i) {
      let c = dev.isis.ifs.get(i.name);
      if (!c && i.kind === 'unit' && !i.loopback) c = dev.isis.ifs.get('all');
      if (!c || c.disabled) return null;
      const levels = new Set([...c.levels].filter(l => dev.isis.globalLevels.has(l)));
      return { levels, p2p: c.p2p, passive: c.passive, auth: c.auth, bfd: c.bfd, isoMissing: !i.iso };
    },
    mplsOf(dev, i) {
      const any = s => s.has(i.name) || (s.has('all') && i.kind === 'unit' && !i.loopback);
      return { ldp: any(dev.ldp), mplsFamily: !!i.mpls, mplsProto: any(dev.mpls), rsvp: any(dev.rsvp) };
    },
    l2Profile(dev, p) {
      const units = [...dev.ifs.values()].filter(u => u.parent === p.name);
      let untagged = null; const tagged = new Set(); let mode = null;
      for (const u of units) {
        if (u.l2) {
          const vl = resolveVlans(dev, u.l2.vlans);
          if (u.l2.mode === 'trunk') {
            mode = 'trunk'; vl.forEach(v => tagged.add(v));
            const nat = u.l2.native ?? p.native;
            if (nat != null) { untagged = +nat; tagged.delete(+nat); }
          } else {
            mode = mode || 'access';
            if (p.tagging && u.vlanId) tagged.add(u.vlanId); else untagged = vl[0] ?? u.vlanId ?? null;
          }
        } else if (u.vlanId != null && p.tagging) { tagged.add(u.vlanId); mode = mode || 'sous-interfaces taguées'; }
        else if (allAddr(u).length || u.iso || u.mpls) { if (!p.tagging) { untagged = 'L3'; mode = mode || 'routé'; } }
      }
      if (p.tagging && p.native != null && untagged == null) untagged = p.native;
      return { mode: mode || 'non configuré', untagged, tagged };
    },
    encapOf(dev, i) {
      const p = phys(dev, i);
      if (i.vlanId != null && p && p.tagging) return { tag: i.vlanId, label: 'VLAN ' + i.vlanId + ' tagué' };
      if (p && p.tagging && i.kind === 'unit') return { tag: null, label: 'vlan-tagging sans vlan-id', broken: true };
      return { tag: null, label: 'non tagué' };
    },
    ifAliases: n => [n.toLowerCase(), n.replace(/\.0$/, '').toLowerCase()],
    ospfAdvertisesMtu: () => true,
    ospfMtuHint: '',
    frameLabel: p => (p.mtu || 1514) + ' (mtu physique)',
    mplsLabel: m => m.ldp ? 'LDP' + (m.mplsFamily ? '' : ', family mpls absente') + (m.mplsProto ? '' : ', hors protocols mpls') : (m.mplsFamily ? 'family mpls sans LDP' : 'non'),
    mplsProblems(m, nm) {
      const p = [];
      if (!m.mplsFamily) p.push(`${nm} : ajoutez « family mpls » sur l’unité`);
      if (!m.mplsProto) p.push(`${nm} : l’interface doit aussi figurer sous « protocols mpls »`);
      return p;
    },
    bgpRequiresGroupType: true,
    bgpRequiresAfEnable: false,
    bgpHoldDefault: 90,
    routerIds: dev => ({ global: dev.routerId, ospf: dev.routerId, bgp: dev.routerId, lsr: dev.routerId }),
    lldpDefault: false
  });

  Object.assign(V, { junosToSet, junosLines, normJIf, normJFam, parseJunos, jStatement, jBgpAttr, jInterface, detectJunos });
})(globalThis.VAV = globalThis.VAV || {});
