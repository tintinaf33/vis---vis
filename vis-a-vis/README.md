# Vis-à-vis

Comparateur de configurations de routeurs voisins. Collez la configuration de deux équipements reliés entre eux : Vis-à-vis retrouve les liens qui les connectent, puis vérifie paramètre par paramètre que chaque côté attend exactement ce que l’autre envoie.

![Capture du rapport](docs/capture.png)

Tout s’exécute dans le navigateur : aucune configuration n’est envoyée sur un serveur, aucune dépendance n’est à installer.

## Deux modes d’analyse

- **Deux voisins** : deux équipements reliés entre eux. L’outil retrouve les liens qui les connectent et vérifie que chaque côté attend ce que l’autre envoie. Seules les interfaces qui se font face sont contrôlées ; les autres sont listées dans « Interfaces non comparées ».
- **Comparer deux configurations** : le même équipement avant et après une modification, ou deux équipements censés être configurés pareil. Toutes les interfaces sont comparées une à une par leur nom, puis le système, le routage, chaque voisin BGP et enfin la totalité des lignes de configuration.

## Constructeurs pris en charge

| Constructeur | Modèles testés | Commande à exporter |
|---|---|---|
| Juniper Junos | MX104 (et MX, EX, QFX, SRX, ACX) | `show configuration` ou `show configuration \| display set` |
| HPE Comware 7 | 5520 HI (et 5940, 5710, 7500…) | `display current-configuration` |

Les `groups` / `apply-groups` Junos sont dépliés automatiquement, jokers compris. Les captures de terminal (invite, bannière, CRLF) sont acceptées telles quelles.

## Utilisation en local

Trois possibilités, sans rien installer :

1. **Fichier unique (recommandé hors ligne)** : ouvrez `dist/vis-a-vis.html` dans un navigateur. Ce fichier contient tout ; vous pouvez le copier sur une clé USB ou un poste isolé.
2. **Version découpée** : ouvrez directement `index.html` (double-clic).
3. **Petit serveur local**, si votre navigateur restreint les fichiers locaux :
   ```
   python3 -m http.server 8000
   ```
   puis ouvrez http://localhost:8000.

Sans accès internet, les polices Google ne se chargent pas et l’outil utilise les polices du système. Tout le reste fonctionne.

Raccourci : `Ctrl + Entrée` lance la comparaison. Le bouton « Charger l’exemple » montre l’outil sur une configuration MX104 et une configuration HPE 5520 contenant des erreurs volontaires.

## Héberger sur GitHub

```
git init
git add .
git commit -m "Vis-à-vis 1.0.0"
git branch -M main
git remote add origin https://github.com/<votre-compte>/vis-a-vis.git
git push -u origin main
```

Pour obtenir une page en ligne : **Settings → Pages → Build and deployment → Deploy from a branch**, branche `main`, dossier `/ (root)`. L’outil sera disponible à l’adresse `https://<votre-compte>.github.io/vis-a-vis/`.

L’intégration continue (`.github/workflows/ci.yml`) lance les tests à chaque push et vérifie que `dist/` est à jour.

> Les configurations du dossier `samples/` sont entièrement fictives : adresses dans les plages réservées à la documentation (RFC 5737), numéros d’AS de documentation (RFC 5398), secrets générés à partir de mots de passe inventés.

> Ne committez jamais de configurations de production : elles contiennent adresses, topologie et clés. Le `.gitignore` exclut le dossier `configs-privees/`.

## Ce qui est vérifié

**Pour chaque lien** (trouvé par sous-réseau commun, par descriptions croisées ou désigné à la main ; les interfaces de management sont ignorées) :

- adressage : même sous-réseau, même masque, pas de doublon, pas d’adresse réseau ou de broadcast ; un lien dont l’IP est erronée reste visible comme « lien probable » ;
- état administratif, vitesse, duplex, descriptions qui se citent mutuellement, LLDP, filtres ;
- encapsulation VLAN et MTU IP effective, recalculée selon les règles de chaque constructeur ;
- agrégats : mode LACP, cadence, nombre de membres ;
- niveau 2 : VLAN non tagué, VLAN tagués présents d’un seul côté ;
- OSPF et OSPFv3 : area, type d’area, passive, type de réseau, timers, authentification (clés comparées), coût, BFD et ses timers ;
- IS-IS : famille ISO, type de circuit, niveaux, area, authentification ;
- MPLS : LDP et ses prérequis, RSVP (bande passante réservable, protection de lien) ;
- QoS : classification et marquage croisés (EXP, DSCP), ordonnancement, shaping.

**Pour chaque session BGP** : réciprocité, adresses source, joignabilité des loopbacks dans l’IGP, AS, type, multihop, mot de passe, familles, hold time, BFD.

**Pour chaque service partagé** (VRF, VPLS appariés par route-target) : type, route-targets croisés, RD, sites VPLS, normalisation VLAN, famille BGP requise, interfaces attachées.

**Syntaxe et valeurs** : accolades, points-virgules, guillemets, adresses mal formées où qu’elles soient, adresses source qui n’appartiennent pas à l’équipement, objets cités mais jamais définis, code-points et parts de QoS, ports, valeurs hors limites (VLAN, MTU, timers, AS…), RD et route-targets mal formés, mots-clés mal orthographiés, interfaces citées mais inexistantes, adresses en double sur un même équipement. Les anomalies s’affichent dès la saisie.

**Paramètres communs du réseau** : serveurs NTP, RADIUS et syslog, fuseau horaire et tous les objets de même nom (prefix-lists, filtres, politiques, QoS, LSP, SNMP, classes de connexion…) doivent être identiques sur les deux équipements ; les secrets sont comparés sans jamais être affichés.

**Globalement** : router-ID, NET IS-IS, LSR-ID, IP en double, LLDP, gabarits (groupes appliqués d’un seul côté), OSPF traffic-engineering et reference-bandwidth.

Les configurations Junos sont lues en format hiérarchique ou `display set`, avec dépliage complet des `groups` / `apply-groups` (jokers compris) : inutile de passer par `display inheritance`.

## Développement

Il suffit de Node.js 18 ou plus récent, sans aucune dépendance.

```
node tests/run.js      # tests du moteur
node tools/build.js    # régénère js/ui/samples.js et dist/vis-a-vis.html
```

Après toute modification, relancez la construction et committez `dist/`.

```
index.html                 page et ordre de chargement des scripts
css/style.css
js/core/                   IP, texte, secrets, modèle commun, registre des constructeurs
js/vendors/junos.js        lecture Junos + adaptateur
js/vendors/comware.js      lecture Comware 7 + adaptateur
js/analysis/               vues effectives et contrôles (indépendants des constructeurs)
js/ui/                     interface et exemples
samples/                   configurations d’exemple
tests/                     tests Node
tools/build.js             construction du fichier unique
dist/vis-a-vis.html        version autonome
docs/                      documentation
```

Pour ajouter un fabricant, lisez [docs/ajouter-un-constructeur.md](docs/ajouter-un-constructeur.md).

## Limites connues

- Les clés HPE `$c$` sont chiffrées de façon non réversible : l’outil signale qu’elles sont à comparer à la main. Les clés Junos `$9$` sont décodées localement pour la comparaison et ne sont jamais affichées.
- Les conditions `when` des groupes Junos ne sont pas évaluées.
- Les liens de niveau 2 sans adresse IP ne sont trouvés que par les descriptions ou par une paire manuelle.

## Licence

MIT, voir [LICENSE](LICENSE).
