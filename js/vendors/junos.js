/* Vis-à-vis : Constructeur : Juniper Junos (lecture hiérarchique et display set) */
(function (V) {
  'use strict';
  const { J9, v4int, issue, isInt, isAS, isRT, isRD, isRate, isIP, isIPv4, globMatch, addAddr, allAddr, getIf, mapNet, name, newDev, normArea, normSpeed, parse, phys, registerVendor, resolveVlans, secret, tok } = V;

  /* ---------- Junos ---------- */
  // Convertit le format hiérarchique en lignes « set ». Les défauts de structure (accolade ou point-virgule
  // manquant, guillemet non fermé…) ne sont pas ignorés : ils sont listés dans le tableau rendu (propriété issues).
  function junosToSet(text) {
    let s = String(text || '').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    s = s.split(/\r?\n/).map(l => (/^\s*\{(master|backup|primary|secondary|linecard)[^}]*\}\s*$/i.test(l) || /^\s*[\w.+-]+@[\w.+-]+[>#%]/.test(l)) ? '' : l).join('\n');
    const toks = [], issues = []; let i = 0, ln = 1;
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') { ln++; i++; continue; }
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if ('{};[]'.includes(c)) { toks.push({ t: c, ln }); i++; continue; }
      if (c === '"') {
        let j = i + 1, v = ''; const start = ln;
        while (j < s.length && s[j] !== '"') { if (s[j] === '\n') { ln++; } if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2; continue; } v += s[j]; j++; }
        if (j >= s.length) issues.push({ sev: 'err', msg: `Guillemet ouvert ligne ${start} jamais refermé : la suite de la configuration est mal lue.` });
        toks.push({ w: v, q: true, ln: start }); i = j + 1; continue;
      }
      let j = i; while (j < s.length && !/[\s{};[\]"]/.test(s[j])) j++;
      toks.push({ w: s.slice(i, j), ln }); i = j;
    }
    const out = [], stack = []; let cur = [], list = null;
    const fmt = w => (w.q || /\s/.test(w.w) || w.w === '') ? '"' + w.w + '"' : w.w;
    const text1 = arr => arr.map(x => x.list ? '[ … ]' : fmt(x)).join(' ');
    const stripPrefixes = () => {
      let inact = false;
      while (cur.length && cur[0].w && /^(inactive|protect|replace|delete):$/.test(cur[0].w)) { if (cur[0].w === 'inactive:') inact = true; cur.shift(); }
      return inact;
    };
    const emit = () => {
      const inact = stripPrefixes();
      if (!cur.length) return;
      const anyInactive = inact || stack.some(x => x.inactive);
      const prefix = stack.map(x => x.words).filter(Boolean).join(' ');
      const li = cur.findIndex(x => x.list);
      const variants = li >= 0 ? cur[li].list.map(v => [...cur.slice(0, li), v, ...cur.slice(li + 1)]) : [cur];
      for (const v of variants) {
        const line = ('set ' + prefix + ' ' + v.map(fmt).join(' ')).replace(/\s+/g, ' ').trim();
        out.push(anyInactive ? '#inactive ' + line : line);
      }
    };
    const multiLine = () => cur.length > 1 && cur[0].ln !== cur[cur.length - 1].ln && !cur.some(x => x.list);
    for (const k of toks) {
      if (k.t === '[') { if (list) issues.push({ sev: 'err', msg: `Ligne ${k.ln} : crochet « [ » ouvert alors qu’une liste n’est pas refermée.` }); list = []; continue; }
      if (k.t === ']') { if (!list) { issues.push({ sev: 'err', msg: `Ligne ${k.ln} : crochet « ] » sans crochet ouvrant.` }); continue; } cur.push({ list, ln: k.ln }); list = null; continue; }
      if (list && k.w !== undefined) { list.push(k); continue; }
      if (list) { issues.push({ sev: 'err', msg: `Ligne ${k.ln} : liste « [ … » non refermée avant « ${k.t} ».` }); cur.push({ list, ln: k.ln }); list = null; }
      if (k.t === '{') {
        if (!cur.length) issues.push({ sev: 'err', msg: `Ligne ${k.ln} : accolade ouvrante sans nom de bloc.` });
        else if (multiLine()) issues.push({ sev: 'err', msg: `Ligne ${cur[cur.length - 1].ln} : « ${text1(cur)} » s’étend sur plusieurs lignes, un point-virgule ou une accolade manque probablement ligne ${cur[0].ln}.` });
        const inact = stripPrefixes(); stack.push({ words: cur.map(fmt).join(' '), inactive: inact, ln: k.ln }); cur = []; continue;
      }
      if (k.t === '}') {
        if (cur.length) { issues.push({ sev: 'err', msg: `Ligne ${cur[cur.length - 1].ln} : point-virgule manquant après « ${text1(cur)} ».` }); emit(); cur = []; }
        if (!stack.length) { issues.push({ sev: 'err', msg: `Ligne ${k.ln} : accolade fermante « } » en trop.` }); continue; }
        stack.pop(); continue;
      }
      if (k.t === ';') {
        if (multiLine()) issues.push({ sev: 'err', msg: `Ligne ${cur[cur.length - 1].ln} : « ${text1(cur)} » s’étend sur plusieurs lignes, un point-virgule manque probablement ligne ${cur[0].ln}.` });
        emit(); cur = []; continue;
      }
      cur.push(k);
    }
    if (list) issues.push({ sev: 'err', msg: 'Liste « [ … » jamais refermée en fin de configuration.' });
    if (cur.length) { issues.push({ sev: 'err', msg: `Fin de configuration : « ${text1(cur)} » n’est terminé ni par un point-virgule ni par une accolade.` }); emit(); }
    if (stack.length) issues.push({ sev: 'err', msg: `${stack.length} accolade(s) jamais refermée(s) (bloc « ${stack[stack.length - 1].words || '?'} » ouvert ligne ${stack[stack.length - 1].ln}) : la fin de la configuration est rattachée au mauvais bloc.` });
    out.issues = issues;
    return out;
  }

  /* Captures de terminal : BOM, bannière « --- JUNOS … », invite « user@hôte> », {master} */
  function cleanCapture(text) {
    return String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
      .filter(l => !/^\s*-{3}\s*JUNOS\b/i.test(l) && !/^\s*\{(master|backup|primary|secondary|linecard)[^}]*\}\s*$/i.test(l) && !/^\s*[\w.+-]+@[\w.+-]+[>#%]/.test(l))
      .join('\n');
  }

  /* ---------- Groupes de configuration : groups / apply-groups / apply-groups-except ----------
   * Reproduit l'héritage Junos : les lignes d'un groupe appliqué à un niveau sont ajoutées sous ce niveau ;
   * un joker <…> ne correspond qu'à des éléments réellement configurés ; une valeur explicite l'emporte
   * sur une valeur héritée ; le groupe le plus spécifique puis le premier listé l'emporte. */
  const isJGlob = t => /^<.+>$/.test(t);
  const VALUE_KW = new Set(['mtu', 'speed', 'link-mode', 'interface-type', 'hello-interval', 'dead-interval', 'metric', 'key', 'minimum-interval',
    'multiplier', 'bandwidth', 'description', 'encapsulation', 'shaping-rate', 'scheduler-map', 'type', 'peer-as', 'local-address', 'local-as',
    'hold-time', 'ttl', 'site-identifier', 'interval', 'loss-threshold', 'priority', 'router-id', 'autonomous-system', 'instance-type',
    'route-distinguisher', 'vrf-target', 'vrf-import', 'vrf-export', 'native-vlan-id', 'vlan-id', 'authentication-key', 'minimum-links',
    'periodic', 'optimize-timer', 'idle-timeout', 'uid', 'class', 'timeout', 'host-name', 'time-zone', 'reference-bandwidth', 'preference']);
  // Choix mutuellement exclusifs : une valeur explicite empêche d'hériter d'une autre option du même choix
  const CHOICES = { authentication: ['md5', 'simple-password', 'keychain', 'authentication-key-chain'], 'interface-mode': ['access', 'trunk'], 'link-mode': ['full-duplex', 'half-duplex', 'automatic'] };
  const SEP = '\u0001';
  const quoteTok = w => (/\s/.test(w) || w === '') ? '"' + w + '"' : w;
  function applyGroups(lines) {
    const groups = new Map(), applies = [], excepts = [], base = [];
    for (const l of lines) {
      const t = tok(l);
      if (t[0] !== 'set') { base.push(l); continue; }
      if (t[1] === 'groups') { if (!groups.has(t[2])) groups.set(t[2], []); if (t.length > 3) groups.get(t[2]).push(t.slice(3)); continue; }
      const k = t.indexOf('apply-groups'), ke = t.indexOf('apply-groups-except');
      if (k > 0 && k === t.length - 2) { applies.push({ prefix: t.slice(1, k), name: t[k + 1], i: applies.length }); continue; }
      if (ke > 0 && ke === t.length - 2) { excepts.push({ prefix: t.slice(1, ke), name: t[ke + 1] }); continue; }
      base.push(l);
    }
    const baseT = base.filter(l => l.startsWith('set ')).map(l => tok(l).slice(1));
    const have = new Set(baseT.map(t => t.join(SEP)));
    const single = new Set(baseT.filter(t => t.length > 1 && VALUE_KW.has(t[t.length - 2])).map(t => t.slice(0, -1).join(SEP)));
    const expand = (t, from) => {
      const w = t.findIndex((x, j) => j >= from && isJGlob(x));
      if (w < 0) return [t];
      const vals = new Set();
      for (const c of baseT) {
        if (c.length <= w) continue;
        let ok = true; for (let j = 0; j < w; j++) if (c[j] !== t[j]) { ok = false; break; }
        if (ok && globMatch(t[w], c[w])) vals.add(c[w]);
      }
      const out = [];
      for (const v of vals) { const n = t.slice(); n[w] = v; out.push(...expand(n, w + 1)); }
      return out;
    };
    const applied = new Set(), unknown = [], out = [];
    const sorted = applies.slice().sort((x, y) => y.prefix.length - x.prefix.length || x.i - y.i);
    for (const a of sorted) {
      const g = groups.get(a.name);
      if (!g) { unknown.push(a.name); continue; }
      applied.add(a.name);
      for (const gl of g) {
        if (gl.length <= a.prefix.length) continue;
        let match = true;
        for (let j = 0; j < a.prefix.length; j++) if (gl[j] !== a.prefix[j] && !(isJGlob(gl[j]) && globMatch(gl[j], a.prefix[j]))) { match = false; break; }
        if (!match) continue;
        for (const L of expand(a.prefix.concat(gl.slice(a.prefix.length)), a.prefix.length)) {
          if (excepts.some(e => e.name === a.name && e.prefix.every((x, j) => L[j] === x))) continue;
          const key = L.join(SEP), pre = L.slice(0, -1).join(SEP);
          if (have.has(key)) continue;
          if (L.length > 1 && VALUE_KW.has(L[L.length - 2]) && single.has(pre)) continue;
          let clash = false;
          for (let j = 1; j < L.length && !clash; j++) {
            const opts = CHOICES[L[j - 1]];
            if (!opts || !opts.includes(L[j])) continue;
            clash = baseT.some(b => b.length > j && opts.includes(b[j]) && b[j] !== L[j] && b.slice(0, j).every((x, q) => x === L[q]));
          }
          if (clash) continue;
          have.add(key); if (L.length > 1 && VALUE_KW.has(L[L.length - 2])) single.add(pre);
          out.push('set ' + L.map(quoteTok).join(' '));
        }
      }
    }
    return { lines: base.concat(out), defined: [...groups.keys()], applied: [...applied], unknown, inherited: out.length };
  }

  function junosLines(text, opts) {
    text = cleanCapture(text);
    const raw = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const setCount = raw.filter(l => /^(set|deactivate) /.test(l)).length;
    const isSet = setCount > 0 && setCount >= raw.filter(l => !l.startsWith('#')).length * 0.5;
    const conv = isSet ? null : junosToSet(text);
    const lines = isSet ? raw.filter(l => /^(set|deactivate) /.test(l)) : conv;
    const structIssues = conv ? conv.issues : [];
    if (isSet) raw.forEach((l, n) => { if (!/^(set|deactivate|delete|#)/.test(l) && !/^\s*$/.test(l)) structIssues.push({ sev: 'err', msg: `Ligne ${n + 1} ignorée, elle ne commence ni par « set » ni par « deactivate » : « ${l.slice(0, 80)} ».` }); });
    const deact = lines.filter(l => l.startsWith('deactivate ')).map(l => 'set ' + l.slice(11));
    const res = [], inactive = [];
    for (const l of lines) {
      if (l.startsWith('deactivate ')) continue;
      if (l.startsWith('#inactive ')) { inactive.push(l.slice(10)); continue; }
      if (deact.some(d => l === d || l.startsWith(d + ' '))) { inactive.push(l); continue; }
      res.push(l);
    }
    if (opts && opts.raw) return { lines: res, inactive, format: isSet ? 'set' : 'hiérarchique', issues: structIssues };
    const g = applyGroups(res);
    return { lines: g.lines, inactive, format: isSet ? 'set' : 'hiérarchique', groups: g, issues: structIssues };
  }
  const normJIf = n => (!n || n === 'all' || n.includes('.')) ? n : n + '.0';
  function normJFam(f, s) {
    const m = { 'inet-vpn': 'vpnv4', 'inet6-vpn': 'vpnv6', evpn: 'evpn', l2vpn: 'l2vpn', 'route-target': 'rtc', 'inet-mvpn': 'mvpn', 'inet6-mvpn': 'mvpn6', 'traffic-engineering': 'bgp-te', 'inet-vpn-flow': 'flowspec-vpn' };
    if (m[f]) return m[f];
    if (f === 'inet') return s === 'labeled-unicast' ? 'ipv4-labeled' : s === 'flow' ? 'flowspec' : s === 'multicast' ? 'ipv4-multicast' : 'ipv4-unicast';
    if (f === 'inet6') return s === 'labeled-unicast' ? 'ipv6-labeled' : s === 'flow' ? 'flowspec-v6' : 'ipv6-unicast';
    return f + (s ? ' ' + s : '');
  }

  function parseJunos(text) {
    const dev = newDev('junos');
    const { lines, inactive, format, groups: G, issues: structIssues } = junosLines(text);
    dev.format = format;
    for (const x of structIssues || []) issue(dev, x.sev, x.msg);
    dev.groups = { defined: G.defined, applied: G.applied, unused: G.defined.filter(n => !G.applied.includes(n)), inherited: G.inherited };
    if (G.applied.length) dev.notes.push({ sev: 'info', msg: `Groupes de configuration dépliés (${G.applied.join(', ')}) : ${G.inherited} ligne(s) héritée(s) prises en compte.` });
    if (G.unknown.length) dev.notes.push({ sev: 'warn', msg: `apply-groups vers un groupe inexistant : ${G.unknown.join(', ')}.` });
    if (inactive.length) dev.notes.push({ sev: 'info', msg: `${inactive.length} ligne(s) désactivée(s) (inactive / deactivate) ignorée(s).` });
    const bgpGroups = {}, bgpGlob = {}, pol = { comm: new Map(), stmt: new Map() };
    for (const line of lines) {
      let t = tok(line); if (t[0] !== 'set') continue; t = t.slice(1);
      if (t[0] === 'logical-systems') t = t.slice(2);
      let vrf = null;
      if (t[0] === 'routing-instances') {
        vrf = t[1]; if (!vrf || vrf === 'apply-groups') continue;
        dev.vrfs.add(vrf); t = t.slice(2);
        const I = getInst(dev, vrf);
        if (t[0] === 'interface') { getIf(dev, normJIf(t[1])).vrf = vrf; I.ifaces.push(normJIf(t[1])); continue; }
        if (t[0] === 'instance-type') { I.type = t[1]; continue; }
        if (t[0] === 'route-distinguisher') { I.rd = t[1]; continue; }
        if (t[0] === 'vrf-target') { if (t[1] === 'import') I.rtImport.add(t[2]); else if (t[1] === 'export') I.rtExport.add(t[2]); else { I.rtImport.add(t[1]); I.rtExport.add(t[1]); } continue; }
        if (t[0] === 'vrf-import') { I.importPol.push(t[1]); continue; }
        if (t[0] === 'vrf-export') { I.exportPol.push(t[1]); continue; }
        if (t[0] === 'vlan-id') { I.vlanId = t[1]; continue; }
        if (t[0] === 'protocols' && t[1] === 'vpls' && t[2] === 'site') { let st = I.sites.find(x => x.name === t[3]); if (!st) { st = { name: t[3], id: null }; I.sites.push(st); } if (t[4] === 'site-identifier') st.id = t[5]; continue; }
      }
      if (t[0] === 'policy-options') { jPolicy(pol, t); continue; }
      jStatement(dev, t, vrf, bgpGroups, bgpGlob);
    }
    // Route-targets des services : vrf-target, ou communautés citées par les politiques vrf-import / vrf-export
    for (const I of dev.instances.values()) {
      const members = n => pol.comm.get(n) || [];
      for (const p of I.importPol) for (const c of (pol.stmt.get(p) || { from: new Set() }).from) members(c).forEach(m => I.rtImport.add(m));
      for (const p of I.exportPol) for (const c of (pol.stmt.get(p) || { add: new Set() }).add) members(c).forEach(m => I.rtExport.add(m));
    }
    dev.sys.policies = [...pol.stmt.keys()].sort();
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
    validateJunos(dev, lines);
    dev.objects = junosObjects(lines);
    if (dev.lldp.enabled === null) dev.lldp.enabled = false;
    return dev;
  }

  /* ---------- Validation : valeurs hors limites, mots-clés inconnus, références à des interfaces absentes ----------
   * Junos refuserait ces configurations au commit ; ici on les signale au lieu de les ignorer. */
  const KW = {
    phys: 'description unit mtu disable enable vlan-tagging flexible-vlan-tagging stacked-vlan-tagging encapsulation speed link-mode gigether-options ether-options aggregated-ether-options native-vlan-id hold-time apply-groups apply-groups-except mac damping optics-options traps no-traps per-unit-scheduler hierarchical-scheduler esi auto-negotiation no-auto-negotiation flow-control no-flow-control loopback no-loopback gratuitous-arp-reply no-gratuitous-arp-reply no-gratuitous-arp-request link-degrade-monitor otn-options framing clocking mixed-rate-mode number-of-sub-ports interface-mode vlan-offload passive-monitor-mode accounting-profile shared-scheduler satop-options aggregated-sonet-options sonet-options fastether-options redundant-ether-options anchor-point',
    unit: 'description vlan-id vlan-tags family disable enable encapsulation vlan-id-list vlan-id-range native-inner-vlan-id input-vlan-map output-vlan-map apply-groups apply-groups-except bandwidth proxy-arp traps no-traps mac peer-unit tunnel point-to-point multipoint accounting-profile alias demux-source demux-options layer2-policer esi interface-shared-with copy-tos-to-outer-ip-header dialer-options vci shaping arp-resp',
    inet: 'address filter mtu sampling policer rpf-check no-redirects dhcp dhcp-client primary preferred unnumbered-address targeted-broadcast accounting simple-filter service destination-class-usage source-class-usage receive-options-packets receive-ttl-exceeded demux-source demux-destination arp-max-cache arp-new-hold-limit apply-groups apply-groups-except negotiate-address no-neighbor-learn kernel-forwarding-table-filter ipsec-sa nd6-max-cache dad-disable dhcpv6-client ipv6-duplicate-addr-detection-transmits mld no-dad-disable',
    ospfIf: 'interface-type hello-interval dead-interval metric passive authentication bfd-liveness-detection priority retransmit-interval transit-delay ldp-synchronization link-protection node-link-protection te-metric disable no-advertise-adjacency-segment neighbor poll-interval flood-reduction demand-circuit no-neighbor-down-notification strict-bfd ipsec-sa apply-groups apply-groups-except topology post-convergence-lfa mtu secondary no-interface-state-traps dynamic-neighbors lsa-filter no-eligible-backup no-eligible-remote-backup interface-group',
    bgp: 'type local-address peer-as local-as neighbor family authentication-key authentication-algorithm authentication-key-chain multihop hold-time export import cluster description bfd-liveness-detection passive advertise-inactive advertise-peer-as as-override damping keep log-updown multipath out-delay preference remove-private tcp-mss traceoptions vpn-apply-export local-preference metric-out graceful-restart apply-groups apply-groups-except allow no-advertise-peer-as mtu-discovery accept-remote-nexthop local-interface ipsec-sa outbound-route-filter egress-te unconfigured-peer-graceful-restart precision-timers advertise-external no-client-reflect shutdown idle-after-switch-over optimal-route-reflection forwarding-context bmp disable minimum-hold-time drop-path-attributes',
    bgpFam: 'inet inet6 inet-vpn inet6-vpn l2vpn evpn route-target traffic-engineering inet-mvpn inet6-mvpn inet-mdt iso iso-vpn inet-labeled-unicast inet6-labeled-unicast inet-vpn-flow inet6-vpn-flow bgp-ls atomic-aggregate fabric',
    instType: 'vrf vpls virtual-router virtual-switch l2vpn evpn mac-vrf forwarding no-forwarding layer2-control mpls-internet-multicast evpn-vpws l2backhaul-vpn mpls-forwarding'
  };
  for (const k of Object.keys(KW)) KW[k] = new Set(KW[k].split(' '));
  const isArea = a => /^\d+$/.test(a) ? +a <= 4294967295 : /^(\d{1,3}\.){3}\d{1,3}$/.test(a) && a.split('.').every(x => +x <= 255);
  const ifNameOk = n => /^([a-z]{2,4}-\d+\/\d+\/\d+(:\d+)?|ae\d+|lo\d+|irb|vlan|fxp\d+|em\d+|me\d+|vme|reth\d+|st\d+|gr-[\d\/]+|lt-[\d\/]+|ip-[\d\/]+|ps\d+|cbp\d+|pp\d+|vtep|dsc|esi|rlsq\d+|lsq-[\d\/]+|si-[\d\/]+|ms-[\d\/]+|mo-[\d\/]+|interface-range|traceoptions|<.*>|.*\*.*)$/.test(n);
  // Mot qui ressemble à une adresse IPv4 (au moins trois groupes de chiffres séparés par des points, éventuellement vides)
  const IPV4ISH = /^\d{1,3}(\.\d{0,3}){2,}(\/\d*)?$/;
  const ownsIP = (dev, ip) => [...dev.ifs.values()].some(i => [...i.v4, ...i.v6].some(a => a.ip === ip));
  const FC_DEFAULT = new Set(['best-effort', 'expedited-forwarding', 'assured-forwarding', 'network-control', 'be', 'ef', 'af', 'nc']);
  const DSCP_ALIAS = /^(ef|be|cs[0-7]|af[1-4][1-3]|nc[12])$/;

  /* Contrôles valables dans toute la configuration : adresses mal formées où qu'elles soient, adresses source
   * qui n'appartiennent pas à l'équipement, objets cités mais jamais définis, valeurs de QoS et de ports. */
  function validateGeneric(dev, lines, bad) {
    const defs = { filter: new Set(), policy: new Set(), community: new Set(), prefixList: new Set(), smap: new Set(), sched: new Set(), drop: new Set(), fc: new Set(), lsp: new Set() };
    const cls = new Set(), rw = new Set(), refs = [], smapSched = new Map(), schedPct = new Map();
    const T = lines.filter(l => l.startsWith('set ')).map(l => tok(l).slice(1));
    for (const t of T) {
      const u = t[0] === 'routing-instances' ? t.slice(2) : t;
      if (u[0] === 'firewall') { const k = u.indexOf('filter'); if (k >= 0 && u[k + 1]) defs.filter.add(u[k + 1]); }
      if (u[0] === 'policy-options') {
        if (u[1] === 'policy-statement') defs.policy.add(u[2]);
        if (u[1] === 'community') defs.community.add(u[2]);
        if (u[1] === 'prefix-list') defs.prefixList.add(u[2]);
      }
      if (u[0] === 'class-of-service') {
        if (u[1] === 'scheduler-maps') defs.smap.add(u[2]);
        if (u[1] === 'schedulers') defs.sched.add(u[2]);
        if (u[1] === 'drop-profiles') defs.drop.add(u[2]);
        if (u[1] === 'classifiers') cls.add(u[2] + ' ' + u[3]);
        if (u[1] === 'rewrite-rules') rw.add(u[2] + ' ' + u[3]);
        if (u[1] === 'forwarding-classes' && u[2] === 'queue') { defs.fc.add(u[4]); if (!isInt(u[3], 0, 15)) bad('err', `class-of-service : numéro de file « ${u[3]} » invalide.`); }
        if (u[1] === 'forwarding-classes' && u[2] === 'class') defs.fc.add(u[3]);
      }
      if (u[0] === 'protocols' && u[1] === 'mpls' && u[2] === 'label-switched-path') defs.lsp.add(u[3]);
    }
    for (const t of T) {
      const ctxOf = j => t.slice(0, j).join(' ');
      // a. Adresses IPv4 mal formées, partout (les adresses d'interface sont déjà signalées à part)
      const ifAddr = t[0] === 'interfaces' && t.includes('address') && t.includes('family');
      for (let j = 0; j < t.length; j++) {
        const w = t[j];
        if (!IPV4ISH.test(w) || ifAddr) continue;
        const [ip, len] = w.split('/');
        if (v4int(ip) !== null && (len === undefined || isInt(len, 0, 32))) continue;
        bad('err', `Adresse « ${w} » mal formée dans « ${ctxOf(j) || w} ».`);
      }
      // b. Adresse source qui doit appartenir à l'équipement
      const k = t.indexOf('source-address');
      if (k > 0 && t[k + 1] && t[0] !== 'firewall' && t[0] !== 'policy-options' && !t.includes('from')) {
        const v = t[k + 1];
        if (isIP(v)) { if (!ownsIP(dev, v)) bad('err', `« ${ctxOf(k)} » : source-address ${v} n’est configurée sur aucune interface de l’équipement, les paquets ne pourront pas partir avec cette adresse.`); }
        else if (!IPV4ISH.test(v) && !dev.ifs.has(v) && !dev.ifs.has(v + '.0')) bad('warn', `« ${ctxOf(k)} » : source-address « ${v} » n’est ni une adresse ni une interface connue.`);
      }
      // c. Références à des objets
      const u = t[0] === 'routing-instances' ? t.slice(2) : t, pre = t[0] === 'routing-instances' ? `instance ${t[1]} : ` : '';
      const ref = (kind, n, where) => { if (n && !/^[(!&|]/.test(n) && !n.includes('&&') && !n.includes('||')) refs.push([kind, n, pre + where]); };
      if (u[0] === 'interfaces') { const f = u.indexOf('filter'); if (f > 0 && /^(input|output|input-list|output-list)$/.test(u[f + 1] || '')) ref('filter', u[f + 2], `filtre de ${u[1]}${u[2] === 'unit' ? '.' + u[3] : ''}`); }
      if (u[0] === 'vrf-import' || u[0] === 'vrf-export') ref('policy', u[1], u[0]);
      for (const kw of ['import', 'export']) {
        const j = u.indexOf(kw);
        if (j > 0 && ['protocols', 'routing-options'].includes(u[0]) && u[j + 1] && !['target', 'policy', 'rib', 'rib-group'].includes(u[j + 1]) && !(u[j + 1] || '').startsWith('target:')) ref('policy', u[j + 1], ctxOf(j + (t.length - u.length)));
        if (j > 0 && u[j + 1] === 'policy') ref('policy', u[j + 2], ctxOf(j + (t.length - u.length)));
      }
      if (u[0] === 'policy-options' && u[1] === 'policy-statement') {
        const c = u.indexOf('community'); if (c > 0) for (const n of u.slice(c + 1)) if (!/^(add|set|delete)$/.test(n)) ref('community', n, `politique ${u[2]}`);
        for (const kw of ['prefix-list', 'prefix-list-filter']) { const j = u.indexOf(kw); if (j > 2) ref('prefixList', u[j + 1], `politique ${u[2]}`); }
      }
      if (u[0] === 'firewall') {
        for (const kw of ['source-prefix-list', 'destination-prefix-list', 'prefix-list']) { const j = u.indexOf(kw); if (j > 0) ref('prefixList', u[j + 1], `filtre ${u[u.indexOf('filter') + 1]}`); }
        const fcI = u.indexOf('forwarding-class'); if (fcI > 0) ref('fc', u[fcI + 1], `filtre ${u[u.indexOf('filter') + 1]}`);
        for (const kw of ['port', 'destination-port', 'source-port']) { const j = u.indexOf(kw); if (j > 0 && u[j + 1] && /^[\d-]+$/.test(u[j + 1])) for (const p of u[j + 1].split('-')) if (!isInt(p, 0, 65535)) bad('err', `Filtre ${u[u.indexOf('filter') + 1]} : port « ${u[j + 1]} » invalide (0 à 65535).`); }
      }
      if (u[0] === 'class-of-service') {
        if (u[1] === 'interfaces') {
          const sm = u.indexOf('scheduler-map'); if (sm > 0) ref('smap', u[sm + 1], `QoS de ${u[2]}`);
          for (const kw of ['classifiers', 'rewrite-rules']) { const j = u.indexOf(kw); if (j > 0 && u[j + 2] && u[j + 2] !== 'default') { const key = u[j + 1] + ' ' + u[j + 2]; if (!(kw === 'classifiers' ? cls : rw).has(key)) bad('err', `QoS de ${u[2]} : ${kw === 'classifiers' ? 'classifieur' : 'règle de marquage'} « ${key} » jamais défini(e) : Junos refuserait le commit.`); } }
          if (u.includes('shaping-rate') && !isRate(u[u.indexOf('shaping-rate') + 1])) bad('err', `QoS de ${u[2]} : shaping-rate « ${u[u.indexOf('shaping-rate') + 1]} » invalide.`);
        }
        if (u[1] === 'scheduler-maps' && u[3] === 'forwarding-class') { ref('fc', u[4], `scheduler-map ${u[2]}`); if (u[5] === 'scheduler') { ref('sched', u[6], `scheduler-map ${u[2]}`); if (!smapSched.has(u[2])) smapSched.set(u[2], []); smapSched.get(u[2]).push(u[6]); } }
        if ((u[1] === 'classifiers' || u[1] === 'rewrite-rules') && u[4] === 'forwarding-class') {
          ref('fc', u[5], `${u[1] === 'classifiers' ? 'classifieur' : 'marquage'} ${u[3]}`);
          const cp = u.indexOf(u[1] === 'classifiers' ? 'code-points' : 'code-point');
          if (cp > 0) for (const v of u.slice(cp + 1)) {
            const ok = u[2] === 'dscp' || u[2] === 'dscp-ipv6' ? (/^[01]{6}$/.test(v) || DSCP_ALIAS.test(v)) : /^[01]{3}$/.test(v) || /^(be|ef|af\d\d|cs\d|nc\d)$/.test(v);
            if (!ok) bad('err', `${u[1] === 'classifiers' ? 'Classifieur' : 'Marquage'} ${u[2]} ${u[3]} : code-point « ${v} » invalide (${u[2].startsWith('dscp') ? '6' : '3'} bits attendus, par exemple ${u[2].startsWith('dscp') ? '101110' : '101'}).`);
          }
          const lp = u.indexOf('loss-priority'); if (lp > 0 && !/^(low|medium-low|medium-high|high)$/.test(u[lp + 1] || '')) bad('err', `${u[3]} : loss-priority « ${u[lp + 1]} » invalide.`);
        }
        if (u[1] === 'schedulers') {
          const tr = u.indexOf('transmit-rate');
          if (tr > 0 && u[tr + 1] === 'percent') { if (!isInt(u[tr + 2], 0, 100)) bad('err', `Scheduler ${u[2]} : transmit-rate « ${u[tr + 2]} % » invalide (0 à 100).`); else schedPct.set(u[2], +u[tr + 2]); }
          if (u[3] === 'priority' && !/^(low|medium-low|medium-high|high|strict-high)$/.test(u[4] || '')) bad('err', `Scheduler ${u[2]} : priorité « ${u[4]} » invalide.`);
          const dp = u.indexOf('drop-profile'); if (dp > 0 && u[dp - 1] !== 'drop-profile-map') ref('drop', u[dp + 1], `scheduler ${u[2]}`);
          else if (dp > 0) ref('drop', u[dp + 1], `scheduler ${u[2]}`);
        }
        if (u[1] === 'drop-profiles' && (u.includes('fill-level') || u.includes('drop-probability'))) { const j = Math.max(u.indexOf('fill-level'), u.indexOf('drop-probability')); for (const v of u.slice(j + 1)) if (!isInt(v, 0, 100)) bad('err', `Drop-profile ${u[2]} : valeur « ${v} » invalide (0 à 100).`); }
        if (u[1] === 'host-outbound-traffic' && u[2] === 'forwarding-class') ref('fc', u[3], 'host-outbound-traffic');
      }
      if (u[0] === 'routing-options' && u[1] === 'dynamic-tunnels') { const j = u.indexOf('label-switched-path-template'); if (j > 0 && u[j + 1] !== 'default-template') ref('lsp', u[j + 1], `tunnel dynamique ${u[2]}`); }
    }
    const LBL = { filter: 'filtre', policy: 'politique', community: 'communauté', prefixList: 'prefix-list', smap: 'scheduler-map', sched: 'scheduler', drop: 'drop-profile', fc: 'forwarding-class', lsp: 'modèle de LSP' };
    for (const [kind, n, where] of refs) {
      if (defs[kind].has(n) || (kind === 'fc' && FC_DEFAULT.has(n))) continue;
      bad('err', `${where.replace(/^./, c => c.toUpperCase())} : ${LBL[kind]} « ${n} » jamais définie : faute de frappe ? Junos refuserait le commit.`);
    }
    for (const [m, list] of smapSched) { const sum = list.reduce((a, x) => a + (schedPct.get(x) || 0), 0); if (sum > 100) bad('warn', `Scheduler-map ${m} : la somme des transmit-rate atteint ${sum} % (plus de 100 %).`); }
  }

  /* Objets nommés (prefix-lists, filtres, politiques, QoS, serveurs…) : leur contenu normalisé sert à vérifier
   * que deux équipements d'un même réseau utilisent bien les mêmes définitions. */
  function junosObjects(lines) {
    const obj = new Map();
    // Chaque ligne a une identité (secrets décodés puis hachés, pour comparer) et un affichage (secrets masqués)
    const SECRET_KW = new Set(['secret', 'authentication-key', 'encrypted-password', 'key', 'simple-password', 'password', 'ssh-rsa', 'ssh-ed25519', 'ssh-ecdsa', 'ssh-dss', 'pre-shared-key', 'ascii-text', 'hexadecimal']);
    const put = (key, show, rest) => {
      if (!obj.has(key)) obj.set(key, { show, lines: new Map() });
      const id = rest.map((w, j) => SECRET_KW.has(rest[j - 1]) || /^\$9\$/.test(w) ? '#' + J9hash(/^\$9\$/.test(w) ? (J9.dec(w) || w) : w) : w).join(' ');
      const disp = rest.map((w, j) => SECRET_KW.has(rest[j - 1]) || /^\$[1569]\$/.test(w) ? '•••' : w).join(' ');
      obj.get(key).lines.set(id, disp);
    };
    for (const l of lines) {
      if (!l.startsWith('set ')) continue;
      const t = tok(l).slice(1);
      if (t[0] === 'policy-options' && ['prefix-list', 'policy-statement', 'community'].includes(t[1]) && t[2]) put(`${t[1]} ${t[2]}`, `${t[1]} ${t[2]}`, t.slice(3));
      else if (t[0] === 'firewall') { const k = t.indexOf('filter'); if (k > 0 && t[k + 1]) put(`filter ${t[k + 1]}`, `filtre ${t[k + 1]}`, t.slice(k + 2)); }
      else if (t[0] === 'class-of-service' && ['classifiers', 'rewrite-rules'].includes(t[1]) && t[3]) put(`${t[1]} ${t[2]} ${t[3]}`, `${t[1]} ${t[2]} ${t[3]}`, t.slice(4));
      else if (t[0] === 'class-of-service' && ['schedulers', 'scheduler-maps', 'drop-profiles'].includes(t[1]) && t[2]) put(`${t[1]} ${t[2]}`, `${t[1]} ${t[2]}`, t.slice(3));
      else if (t[0] === 'class-of-service' && ['forwarding-classes', 'host-outbound-traffic'].includes(t[1])) put(t[1], t[1], t.slice(2));
      else if (t[0] === 'system' && t[1] === 'syslog' && (t[2] === 'host' || t[2] === 'file') && t[3]) put(`syslog ${t[2]} ${t[3]}`, `syslog ${t[2]} ${t[3]}`, t.slice(4));
      else if (t[0] === 'system' && t[1] === 'syslog' && t[2] && t[2] !== 'source-address') put('syslog', 'syslog (général)', t.slice(2));
      else if (t[0] === 'system' && t[1] === 'radius-server' && t[2] && t[3] !== 'source-address') put(`radius-server ${t[2]}`, `serveur RADIUS ${t[2]}`, t.slice(3));
      else if (t[0] === 'system' && t[1] === 'login' && (t[2] === 'class' || t[2] === 'user') && t[3]) put(`login ${t[2]} ${t[3]}`, `${t[2] === 'class' ? 'classe' : 'utilisateur'} ${t[3]}`, t.slice(4));
      else if (t[0] === 'system' && ['services', 'authentication-order', 'time-zone', 'name-server', 'domain-name'].includes(t[1])) put(`system ${t[1]}`, t[1], t.slice(2));
      else if (t[0] === 'system' && t[1] === 'ntp') put('ntp', 'NTP', t.slice(2).filter(x => x !== 'source-address'));
      else if (t[0] === 'snmp' && t[1] === 'community' && t[2]) put('snmp community #' + J9hash(t[2]), 'communauté SNMP (nom masqué)', t.slice(3));
      else if (t[0] === 'snmp' && t[1] && t[1] !== 'community' && t[1] !== 'location' && t[1] !== 'contact') put('snmp ' + t[1], 'snmp ' + t[1], t.slice(2));
      else if (t[0] === 'protocols' && t[1] === 'mpls' && t[2] === 'label-switched-path' && t[3]) put(`lsp ${t[3]}`, `LSP ${t[3]}`, t.slice(4));
      else if (t[0] === 'routing-options' && t[1] === 'dynamic-tunnels' && t[2]) put(`dynamic-tunnels ${t[2]}`, `tunnel dynamique ${t[2]}`, t.slice(3));
    }
    return obj;
  }
  const J9hash = s => { let h = 5381; for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0; return h.toString(36); };

  function validateJunos(dev, lines) {
    const bad = (sev, msg, ifn) => issue(dev, sev, msg, ifn);
    const kw = (set, word, where) => { if (word && !set.has(word) && !/^</.test(word)) bad('warn', `Mot-clé « ${word} » inconnu sous « ${where} » : faute de frappe ? Junos refuserait cette ligne.`); };
    const num = (v, min, max, what) => { if (!isInt(v, min, max)) bad('err', `${what} : valeur « ${v} » invalide (attendu un entier entre ${min} et ${max}).`); };
    const refs = [];
    for (const line of lines) {
      let t = tok(line); if (t[0] !== 'set') continue; t = t.slice(1);
      if (t[0] === 'logical-systems') t = t.slice(2);
      let where = '';
      if (t[0] === 'routing-instances' && t[1]) {
        const n = t[1], r = t.slice(2); where = ` (instance ${n})`;
        if (r[0] === 'instance-type' && !KW.instType.has(r[1])) bad('err', `Instance ${n} : type « ${r[1]} » inconnu.`);
        if (r[0] === 'route-distinguisher' && !isRD(r[1])) bad('err', `Instance ${n} : route-distinguisher « ${r[1]} » mal formé (attendu AS:nn ou IP:nn).`);
        if (r[0] === 'vrf-target') { const v = (r[1] === 'import' || r[1] === 'export') ? r[2] : r[1]; if (v && !isRT(v)) bad('err', `Instance ${n} : vrf-target « ${v} » mal formé (attendu target:AS:nn).`); }
        if (r[0] === 'interface') refs.push([normJIf(r[1]), 'routing-instances ' + n]);
        if (r[0] === 'vlan-id' && !/^(all|none)$/.test(r[1]) && !isInt(r[1], 1, 4094)) bad('err', `Instance ${n} : vlan-id « ${r[1]} » invalide.`);
        const k = r.indexOf('site-identifier'); if (k >= 0) num(r[k + 1], 1, 65534, `Instance ${n}, site-identifier`);
        t = r;
      }
      if (t[0] === 'interfaces' && t[1] && t[1] !== 'apply-groups' && t[1] !== 'interface-range') {
        const n = t[1], r = t.slice(2);
        if (!ifNameOk(n)) bad('warn', `Nom d’interface « ${n} » inhabituel : faute de frappe ?`);
        if (r[0] === 'unit') {
          if (!/^\d+$/.test(r[1] || '') && !/^</.test(r[1] || '') && r[1] !== '*') { bad('err', `${n} : numéro d’unité « ${r[1]} » invalide (attendu un nombre).`, n + '.' + r[1]); continue; }
          const u = r.slice(2), un = n + '.' + r[1];
          kw(KW.unit, u[0], `interfaces ${n} unit ${r[1]}`);
          if (u[0] === 'vlan-id') num(u[1], 1, 4094, `${un}, vlan-id`);
          if (u[0] === 'family' && (u[1] === 'inet' || u[1] === 'inet6')) {
            kw(KW.inet, u[2], `${un} family ${u[1]}`);
            if (u[2] === 'mtu') num(u[3], 64, 9500, `${un}, mtu`);
            if (u[2] === 'address' && u[1] === 'inet' && String(u[3]).includes(':')) bad('err', `${un} : adresse IPv6 « ${u[3]} » sous family inet.`, un);
            if (u[2] === 'address' && u[1] === 'inet6' && !String(u[3]).includes(':')) bad('err', `${un} : adresse IPv4 « ${u[3]} » sous family inet6.`, un);
          }
        } else if (r[0]) {
          kw(KW.phys, r[0], `interfaces ${n}`);
          if (r[0] === 'mtu') num(r[1], 256, 16000, `${n}, mtu`);
          if (r[0] === 'native-vlan-id') num(r[1], 1, 4094, `${n}, native-vlan-id`);
          if (r[0] === 'speed' && !/^(\d+(\.\d+)?[mg]|auto|auto-\d+[mg])$/i.test(r[1] || '')) bad('err', `${n} : vitesse « ${r[1]} » invalide (exemples : 100m, 1g, 10g).`);
          if (r[0] === 'link-mode' && !/^(full-duplex|half-duplex|automatic)$/.test(r[1] || '')) bad('err', `${n} : link-mode « ${r[1]} » invalide.`);
        }
      }
      if (t[0] === 'protocols') {
        const p = t[1], r = t.slice(2);
        if ((p === 'ospf' || p === 'ospf3') && r[0] === 'area') {
          if (!isArea(r[1])) bad('err', `${p} : identifiant d’area « ${r[1]} » invalide${where}.`);
          if (r[2] === 'interface') {
            refs.push([normJIf(r[3]), `protocols ${p}`]);
            const x = r.slice(4);
            kw(KW.ospfIf, x[0], `${p} area ${r[1]} interface ${r[3]}`);
            if (x[0] === 'metric') num(x[1], 1, 65535, `${p} ${r[3]}, metric`);
            if (x[0] === 'hello-interval') num(x[1], 1, 255, `${p} ${r[3]}, hello-interval`);
            if (x[0] === 'dead-interval') num(x[1], 1, 65535, `${p} ${r[3]}, dead-interval`);
            if (x[0] === 'interface-type' && !/^(p2p|nbma|p2mp|p2mp-over-lan)$/.test(x[1] || '')) bad('err', `${p} ${r[3]} : interface-type « ${x[1]} » invalide (p2p, nbma, p2mp).`);
            if (x[0] === 'authentication' && x[1] === 'md5') num(x[2], 0, 255, `${p} ${r[3]}, identifiant de clé MD5`);
            if (x[0] === 'bfd-liveness-detection' && x[1] === 'minimum-interval') num(x[2], 1, 255000, `${p} ${r[3]}, BFD minimum-interval`);
            if (x[0] === 'bfd-liveness-detection' && x[1] === 'multiplier') num(x[2], 1, 255, `${p} ${r[3]}, BFD multiplier`);
          }
        }
        if (['isis', 'ldp', 'mpls', 'rsvp'].includes(p) && r[0] === 'interface' && r[1]) refs.push([normJIf(r[1]), `protocols ${p}`]);
        if (p === 'lldp' && r[0] === 'interface' && r[1] && r[1] !== 'all') refs.push([r[1], 'protocols lldp']);
        if (p === 'rsvp' && r[0] === 'interface' && r[2] === 'bandwidth' && !isRate(r[3])) bad('err', `rsvp ${r[1]} : bande passante « ${r[3]} » invalide (exemples : 100m, 1g).`);
        if (p === 'bgp') {
          let x = r, ctx = 'protocols bgp';
          if (x[0] === 'group') { ctx = `bgp group ${x[1]}`; x = x.slice(2); }
          if (x[0] === 'neighbor') { if (!isIP(x[1]) && !IPV4ISH.test(x[1])) bad('err', `${ctx} : adresse de voisin « ${x[1]} » invalide${where}.`); ctx += ` neighbor ${x[1]}`; x = x.slice(2); }
          if (x.length) kw(KW.bgp, x[0], ctx);
          if (x[0] === 'local-address' && !isIP(x[1]) && !IPV4ISH.test(x[1])) bad('err', `${ctx} : local-address « ${x[1]} » invalide.`);
          if (x[0] === 'local-address' && isIP(x[1]) && !ownsIP(dev, x[1])) bad('err', `${ctx} : local-address ${x[1]} n’est configurée sur aucune interface de l’équipement : la session BGP ne peut pas s’établir.`);
          if ((x[0] === 'peer-as' || x[0] === 'local-as') && !isAS(x[1])) bad('err', `${ctx} : ${x[0]} « ${x[1]} » invalide.`);
          if (x[0] === 'type' && !/^(internal|external)$/.test(x[1] || '')) bad('err', `${ctx} : type « ${x[1]} » invalide (internal ou external).`);
          if (x[0] === 'hold-time' && !(x[1] === '0' || isInt(x[1], 3, 65535))) bad('err', `${ctx} : hold-time « ${x[1]} » invalide (0 ou 3 à 65535).`);
          if (x[0] === 'multihop' && x[1] === 'ttl') num(x[2], 1, 255, `${ctx}, multihop ttl`);
          if (x[0] === 'family' && !KW.bgpFam.has(x[1])) bad('err', `${ctx} : famille « ${x[1]} » inconnue (faute de frappe ?) : Junos refuserait la configuration et la famille n’est pas négociée.`);
        }
      }
      if (t[0] === 'routing-options' && !where) {
        if (t[1] === 'router-id' && !isIPv4(t[2]) && !IPV4ISH.test(t[2])) bad('err', `routing-options : router-id « ${t[2]} » invalide (attendu une adresse IPv4).`);
        if (t[1] === 'autonomous-system' && !isAS(t[2])) bad('err', `routing-options : autonomous-system « ${t[2]} » invalide.`);
      }
      if (t[0] === 'policy-options' && t[1] === 'community' && t[3] === 'members') for (const m of t.slice(4)) if (/^target:/.test(m) && !isRT(m)) bad('err', `Communauté ${t[2]} : membre « ${m} » mal formé (attendu target:AS:nn).`);
      if (t[0] === 'class-of-service' && t[1] === 'interfaces' && t[2] && !t[2].includes('*')) refs.push([t[3] === 'unit' ? t[2] + '.' + t[4] : t[2], 'class-of-service']);
    }
    for (const [n, ctx] of refs) if (n && n !== 'all' && !n.includes('*') && !/^</.test(n) && !dev.ifs.has(n))
      bad('warn', `${ctx} cite l’interface ${n}, qui n’existe pas dans « interfaces » : faute de frappe ou unité renumérotée ?`, n);
    validateGeneric(dev, lines, bad);
    // Adresses mal formées, doublons et chevauchements sur l'équipement lui-même
    const seen = new Map();
    for (const i of dev.ifs.values()) {
      for (const b of i.badAddr || []) bad('err', `${i.name} : adresse « ${b} » mal formée, elle est ignorée (aucune adresse valide sur l’interface).`, i.name);
      for (const a of [...i.v4, ...i.v6]) {
        if (seen.has(a.ip) && seen.get(a.ip) !== i.name) bad('err', `L’adresse ${a.ip} est configurée deux fois sur l’équipement (${seen.get(a.ip)} et ${i.name}).`, i.name);
        seen.set(a.ip, i.name);
      }
    }
  }

  function getInst(dev, n) {
    if (!dev.instances.has(n)) dev.instances.set(n, { name: n, type: null, rd: null, rtImport: new Set(), rtExport: new Set(), importPol: [], exportPol: [], ifaces: [], sites: [], vlanId: null });
    return dev.instances.get(n);
  }
  function jPolicy(pol, t) {
    if (t[1] === 'community' && t[3] === 'members') { const l = pol.comm.get(t[2]) || []; l.push(...t.slice(4)); pol.comm.set(t[2], l); return; }
    if (t[1] !== 'policy-statement') return;
    const st = pol.stmt.get(t[2]) || { from: new Set(), add: new Set() }; pol.stmt.set(t[2], st);
    const k = t.indexOf('community');
    if (k < 0) return;
    if (t[k - 1] === 'from') t.slice(k + 1).forEach(c => st.from.add(c));
    if (t[k - 1] === 'then' && (t[k + 1] === 'add' || t[k + 1] === 'set')) t.slice(k + 2).forEach(c => st.add.add(c));
  }
  function jStatement(dev, t, vrf, bgpGroups, bgpGlob) {
    const k = t[0];
    if (k === 'system') {
      if (t[1] === 'host-name') dev.hostname = t[2];
      else if (t[1] === 'ntp' && t[2] === 'server') { if (!dev.sys.ntp.includes(t[3])) dev.sys.ntp.push(t[3]); }
      else if (t[1] === 'syslog' && t[2] === 'host') { if (!dev.sys.syslog.includes(t[3])) dev.sys.syslog.push(t[3]); }
      else if (t[1] === 'radius-server') { if (!dev.sys.radius.includes(t[2])) dev.sys.radius.push(t[2]); }
      else if (t[1] === 'time-zone') dev.sys.tz = t[2];
      return;
    }
    if (k === 'snmp' && t[1] === 'community') { if (!dev.sys.snmp.includes(t[2])) dev.sys.snmp.push(t[2]); return; }
    if (k === 'firewall') { const f = t.indexOf('filter'); if (f > 0 && t[f + 1] && !dev.sys.filters.includes(t[f + 1])) dev.sys.filters.push(t[f + 1]); return; }
    if (k === 'class-of-service' && t[1] === 'interfaces' && t[2]) {
      let key = t[2], r = t.slice(3);
      if (r[0] === 'unit') { key = t[2] + '.' + r[1]; r = r.slice(2); }
      const c = dev.cos.get(key) || { scheduler: null, shaping: null, classifiers: {}, rewrite: {} }; dev.cos.set(key, c);
      if (r[0] === 'scheduler-map') c.scheduler = r[1];
      else if (r[0] === 'shaping-rate') c.shaping = r[1];
      else if (r[0] === 'classifiers' && r[1]) c.classifiers[r[1]] = r[2] || 'défaut';
      else if (r[0] === 'rewrite-rules' && r[1]) c.rewrite[r[1]] = r[2] || 'défaut';
      return;
    }
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
      if (p === 'ospf' && r[0] === 'traffic-engineering') dev.sys.ospfTE = true;
      if (r[0] === 'reference-bandwidth') O.refBw = r[1];
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
    if (p === 'rsvp' && r[0] === 'interface') {
      const ifn = normJIf(r[1]); dev.rsvp.add(ifn);
      if (r[2] === 'bandwidth') dev.rsvpBw.set(ifn, r[3]);
      if (r[2] === 'link-protection') dev.rsvpLP.add(ifn);
      return;
    }
    if (p === 'mpls' && r[0] === 'label-switched-path' && r[1] && !dev.sys.lsps.includes(r[1])) { dev.sys.lsps.push(r[1]); return; }
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
          if (rr[0] === 'filter' && (rr[1] === 'input' || rr[1] === 'output' || rr[1] === 'input-list' || rr[1] === 'output-list')) {
            const k2 = rr[1].startsWith('input') ? 'filterIn' : 'filterOut'; u[k2] = (u[k2] ? u[k2] + ', ' : '') + rr[2];
          }
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
    // Lignes normalisées pour la comparaison ligne à ligne (toujours au format display set)
    lines: text => junosLines(text, { raw: true }).lines.map(l => { const t = tok(l); return { section: t.slice(1, 3).join(' '), text: l }; }),
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
      const rs = any(dev.rsvp);
      return { ldp: any(dev.ldp), mplsFamily: !!i.mpls, mplsProto: any(dev.mpls), rsvp: rs,
        rsvpBw: rs ? (dev.rsvpBw.get(i.name) || dev.rsvpBw.get('all') || null) : null, linkProtection: rs && (dev.rsvpLP.has(i.name) || dev.rsvpLP.has('all')) };
    },
    // Qualité de service effective : niveau physique (nom exact ou motif « ge-1/1/* ») puis niveau unité
    cosOf(dev, i) {
      const p = phys(dev, i);
      const res = { scheduler: null, shaping: null, classifiers: {}, rewrite: {} }; let any = false;
      const merge = c => { any = true; res.scheduler = res.scheduler || c.scheduler; res.shaping = res.shaping || c.shaping; Object.assign(res.classifiers, c.classifiers); Object.assign(res.rewrite, c.rewrite); };
      for (const [k, c] of dev.cos) {
        if (k === i.name || (i.unit != null && globMatch(k, i.name))) merge(c);
        else if (p && (k === p.name || (!k.includes('.') && globMatch(k, p.name)))) merge(c);
      }
      return any ? res : null;
    },
    lldpOn: (dev, p) => !!(dev.lldp.enabled && p && (dev.lldp.all || dev.lldp.ifs.has(p.name))),
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
