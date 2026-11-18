#!/usr/bin/env node
/* Vis-à-vis : tests du moteur (node tests/run.js, aucune dépendance). */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('./load');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  ÉCHEC ' + name + '\n         ' + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' attendu ' + JSON.stringify(b) + ', obtenu ' + JSON.stringify(a)); }
function ok(c, msg) { if (!c) throw new Error(msg || 'condition fausse'); }

const A = rd('samples/mx104-par1.conf'), B = rd('samples/hpe5520-par1.cfg');
const r = V.analyze(A, B);
const find = (block, label) => block.checks.find(c => c.label === label);
const link = (a, b) => r.links.find(l => l.a.name === a && l.b.name === b);

console.log('Lecture des configurations');
test('détection des constructeurs', () => { eq(V.detectVendor(A), 'junos'); eq(V.detectVendor(B), 'comware'); eq(V.detectVendor('bonjour'), null); });
test('noms d’hôte', () => { eq(r.A.hostname, 'MX104-PAR1'); eq(r.B.hostname, 'HPE5520-PAR1'); });
test('Junos : hiérarchique et display set donnent le même résultat', () => {
  const r2 = V.analyze(V.junosToSet(A).join('\n'), B);
  const flat = x => JSON.stringify([x.links.map(l => l.checks), x.sessions.map(s => s.checks)]);
  eq(flat(r2), flat(r));
});
test('Junos : lignes inactive ignorées', () => {
  const d = V.parse('set system host-name R1\nset interfaces ge-0/0/0 unit 0 family inet address 192.0.2.1/30\ndeactivate interfaces ge-0/0/0');
  eq(d.ifs.get('ge-0/0/0.0'), undefined);
});
test('Junos : clé $9$ décodée localement', () => { eq(V.J9.dec(V.J9.enc('S3cret!', 5)), 'S3cret!'); });
test('Comware : noms abrégés et trunk', () => {
  const d = V.parse('sysname SW\n#\ninterface XGE1/0/1\n port link-type trunk\n port trunk permit vlan 10 to 12\n undo port trunk permit vlan 1\n port trunk pvid vlan 10\n#');
  const p = V.l2Profile(d, d.ifs.get('Ten-GigabitEthernet1/0/1'));
  eq([p.mode, p.untagged, [...p.tagged]], ['trunk', 10, [11, 12]]);
});
test('Comware : OSPF via commande network', () => {
  eq(r.B.ospf.ifs.get('Route-Aggregation1').area, '0.0.0.1');
});

console.log('Détection des liens');
test('liens trouvés par sous-réseau et par description', () => {
  eq(r.links.map(l => l.a.name + '|' + l.b.name + '|' + l.how), [
    'ge-1/0/0.100|Vlan-interface100|auto', 'ae0.0|Route-Aggregation1|auto',
    'ge-1/0/0|Ten-GigabitEthernet1/0/49|description', 'ge-1/0/1|GigabitEthernet1/0/1|description']);
});

console.log('Erreurs volontaires de l’exemple');
test('timers OSPF différents', () => eq(find(link('ge-1/0/0.100', 'Vlan-interface100'), 'Timers hello / dead').sev, 'err'));
test('MTU différente avec IS-IS = bloquant', () => eq(find(link('ge-1/0/0.100', 'Vlan-interface100'), 'MTU IP').sev, 'err'));
test('LDP d’un seul côté', () => eq(find(link('ge-1/0/0.100', 'Vlan-interface100'), 'LDP').sev, 'err'));
test('VLAN 100 transporté tagué', () => eq(find(link('ge-1/0/0.100', 'Vlan-interface100'), 'Encapsulation').sev, 'ok'));
test('area OSPF différente sur l’agrégat', () => eq(find(link('ae0.0', 'Route-Aggregation1'), 'Area').sev, 'err'));
test('cadence LACP différente', () => eq(find(link('ae0.0', 'Route-Aggregation1'), 'Cadence LACP').sev, 'warn'));
test('VLAN d’accès différent', () => eq(find(link('ge-1/0/1', 'GigabitEthernet1/0/1'), 'VLAN non tagué').sev, 'err'));
test('VLAN tagué présent d’un seul côté', () => eq(find(link('ge-1/0/0', 'Ten-GigabitEthernet1/0/49'), 'VLAN tagués').sev, 'warn'));
const s1 = r.sessions.find(s => s.a && s.a.ip === '192.0.2.2');
test('BGP : mauvais AS côté HPE', () => eq(find(s1, 'AS attendu pour MX104-PAR1').sev, 'err'));
test('BGP : ebgp-max-hop manquant', () => eq(find(s1, 'Multihop eBGP').sev, 'err'));
test('BGP : VPNv4 non négocié', () => eq(find(s1, 'Familles d’adresses').sev, 'warn'));
test('BGP : session déclarée d’un seul côté', () => ok(r.sessions.some(s => !s.a && s.b && s.b.ip === '198.51.100.9')));

