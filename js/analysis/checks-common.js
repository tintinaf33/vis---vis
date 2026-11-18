/* Vis-à-vis : paramètres communs du réseau.
 * Deux équipements d'un même réseau partagent normalement leurs serveurs (NTP, RADIUS, syslog), leurs communautés
 * SNMP et les objets construits sur un même gabarit (prefix-lists, filtres, politiques, QoS…). Une différence
 * trahit souvent une faute de frappe : elle est signalée, avec les lignes en cause. */
(function (V) {
  'use strict';
  const { R, name, natSort } = V;

  function listCheck(res, A, B, label, a, b, why) {
    a = [...new Set(a)].sort(natSort); b = [...new Set(b)].sort(natSort);
    if (!a.length && !b.length) return;
    const onlyA = a.filter(x => !b.includes(x)), onlyB = b.filter(x => !a.includes(x));
    if (!onlyA.length && !onlyB.length) { res.push(R('Administration', label, 'ok', a.join(', '), b.join(', '), 'Identiques sur les deux équipements.')); return; }
    res.push(R('Administration', label, 'warn', a.join(', ') || 'aucun', b.join(', ') || 'aucun',
      [onlyA.length ? `seulement sur ${name(A)} : ${onlyA.join(', ')}` : '', onlyB.length ? `seulement sur ${name(B)} : ${onlyB.join(', ')}` : ''].filter(Boolean).join(' ; ').replace(/^./, c => c.toUpperCase()) + '. ' + why));
  }

  function commonChecks(A, B) {
    const res = [];
    const why = 'Deux équipements d’un même réseau utilisent normalement les mêmes : faute de frappe ?';
    listCheck(res, A, B, 'Serveurs NTP', A.sys.ntp, B.sys.ntp, why);
    listCheck(res, A, B, 'Serveurs RADIUS', A.sys.radius, B.sys.radius, why);
    listCheck(res, A, B, 'Serveurs syslog', A.sys.syslog, B.sys.syslog, why);
    if (A.sys.tz || B.sys.tz) listCheck(res, A, B, 'Fuseau horaire', [A.sys.tz || 'défaut'], [B.sys.tz || 'défaut'], 'Horodatage des journaux incohérent entre les deux équipements.');
    // Objets de même nom : même contenu attendu
    const OA = A.objects || new Map(), OB = B.objects || new Map();
    const common = [...OA.keys()].filter(k => OB.has(k)).sort(natSort);
    let same = 0;
    for (const k of common) {
      const a = OA.get(k).lines, b = OB.get(k).lines;
      const onlyA = [...a.keys()].filter(x => !b.has(x)).map(x => a.get(x)), onlyB = [...b.keys()].filter(x => !a.has(x)).map(x => b.get(x));
      if (!onlyA.length && !onlyB.length) { same++; continue; }
      const ex = (l, who) => l.length ? `${who} : « ${l.slice(0, 3).map(x => x || '(définition vide)').join(' », « ')} »${l.length > 3 ? ` et ${l.length - 3} autre(s)` : ''}` : '';
      res.push(R('Objets communs', OA.get(k).show, 'warn', `${a.size} ligne(s), ${onlyA.length} différente(s)`, `${b.size} ligne(s), ${onlyB.length} différente(s)`,
        `Même nom, contenu différent. ${[ex(onlyA, 'Seulement sur ' + name(A)), ex(onlyB, 'seulement sur ' + name(B))].filter(Boolean).join(' ; ')}.`));
    }
    if (common.length) res.push(R('Objets communs', 'Objets identiques', 'ok', `${same} sur ${common.length}`, `${same} sur ${common.length}`, `${same} objet(s) de même nom (prefix-lists, filtres, politiques, QoS, serveurs…) ont exactement le même contenu des deux côtés.`));
    const own = (O, P) => [...O.keys()].filter(k => !P.has(k)).map(k => O.get(k).show);
    const oa = own(OA, OB), ob = own(OB, OA);
    if (oa.length || ob.length) res.push(R('Objets communs', 'Objets propres à un équipement', 'info', oa.length ? `${oa.length} : ${oa.slice(0, 6).join(', ')}${oa.length > 6 ? '…' : ''}` : 'aucun', ob.length ? `${ob.length} : ${ob.slice(0, 6).join(', ')}${ob.length > 6 ? '…' : ''}` : 'aucun',
      'Objets présents d’un seul côté : normal pour un service local, à vérifier s’ils devraient exister partout.'));
    return res;
  }

  Object.assign(V, { commonChecks });
})(globalThis.VAV = globalThis.VAV || {});
