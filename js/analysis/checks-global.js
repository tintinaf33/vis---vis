/* Vis-à-vis : Contrôles globaux : identifiants, doublons */
(function (V) {
  'use strict';
  const { R, adapter, allAddr, name, netParse } = V;

  /* ---------- Contrôles globaux ---------- */
  function globalChecks(A, B) {
    const res = [];
    const nA = name(A), nB = name(B);
    res.push(R('Global', 'Nom d’hôte', A.hostname && A.hostname === B.hostname ? 'warn' : (A.hostname && B.hostname ? 'ok' : 'info'), A.hostname || 'non trouvé', B.hostname || 'non trouvé',
      A.hostname && A.hostname === B.hostname ? 'Même nom des deux côtés : avez-vous collé deux fois la même configuration ?' : (A.hostname && B.hostname ? '' : 'Nom d’hôte introuvable dans une des configurations.')));
    const ids = d => adapter(d).routerIds(d);
    const ridA = ids(A).global, ridB = ids(B).global;
    const ospfR = d => ids(d).ospf;
    const bgpR = d => ids(d).bgp;
    if (ridA || ridB) res.push(R('Global', 'Router-ID', ridA && ridA === ridB ? 'err' : 'ok', ridA || 'non défini', ridB || 'non défini', ridA && ridA === ridB ? 'Router-ID identiques.' : ''));
    if (A.ospf.ifs.size && B.ospf.ifs.size) {
      const a = ospfR(A), b = ospfR(B);
      res.push(R('Global', 'Router-ID OSPF', a && a === b ? 'err' : (a && b ? 'ok' : 'info'), a || 'automatique', b || 'automatique', a && a === b ? 'Router-ID OSPF identiques : adjacence impossible et LSA en conflit.' : (a && b ? 'Router-ID distincts.' : 'Router-ID choisi automatiquement : fixez-le pour éviter les surprises au redémarrage.')));
    }
    if (A.bgp.neighbors.length && B.bgp.neighbors.length) {
      const a = bgpR(A), b = bgpR(B);
      if (a || b) res.push(R('Global', 'Router-ID BGP', a && a === b ? 'err' : 'ok', a || 'automatique', b || 'automatique', a && a === b ? 'Router-ID BGP identiques : la session iBGP est refusée.' : 'Router-ID distincts.'));
      res.push(R('Global', 'AS local', 'info', A.bgp.as || 'non défini', B.bgp.as || 'non défini', String(A.bgp.as) === String(B.bgp.as) ? 'Même AS : sessions iBGP.' : 'AS différents : sessions eBGP.'));
    }
    const sysA = A.isis.nets.map(netParse).filter(Boolean), sysB = B.isis.nets.map(netParse).filter(Boolean);
    if (sysA.length || sysB.length) {
      const dup = sysA.some(x => sysB.some(y => y.sys === x.sys));
      res.push(R('Global', 'NET IS-IS', dup ? 'err' : (sysA.length && sysB.length ? 'ok' : 'warn'), A.isis.nets.join(', ') || 'absent', B.isis.nets.join(', ') || 'absent',
        dup ? 'System-ID identiques : adjacence impossible.' : (sysA.length && sysB.length ? 'System-ID distincts.' : 'NET absent d’un côté : IS-IS ne démarrera pas.')));
    }
    const lsrA = ids(A).lsr, lsrB = ids(B).lsr;
    if ((A.ldp.size || B.ldp.size) && (lsrA || lsrB)) res.push(R('Global', 'LSR-ID MPLS', lsrA && lsrA === lsrB ? 'err' : 'ok', lsrA || 'non défini', lsrB || 'non défini', lsrA && lsrA === lsrB ? 'LSR-ID identiques : session LDP impossible.' : 'LSR-ID distincts.'));
    const ipsB = new Map(); for (const i of B.ifs.values()) for (const a of allAddr(i)) ipsB.set(a.ip, i.name);
    const dups = [];
    for (const i of A.ifs.values()) for (const a of allAddr(i)) if (ipsB.has(a.ip)) dups.push(`${a.ip} (${i.name} / ${ipsB.get(a.ip)})`);
    res.push(R('Global', 'Adresses en double', dups.length ? 'err' : 'ok', dups.length ? dups.length + ' conflit(s)' : 'aucune', dups.length ? dups.length + ' conflit(s)' : 'aucune', dups.length ? 'Adresses présentes des deux côtés : ' + dups.join(', ') + '.' : 'Aucune adresse IP n’est utilisée deux fois.'));
    if (A.lldp.enabled !== B.lldp.enabled) res.push(R('Global', 'LLDP', 'info', A.lldp.enabled ? 'activé' + (adapter(A).lldpDefault ? ' (défaut)' : '') : 'désactivé', B.lldp.enabled ? 'activé' + (adapter(B).lldpDefault ? ' (défaut)' : '') : 'désactivé', 'LLDP n’est actif que d’un côté : pas de vue des voisins pour le dépannage.'));
    return res;
  }

  Object.assign(V, { globalChecks });
})(globalThis.VAV = globalThis.VAV || {});