console.log('Robustesse');
test('inverser A et B donne le même nombre de problèmes', () => {
  const r2 = V.analyze(B, A);
  const n = x => [...x.links.flatMap(l => l.checks), ...x.sessions.flatMap(s => s.checks)].filter(c => c.sev === 'err' || c.sev === 'warn').length;
  eq(n(r2), n(r));
});
test('aucune clé décodée n’apparaît dans le rapport', () => {
  const txt = JSON.stringify([r.links.map(l => l.checks), r.sessions.map(s => s.checks), r.global]);
  ok(!txt.includes('S3cretOSPF') && !txt.includes('Bgp!Key2026'));
});

console.log('Fautes injectées (chaque modification doit faire apparaître un problème)');
{
  const key = x => new Set([...x.links.flatMap(l => l.checks.map(c => l.a.name.split('.')[0] + '|' + c.label + '|' + c.msg.slice(0, 60) + '|' + c.sev)),
    ...x.sessions.flatMap(s => s.checks.map(c => 'bgp|' + c.label + '|' + c.msg.slice(0, 60) + '|' + c.sev)), ...x.global.map(c => 'g|' + c.label + '|' + c.sev)]);
  const A0 = A, B0 = B, base = key(r);
  const M=[
   ['B','IP Vlan-if100 autre sous-réseau','ip address 198.51.100.2 255.255.255.252','ip address 203.0.113.202 255.255.255.252'],
   ['B','masque Vlan-if100 /24','ip address 198.51.100.2 255.255.255.252','ip address 198.51.100.2 255.255.255.0'],
   ['B','IP en double','ip address 198.51.100.2 255.255.255.252','ip address 198.51.100.1 255.255.255.252'],
   ['B','IP = adresse réseau','ip address 198.51.100.2 255.255.255.252','ip address 198.51.100.0 255.255.255.252'],
   ['B','IP RAGG1 autre sous-réseau','ip address 198.51.100.8 255.255.255.254','ip address 203.0.113.70 255.255.255.254'],
   ['B','OSPF retiré de Vlan-if100',' ospf 1 area 0.0.0.0\n',''],
   ['B','OSPF area 1 sur Vlan-if100',' ospf 1 area 0.0.0.0\n',' ospf 1 area 0.0.0.1\n'],
   ['B','OSPF broadcast',' ospf network-type p2p',' ospf network-type broadcast'],
   ['B','OSPF passive',' silent-interface LoopBack0',' silent-interface Vlan-interface100'],
   ['B','ISIS broadcast',' isis circuit-type p2p\n',''],
   ['B','ISIS level-1',' isis circuit-level level-2',' isis circuit-level level-1'],
   ['B','trunk vlan 101',' port trunk permit vlan 1 100 200',' port trunk permit vlan 1 101 200'],
   ['B','trunk pvid 100',' port trunk permit vlan 1 100 200',' port trunk permit vlan 1 100 200\n port trunk pvid vlan 100'],
   ['B','LAG statique',' link-aggregation mode dynamic\n',''],
   ['B','membre LAG retiré','interface Ten-GigabitEthernet1/0/52\n port link-mode route\n port link-aggregation group 1','interface Ten-GigabitEthernet1/0/52\n port link-mode route'],
   ['B','BGP AS correct mais loopback changée','ip address 192.0.2.2 255.255.255.255','ip address 192.0.2.9 255.255.255.255'],
   ['B','BGP peer IP faute de frappe','peer 192.0.2.1 ','peer 192.0.2.11 ',true],
   ['B','BGP sans connect-interface',' peer 192.0.2.1 connect-interface LoopBack0\n',''],
   ['B','shutdown Vlan-if100',' description Transit coeur vers MX104-PAR1',' description Transit coeur vers MX104-PAR1\n shutdown'],
   ['B','access vlan 300 (corrige)',' port access vlan 30',' port access vlan 300'],
   ['B','MTU alignée (corrige)',' description Transit coeur vers MX104-PAR1',' description Transit coeur vers MX104-PAR1\n mtu 9174'],
   ['A','Junos IP ae0 changée','address 198.51.100.9/31','address 203.0.113.33/31'],
   ['A','Junos vlan-id 101','vlan-id 100;','vlan-id 101;'],
   ['A','Junos area 0.0.0.1','area 0.0.0.0 {','area 0.0.0.1 {'],
   ['A','Junos peer-as faux','peer-as 64502;','peer-as 64503;'],
   ['A','Junos neighbor IP faux','neighbor 192.0.2.2 {','neighbor 192.0.2.3 {'],
   ['A','Junos sans multihop','            multihop {\n                ttl 2;\n            }\n',''],
   ['A','Junos LACP retiré (statique)','            lacp {\n                active;\n                periodic fast;\n            }\n',''],
   ['A','Junos family iso retirée','            family iso;\n            family mpls;','            family mpls;'],
   ['A','Junos hostname identique','host-name MX104-PAR1;','host-name HPE5520-PAR1;'],
   ['A','Junos router-id identique','router-id 192.0.2.1;','router-id 192.0.2.2;'],
  ];
  for (const [side, label, from, to, all] of M) test(label, () => {
    const src = side === 'A' ? A0 : B0;
    ok(src.includes(from), 'motif introuvable dans l’exemple');
    const mod = all ? src.split(from).join(to) : src.replace(from, to);
    const k = key(side === 'A' ? V.analyze(mod, B0) : V.analyze(A0, mod));
    const isProb = x => /\|(err|warn)$/.test(x);
    if (label.includes('corrige')) ok([...base].some(x => isProb(x) && !k.has(x)), 'le problème corrigé est toujours signalé');
    else ok([...k].some(x => isProb(x) && !base.has(x)), 'aucun nouveau problème détecté');
  });
}
test('IP modifiée : le lien reste visible et passe en erreur', () => {
  const mod = B.replace('ip address 198.51.100.2 255.255.255.252', 'ip address 203.0.113.202 255.255.255.252');
  const x = V.analyze(A, mod); const l = x.links.find(l => l.a.name === 'ge-1/0/0.100');
  ok(l && l.how === 'probable', 'lien probable absent'); eq(l.checks.find(c => c.label === 'Adresse IPv4').sev, 'err');
});
test('interface décrite vers le voisin sans correspondance : signalée', () => {
  const mod = B + '\ninterface Vlan-interface900\n description Lien secours MX104-PAR1\n ip address 203.0.113.90 255.255.255.0\n#\n';
  const x = V.analyze(A, mod); ok(x.unmatched.B.some(u => u.name === 'Vlan-interface900' && u.toPeer));
});

