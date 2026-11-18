# Ajouter un constructeur

Vis-à-vis sépare la **lecture** des configurations (propre à chaque constructeur) des **contrôles** (communs à tous). Un constructeur est un fichier `js/vendors/<id>.js` qui :

1. lit le texte de configuration et remplit le **modèle commun** ;
2. s’enregistre auprès du registre avec `registerVendor({...})` en fournissant un **adaptateur** : les quelques règles qui changent d’un fabricant à l’autre (valeurs par défaut, calcul de la MTU, syntaxe des VLAN…).

Les contrôles (`js/analysis/`) ne testent jamais le nom d’un constructeur : ils interrogent uniquement le modèle et l’adaptateur. Ajouter un fabricant ne demande donc aucune modification des contrôles.

## Étapes

1. Copier `js/vendors/comware.js` (le plus simple) vers `js/vendors/<id>.js`.
2. Ajouter la balise `<script src="js/vendors/<id>.js"></script>` dans `index.html`, **après** `js/core/model.js` et **avant** `js/analysis/views.js`. L’ordre des balises est la seule source de vérité : les tests et le script de construction le relisent.
3. Ajouter une configuration d’exemple dans `samples/` et des tests dans `tests/run.js`.
4. Lancer `node tests/run.js` puis `node tools/build.js`.

## Le modèle commun

`parse(text)` doit renvoyer l’objet créé par `newDev('<id>')`, complété :

| Champ | Contenu |
|---|---|
| `hostname` | nom de l’équipement |
| `format` | libellé libre du format lu |
| `ifs` | `Map` nom → interface créée par `getIf(dev, nom)` |
| `routerId`, `lsrId` | identifiants globaux |
| `ospf`, `ospf3` | `{ rid, areas: { '0.0.0.0': { type, auth } }, ifs: Map nom → { area, network, hello, dead, auth, passive, cost, bfd, mtuEnable } }` |
| `isis` | `{ enabled, nets: [NET…], … }` + ce que lit votre `isisOf` |
| `ldp`, `mpls`, `rsvp` | `Set` des interfaces concernées (ou champs lus par votre `mplsOf`) |
| `bgp` | `{ as, rid, neighbors: [{ ip, peerAs, localAs, type, group, vrf, localAddress, connectIf, auth, multihop, ttl, families: Set, hold, bfd, shutdown }] }` |
| `lldp` | `{ enabled }` |
| `vlans` | `Map` nom ou numéro → numéro de VLAN |
| `notes` | `[{ sev: 'info', msg }]` affichées dans les contrôles globaux |
| `instances` | `Map` nom → `{ name, type, rd, rtImport: Set, rtExport: Set, ifaces, sites: [{ name, id }], vlanId }` (VRF, VPLS…) |
| `rsvpBw`, `rsvpLP` | bande passante RSVP par interface, interfaces avec protection de lien |
| `sys` | `{ ntp, syslog, radius, snmp, tz, policies, filters, lsps, ospfTE }` pour le mode comparaison |
| `groups` | `{ defined, applied, unused, inherited }` si le constructeur a une notion de gabarits |

Interface (`getIf`) : `name`, `desc`, `v4` / `v6` (via `addAddr(i, '192.0.2.1/30')`), `disabled`, `mtu`, `ipMtu`, `vlanId`, `parent` (pour une sous-interface ou unité), `kind` (`phys`, `unit`, `sub`, `vlanif`, `lag`, `loopback`), `lag` (agrégat parent d’un membre), `lacpMode` (`active`, `passive`, `static`) et `lacpPeriod` (`fast`, `slow`) sur l’agrégat, `speed` (Mb/s, via `normSpeed`), `duplex`, `vrf`, `loopback`.

Les familles BGP sont normalisées : `ipv4-unicast`, `ipv6-unicast`, `vpnv4`, `vpnv6`, `evpn`, `l2vpn`, `ipv4-labeled`, `ipv6-labeled`, `flowspec`, `rtc`.

Les secrets passent par `secret(raw)` (gère `$9$`) ou un objet `{ kind, raw, value }` où `value` vaut `null` si la clé n’est pas réversible. Une valeur décodée ne doit **jamais** être affichée : elle sert seulement à comparer.

## L’adaptateur

| Clé | Rôle |
|---|---|
| `id`, `label`, `short`, `models` | identifiant, nom affiché, nom court, modèles couverts |
| `exportCommand` | commande à lancer sur l’équipement (affichée dans l’interface) |
| `detect(text)` | score de 0 à 1 ; le constructeur au meilleur score est retenu |
| `parse(text)` | renvoie le modèle |
| `formatLabel(dev)` | libellé du format lu |
| `lines(text)` | liste `{ section, text }` des lignes normalisées, pour la comparaison ligne à ligne (une commande complète par ligne, avec son contexte) |
| `ipMtu(dev, i)` | `{ v, how }` : MTU IP effective et explication |
| `isisOf(dev, i)` | `{ levels: Set, p2p, passive, auth, bfd }` ou `null` |
| `mplsOf(dev, i)` | `{ ldp, mplsFamily, mplsProto, rsvp, … }` |
| `l2Profile(dev, port)` | `{ mode, untagged (numéro, 'L3' ou null), tagged (Set ou 'all') }` |
| `cosOf(dev, i)` | `{ scheduler, shaping, classifiers: { exp: nom }, rewrite: { exp: nom } }` ou `null` |
| `lldpOn(dev, port)` | LLDP actif sur ce port |
| `encapOf(dev, i)` | `{ tag }`, `{ vlanif }` ou `{ broken: true }`, avec `label` |
| `ifAliases(nom)` | variantes du nom (abréviations) pour relier les descriptions |
| `ospfAdvertisesMtu(ospfIf)` / `ospfMtuHint` | l’équipement annonce-t-il sa MTU dans les paquets DD |
| `frameLabel(port)` | taille de trame affichée pour les liens de niveau 2 |
| `mplsLabel(m)` / `mplsProblems(m, nom)` | libellé et prérequis manquants pour LDP |
| `bgpRequiresGroupType` | un groupe BGP doit déclarer son type (Junos) |
| `bgpRequiresAfEnable` | les voisins doivent être activés par famille (Comware 7, Cisco IOS-XR…) |
| `bgpHoldDefault` | hold time par défaut en secondes |
| `routerIds(dev)` | `{ global, ospf, bgp, lsr }` effectifs |
| `lldpDefault` | LLDP actif par défaut |
