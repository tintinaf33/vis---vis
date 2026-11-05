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
  const d = V.parse('set system host-name R1\nset interfaces ge-0/0/0 unit 0 family inet address 10.0.0.1/30\ndeactivate interfaces ge-0/0/0');
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
test('BGP : session déclarée d’un seul côté', () => ok(r.sessions.some(s => !s.a && s.b && s.b.ip === '10.10.1.1')));

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

console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