console.log('Comparaison complète de deux configurations');
{
  const A2 = A.replace('address 198.51.100.1/30', 'address 198.51.100.5/30').replace('chassis {', 'snmp {\n    community public;\n}\nchassis {')
    .replace('$9$lrfMx-wYgJZjbsaUDi5TB1RSKW8XNY2o', V.J9.enc('S3cretOSPF', 99));
  const c = V.compareConfigs(A, A2);
  const diffIf = c.ifaces.filter(x => x.checks.some(k => k.sev === 'warn')).map(x => x.name);
  test('une IP modifiée est signalée sur la bonne interface', () => eq(diffIf, ['ge-1/0/0.100']));
  test('une ligne non analysée (snmp) apparaît dans les différences', () => ok(c.lines.groups.some(g => g.added.includes('set snmp community public'))));
  test('une clé $9$ rechiffrée mais identique n’est pas une différence', () => ok(!c.lines.groups.some(g => g.section.startsWith('protocols ospf'))));
  const same = V.compareConfigs(A, A);
  test('configuration identique : aucun écart', () => { eq(same.ifaces.flatMap(x => x.checks).filter(k => k.sev !== 'ok').length, 0); eq(same.lines.nAdded + same.lines.nRemoved, 0); });
  const Bm = B.replace(' port trunk permit vlan 1 100 200', ' port trunk permit vlan 1 100 201');
  const cb = V.compareConfigs(B, Bm);
  test('Comware : VLAN de trunk modifié', () => eq(cb.ifaces.filter(x => x.checks.some(k => k.sev === 'warn')).map(x => x.name), ['Ten-GigabitEthernet1/0/49']));
  test('interface supprimée détectée', () => {
    const c2 = V.compareConfigs(A, A.replace(/    ge-1\/0\/1 \{[\s\S]*?\n    \}\n/, ''));
    ok(c2.ifaces.some(x => x.name === 'ge-1/0/1' && x.status === 'A'));
  });
  test('deux équipements au même gabarit : suggestion de comparaison', () => {
    const sim = V.similarity(V.parse(A), V.parse(A2.replace('MX104-PAR1', 'MX104-LYON2')));
    ok(sim.common >= 3 && sim.ratio >= 0.5);
  });
}

