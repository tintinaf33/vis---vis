/* Vis-à-vis : Contrôles des sessions BGP */
(function (V) {
  'use strict';
  const { R, adapter, cmpSecret, connectedIf, fmtSecret, name, ownerOf, sourceIp } = V;

  /* ---------- BGP ---------- */
  function findSessions(A, B) {
    const S = [];
    for (const n of A.bgp.neighbors) {
      if (!ownerOf(B, n.ip)) continue;
      const src = sourceIp(A, n);
      const m = B.bgp.neighbors.find(m => src.ip && m.ip === src.ip && ownerOf(A, m.ip))
        || B.bgp.neighbors.find(m => ownerOf(A, m.ip) && sourceIp(B, m).ip === n.ip && !S.some(s => s.b === m));
      S.push({ a: n, b: m || null });
    }
    for (const m of B.bgp.neighbors) {
      if (!ownerOf(A, m.ip) || S.some(s => s.b === m)) continue;
      S.push({ a: null, b: m });
    }
    return S;
  }
  const FAM_LABEL = { 'ipv4-unicast': 'IPv4 unicast', 'ipv6-unicast': 'IPv6 unicast', vpnv4: 'VPNv4', vpnv6: 'VPNv6', evpn: 'EVPN', l2vpn: 'L2VPN', 'ipv4-labeled': 'IPv4 labeled', 'ipv6-labeled': 'IPv6 labeled (6PE)', flowspec: 'Flowspec', rtc: 'Route-target', 'ipv4-multicast': 'IPv4 multicast' };
  const famL = s => [...s].map(f => FAM_LABEL[f] || f).join(', ') || 'aucune';
  function checkSession(A, B, s) {
    const res = []; const n = s.a, m = s.b;
    if (!n || !m) {
      const who = n ? A : B, x = n || m;
      res.push(R('BGP', 'Réciprocité', 'err', n ? 'neighbor ' + n.ip : 'absent', m ? 'peer ' + m.ip : 'absent', `Session déclarée uniquement sur ${name(who)} (vers ${x.ip}) : elle restera en Active/Connect.`));
      return res;
    }
    res.push(R('BGP', 'Réciprocité', 'ok', 'neighbor ' + n.ip, 'peer ' + m.ip, 'Session déclarée des deux côtés.'));
    const sa = sourceIp(A, n), sb = sourceIp(B, m);
    const addrProbs = [];
    if (sa.ip && sa.ip !== m.ip) addrProbs.push(`${name(A)} source depuis ${sa.ip} (${sa.how}), mais ${name(B)} attend ${m.ip}`);
    if (sb.ip && sb.ip !== n.ip) addrProbs.push(`${name(B)} source depuis ${sb.ip} (${sb.how}), mais ${name(A)} attend ${n.ip}`);
    if (!sa.ip && !connectedIf(A, n.ip)) addrProbs.push(`${name(A)} : définissez « local-address » pour une session entre loopbacks`);
    if (!sb.ip && !connectedIf(B, m.ip)) addrProbs.push(`${name(B)} : définissez « peer ${m.ip} connect-interface » pour une session entre loopbacks`);
    res.push(R('BGP', 'Adresses de session', addrProbs.length ? 'err' : 'ok', `${sa.ip || '?'} → ${n.ip}`, `${sb.ip || '?'} → ${m.ip}`, addrProbs.length ? addrProbs.join(' ; ') + '. La connexion TCP sera refusée.' : 'Chaque côté source depuis l’adresse attendue par l’autre.'));
    const lasA = n.localAs || A.bgp.as, lasB = m.localAs || B.bgp.as;
    const pA = n.peerAs, pB = m.peerAs;
    const asOk1 = pA && String(pA) === String(lasB), asOk2 = pB && String(pB) === String(lasA);
    res.push(R('BGP', `AS attendu pour ${name(B)}`, asOk1 ? 'ok' : 'err', pA ? 'peer-as ' + pA : 'peer-as absent', 'AS local ' + (lasB || '?'), asOk1 ? 'Correspond.' : `${name(A)} attend l’AS ${pA || '?'} mais ${name(B)} s’annonce en ${lasB || '?'} : NOTIFICATION « Bad Peer AS ».`));
    res.push(R('BGP', `AS attendu pour ${name(A)}`, asOk2 ? 'ok' : 'err', 'AS local ' + (lasA || '?'), pB ? 'as-number ' + pB : 'as-number absent', asOk2 ? 'Correspond.' : `${name(B)} attend l’AS ${pB || '?'} mais ${name(A)} s’annonce en ${lasA || '?'} : NOTIFICATION « Bad Peer AS ».`));
    const ibgp = String(lasA) === String(lasB);
    const typeIssues = [];
    if (n.type === 'internal' && !ibgp) typeIssues.push(`${name(A)} : groupe « type internal » pour une session eBGP`);
    if (n.type === 'external' && ibgp) typeIssues.push(`${name(A)} : groupe « type external » pour une session iBGP`);
    if (!n.type && adapter(A).bgpRequiresGroupType) typeIssues.push(`${name(A)} : « type » non défini sur le groupe ${n.group}`);
    res.push(R('BGP', 'Type de session', typeIssues.length ? 'err' : 'ok', (n.type || '?') + (n.group ? ' (groupe ' + n.group + ')' : ''), (m.type || (ibgp ? 'internal' : 'external')) + (m.group ? ' (groupe ' + m.group + ')' : ''), typeIssues.length ? typeIssues.join(' ; ') + '.' : (ibgp ? 'iBGP' : 'eBGP') + ' cohérent.'));
    if (!ibgp) {
      const dA = !!connectedIf(A, n.ip), dB = !!connectedIf(B, m.ip);
      const needA = !dA && !n.multihop, needB = !dB && !m.multihop;
      if (!dA || !dB || n.multihop || m.multihop) {
        res.push(R('BGP', 'Multihop eBGP', needA || needB ? 'err' : 'ok',
          dA ? 'voisin direct' : (n.multihop ? 'multihop' + (n.ttl ? ' ttl ' + n.ttl : '') : 'multihop absent'),
          dB ? 'voisin direct' : (m.multihop ? 'ebgp-max-hop ' + (m.ttl || '') : 'ebgp-max-hop absent'),
          needA || needB ? [needA ? `${name(A)} : ajoutez « multihop ttl 2 »` : '', needB ? `${name(B)} : ajoutez « peer ${m.ip} ebgp-max-hop 2 »` : ''].filter(Boolean).join(' ; ') + '. Sans cela, les paquets eBGP partent avec un TTL de 1.' : 'TTL suffisant pour atteindre le voisin.'));
      }
    }
    const c = cmpSecret(n.auth, m.auth);
    res.push(R('BGP', 'Mot de passe MD5', c.sev, fmtSecret(n.auth), fmtSecret(m.auth), c.msg));
    const explicit = x => x.families && x.families.size;
    const famOf = (d, x) => adapter(d).bgpRequiresAfEnable ? (x.families || new Set()) : (explicit(x) ? x.families : new Set([x.ip.includes(':') ? 'ipv6-unicast' : 'ipv4-unicast']));
    const fA = famOf(A, n), fB = famOf(B, m);
    const empty = [[A, n, fA], [B, m, fB]].find(e => !e[2].size);
    const inter = [...fA].filter(f => fB.has(f)), onlyA = [...fA].filter(f => !fB.has(f)), onlyB = [...fB].filter(f => !fA.has(f));
    let fsev = 'ok', fmsg = 'Familles identiques.';
    if (empty) { fsev = 'err'; fmsg = `${name(empty[0])} : aucune famille activée pour ${empty[1].ip} (par exemple « peer ${empty[1].ip} enable » sous address-family) : aucune route n’est échangée.`; }
    else if (!inter.length) { fsev = 'err'; fmsg = 'Aucune famille d’adresses commune : la session tombera après l’OPEN.'; }
    else if (onlyA.length || onlyB.length) { fsev = 'warn'; fmsg = 'Familles non négociées : ' + [onlyA.length ? `${famL(onlyA)} (seulement ${name(A)})` : '', onlyB.length ? `${famL(onlyB)} (seulement ${name(B)})` : ''].filter(Boolean).join(', ') + '.'; }
    res.push(R('BGP', 'Familles d’adresses', fsev, famL(fA) + (explicit(n) || adapter(A).bgpRequiresAfEnable ? '' : ' (défaut)'), famL(fB) + (explicit(m) || adapter(B).bgpRequiresAfEnable ? '' : ' (défaut)'), fmsg));
    const hA = n.hold ?? adapter(A).bgpHoldDefault, hB = m.hold ?? adapter(B).bgpHoldDefault;
    res.push(R('BGP', 'Hold time', hA === hB ? 'ok' : 'info', hA + ' s' + (n.hold == null ? ' (défaut)' : ''), hB + ' s' + (m.hold == null ? ' (défaut)' : ''), hA === hB ? 'Identique.' : `Différent : la valeur négociée sera ${Math.min(hA, hB)} s.`));
    if (n.bfd || m.bfd) res.push(R('BGP', 'BFD', n.bfd && m.bfd ? 'ok' : 'warn', n.bfd ? 'activé' : 'non', m.bfd ? 'activé' : 'non', n.bfd && m.bfd ? 'BFD des deux côtés.' : 'BFD d’un seul côté : pas de détection rapide de panne.'));
    if (n.shutdown || m.shutdown) res.push(R('BGP', 'État', 'warn', n.shutdown ? 'désactivée' : 'active', m.shutdown ? 'désactivée' : 'active', 'La session est désactivée administrativement.'));
    if (n.passive && m.passive) res.push(R('BGP', 'Ouverture TCP', 'err', 'passive', 'passive', 'Aucun côté n’initie la connexion.'));
    if (n.vrf || m.vrf) res.push(R('BGP', 'Instance', 'info', n.vrf || 'globale', m.vrf || 'globale', 'Session dans une VRF.'));
    return res;
  }

  Object.assign(V, { findSessions, FAM_LABEL, famL, checkSession });
})(globalThis.VAV = globalThis.VAV || {});
