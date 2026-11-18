# Historique des versions

## 1.5.1

- Exemples, tests et documentation : toutes les adresses IP sont désormais dans les plages réservées à la documentation (RFC 5737 : 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) et les numéros d’AS dans la plage 64496 à 64511 (RFC 5398). Aucune ne peut correspondre à un réseau réel.
- Noms de gabarits et d’objets des exemples remplacés par des noms neutres.

## 1.5.0

Validée par 33 nouvelles fautes injectées dans les sections système, SNMP, politiques, filtres et QoS de deux configurations réelles (toutes détectées), en plus des 170 scénarios précédents.

- Adresses IPv4 mal formées détectées partout dans la configuration (NTP, RADIUS, syslog, SNMP, prefix-lists, filtres, tunnels dynamiques…), plus seulement sur les interfaces et en BGP.
- Une `source-address` (RADIUS, syslog, NTP, SNMP…) ou une `local-address` BGP qui n’appartient à aucune interface de l’équipement est une erreur ; une interface source inexistante est signalée.
- Nouvelle section « Paramètres communs du réseau » en mode voisins : serveurs NTP, RADIUS et syslog, fuseau horaire, et tous les objets de même nom (prefix-lists, filtres, politiques, communautés, classifieurs, marquages, schedulers, scheduler-maps, drop-profiles, classes de service, LSP, tunnels dynamiques, serveurs RADIUS et syslog, classes et utilisateurs de connexion, SNMP) doivent avoir le même contenu sur les deux équipements. Les secrets sont comparés mais jamais affichés.
- Références à des objets jamais définis (filtre, politique, communauté, prefix-list, scheduler-map, scheduler, drop-profile, classe de service, classifieur, marquage, modèle de LSP) : Junos refuserait le commit.
- Valeurs QoS et pare-feu : code-points EXP/DSCP, loss-priority, priorités, files, transmit-rate, somme des parts d’un scheduler-map, drop-profiles, ports.
- HPE Comware : mêmes contrôles d’adresses sur tout le texte, interfaces source, et comparaison des ACL, politiques QoS, schémas RADIUS, route-policies, prefix-lists, SNMP, NTP et info-center.

## 1.4.0

Validée par 37 fautes de saisie injectées dans deux configurations réelles (toutes détectées), en plus des 133 scénarios précédents.

- Les adresses mal formées (« 192.0.2./31 », octet > 255, préfixe /33, masque non contigu chez HPE) ne sont plus ignorées en silence : elles sont signalées en erreur bloquante sur le lien et dans les contrôles globaux.
- Ports rapprochés par leurs descriptions : l’outil compare leurs unités routées (adressage, OSPF, LDP, RSVP, QoS) et non plus seulement le port physique.
- Une interface routée (family inet, mpls, OSPF ou LDP) sans adresse en face d’une interface adressée est une erreur bloquante.
- Nouvelle validation de syntaxe Junos : accolade ou point-virgule manquant, accolade en trop, guillemet ou liste non fermés (avec numéro de ligne), ligne sans « set » en format display set.
- Nouvelle validation des valeurs : unités, VLAN, MTU, vitesse, link-mode, area, metric, timers, BFD, identifiant de clé, adresses de voisins BGP, local-address, AS, type de groupe, familles, router-id, RD, route-targets, site-identifier, bande passante RSVP ; mêmes contrôles côté Comware (adresses, masques, VLAN, timers, coût, AS, voisins).
- Mots-clés inconnus sous les interfaces, unités, family inet/inet6, interfaces OSPF et groupes/voisins BGP (« disabel », « adress »…).
- Interfaces citées par OSPF, IS-IS, LDP, MPLS, RSVP, LLDP, QoS ou une instance mais absentes de la configuration ; adresse configurée deux fois sur le même équipement.
- Les anomalies s’affichent dès la saisie, sous la zone de texte.

## 1.3.0

Validée sur deux configurations réelles de routeurs MX voisins et 66 fautes injectées (toutes détectées).

- Junos : dépliage complet des `groups` / `apply-groups` avec jokers (`<*>`, `<ge-*>`, `<*_VPLS>`), `apply-groups-except`, priorité des valeurs explicites et des choix exclusifs (une authentification `simple-password` explicite remplace le MD5 hérité). Avant, les valeurs héritées (MTU, OSPF p2p, MD5, BFD…) étaient ignorées.
- Junos : nettoyage des captures de terminal (BOM, bannière `--- JUNOS`, invite de commande, CRLF).
- Nouveaux contrôles par lien : LLDP, filtres de pare-feu, QoS (classification et marquage EXP/DSCP croisés, ordonnancement, shaping), RSVP (bande passante réservable, protection de lien), timers BFD, cohérence des descriptions.
- Nouveau contrôle BGP : loopbacks de session non annoncées dans l’IGP.
- Nouveaux contrôles de services (VRF, VPLS) : appariement par route-target, type, route-targets croisés, RD, sites VPLS en double, normalisation VLAN, famille BGP requise, interfaces attachées.
- Gabarits : groupe défini des deux côtés mais appliqué d’un seul, OSPF traffic-engineering et reference-bandwidth.
- Interfaces de management (fxp0, em0, me0…) exclues de la détection de liens.
- Les descriptions abrégées (« SITE_NORD-PK12_02 ») sont reconnues comme désignant l’équipement voisin.
- Mode comparaison : QoS, filtres, LLDP, RSVP, BFD, NTP, syslog, RADIUS, SNMP (masqué), groupes, politiques, filtres, LSP et services.

## 1.2.0

- Nouveau mode « Comparer deux configurations » : même équipement avant et après une modification, ou deux équipements censés être configurés pareil.
  - Toutes les interfaces sont comparées une à une par leur nom (adressage, MTU, VLAN, agrégat, niveau 2, OSPF, IS-IS, MPLS).
  - Système et routage, puis chaque voisin BGP, sont comparés paramètre par paramètre.
  - Différences ligne à ligne sur la totalité du texte de configuration, y compris ce que l’outil n’analyse pas en détail. Les clés sont masquées, et une clé Junos rechiffrée mais identique n’est pas comptée comme une différence.
- En mode « Deux voisins », l’outil propose la comparaison complète quand les deux configurations partagent de nombreuses interfaces de même nom.

## 1.1.0

- Correction majeure : une adresse IP ou un masque erroné ne fait plus disparaître le lien du rapport. Les interfaces qui se font face (même VLAN, ports reliés, descriptions croisées) sont rapprochées en « lien probable » et l’erreur d’adressage est signalée.
- Sessions BGP : une adresse de voisin erronée (faute de frappe, loopback modifiée) est désormais détectée et la session est rapprochée de son vis-à-vis.
- Nouvelle section « Interfaces non comparées » : plus aucune interface n’est ignorée en silence ; celles décrites vers le voisin sans correspondance sont signalées.
- 31 scénarios de fautes injectées ajoutés aux tests automatiques.

## 1.0.0

- Première version publique.
- Constructeurs : Juniper Junos (hiérarchique et `display set`) et HPE Comware 7.
- Détection automatique des liens (sous-réseau commun, descriptions croisées) et paires manuelles.
- Contrôles : adressage, état, encapsulation VLAN, MTU IP effective, agrégats LACP, vitesse et duplex, niveau 2, OSPF, OSPFv3, IS-IS, LDP, RSVP, sessions BGP, identifiants globaux.
- Architecture par adaptateurs constructeurs, prête pour l’ajout de nouveaux fabricants.
