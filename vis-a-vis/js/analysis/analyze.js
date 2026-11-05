/* Vis-à-vis : Point d’entrée de l’analyse et résumés pour l’interface */
(function (V) {
  'use strict';
  const { R, allAddr, checkLink, checkSession, cidr, findLinks, findSessions, globalChecks, ipMtu, isisOf, l3Ifs, mplsOf, name, natSort, ospfOf, parse, phys, sameNet, suggestPairs } = V;

  /* ---------- Analyse ---------- */
  function analyze(textA, textB, vendorA, vendorB, manual) {
    const A = parse(textA, vendorA), B = parse(textB, vendorB);
    if (!A || !B) return { error: !A && !B ? 'both' : (!A ? 'A' : 'B'), A, B };
    const links = findLinks(A, B);
    const sugg = suggestPairs(A, B, links);
    const lift = (D, i, other) => {
      if (!i || !other || allAddr(i).length || !allAddr(other).length) return i;
      const u = [...D.ifs.values()].find(x => x.parent === i.name && allAddr(x).some(a => allAddr(other).some(b => a.fam === b.fam && sameNet(a, b, Math.min(a.len, b.len)))));
      return u || i;
    };
    const man = (manual || []).map(p => {
      const a = A.ifs.get(p[0]), b = B.ifs.get(p[1]);
      return { a: lift(A, a, b), b: lift(B, b, a), how: 'manuel' };
    }).filter(p => p.a && p.b && !links.some(l => l.a === p.a && l.b === p.b));
    const all = [...links, ...sugg, ...man].map(l => ({ a: l.a, b: l.b, how: l.how, checks: checkLink(A, l.a, B, l.b) }));
    const sessions = findSessions(A, B).map(s => ({ a: s.a, b: s.b, checks: checkSession(A, B, s) }));
    const glob = globalChecks(A, B);
    for (const d of [A, B]) for (const nt of d.notes) glob.push(R('Lecture', 'Configuration ' + name(d), nt.sev, d === A ? nt.msg : '', d === B ? nt.msg : '', nt.msg));
    return { A, B, links: all, sessions, global: glob };
  }

  /* ---------- Résumé d'un équipement ---------- */
  function summary(dev) {
    const physC = [...dev.ifs.values()].filter(i => i.kind === 'phys').length;
    const l3 = l3Ifs(dev).length;
    const protos = [];
    if (dev.ospf.ifs.size) protos.push('OSPF');
    if (dev.ospf3.ifs.size) protos.push('OSPFv3');
    if (dev.isis.enabled) protos.push('IS-IS');
    if (dev.ldp.size) protos.push('LDP');
    if (dev.rsvp.size) protos.push('RSVP');
    if (dev.bgp.neighbors.length) protos.push('BGP (' + dev.bgp.neighbors.length + ' voisins)');
    return { physC, l3, protos };
  }
  function ifTable(dev) {
    return [...dev.ifs.values()].filter(i => i.kind !== 'phys' || allAddr(i).length || i.desc || i.lag || i.linkType || i.l2)
      .sort((a, b) => natSort(a.name, b.name)).map(i => {
        const o = ospfOf(dev, i), s = isisOf(dev, i), m = mplsOf(dev, i);
        return { name: i.name, desc: i.desc, ip: allAddr(i).map(cidr).join(', '), mtu: allAddr(i).length ? ipMtu(dev, i).v : '', vlan: i.vlanId ?? (i.kind === 'vlanif' ? i.name.replace(/\D+/g, '') : ''),
          lag: i.lag || (i.kind === 'lag' ? (i.lacpMode || '') : ''), ospf: o ? o.area + (o.passive ? ' (passive)' : '') : '', isis: s ? [...s.levels].map(l => 'L' + l).join('+') : '', ldp: m.ldp ? 'oui' : '', off: i.disabled };
      });
  }
  function pairable(dev) {
    return [...dev.ifs.values()].filter(i => i.kind === 'phys' || i.kind === 'lag' || allAddr(i).length).map(i => i.name).sort(natSort);
  }

  Object.assign(V, { analyze, summary, ifTable, pairable });
})(globalThis.VAV = globalThis.VAV || {});
