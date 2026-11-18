/* Vis-à-vis : contrôles des services (VRF L3VPN, VPLS, EVPN) entre les deux équipements */
(function (V) {
  'use strict';
  const { R, name } = V;

  const TYPE = { vrf: 'VRF (L3VPN)', vpls: 'VPLS', evpn: 'EVPN', 'mac-vrf': 'MAC-VRF', l2vpn: 'L2VPN', 'virtual-router': 'virtual-router', 'virtual-switch': 'virtual-switch' };
  const typeLabel = t => TYPE[t] || t || 'type non précisé';
  const FAM_NEED = { vrf: 'vpnv4', vpls: 'l2vpn', l2vpn: 'l2vpn', evpn: 'evpn', 'mac-vrf': 'evpn' };
  const FAM_TXT = { vpnv4: 'VPNv4 (inet-vpn)', l2vpn: 'L2VPN (l2vpn signaling)', evpn: 'EVPN' };
  const rtList = s => [...s].sort().join(', ') || 'aucun';
  const hasFam = (D, f) => D.bgp.neighbors.some(n => n.families && n.families.has(f));

  // Deux instances forment un même service si l'une importe ce que l'autre exporte, ou si elles portent le même nom
  function servicePairs(A, B) {
    const out = [];
    for (const a of A.instances.values()) for (const b of B.instances.values()) {
      const share = [...a.rtExport].some(x => b.rtImport.has(x)) || [...b.rtExport].some(x => a.rtImport.has(x));
      if (share || a.name === b.name) out.push({ a, b });
    }
    return out;
  }

  function checkService(A, B, a, b) {
    const res = [], nA = name(A), nB = name(B);
    res.push(R('Service', 'Type', a.type === b.type ? 'ok' : 'err', typeLabel(a.type), typeLabel(b.type),
      a.type === b.type ? 'Même type de service.' : 'Types de service différents : les deux instances ne peuvent pas échanger de routes.'));
    const ab = [...a.rtExport].filter(x => b.rtImport.has(x)), ba = [...b.rtExport].filter(x => a.rtImport.has(x));
    res.push(R('Service', 'Route-targets', ab.length && ba.length ? 'ok' : 'err', `import ${rtList(a.rtImport)} ; export ${rtList(a.rtExport)}`, `import ${rtList(b.rtImport)} ; export ${rtList(b.rtExport)}`,
      ab.length && ba.length ? 'Chaque côté importe les route-targets exportés par l’autre.'
        : [!ab.length ? `${nB} n’importe aucun route-target exporté par ${nA}` : '', !ba.length ? `${nA} n’importe aucun route-target exporté par ${nB}` : ''].filter(Boolean).join(' ; ') + ' : le service ne passera pas dans ce sens.'));
    const rdSev = !a.rd || !b.rd ? 'err' : (a.rd === b.rd ? 'info' : 'ok');
    res.push(R('Service', 'Route-distinguisher', rdSev, a.rd || 'absent', b.rd || 'absent',
      rdSev === 'err' ? 'Route-distinguisher absent : l’instance ne peut pas annoncer ses routes.' : rdSev === 'info' ? 'RD identiques : fonctionne, mais un RD propre à chaque équipement est recommandé (multi-chemin, réflecteurs de routes).' : 'RD distincts.'));
    if (a.type === 'vpls' || b.type === 'vpls') {
      const ids = I => I.sites.map(x => x.id).filter(Boolean);
      const dupId = ids(a).filter(x => ids(b).includes(x));
      const dupName = a.sites.map(x => x.name).filter(n => b.sites.some(y => y.name === n));
      const missing = !ids(a).length || !ids(b).length;
      const st = I => I.sites.map(x => `${x.name} (id ${x.id || '?'})`).join(', ') || 'aucun';
      res.push(R('Service', 'Site VPLS', dupId.length || dupName.length || missing ? 'err' : 'ok', st(a), st(b),
        dupId.length ? `Même site-identifier (${dupId.join(', ')}) des deux côtés : collision de site, le pseudo-wire ne montera pas.`
          : dupName.length ? `Même nom de site (${dupName.join(', ')}) des deux côtés : collision de site VPLS.`
            : missing ? 'Site VPLS absent d’un côté : l’instance ne peut pas participer au VPLS.' : 'Sites distincts.'));
      if (a.vlanId || b.vlanId) res.push(R('Service', 'Normalisation VLAN', (a.vlanId || 'aucune') === (b.vlanId || 'aucune') ? 'ok' : 'warn', a.vlanId || 'aucune', b.vlanId || 'aucune',
        (a.vlanId || 'aucune') === (b.vlanId || 'aucune') ? 'Identique.' : 'Normalisation VLAN différente : les trames peuvent être rejetées ou mal étiquetées en sortie.'));
    }
    const f = FAM_NEED[a.type];
    if (f) {
      const fa = hasFam(A, f), fb = hasFam(B, f);
      res.push(R('Service', 'Famille BGP requise', fa && fb ? 'ok' : 'err', fa ? FAM_TXT[f] + ' activée' : 'absente', fb ? FAM_TXT[f] + ' activée' : 'absente',
        fa && fb ? `La famille ${FAM_TXT[f]} est activée sur les sessions BGP des deux équipements.` : `Sans famille ${FAM_TXT[f]} sur ses sessions BGP, ${fa ? nB : nA} ne peut pas annoncer ce service.`));
    }
    res.push(R('Service', 'Interfaces attachées', a.ifaces.length && b.ifaces.length ? 'ok' : 'warn', a.ifaces.join(', ') || 'aucune', b.ifaces.join(', ') || 'aucune',
      a.ifaces.length && b.ifaces.length ? '' : `Aucune interface attachée sur ${!a.ifaces.length ? nA : nB} : le service n’a pas d’accès client de ce côté.`));
    return res;
  }

  function serviceChecks(A, B) {
    const pairs = servicePairs(A, B).map(p => ({ a: p.a, b: p.b, checks: checkService(A, B, p.a, p.b) }));
    const local = [];
    for (const [D, side] of [[A, 'A'], [B, 'B']]) for (const I of D.instances.values()) {
      if (pairs.some(p => p[side.toLowerCase()] === I)) continue;
      local.push({ side, name: I.name, type: typeLabel(I.type), rt: rtList(new Set([...I.rtImport, ...I.rtExport])), ifaces: I.ifaces.join(', ') || 'aucune' });
    }
    const dev = [];
    for (const D of [A, B]) for (const I of D.instances.values()) {
      const f = FAM_NEED[I.type];
      if (f && D.bgp.neighbors.length && !hasFam(D, f)) dev.push(R('Services', 'Famille BGP pour ' + I.name, 'err', D === A ? `${typeLabel(I.type)} sans ${FAM_TXT[f]}` : '—', D === B ? `${typeLabel(I.type)} sans ${FAM_TXT[f]}` : '—',
        `${name(D)} : l’instance ${I.name} a besoin de la famille BGP ${FAM_TXT[f]} sur au moins une session pour être annoncée.`));
    }
    return { pairs, local, dev };
  }

  Object.assign(V, { serviceChecks, typeLabel });
})(globalThis.VAV = globalThis.VAV || {});
