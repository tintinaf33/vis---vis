/* Vis-à-vis : Contrôles par lien : adressage, MTU, VLAN, LACP, OSPF, IS-IS, MPLS */
(function (V) {
  'use strict';
  const { R, adapter, allAddr, carriers, cidr, cmpSecret, encapOf, fmtSecret, fmtSpeed, fmtVlans, ipMtu, isisOf, l2Profile, l3Ifs, lagOf, lenMask, members, mplsOf, name, net4, netParse, ospfOf, phys, sameNet, v4str } = V;

  /* ---------- Résultats ---------- */

  function findLinks(A, B) {
    const links = [], seen = new Set();
    for (const ia of l3Ifs(A)) for (const ib of l3Ifs(B)) {
      for (const x of allAddr(ia)) for (const y of allAddr(ib)) {
        if (x.fam !== y.fam) continue;
        const host = x.fam === 4 ? 32 : 128;
        if (x.len >= host && y.len >= host) continue;
        if (x.fam === 6 && /^fe80/i.test(x.ip)) continue;
        const l = Math.min(x.len, y.len);
        if (l < (x.fam === 4 ? 8 : 16)) continue;
        if (!sameNet(x, y, l)) continue;
        const key = ia.name + '|' + ib.name;
        if (seen.has(key)) continue;
        seen.add(key); links.push({ a: ia, b: ib, how: 'auto', x, y });
      }
    }
    return links;
  }
  const ifVariants = (dev, n) => adapter(dev).ifAliases(n);
  function suggestPairs(A, B, existing) {
    const out = [];
    if (!A.hostname || !B.hostname) return out;
    const has = (d, s) => d && s && d.toLowerCase().includes(s.toLowerCase());
    const cands = d => [...d.ifs.values()].filter(i => (i.kind === 'phys' || i.kind === 'lag') && !i.lag && i.desc);
    for (const ia of cands(A)) {
      if (!has(ia.desc, B.hostname)) continue;
      for (const ib of cands(B)) {
        if (!has(ib.desc, A.hostname)) continue;
        const ok = ifVariants(B, ib.name).some(v => ia.desc.toLowerCase().includes(v)) || ifVariants(A, ia.name).some(v => ib.desc.toLowerCase().includes(v));
        if (!ok) continue;
        if (existing.some(l => (phys(A, l.a) === ia && phys(B, l.b) === ib) || (l.a === ia && l.b === ib))) continue;
        out.push({ a: ia, b: ib, how: 'description' });
      }
    }
    return out;
  }

  function checkLink(A, ia, B, ib) {
    const res = [];
    const nA = name(A), nB = name(B);
    // --- Adressage
    for (const fam of [4, 6]) {
      const xs = fam === 4 ? ia.v4 : ia.v6, ys = fam === 4 ? ib.v4 : ib.v6;
      if (!xs.length && !ys.length) continue;
      const lab = fam === 4 ? 'Adresse IPv4' : 'Adresse IPv6';
      let pair = null;
      for (const x of xs) for (const y of ys) { const l = Math.min(x.len, y.len); if (!pair && sameNet(x, y, l)) pair = [x, y]; }
      if (!pair) {
        if (xs.length && ys.length) res.push(R('Adressage', lab, 'err', xs.map(cidr).join(', '), ys.map(cidr).join(', '), 'Aucune adresse dans le même sous-réseau.'));
        else res.push(R('Adressage', lab, fam === 4 ? 'warn' : 'info', xs.map(cidr).join(', ') || 'aucune', ys.map(cidr).join(', ') || 'aucune', `IPv${fam} n’est configuré que d’un côté.`));
        continue;
      }
      const [x, y] = pair;
      if (x.n === y.n) { res.push(R('Adressage', lab, 'err', cidr(x), cidr(y), 'Adresse identique des deux côtés : conflit IP.')); continue; }
      if (x.len !== y.len) { res.push(R('Adressage', lab, 'err', cidr(x), cidr(y), `Masques différents (/${x.len} et /${y.len}) : les deux côtés n’ont pas la même vision du sous-réseau.`)); continue; }
      if (fam === 4 && x.len <= 30) {
        const bad = a => { const h = (~lenMask(a.len)) >>> 0; const host = (a.n & h) >>> 0; return host === 0 || host === h; };
        if (bad(x) || bad(y)) { res.push(R('Adressage', lab, 'err', cidr(x), cidr(y), 'Une adresse correspond à l’adresse réseau ou de broadcast du sous-réseau.')); continue; }
      }
      const netS = fam === 4 ? v4str(net4(x.n, x.len)) + '/' + x.len : 'préfixe /' + x.len;
      res.push(R('Adressage', lab, 'ok', cidr(x), cidr(y), 'Même sous-réseau : ' + netS + '.'));
    }
    const hasIp = allAddr(ia).length && allAddr(ib).length;
    if ((ia.vrf || ib.vrf) && hasIp) res.push(R('Adressage', 'Table de routage', 'info', ia.vrf || 'globale', ib.vrf || 'globale', 'Les noms de VRF sont locaux ; vérifiez qu’il s’agit bien du même service.'));

    // --- État administratif
    const pa = phys(A, ia), pb = phys(B, ib);
    const offA = ia.disabled || (pa && pa.disabled), offB = ib.disabled || (pb && pb.disabled);
    res.push(R('Interface', 'État administratif', offA || offB ? 'warn' : 'ok', offA ? 'désactivée' : 'active', offB ? 'désactivée (shutdown)' : 'active',
      offA || offB ? 'Une interface est désactivée : le lien ne montera pas.' : 'Les deux interfaces sont actives.'));

    // --- Encapsulation VLAN (lien L3)
    if (hasIp) {
      const ea = encapOf(A, ia), eb = encapOf(B, ib);
      if (ea.broken || eb.broken) res.push(R('Interface', 'Encapsulation', 'err', ea.label, eb.label, 'Une sous-interface est déclarée sans identifiant de VLAN.'));
      else if (eb.vlanif != null || ea.vlanif != null) {
        const [ej, ec, dc, side] = eb.vlanif != null ? [ea, eb, B, 'B'] : [eb, ea, A, 'A'];
        const v = ec.vlanif; const car = carriers(dc, v);
        const tagNeed = ej.tag != null;
        if (tagNeed && ej.tag !== v) res.push(R('Interface', 'Encapsulation', 'err', side === 'B' ? ea.label : eb.label, side === 'B' ? eb.label : ea.label, `Trames taguées VLAN ${ej.tag} en face d’une interface VLAN ${v} : elles n’arriveront pas dans le bon VLAN.`));
        else {
          const good = car.filter(c => c.tagged === tagNeed);
          const msg = good.length
            ? `VLAN ${v} transporté ${tagNeed ? 'tagué' : 'non tagué'} par : ${good.map(c => c.name).join(', ')}.`
            : car.length ? `Le VLAN ${v} est bien sur ${car.map(c => c.name).join(', ')}, mais ${tagNeed ? 'non tagué' : 'tagué'} : l’encapsulation ne correspond pas.`
              : `Aucun port ne transporte le VLAN ${v} : le lien ne peut pas fonctionner.`;
          res.push(R('Interface', 'Encapsulation', good.length ? 'ok' : 'err', ea.label, eb.label, msg));
        }
      } else if ((ea.tag ?? null) !== (eb.tag ?? null)) {
        res.push(R('Interface', 'Encapsulation', 'err', ea.label, eb.label, ea.tag != null && eb.tag != null ? 'Les identifiants de VLAN sont différents.' : 'Un côté tague les trames, l’autre non.'));
      } else res.push(R('Interface', 'Encapsulation', 'ok', ea.label, eb.label, 'Encapsulation identique.'));
    }

    // --- MTU
    const oA = ospfOf(A, ia), oB = ospfOf(B, ib), sA = isisOf(A, ia), sB = isisOf(B, ib);
    if (hasIp) {
      const ma = ipMtu(A, ia), mb = ipMtu(B, ib);
      if (ma.v === mb.v) res.push(R('Interface', 'MTU IP', 'ok', `${ma.v} (${ma.how})`, `${mb.v} (${mb.how})`, 'MTU IP identique.'));
      else {
        let sev = 'warn', msg = 'MTU IP différente : risque de pertes sur les gros paquets (MPLS, VPN, jumbo).';
        if (oA && oB) {
          const silent = [[A, oA], [B, oB]].filter(([d, o]) => !adapter(d).ospfAdvertisesMtu(o));
          if (!silent.length) { sev = 'err'; msg = 'MTU IP différente : l’adjacence OSPF restera bloquée en ExStart/Exchange.'; }
          else msg = 'MTU IP différente. ' + silent.map(([d]) => `${name(d)} n’annonce pas sa MTU dans les paquets DD${adapter(d).ospfMtuHint ? ' (' + adapter(d).ospfMtuHint + ')' : ''}`).join(' ; ') + ', donc l’adjacence monte quand même, mais les gros paquets seront perdus.';
        }
        if (sA && sB) { const isisMsg = 'IS-IS : les hellos sont complétés à la MTU, l’adjacence sera refusée par le côté à plus petite MTU.'; msg = sev === 'err' || (oA && oB) ? msg + ' ' + isisMsg : 'MTU IP différente. ' + isisMsg; sev = 'err'; }
        res.push(R('Interface', 'MTU IP', sev, `${ma.v} (${ma.how})`, `${mb.v} (${mb.how})`, msg));
      }
    }

    // --- Agrégats
    const la = lagOf(A, ia), lb = lagOf(B, ib);
    if (la || lb) {
      if (!la || !lb) res.push(R('Agrégat', 'Type de lien', ib.kind === 'vlanif' || ia.kind === 'vlanif' ? 'info' : 'warn', la ? la.name : 'interface simple', lb ? lb.name : 'interface simple',
        ib.kind === 'vlanif' || ia.kind === 'vlanif' ? 'L’autre côté est une interface VLAN : comparez l’agrégat via une paire manuelle.' : 'Un côté est un agrégat, l’autre une interface simple.'));
      else {
        const ma = la.lacpMode || 'static', mb = lb.lacpMode || 'static';
        const lab = m => m === 'static' ? 'statique (sans LACP)' : 'LACP ' + m;
        if (ma === 'static' || mb === 'static') res.push(R('Agrégat', 'Mode', ma === mb ? 'warn' : 'err', lab(ma), lab(mb), ma === mb ? 'Agrégat statique des deux côtés : fonctionne, mais aucune détection de mauvais câblage.' : 'LACP d’un côté, statique de l’autre : l’agrégat ne montera pas correctement.'));
        else if (ma === 'passive' && mb === 'passive') res.push(R('Agrégat', 'Mode', 'err', lab(ma), lab(mb), 'LACP passif des deux côtés : personne n’initie la négociation.'));
        else res.push(R('Agrégat', 'Mode', 'ok', lab(ma), lab(mb), 'Modes LACP compatibles.'));
        if (ma !== 'static' && mb !== 'static') {
          const pA = la.lacpPeriod || 'slow', pB = lb.lacpPeriod || 'slow';
          const lp = p => p === 'fast' ? 'rapide (1 s)' : 'lente (30 s)';
          res.push(R('Agrégat', 'Cadence LACP', pA === pB ? 'ok' : 'warn', lp(pA), lp(pB), pA === pB ? 'Même cadence.' : 'Cadences différentes : l’agrégat fonctionne, mais la détection de panne est asymétrique. Junos est en rapide par défaut, HPE en lente (« lacp period short » pour aligner).'));
        }
        const mA = members(A, la), mB = members(B, lb);
        const sevM = !mA.length || !mB.length ? 'err' : (mA.length === mB.length ? 'ok' : 'warn');
        res.push(R('Agrégat', 'Membres', sevM, `${mA.length} : ${mA.join(', ') || 'aucun'}`, `${mB.length} : ${mB.join(', ') || 'aucun'}`,
          sevM === 'err' ? 'Un agrégat n’a aucun membre.' : sevM === 'warn' ? 'Nombre de membres différent : vérifiez le câblage.' : 'Même nombre de membres.'));
        if (la.minLinks || lb.minLinks) res.push(R('Agrégat', 'Liens minimum', (la.minLinks || 1) === (lb.minLinks || 1) ? 'ok' : 'info', la.minLinks || 1, lb.minLinks || 1, 'Seuil sous lequel l’agrégat tombe.'));
      }
    }

    // --- Vitesse / duplex
    const qa = la || pa, qb = lb || pb;
    if (qa && qb && qa.kind !== 'vlanif' && qb.kind !== 'vlanif' && (qa.speed != null || qb.speed != null || qa.duplex || qb.duplex)) {
      const spA = qa.speed, spB = qb.speed;
      if (spA != null || spB != null) {
        const sev = spA != null && spB != null && spA !== 'auto' && spB !== 'auto' ? (spA === spB ? 'ok' : 'err') : (spA === spB ? 'ok' : 'warn');
        res.push(R('Interface', 'Vitesse', sev, fmtSpeed(spA), fmtSpeed(spB), sev === 'ok' ? 'Vitesses cohérentes.' : sev === 'err' ? 'Vitesses forcées différentes : pas de lien.' : 'Vitesse forcée d’un seul côté : la négociation peut échouer.'));
      }
      const dA = qa.duplex || 'auto', dB = qb.duplex || 'auto';
      if (qa.duplex || qb.duplex) res.push(R('Interface', 'Duplex', dA === dB ? 'ok' : 'warn', dA, dB, dA === dB ? 'Duplex identique.' : 'Duplex forcé d’un côté ou différent : risque de duplex mismatch (erreurs CRC, collisions tardives).'));
    }

    // --- Niveau 2 (paires physiques)
    if (!hasIp) {
      const L = l2Profile(A, pa), M = l2Profile(B, pb);
      if (L && M && !(L.mode === 'non configuré' && M.mode === 'non configuré')) {
        res.push(R('Niveau 2', 'Mode du port', 'info', L.mode, M.mode, ''));
        const u = x => x == null ? 'aucun (rejeté)' : x === 'L3' ? 'routé (non tagué)' : 'VLAN ' + x;
        const uA = L.untagged, uB = M.untagged;
        let sev = 'ok', msg = 'Trafic non tagué cohérent.';
        if (uA == null && uB == null) msg = 'Pas de trafic non tagué des deux côtés.';
        else if (uA == null || uB == null) { sev = 'warn'; msg = `Le trafic non tagué (${u(uA ?? uB)}) envoyé par ${uA == null ? nB : nA} sera rejeté en face.`; }
        else if (uA === 'L3' || uB === 'L3') msg = 'Côté routé ↔ VLAN non tagué : cohérent si c’est voulu.';
        else if (uA !== uB) { sev = 'err'; msg = `VLAN natif/accès différent : le VLAN ${uA} de ${nA} fusionne avec le VLAN ${uB} de ${nB}.`; }
        res.push(R('Niveau 2', 'VLAN non tagué', sev, u(uA), u(uB), msg));
        const tA = L.tagged, tB = M.tagged;
        if (tA === 'all' || tB === 'all') res.push(R('Niveau 2', 'VLAN tagués', 'info', fmtVlans(tA), fmtVlans(tB), '« Tous les VLAN » d’un côté : vérifiez que la liste de l’autre côté est complète.'));
        else if (tA.size || tB.size) {
          const onlyA = [...tA].filter(v => !tB.has(v)), onlyB = [...tB].filter(v => !tA.has(v));
          const ok = !onlyA.length && !onlyB.length;
          res.push(R('Niveau 2', 'VLAN tagués', ok ? 'ok' : 'warn', fmtVlans(tA), fmtVlans(tB),
            ok ? 'Mêmes VLAN autorisés.' : [onlyA.length ? `Seulement côté ${nA} : ${fmtVlans(onlyA)}.` : '', onlyB.length ? `Seulement côté ${nB} : ${fmtVlans(onlyB)}.` : ''].filter(Boolean).join(' ')));
        }
      }
      // MTU L2 (info)
      if (pa && pb && (pa.mtu || pb.mtu || pb.jumbo || pa.jumbo)) {
        const fa = adapter(A).frameLabel(pa), fb = adapter(B).frameLabel(pb);
        res.push(R('Niveau 2', 'Taille de trame', 'info', fa, fb, 'Junos compte l’en-tête Ethernet dans sa MTU physique ; HPE l’exprime en taille de trame jumbo. Vérifiez que les deux couvrent le trafic attendu.'));
      }
    }

    // --- OSPF
    checkOspf(res, A, B, oA, oB, 'OSPF');
    checkOspf(res, A, B, ospfOf(A, ia, 'ospf3'), ospfOf(B, ib, 'ospf3'), 'OSPFv3');
    // --- IS-IS
    checkIsis(res, A, B, sA, sB);
    // --- MPLS
    if (hasIp) checkMpls(res, A, B, mplsOf(A, ia), mplsOf(B, ib));
    return res;
  }

  function fmtAuth(a) {
    if (!a) return 'aucune';
    if (a.type === 'keychain') return 'keychain ' + a.name;
    return a.type + (a.keyId ? ' clé ' + a.keyId : '') + (a.secret ? ', ' + fmtSecret(a.secret) : '');
  }
  function checkOspf(res, A, B, oA, oB, P) {
    if (!oA && !oB) return;
    if (!oA || !oB) {
      res.push(R(P, 'Activation', 'err', oA ? 'actif, area ' + oA.area : 'non activé', oB ? 'actif, area ' + oB.area : 'non activé', P + ' n’est actif que d’un côté : aucune adjacence.'));
      return;
    }
    res.push(R(P, 'Area', oA.area === oB.area ? 'ok' : 'err', oA.area, oB.area, oA.area === oB.area ? 'Même area.' : 'Areas différentes : les hellos sont rejetés.'));
    if (oA.area === oB.area) res.push(R(P, 'Type d’area', oA.areaType === oB.areaType ? 'ok' : 'err', oA.areaType, oB.areaType, oA.areaType === oB.areaType ? 'Même type d’area.' : 'Options stub/NSSA différentes : les hellos sont rejetés.'));
    if (oA.passive || oB.passive) res.push(R(P, 'Interface passive', 'err', oA.passive ? 'passive' : 'active', oB.passive ? 'passive (silent)' : 'active', 'Une interface passive n’envoie pas de hello : pas d’adjacence.'));
    const netOk = oA.network === oB.network;
    res.push(R(P, 'Type de réseau', netOk ? 'ok' : 'err', oA.network, oB.network, netOk ? 'Même type de réseau.' : 'Types de réseau différents : élection DR d’un côté seulement, adjacence instable ou routes absentes.'));
    const tOk = oA.hello === oB.hello && oA.dead === oB.dead;
    res.push(R(P, 'Timers hello / dead', tOk ? 'ok' : 'err', `${oA.hello} s / ${oA.dead} s${oA.setHello || oA.setDead ? '' : ' (défaut)'}`, `${oB.hello} s / ${oB.dead} s${oB.setHello || oB.setDead ? '' : ' (défaut)'}`,
      tOk ? 'Timers identiques.' : 'Timers différents : les hellos sont rejetés, pas d’adjacence.'));
    if (P === 'OSPF') {
      const ta = oA.auth ? oA.auth.type : 'none', tb = oB.auth ? oB.auth.type : 'none';
      if (ta === 'none' && tb === 'none') res.push(R(P, 'Authentification', 'ok', 'aucune', 'aucune', 'Pas d’authentification des deux côtés.'));
      else if (ta !== tb) {
        const near = (ta === 'md5' && tb === 'hmac-md5') || (tb === 'md5' && ta === 'hmac-md5');
        res.push(R(P, 'Authentification', near ? 'warn' : 'err', fmtAuth(oA.auth), fmtAuth(oB.auth), near ? 'md5 et hmac-md5 : vérifiez l’interopérabilité en labo, préférez « md5 » des deux côtés.' : 'Types d’authentification différents : adjacence refusée.'));
      } else {
        if ((oA.auth.keyId || oB.auth.keyId) && oA.auth.keyId !== oB.auth.keyId) res.push(R(P, 'Authentification', 'err', fmtAuth(oA.auth), fmtAuth(oB.auth), 'Identifiants de clé différents : adjacence refusée.'));
        else { const c = cmpSecret(oA.auth.secret, oB.auth.secret); res.push(R(P, 'Authentification', c.sev, fmtAuth(oA.auth), fmtAuth(oB.auth), c.msg)); }
      }
    }
    if (oA.cost != null || oB.cost != null) res.push(R(P, 'Coût', (oA.cost ?? 'auto') === (oB.cost ?? 'auto') ? 'ok' : 'info', oA.cost ?? 'auto (bande passante)', oB.cost ?? 'auto (bande passante)', (oA.cost ?? 'auto') === (oB.cost ?? 'auto') ? 'Coûts symétriques.' : 'Coûts asymétriques : le trafic aller et retour peut prendre des chemins différents.'));
    if (oA.bfd || oB.bfd) res.push(R(P, 'BFD', oA.bfd && oB.bfd ? 'ok' : 'warn', oA.bfd ? 'activé' + (oA.bfd.min ? ` (${oA.bfd.min} ms × ${oA.bfd.mult || 3})` : '') : 'non', oB.bfd ? 'activé' + (oB.bfd.min ? ` (${oB.bfd.min} ms × ${oB.bfd.mult || 3})` : '') : 'non',
      oA.bfd && oB.bfd ? 'BFD des deux côtés (les timers sont négociés).' : 'BFD d’un seul côté : la session BFD ne montera pas, pas de détection rapide.'));
  }
  function checkIsis(res, A, B, sA, sB) {
    if (!sA && !sB) return;
    if (!sA || !sB) { res.push(R('IS-IS', 'Activation', 'err', sA ? 'actif' : 'non activé', sB ? 'actif' : 'non activé', 'IS-IS n’est actif que d’un côté : aucune adjacence.')); return; }
    if (sA.isoMissing) res.push(R('IS-IS', 'Famille ISO', 'err', 'family iso absente', '—', 'Junos : sans « family iso » sur l’unité, IS-IS ne tourne pas sur cette interface.'));
    if (sA.passive || sB.passive) res.push(R('IS-IS', 'Interface passive', 'err', sA.passive ? 'passive' : 'active', sB.passive ? 'silent' : 'active', 'Une interface passive n’établit pas d’adjacence.'));
    res.push(R('IS-IS', 'Type de circuit', sA.p2p === sB.p2p ? 'ok' : 'err', sA.p2p ? 'point à point' : 'broadcast', sB.p2p ? 'point à point' : 'broadcast', sA.p2p === sB.p2p ? 'Même type de circuit.' : 'Point à point d’un côté, broadcast de l’autre : pas d’adjacence.'));
    const inter = [...sA.levels].filter(l => sB.levels.has(l));
    const fl = s => [...s].sort().map(l => 'L' + l).join(' + ') || 'aucun';
    if (!inter.length) res.push(R('IS-IS', 'Niveaux', 'err', fl(sA.levels), fl(sB.levels), 'Aucun niveau commun : pas d’adjacence.'));
    else {
      let sev = 'ok', msg = 'Niveau(x) commun(s) : ' + inter.map(l => 'L' + l).join(' + ') + '.';
      if (inter.includes(1)) {
        const aA = new Set(A.isis.nets.map(netParse).filter(Boolean).map(x => x.area)), aB = new Set(B.isis.nets.map(netParse).filter(Boolean).map(x => x.area));
        if (aA.size && aB.size && ![...aA].some(x => aB.has(x))) { sev = inter.includes(2) ? 'warn' : 'err'; msg = 'Areas IS-IS différentes : l’adjacence L1 ne montera pas' + (inter.includes(2) ? ', seule la L2 fonctionnera.' : '.'); }
      }
      res.push(R('IS-IS', 'Niveaux', sev, fl(sA.levels), fl(sB.levels), msg));
    }
    const hA = !!(sA.auth && sA.auth.secret), hB = !!(sB.auth && sB.auth.secret);
    if (hA || hB) { const c = cmpSecret(sA.auth && sA.auth.secret, sB.auth && sB.auth.secret); res.push(R('IS-IS', 'Authentification des hellos', c.sev, hA ? (sA.auth.type || 'md5') + ', ' + fmtSecret(sA.auth.secret) : 'aucune', hB ? (sB.auth.type || 'md5') + ', ' + fmtSecret(sB.auth.secret) : 'aucune', c.msg)); }
    if (sA.bfd || sB.bfd) res.push(R('IS-IS', 'BFD', sA.bfd && sB.bfd ? 'ok' : 'warn', sA.bfd ? 'activé' : 'non', sB.bfd ? 'activé' : 'non', sA.bfd && sB.bfd ? 'BFD des deux côtés.' : 'BFD d’un seul côté : pas de détection rapide.'));
  }
  function checkMpls(res, A, B, mA, mB) {
    const any = m => m.ldp || m.mplsFamily || m.rsvp;
    if (!any(mA) && !any(mB)) return;
    const lab = (m, d) => adapter(d).mplsLabel(m);
    if (mA.ldp !== mB.ldp) res.push(R('MPLS', 'LDP', 'err', lab(mA, A), lab(mB, B), 'LDP n’est actif que d’un côté : pas de session LDP, les LSP ne passeront pas par ce lien.'));
    else if (mA.ldp) {
      const probs = [...adapter(A).mplsProblems(mA, name(A)), ...adapter(B).mplsProblems(mB, name(B))];
      res.push(R('MPLS', 'LDP', probs.length ? 'err' : 'ok', lab(mA, A), lab(mB, B), probs.length ? probs.join(' ; ') + '.' : 'LDP actif des deux côtés.'));
    }
    if (mA.rsvp || mB.rsvp) res.push(R('MPLS', 'RSVP-TE', mA.rsvp === mB.rsvp ? 'ok' : 'warn', mA.rsvp ? 'actif' : 'non', mB.rsvp ? 'actif' : 'non', mA.rsvp === mB.rsvp ? 'RSVP des deux côtés.' : 'RSVP d’un seul côté : les tunnels TE ne passeront pas ici.'));
  }

  Object.assign(V, { findLinks, ifVariants, suggestPairs, checkLink, fmtAuth, checkOspf, checkIsis, checkMpls });
})(globalThis.VAV = globalThis.VAV || {});
