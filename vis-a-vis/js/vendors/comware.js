/* Vis-à-vis : Constructeur : HPE Comware 7 */
(function (V) {
  'use strict';
  const { issue, isInt, isAS, isIP, validMask, addAddr, allAddr, cwSecret, expandVlans, getIf, mapNet, maskLen, name, newDev, normArea, normSpeed, parse, phys, registerVendor, secret, tok, v4int, v6big } = V;

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
      else if (k === 'ip' && t[1] === 'vpn-instance') {
        dev.vrfs.add(t[2]); const I = cwInst(dev, t[2]); I.type = 'vrf';
        for (const c of n.children) {
          const ct = tok(c.text);
          if (ct[0] === 'route-distinguisher') I.rd = ct[1];
          if (ct[0] === 'vpn-target') { const dir = ct[ct.length - 1]; ct.slice(1).filter(x => /:/.test(x)).forEach(rt => { const v = 'target:' + rt; if (dir !== 'export-extcommunity') I.rtImport.add(v); if (dir !== 'import-extcommunity') I.rtExport.add(v); }); }
          if (ct[0] === 'address-family') for (const g of c.children) { const gt = tok(g.text); if (gt[0] === 'vpn-target') { const dir = gt[gt.length - 1]; gt.slice(1).filter(x => /:/.test(x)).forEach(rt => { const v = 'target:' + rt; if (dir !== 'export-extcommunity') I.rtImport.add(v); if (dir !== 'import-extcommunity') I.rtExport.add(v); }); } }
        }
      }
      else if (k === 'vsi') {
        const I = cwInst(dev, t[1]); I.type = 'vpls';
        const walk = nodes => { for (const c of nodes) { const ct = tok(c.text);
          if (ct[0] === 'route-distinguisher') I.rd = ct[1];
          if (ct[0] === 'vpn-target') { const dir = ct[ct.length - 1]; ct.slice(1).filter(x => /:/.test(x)).forEach(rt => { const v = 'target:' + rt; if (dir !== 'export-extcommunity') I.rtImport.add(v); if (dir !== 'import-extcommunity') I.rtExport.add(v); }); }
          if (ct[0] === 'site') I.sites.push({ name: 'site ' + ct[1], id: ct[1] });
          walk(c.children); } };
        walk(n.children);
      }
      else if (k === 'ntp-service' && t[1] === 'unicast-server') dev.sys.ntp.push(t[2]);
      else if (k === 'info-center' && t[1] === 'loghost') dev.sys.syslog.push(t[2] === 'vpn-instance' ? t[4] : t[2]);
      else if (k === 'snmp-agent' && t[1] === 'community') dev.sys.snmp.push(t[t.length - 1]);
      else if (k === 'clock' && t[1] === 'timezone') dev.sys.tz = t.slice(2).join(' ');
      else if (k === 'radius' && t[1] === 'scheme') { for (const c of n.children) { const ct = tok(c.text); if (ct[0] === 'primary' || ct[0] === 'secondary') dev.sys.radius.push(ct[2]); } }
      else if (k === 'acl') dev.sys.filters.push(t.slice(1).join(' '));
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
    for (const i of dev.ifs.values()) {
      if (i.vrf && dev.instances.has(i.vrf)) dev.instances.get(i.vrf).ifaces.push(i.name);
      if (i.vsi) { cwInst(dev, i.vsi).ifaces.push(i.name); i.vrf = i.vsi; }
    }
    // Objets nommés comparables d'un équipement à l'autre (secrets masqués) et contrôles sur tout le texte
    const hash = x => { let h = 5381; for (let k = 0; k < x.length; k++) h = ((h * 33) ^ x.charCodeAt(k)) >>> 0; return h.toString(36); };
    const SEC = new Set(['cipher', 'simple', 'hash', 'plain']);
    const put = (key, show, text) => {
      if (!dev.objects.has(key)) dev.objects.set(key, { show, lines: new Map() });
      const w = tok(text);
      dev.objects.get(key).lines.set(w.map((x, j) => SEC.has(w[j - 1]) ? '#' + hash(x) : x).join(' '), w.map((x, j) => SEC.has(w[j - 1]) ? '•••' : x).join(' '));
    };
    const flat = (nodes, pre) => nodes.flatMap(n => [pre + n.text, ...flat(n.children, pre + '  ')]);
    const IPV4ISH = /^\d{1,3}(\.\d{0,3}){2,}(\/\d*)?$/;
    for (const n of tree) {
      const t = tok(n.text), k = t[0];
      let key = null, show = null;
      if (k === 'acl') { key = n.text; show = n.text; }
      else if ((k === 'traffic' && (t[1] === 'classifier' || t[1] === 'behavior')) || (k === 'qos' && t[1] === 'policy')) { key = t.slice(0, 3).join(' '); show = key; }
      else if (k === 'radius' && t[1] === 'scheme') { key = n.text; show = n.text; }
      else if (k === 'route-policy') { key = `route-policy ${t[1]} node ${t[t.indexOf('node') + 1]}`; show = key; put(key, show, t.slice(2).join(' ')); }
      else if (k === 'local-user') { key = `local-user ${t[1]}`; show = key; }
      if (key) { for (const l of flat(n.children, '')) put(key, show, l.trim()); if (!n.children.length && k !== 'route-policy') put(key, show, ''); }
      if (k === 'ip' && t[1] === 'prefix-list') put(`ip prefix-list ${t[2]}`, `prefix-list ${t[2]}`, t.slice(3).join(' '));
      if (k === 'snmp-agent' && t[1] === 'community') { const nm = t[t.length - 1]; put('snmp community #' + hash(nm), 'communauté SNMP (nom masqué)', t.slice(2, -1).join(' ')); }
      else if (k === 'snmp-agent') put('snmp-agent', 'snmp-agent', t.slice(1).join(' '));
      if (k === 'ntp-service') put('ntp-service', 'ntp-service', t.slice(1).join(' '));
      if (k === 'info-center') put('info-center', 'info-center', t.slice(1).join(' '));
      if (k === 'clock') put('clock', 'clock', t.slice(1).join(' '));
      // Adresses mal formées n'importe où, interfaces source inexistantes
      const walk = (node, ctx) => {
        const w = tok(node.text);
        if (w[0] !== 'description' && !(w[0] === 'ip' && w[1] === 'address')) for (const x of w) {
          if (!IPV4ISH.test(x)) continue;
          const [ip, len] = x.split('/');
          if (v4int(ip) === null || (len !== undefined && !isInt(len, 0, 32))) issue(dev, 'err', `Adresse « ${x} » mal formée dans « ${(ctx ? ctx + ' > ' : '') + node.text} ».`);
        }
        const si = w.indexOf('source');
        if (si >= 0 && w[si + 1] && /^[A-Za-z]/.test(w[si + 1]) && ['ntp-service', 'info-center', 'snmp-agent', 'radius', 'hwtacacs', 'sflow'].some(p => node.text.startsWith(p) || (ctx || '').startsWith(p))) {
          const nm = normCwIf(w.slice(si + 1).join('').replace(/^(interface)/i, ''));
          if (/\d/.test(nm) && !dev.ifs.has(nm)) issue(dev, 'warn', `« ${node.text} » : interface source ${nm} inexistante.`);
        }
        for (const c of node.children) walk(c, (ctx ? ctx + ' > ' : '') + node.text);
      };
      walk(n, '');
    }
    // Adresses mal formées, doublons, références à des interfaces absentes
    const seen = new Map();
    for (const i of dev.ifs.values()) {
      for (const b of i.badAddr || []) issue(dev, 'err', `${i.name} : adresse « ${b} » mal formée, elle est ignorée (aucune adresse valide sur l’interface).`, i.name);
      for (const a of i.v4) { if (seen.has(a.ip) && seen.get(a.ip) !== i.name) issue(dev, 'err', `L’adresse ${a.ip} est configurée deux fois sur l’équipement (${seen.get(a.ip)} et ${i.name}).`, i.name); seen.set(a.ip, i.name); }
    }
    for (const P of [...dev.ospf.procs, ...dev.ospf3.procs]) for (const n of P.silent) if (n !== 'all' && !dev.ifs.has(n)) issue(dev, 'warn', `ospf ${P.proc} : silent-interface ${n} n’existe pas : faute de frappe ?`, n);
    for (const n of dev.bgp.neighbors) if (n.connectIf && !dev.ifs.has(n.connectIf)) issue(dev, 'err', `BGP ${n.ip} : connect-interface ${n.connectIf} n’existe pas.`, n.connectIf);
    // IS-IS, MPLS
    for (const i of dev.ifs.values()) {
      if (i.mpls) dev.mpls.add(i.name);
      if (i.ldp) dev.ldp.add(i.name);
      if (i.rsvp) dev.rsvp.add(i.name);
      if (!i.kind) i.kind = cwKind(i.name);
    }
    return dev;
  }

  function cwInst(dev, n) {
    if (!dev.instances.has(n)) dev.instances.set(n, { name: n, type: null, rd: null, rtImport: new Set(), rtExport: new Set(), importPol: [], exportPol: [], ifaces: [], sites: [], vlanId: null });
    return dev.instances.get(n);
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
        if (t[2] === 'dhcp-alloc' || t[2] === 'unnumbered') continue;
        const m = t[3];
        const lenOk = m === undefined || (/^\d{1,2}$/.test(m) ? +m <= 32 : validMask(m));
        if (v4int(t[2]) === null || !lenOk) { (i.badAddr = i.badAddr || []).push(t.slice(2, 4).join(' ')); continue; }
        const len = m === undefined ? 32 : (/^\d{1,2}$/.test(m) ? +m : maskLen(m));
        i.v4.push({ fam: 4, ip: t[2], len, n: v4int(t[2]), sub: t[4] === 'sub' });
      }
      else if (a === 'ipv6' && b === 'address' && t[2]) { if (/link-local/.test(c.text)) continue; addAddr(i, t[2].includes('/') ? t[2] : t[2] + '/' + (t[3] || 128)); }
      else if (a === 'ip' && b === 'binding' && t[2] === 'vpn-instance') i.vrf = t[3];
      else if (a === 'mtu') { i.mtu = +b; if (!isInt(b, 128, 10240)) issue(dev, 'err', `${name} : mtu « ${b} » invalide.`, name); }
      else if (a === 'ip' && b === 'mtu') i.ipMtu = +t[2];
      else if (a === 'jumboframe' && b === 'enable') i.jumbo = t[2] ? +t[2] : true;
      else if (a === 'shutdown') i.disabled = true;
      else if (a === 'port' && b === 'link-mode') i.linkMode = t[2];
      else if (a === 'port' && b === 'link-type') i.linkType = t[2];
      else if (a === 'port' && b === 'access' && t[2] === 'vlan') { i.accessVlan = +t[3]; if (!isInt(t[3], 1, 4094)) issue(dev, 'err', `${name} : VLAN d’accès « ${t[3]} » invalide (1 à 4094).`, name); }
      else if (a === 'port' && b === 'trunk' && t[2] === 'permit' && t[3] === 'vlan' && t.slice(4).some(x => x !== 'to' && x !== 'all' && !isInt(x, 1, 4094))) issue(dev, 'err', `${name} : liste de VLAN « ${t.slice(4).join(' ')} » invalide.`, name);
      if (a === 'port' && b === 'trunk' && t[2] === 'permit' && t[3] === 'vlan') {
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
        if (/^\d+$/.test(b) && t[2] === 'area') { C.proc = b; C.area = normArea(t[3]); if (!/^(\d+|(\d{1,3}\.){3}\d{1,3})$/.test(t[3] || '')) issue(dev, 'err', `${name} : area OSPF « ${t[3]} » invalide.`, name); }
        else if (b === 'network-type') C.network = mapNet(t[2]);
        else if (b === 'timer' && t[2] === 'hello') { C.hello = +t[3]; if (!isInt(t[3], 1, 65535)) issue(dev, 'err', `${name} : timer hello « ${t[3]} » invalide.`, name); }
        else if (b === 'timer' && t[2] === 'dead') { C.dead = +t[3]; if (!isInt(t[3], 1, 2147483647)) issue(dev, 'err', `${name} : timer dead « ${t[3]} » invalide.`, name); }
        else if (b === 'cost') { C.cost = +t[2]; if (!isInt(t[2], 1, 65535)) issue(dev, 'err', `${name} : coût OSPF « ${t[2]} » invalide.`, name); }
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
      else if (a === 'qos' && b === 'trust') { i.qos = i.qos || { classifiers: {}, rewrite: {} }; i.qos.classifiers[t[2] || 'dot1p'] = 'trust'; }
      else if (a === 'qos' && b === 'apply' && t[2] === 'policy') { i.qos = i.qos || { classifiers: {}, rewrite: {} }; i.qos[t[4] === 'outbound' ? 'policyOut' : 'policyIn'] = t[3]; }
      else if (a === 'qos' && b === 'lr') { i.qos = i.qos || { classifiers: {}, rewrite: {} }; const k = t.indexOf('cir'); i.qos.shaping = k > 0 ? t[k + 1] + ' kb/s' : 'oui'; }
      else if (a === 'qos' && b === 'gts') { i.qos = i.qos || { classifiers: {}, rewrite: {} }; const k = t.indexOf('cir'); i.qos.shaping = k > 0 ? t[k + 1] + ' kb/s' : 'oui'; }
      else if (a === 'packet-filter') { const name = t[1] === 'ipv6' ? t[2] : t[1]; const dir = t[t.length - 1]; i[dir === 'outbound' ? 'filterOut' : 'filterIn'] = name; }
      else if (a === 'xconnect' && b === 'vsi') { i.vsi = t[2]; }
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
    if (!isAS(t[1])) issue(dev, 'err', `bgp : numéro d’AS « ${t[1]} » invalide.`);
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
          if (!p.isGroup && !isIP(ct[1]) && !Object.values(peers).some(q => q.isGroup && q.key === ct[1])) issue(dev, 'err', `BGP : voisin « ${ct[1]} » invalide (ni adresse IP ni groupe déclaré).`);
          switch (x[0]) {
            case 'as-number': p.peerAs = x[1]; if (!isAS(x[1])) issue(dev, 'err', `BGP : as-number « ${x[1]} » invalide pour ${ct[1]}.`); break;
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
    // Lignes normalisées : chaque commande précédée de son contexte (« interface X > ip address … »)
    lines(text) {
      const out = [];
      const walk = (nodes, prefix, sec) => { for (const n of nodes) { const t = prefix ? prefix + ' > ' + n.text : n.text; out.push({ section: sec || n.text, text: t }); walk(n.children, t, sec || n.text); } };
      walk(cwTree(text), '', null);
      return out;
    },
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
    mplsOf: (dev, i) => ({ ldp: !!i.ldp, mplsFamily: !!i.mpls, mplsProto: true, rsvp: !!i.rsvp, ldpGlobal: dev.ldpGlobal, lsrId: dev.lsrId, rsvpBw: null, linkProtection: false }),
    cosOf(dev, i) {
      const q = i.qos || (i.parent && dev.ifs.get(i.parent) && dev.ifs.get(i.parent).qos);
      if (!q) return null;
      return { scheduler: [q.policyIn && 'in ' + q.policyIn, q.policyOut && 'out ' + q.policyOut].filter(Boolean).join(', ') || null, shaping: q.shaping || null, classifiers: q.classifiers || {}, rewrite: q.rewrite || {} };
    },
    lldpOn: (dev, p) => !!(dev.lldp.enabled && p && !p.lldpOff),
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
