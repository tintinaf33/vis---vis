/* Vis-à-vis : Point d’entrée de l’analyse et résumés pour l’interface */
(function (V) {
  'use strict';
  const { commonChecks, l3Cfg, encapOf, serviceChecks, R, probableLinks, mentions, lagOf, isMgmt, allAddr, checkLink, checkSession, cidr, findLinks, findSessions, globalChecks, ipMtu, isisOf, l3Ifs, mplsOf, name, natSort, ospfOf, parse, phys, sameNet, suggestPairs } = V;

  /* ---------- Analyse ---------- */
  function analyze(textA, textB, vendorA, vendorB, manual) {
    const A = parse(textA, vendorA), B = parse(textB, vendorB);
    if (!A || !B) return { error: !A && !B ? 'both' : (!A ? 'A' : 'B'), A, B };
    const direct = findLinks(A, B);
    const links = [...direct, ...probableLinks(A, B, direct)];
    // Ports rapprochés par leurs descriptions : on compare leurs unités routées (adressage, OSPF, MPLS…)
    // plutôt que le seul port physique, sinon une adresse absente ou mal formée passerait inaperçue.
    const unitsOf = (D, p) => {
      if (l3Cfg(p)) return [p];
      return [...D.ifs.values()].filter(u => u.parent === p.name && (l3Cfg(u) || ospfOf(D, u) || mplsOf(D, u).ldp));
    };
    const sugg = [];
    for (const pr of suggestPairs(A, B, links)) {
      const ua = unitsOf(A, pr.a), ub = unitsOf(B, pr.b);
      if (ua.length && ub.length) {
        if (ua.length === 1 && ub.length === 1) { sugg.push({ a: ua[0], b: ub[0], how: 'description' }); continue; }
        const key = (D, u) => encapOf(D, u).tag ?? encapOf(D, u).vlanif ?? u.unit ?? '0';
        let paired = false;
        for (const u of ua) { const v = ub.find(w => String(key(B, w)) === String(key(A, u))); if (v) { sugg.push({ a: u, b: v, how: 'description' }); paired = true; } }
        if (paired) continue;
      }
      sugg.push(pr);
    }
    const lift = (D, i, other) => {
      if (!i || !other || allAddr(i).length || !allAddr(other).length) return i;
      const u = [...D.ifs.values()].find(x => x.parent === i.name && allAddr(x).some(a => allAddr(other).some(b => a.fam === b.fam && sameNet(a, b, Math.min(a.len, b.len)))));
      return u || i;
    };
    const man = (manual || []).map(p => {
      const a = A.ifs.get(p[0]), b = B.ifs.get(p[1]);
      return { a: lift(A, a, b), b: lift(B, b, a), how: 'manuel' };
    }).filter(p => p.a && p.b && !links.some(l => l.a === p.a && l.b === p.b));
    const all = [...links, ...sugg, ...man].map(l => ({ a: l.a, b: l.b, how: l.how, why: l.why || null, checks: checkLink(A, l.a, B, l.b) }));
    const left = { A: unmatched(A, B, all, 'a'), B: unmatched(B, A, all, 'b') };
    const sessions = findSessions(A, B).map(s => ({ a: s.a, b: s.b, checks: checkSession(A, B, s) }));
    const glob = [];
    // Anomalies de syntaxe ou de valeur, en tête des contrôles globaux
    for (const D of [A, B]) for (const x of D.issues) glob.push(R('Syntaxe', 'Lecture de ' + name(D), x.sev, D === A ? x.msg : '—', D === B ? x.msg : '—', x.msg));
    glob.push(...globalChecks(A, B));
    for (const d of [A, B]) for (const nt of d.notes) glob.push(R('Lecture', 'Configuration ' + name(d), nt.sev, d === A ? nt.msg : '', d === B ? nt.msg : '', nt.msg));
    for (const [D, O, side] of [[A, B, 'A'], [B, A, 'B']]) for (const u of left[side].filter(u => u.toPeer)) {
      glob.push(R('Couverture', 'Interface non comparée', 'warn', side === 'A' ? u.name : '—', side === 'B' ? u.name : '—',
        `${u.name} (${u.detail}) est décrite comme allant vers ${name(O)}, mais aucune interface en face ne lui correspond. Vérifiez l’adressage ou ajoutez la paire à la main.`));
    }
    const svc = serviceChecks(A, B);
    glob.push(...svc.dev);
    // Gabarits : groupe défini des deux côtés mais appliqué d'un seul
    for (const g of A.groups.defined.filter(x => B.groups.defined.includes(x))) {
      const a = A.groups.applied.includes(g), b = B.groups.applied.includes(g);
      if (a !== b) glob.push(R('Gabarits', 'Groupe ' + g, 'warn', a ? 'appliqué' : 'défini, non appliqué', b ? 'appliqué' : 'défini, non appliqué',
        `Le groupe ${g} existe des deux côtés mais n’est appliqué que sur ${a ? name(A) : name(B)} : les deux équipements ne suivent pas le même gabarit.`));
    }
    if (A.ospf.ifs.size && B.ospf.ifs.size && (A.rsvp.size || B.rsvp.size) && A.sys.ospfTE !== B.sys.ospfTE) glob.push(R('Global', 'OSPF traffic-engineering', 'warn', A.sys.ospfTE ? 'activé' : 'non', B.sys.ospfTE ? 'activé' : 'non',
      'Extensions TE d’OSPF actives d’un seul côté : le calcul de chemin contraint (CSPF) des LSP RSVP sera incomplet.'));
    if (A.ospf.refBw || B.ospf.refBw) glob.push(R('Global', 'OSPF reference-bandwidth', (A.ospf.refBw || '') === (B.ospf.refBw || '') ? 'ok' : 'warn', A.ospf.refBw || 'défaut', B.ospf.refBw || 'défaut',
      (A.ospf.refBw || '') === (B.ospf.refBw || '') ? 'Même bande passante de référence.' : 'Bande passante de référence différente : les coûts automatiques ne sont pas calculés de la même façon.'));
    return { A, B, links: all, sessions, global: glob, common: commonChecks(A, B), unmatched: left, services: svc.pairs, localServices: svc.local };
  }

  /* Interfaces qui n'ont été comparées à rien : rien ne doit être ignoré en silence. */
  function unmatched(D, O, links, side) {
    const used = new Set();
    for (const l of links) {
      const i = side === 'a' ? l.a : l.b; used.add(i);
      const p = phys(D, i); if (p) used.add(p);
      const g = lagOf(D, i); if (g) used.add(g);
    }
    for (const i of D.ifs.values()) if (i.lag && used.has(D.ifs.get(i.lag))) used.add(i);
    const out = [];
    for (const i of D.ifs.values()) {
      if (used.has(i) || i.loopback || i.kind === 'loopback' || isMgmt(i) || isMgmt(phys(D, i))) continue;
      const ips = allAddr(i);
      const pd = i.parent && D.ifs.get(i.parent) ? D.ifs.get(i.parent).desc : '';
      const bad = i.badAddr || [];
      const toPeer = mentions(i.desc, O.hostname, D.hostname) || ((ips.length || bad.length) && mentions(pd, O.hostname, D.hostname));
      if (ips.length || bad.length) out.push({ name: i.name, detail: [ips.map(cidr).join(', '), bad.length ? `adresse mal formée « ${bad.join(', ')} »` : ''].filter(Boolean).join(', '), desc: i.desc || pd || '', toPeer: !!toPeer });
      else if ((i.kind === 'phys' || i.kind === 'lag') && !i.lag && mentions(i.desc, O.hostname, D.hostname)) out.push({ name: i.name, detail: 'sans adresse IP', desc: i.desc, toPeer: true });
    }
    return out.sort((a, b) => (b.toPeer - a.toPeer) || natSort(a.name, b.name));
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

  Object.assign(V, { analyze, unmatched, summary, ifTable, pairable });
})(globalThis.VAV = globalThis.VAV || {});
