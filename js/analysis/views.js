/* Vis-à-vis : Vues effectives (valeurs réellement appliquées, défauts compris) */
(function (V) {
  'use strict';
  const { adapter, allAddr, name, natSort, phys, sameNet, v4int, v6big } = V;

  /* ---------- Vues effectives (délèguent au constructeur quand c'est spécifique) ---------- */
  const ipMtu = (dev, i) => adapter(dev).ipMtu(dev, i);
  const isisOf = (dev, i) => adapter(dev).isisOf(dev, i);
  const mplsOf = (dev, i) => adapter(dev).mplsOf(dev, i);
  const l2Profile = (dev, p) => p ? adapter(dev).l2Profile(dev, p) : null;
  const encapOf = (dev, i) => adapter(dev).encapOf(dev, i);
  const cosOf = (dev, i) => (adapter(dev).cosOf ? adapter(dev).cosOf(dev, i) : null);
  const lldpOn = (dev, p) => (adapter(dev).lldpOn ? adapter(dev).lldpOn(dev, p) : null);
  function ospfOf(dev, i, which) {
    const O = dev[which || 'ospf'];
    let c = O.ifs.get(i.name);
    if (!c && O.ifs.has('all') && i.kind === 'unit') c = O.ifs.get('all');
    if (!c || c.disabled) return null;
    const network = c.network || (i.loopback ? 'loopback' : 'broadcast');
    const hello = c.hello ?? (network === 'nbma' || network === 'p2mp' ? 30 : 10);
    const dead = c.dead ?? hello * 4;
    const ar = O.areas[c.area] || { type: 'normal' };
    return { area: c.area, areaType: ar.type || 'normal', network, hello, dead, auth: c.auth || ar.auth || null,
      passive: c.passive, cost: c.cost, bfd: c.bfd, mtuEnable: c.mtuEnable, how: c.how, setHello: c.hello != null, setDead: c.dead != null, vrf: c.vrf };
  }
  function lagOf(dev, i) {
    const p = phys(dev, i);
    if (p && p.kind === 'lag') return p;
    if (p && p.lag) return dev.ifs.get(p.lag) || null;
    return null;
  }
  const members = (dev, lag) => [...dev.ifs.values()].filter(m => m.lag === lag.name).map(m => m.name).sort(natSort);
  function carriers(dev, vlan) {
    const out = [];
    for (const p of dev.ifs.values()) {
      if (p.kind !== 'phys' && p.kind !== 'lag') continue;
      if (p.lag) continue;
      if (p.linkMode === 'route') continue;
      const pr = l2Profile(dev, p); if (!pr) continue;
      if (pr.untagged === vlan) out.push({ name: p.name, tagged: false });
      else if (pr.tagged === 'all' || (pr.tagged instanceof Set && pr.tagged.has(vlan))) out.push({ name: p.name, tagged: true });
    }
    return out;
  }
  function netParse(net) {
    const parts = String(net).split('.'); if (parts.length < 5) return null;
    return { sys: parts.slice(-4, -1).join('.'), area: parts.slice(0, -4).join('.') };
  }
  function ownerOf(dev, ip) {
    const b = ip.includes(':') ? v6big(ip) : null;
    for (const i of dev.ifs.values()) for (const a of allAddr(i)) if (a.ip === ip || (b !== null && a.fam === 6 && a.n === b)) return i;
    return null;
  }
  function connectedIf(dev, ip) {
    const v6 = ip.includes(':'); const x = v6 ? { fam: 6, n: v6big(ip) } : { fam: 4, n: v4int(ip) };
    if (x.n === null) return null;
    for (const i of dev.ifs.values()) for (const a of (v6 ? i.v6 : i.v4)) {
      if (a.len >= (v6 ? 128 : 32)) continue;
      if (sameNet(a, x, a.len)) return { iface: i, addr: a };
    }
    return null;
  }
  function sourceIp(dev, n) {
    if (n.localAddress) return { ip: n.localAddress, how: 'local-address' };
    const v6 = n.ip.includes(':');
    if (n.connectIf) {
      const i = dev.ifs.get(n.connectIf);
      const a = i && (v6 ? i.v6[0] : i.v4.find(x => !x.sub));
      return { ip: a ? a.ip : null, how: 'connect-interface ' + n.connectIf };
    }
    const c = connectedIf(dev, n.ip);
    if (c) return { ip: c.addr.ip, how: 'interface ' + c.iface.name };
    return { ip: null, how: 'adresse de l’interface de sortie (non déterminable)' };
  }

  Object.assign(V, { cosOf, lldpOn, ipMtu, isisOf, mplsOf, l2Profile, encapOf, ospfOf, lagOf, members, carriers, netParse, ownerOf, connectedIf, sourceIp });
})(globalThis.VAV = globalThis.VAV || {});