console.log('Gabarits Junos (groups / apply-groups à jokers)');
{
  const N = rd('samples/gabarit-nord.conf'), S0 = rd('samples/gabarit-sud.conf');
  const dn = V.parse(N), u = dn.ifs.get('ge-0/0/0.0');
  test('MTU héritée du groupe <ge-0/*>', () => eq(V.ipMtu(dn, u).v, 1586));
  test('OSPF p2p, MD5 et BFD hérités du groupe', () => { const o = V.ospfOf(dn, u); eq([o.network, o.auth.type, o.bfd.min], ['p2p', 'md5', 50]); });
  test('le joker <ge-*> ne touche pas lo0', () => eq(V.ospfOf(dn, dn.ifs.get('lo0.0')).network, 'loopback'));
  test('RSVP link-protection héritée', () => ok(V.mplsOf(dn, u).linkProtection));
  test('site VPLS hérité via <*_VPLS>', () => eq(dn.instances.get('VIDEO_VPLS').sites[0].id, '101'));
  test('une valeur explicite l’emporte sur le groupe', () => {
    const d = V.parse(N.replace('                metric 10;\n            }\n            interface ge-0/0/1.0', '                metric 10;\n                interface-type broadcast;\n            }\n            interface ge-0/0/1.0'));
    eq(V.ospfOf(d, d.ifs.get('ge-0/0/0.0')).network, 'broadcast');
  });
  test('un choix explicite (simple-password) remplace le MD5 du groupe', () => {
    const d = V.parse(N.replace('            interface ge-0/0/0.0 {\n                metric 10;', '            interface ge-0/0/0.0 {\n                authentication {\n                    simple-password "x";\n                }\n                metric 10;'));
    eq(V.ospfOf(d, d.ifs.get('ge-0/0/0.0')).auth.type, 'simple');
  });
  test('apply-groups-except', () => {
    const d = V.parse(N.replace('    ge-0/0/0 {\n        description', '    ge-0/0/0 {\n        apply-groups-except GABARIT-MTU;\n        description'));
    eq(V.ipMtu(d, d.ifs.get('ge-0/0/0.0')).v, 1500);
  });
  const g0 = V.analyze(N, S0);
  test('paire gabarit : aucun problème', () => eq([...g0.links.flatMap(l => l.checks), ...g0.sessions.flatMap(x => x.checks), ...g0.services.flatMap(x => x.checks)].filter(c => c.sev === 'err' || c.sev === 'warn').length, 0));
  test('hiérarchique et display set identiques avec groupes', () => {
    const toSet = t => V.junosToSet(t).join('\n');
    const sig = r => JSON.stringify(r.links.map(l => l.checks.map(c => [c.label, c.sev, c.a, c.b])));
    eq(sig(V.analyze(toSet(N), toSet(S0))), sig(g0));
  });
  const key = r => { const m = new Map(); const add = (k, c) => m.set(k + c.label + c.a + c.b, c.sev);
    r.links.forEach(l => l.checks.forEach(c => add('L' + l.a.name, c))); r.sessions.forEach(x => x.checks.forEach(c => add('S', c)));
    r.services.forEach(x => x.checks.forEach(c => add('V', c))); r.global.forEach(c => add('G', c)); return m; };
  const RK = { ok: 0, info: 1, warn: 2, err: 3 }, base = key(g0);
  const F = [
    ['groupe OSPF : p2p → broadcast', 'interface-type p2p;', 'interface-type broadcast;', 'err'],
    ['groupe OSPF : clé MD5 différente', /md5 1 key "[^"]+"/, 'md5 1 key "autre-cle"', 'err'],
    ['groupe OSPF : BFD 50 → 300 ms', 'minimum-interval 50;', 'minimum-interval 300;', 'info'],
    ['apply-groups GABARIT-OSPF retiré', '        apply-groups GABARIT-OSPF;\n', '', 'err'],
    ['joker MTU <ge-0/*> → <ge-9/*>', '<ge-0/*> {', '<ge-9/*> {', 'err'],
    ['area NSSA retirée', '            nssa;\n', '', 'err'],
    ['LDP retiré du lien', '    ldp {\n        interface ge-0/0/0.0;\n', '    ldp {\n', 'err'],
    ['RSVP bandwidth différente', 'bandwidth 1g;', 'bandwidth 100m;', 'warn'],
    ['QoS : classifieur EXP retiré', '                classifiers {\n                    exp LECTURE-EXP;\n                }\n', '', 'warn'],
    ['LLDP retiré du port', '    lldp {\n        interface ge-0/0/0;\n    }\n', '', 'info'],
    ['IP du lien hors sous-réseau', 'address 192.0.2.1/31;', 'address 203.0.113.41/31;', 'err'],
    ['loopback retirée d’OSPF', '            interface lo0.0 {\n                passive;\n            }\n', '', 'err'],
    ['BGP : voisin mal tapé', 'neighbor 198.51.100.1;', 'neighbor 198.51.100.11;', 'err'],
    ['VPLS : même site-identifier', 'site-identifier 102;', 'site-identifier 101;', 'err'],
    ['VPLS : route-target différent', 'vrf-target target:64500:500;', 'vrf-target target:64500:501;', 'warn'],
    ['groupe GABARIT-VPLS non appliqué', '    apply-groups GABARIT-VPLS;\n', '', 'err'],
  ];
  for (const [label, from, to, expect] of F) test('faute injectée : ' + label, () => {
    ok(typeof from === 'string' ? S0.includes(from) : from.test(S0), 'motif introuvable');
    const k = key(V.analyze(N, S0.replace(from, to)));
    const worst = [...k].filter(([x, sev]) => !base.has(x) || RK[sev] > RK[base.get(x)]).reduce((w, [, sev]) => RK[sev] > RK[w] ? sev : w, 'ok');
    ok(RK[worst] >= RK[expect], `gravité obtenue « ${worst} », attendue « ${expect} »`);
  });
}

console.log('Fautes de saisie (syntaxe et valeurs)');
{
  const N = rd('samples/gabarit-nord.conf'), S0 = rd('samples/gabarit-sud.conf');
  test('configurations saines : aucune fausse alerte', () => {
    for (const f of ['samples/gabarit-nord.conf', 'samples/gabarit-sud.conf', 'samples/mx104-par1.conf', 'samples/hpe5520-par1.cfg']) eq(V.parse(rd(f)).issues, [], f);
  });
  const errOn = (txt, from, to) => { ok(txt.includes(from), 'motif introuvable'); const r = V.analyze(N, txt.replace(from, to)); return [...r.links.flatMap(l => l.checks), ...r.sessions.flatMap(x => x.checks), ...r.global].filter(c => c.sev === 'err'); };
  const F = [
    ['adresse incomplète « 192.0.2./31 »', 'address 192.0.2.1/31;', 'address 192.0.2./31;', 'Adresse IP'],
    ['octet supérieur à 255', 'address 192.0.2.1/31;', 'address 192.0.2.301/31;', 'Adresse IP'],
    ['préfixe /33', 'address 192.0.2.1/31;', 'address 192.0.2.1/33;', 'Adresse IP'],
    ['mot-clé « adress »', 'address 192.0.2.1/31;', 'adress 192.0.2.1/31;', 'Adresse IPv4'],
    ['point-virgule manquant', 'address 192.0.2.1/31;', 'address 192.0.2.1/31', 'Lecture'],
    ['accolade fermante supprimée', '                address 192.0.2.1/31;\n            }\n            family mpls;\n        }\n    }\n', '                address 192.0.2.1/31;\n            }\n            family mpls;\n        }\n', 'Lecture'],
    ['unité renumérotée', '        description FO_RTR-SUD-02-RTR-NORD-01;\n        unit 0 {', '        description FO_RTR-SUD-02-RTR-NORD-01;\n        unit 1 {', 'Activation'],
    ['voisin BGP tronqué', 'neighbor 198.51.100.1;', 'neighbor 198.51.100.;', 'Lecture'],
    ['area avec une lettre', 'area 0.0.0.10 {', 'area 0.0.0.1O {', 'Lecture'],
    ['vrf-target mal formé', 'vrf-target target:64500:500;', 'vrf-target target:64500;', 'Lecture'],
    ['famille BGP mal orthographiée', 'family inet-vpn {', 'family inet-vpm {', 'Lecture'],
    ['guillemet non fermé', 'description FO_RTR-SUD-02-RTR-NORD-01;', 'description "FO_RTR-SUD-02-RTR-NORD-01;', 'Lecture'],
  ];
  for (const [label, from, to, expectLabel] of F) test('faute de saisie : ' + label, () => {
    const errs = errOn(S0, from, to);
    ok(errs.some(c => c.label.startsWith(expectLabel)), 'erreur attendue « ' + expectLabel + ' » absente');
  });
  test('Comware : masque non contigu signalé', () => {
    const d = V.parse(rd('samples/hpe5520-par1.cfg').replace('ip address 198.51.100.8 255.255.255.254', 'ip address 198.51.100.8 255.255.0.254'));
    ok(d.issues.some(x => x.sev === 'err' && /mal formée/.test(x.msg)));
  });
  test('Comware : adresse incomplète signalée sur le lien', () => {
    const r = V.analyze(rd('samples/mx104-par1.conf'), rd('samples/hpe5520-par1.cfg').replace('ip address 198.51.100.2 255.255.255.252', 'ip address 10.10.0. 255.255.255.252'));
    ok(r.links.some(l => l.checks.some(c => c.label === 'Adresse IP' && c.sev === 'err')));
  });
}

console.log('Paramètres communs, objets et références');
{
  const N = rd('samples/gabarit-nord.conf'), S0 = rd('samples/gabarit-sud.conf');
  test('exemples fictifs : aucune anomalie de lecture', () => { eq(V.parse(N).issues, []); eq(V.parse(S0).issues, []); });
  const g = V.analyze(N, S0);
  test('paramètres communs identiques sur la paire saine', () => eq(g.common.filter(c => c.sev === 'warn' || c.sev === 'err').length, 0));
  const has = (r, re, sev) => [...r.common, ...r.global].some(c => c.sev === sev && re.test(c.label + ' ' + c.msg));
  const C = [
    ['serveur NTP mal formé', 'server 203.0.113.30 prefer;', 'server 203..113.30 prefer;', /mal formée/, 'err'],
    ['source-address étrangère au routeur', 'source-address 198.51.100.2;\n        }\n    }\n    syslog', 'source-address 203.0.113.250;\n        }\n    }\n    syslog', /n’est configurée sur aucune interface/, 'err'],
    ['serveur RADIUS différent du voisin', 'radius-server {\n        203.0.113.10 {', 'radius-server {\n        203.0.113.11 {', /Serveurs RADIUS/, 'warn'],
    ['serveur syslog différent du voisin', 'host 203.0.113.20 {', 'host 203.0.113.21 {', /Serveurs syslog/, 'warn'],
    ['entrée de prefix-list modifiée', '        203.0.113.0/24;\n    }\n}\nfirewall', '        192.0.2.128/25;\n    }\n}\nfirewall', /prefix-list MGMT/, 'warn'],
    ['filtre de protection modifié', 'port ssh;', 'port telnet;', /filtre PROTECTION-RE/, 'warn'],
    ['filtre cité mais inexistant', 'input PROTECTION-RE;', 'input PROTECTION-RF;', /jamais définie/, 'err'],
    ['prefix-list citée mais inexistante', '                        MGMT;', '                        MGNT;', /jamais définie/, 'err'],
    ['code-point EXP invalide', 'loss-priority low code-points 111;', 'loss-priority low code-points 1l1;', /code-point/, 'err'],
    ['part d’un scheduler modifiée', 'transmit-rate percent 10;', 'transmit-rate percent 20;', /schedulers FILE-NC|plus de 100/, 'warn'],
    ['scheduler-map vers un scheduler inexistant', 'scheduler FILE-NC;', 'scheduler FILE-NX;', /jamais définie/, 'err'],
    ['secret RADIUS différent (jamais affiché)', 'secret "secret-radius";', 'secret "autre-secret";', /serveur RADIUS/, 'warn'],
  ];
  for (const [label, from, to, re, sev] of C) test('faute injectée : ' + label, () => {
    ok(S0.includes(from), 'motif introuvable');
    const r = V.analyze(N, S0.replace(from, to));
    ok(has(r, re, sev), `aucune ligne « ${sev} » correspondante`);
    if (label.includes('secret')) ok(!JSON.stringify([r.common, r.global]).includes('autre-secret'), 'le secret apparaît dans le rapport');
  });
}

console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
