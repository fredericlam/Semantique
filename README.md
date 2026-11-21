# Sémantique 🌴

🌐 **En ligne : https://semantique.flaaam.workers.dev**

Trouve le mot secret grâce à la **température** : plus ton mot est proche du secret *par le sens*, plus il est chaud (100° = trouvé). Un **nouveau mot toutes les 3 heures** (0h, 3h, 6h … 21h). On peut jouer seul ou entre amis dans une **room**.

Le jeu s'inspire de [Cémantix](https://cemantix.certitudes.org/) et de [Semantle](https://semantle.com/), avec une ergonomie revue.

---

## Statut du projet (20 novembre 2026)

| Domaine | État |
|---|---|
| Données françaises (vocabulaire, formes, vecteurs, planning) | ✅ fait |
| Jeu solo : température, saisie tolérante, indices, pistes, partage | ✅ fait |
| Un mot toutes les 3 heures, compte à rebours, archives (`?manche=N`) | ✅ fait |
| Design rétro Miami, mobile d'abord, mode sombre | ✅ fait |
| App installable (PWA) + page `/installer/` + icône | ✅ fait |
| API sur Cloudflare Workers (Hono) + données sur R2 | ✅ en ligne |
| **Rooms** : serveur (Durable Object) | ✅ en ligne |
| **Rooms** : interface (rejoindre, tableau en direct, classement, parcours) | ✅ fait, testé en local à 3 joueurs |
| Mise en ligne sur Cloudflare | ✅ https://semantique.flaaam.workers.dev |
| Niveaux kid / teen / adulte (un mot secret par niveau et par créneau) | ✅ côté serveur et données ; **masqués dans l'interface** (tout le monde en adulte, `SHOW_LEVELS` dans `src/lib/game.ts`) |
| Thème clair / sombre / auto (pied de page) | ✅ |
| Version anglaise | 🧩 préparée, pas branchée |
| Classement général hors rooms (D1) | 💤 reporté |

### Fonctionnalités

- **Température en °C** calculée à partir du rang du mot, ce qui donne une progression lisible dès le premier essai. Le petit **n°** affiché à côté est le rang (n°1 = le mot le plus proche).
- **Saisie tolérante** : *chevaux* compte comme *cheval*, *mangeait* comme *manger*. Les accents sont facultatifs (« peche » propose aussi pêche et pécher), et une faute de frappe propose des corrections.
- **3 niveaux**, chacun avec son propre mot :
  - 🧒 **kid** (7–11 ans) : noms concrets du quotidien, choisis par proximité de sens avec des thèmes d'enfants (animaux, nourriture, école, jouets…), avec des listes noires dédiées ;
  - 🧑 **teen** : noms, verbes et adjectifs courants ;
  - 🧔 **adulte** : mots plus rares.

  Les mots acceptés sont les mêmes pour tous. En solo, le niveau se choisit sous l'en-tête et l'app s'en souvient ; une room a un niveau fixé à sa création. Les parties et les statistiques sont séparées par niveau.
- **Indices progressifs** : d'abord un mot du top 1000 (top 300 en kid), puis à chaque fois un mot environ 4 fois (3 fois en kid) plus proche que ton meilleur essai. Au rang 1, plus d'indice.
- **Les mots précédents** : sous la partie, les 24 derniers mots (3 jours) du niveau en cours, avec ton résultat (🎯 trouvé en N, 🏳️ abandon, pas joué) et le nombre de personnes qui les ont trouvés. Le mot non joué est flouté (un toucher le révèle) et on peut encore le jouer. Le serveur (`GET /api/fr/history`) ne renvoie que des manches terminées.
- **Rythme** : un mot **toutes les 3 heures** (0h, 3h, 6h, 9h, 12h, 15h, 18h, 21h) depuis le 21/11/2026 15h ; avant, un mot par heure, puis un rythme jour/nuit. Les étapes sont listées dans `shared/timeline.ts` (`ERAS`), commun au serveur et à l'app, changement d'heure géré. Les manches déjà jouées gardent leur numéro, leur mot et leurs résultats. Pour changer de rythme, ajouter une étape future. Les 2000 manches préparées durent environ 8 mois.
- **Décompte** : « 🎯 N personnes ont trouvé le mot de 14h · M mots trouvés aujourd'hui », et le nombre de personnes pour chaque mot passé. Le compteur est tenu par le Durable Object `Stats` : une seule fois par appareil (identifiant anonyme) et par heure, et seulement avec le bon mot (`POST /api/fr/found`, `GET /api/fr/stats`).
- **Thème** : 🌓 auto (suit l'appareil), ☀️ clair ou 🌙 sombre, au choix en pied de page.
- **Pistes** : tes essais sont regroupés automatiquement par thème.
- **Abandonner** ne révèle le mot qu'à la fin du créneau (quand il change), pour ne pas fausser la compétition dans les rooms. D'ici là, on peut **reprendre la partie** (↩️).
- **Trois écrans séparés** : `/` = ton jeu **solo** (jamais remplacé par une room) ; `/rooms` = le **centre des rooms** (reprendre la dernière room, **mes rooms**, rooms publiques, créer / rejoindre) ; `/room/CODE` = l'écran d'**une room**, avec sa propre partie gardée par le serveur. On peut être membre d'autant de rooms qu'on veut.
- **Mes rooms** : rooms créées ou rejointes sur l'appareil (nom, code copiable, ton nom de joueur), « entrer » sans rien retaper, ✕ pour retirer.
- **Deux modes de room**, modifiables à tout moment par n'importe quel membre, avec effet immédiat :
  - 🏆 **défi** (rose) : chacun joue de son côté, les mots des autres restent cachés, classement par points ;
  - 🤝 **collaboratif** (turquoise) : une partie commune ; chaque mot proposé apparaît en direct chez tous avec son auteur, un mot déjà proposé n'est pas recompté, et le premier qui trouve fait gagner l'équipe.
- **Rooms publiques ou privées** : la page `/rooms` liste les rooms publiques, triées par activité, avec un bouton « rejoindre ». Une room privée ne se rejoint qu'avec son code. Le créateur peut changer la visibilité à tout moment. Chaque room a un nom libre, distinct de son code.
- **Rooms** : un code de 5 caractères (sans O/0 ni I/1) et un pseudo, refusé s'il est déjà pris dans la room. Tout le monde joue le même mot. La progression des autres s'affiche en direct, sans leurs mots. Points par manche : 5 / 3 / 2 pour les trois premiers à trouver, puis 1, avec +1 si aucun indice n'a été utilisé. Une room s'efface après 30 jours sans activité. On la rejoint par le bouton 👥 ou par un lien `/room/CODE` ; en rouvrant l'app, on retrouve automatiquement sa dernière room.

---

## Architecture

```
navigateur (Svelte 5 + Vite, PWA)
   │  /api/*
   ▼
Cloudflare Worker (Hono) ──► R2 « semantique-data »  (dictionnaire, tables des manches, planning)
   │
   ├──► Durable Object « Room » (un par room, SQLite + WebSockets en direct)
   └──► Durable Object « Directory » (annuaire des rooms publiques)
```

| Dossier | Rôle |
|---|---|
| `pipeline/` | préparation des données en Python (frWac + Lexique 3.83) |
| `server/` | Worker : `app.ts` (API), `room.ts` (rooms), `data.ts` (lecture des données) |
| `src/` | interface : `App.svelte`, `GuessRow.svelte`, `lib/` (mots, température, partie, PWA) |
| `installer/` | page d'installation sur mobile |
| `public/` | manifeste, service worker, icônes |
| `assets/icon.svg` | icône source (`npm run icons` génère les PNG) |

**Anti-triche :** le mot secret et la liste des mots proches ne sont donnés qu'après avoir trouvé, ou une fois l'heure terminée. Dans une room, c'est le serveur qui enregistre chaque essai.

---

## Développement

```sh
# 1. données (une fois, ~10 s ; télécharge ~270 Mo de données brutes la première fois)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python pipeline/build.py fr --rounds 2000 --start 2026-11-20T00:00:00+01:00

# 2. dépendances + chargement des données dans le R2 local
npm install
npm run seed

# 3. lancer : API (wrangler dev, :8787) + interface (Vite)
npm run dev
```

Scripts : `npm run check` (types), `npm run build`, `npm run preview` (version de production en local), `npm run icons`.

### Données produites (`data/out/fr/`)

- `public/` peut être envoyé au navigateur, il ne contient pas le mot secret :
  - `vocab.txt` (≈ 28 800 mots) ;
  - `forms.json` (formes fléchies et version sans accents) ;
  - `vec.bin` (vecteurs réduits, pour les pistes) ;
  - `meta.json`.
- `private/` reste côté serveur, hors du dépôt :
  - `<niveau>/schedule.json` (kid, teen, adult) : le mot secret de chaque manche ;
  - `<niveau>/rounds/NNNN.bin` : 100 manches par fichier ; pour chaque manche, `int16[V]` similarité ×10000 puis `uint16[V]` rang.
- `data/secret_seed` : graine du tirage des mots, **non versionnée et à ne pas perdre**. Le dépôt étant public, c'est elle qui empêche de deviner les mots à venir.

Relancer le script de préparation garde les plannings existants et ne fait qu'ajouter des manches. Pour exclure un mot des tirages, ajoute-le dans `pipeline/blocklist_fr.txt` (tous niveaux) ou `pipeline/blocklist_fr_kid.txt` (kid seulement). Les réglages de chaque niveau sont dans `pipeline/languages.py` (`FR_LEVELS`).

---

## Déploiement

**Production : https://semantique.flaaam.workers.dev** (Cloudflare Workers, offre gratuite)

### Ce qui est déployé, et où

| Élément | Où | Mis à jour par |
|---|---|---|
| Interface (`dist/` : HTML, JS, CSS, icônes, service worker) | *Static Assets* du Worker `semantique` | chaque push sur `main` (automatique) |
| API `/api/*` (`server/app.ts`) | Worker `semantique` | chaque push sur `main` (automatique) |
| Rooms (`server/room.ts`) | Durable Objects `Room` (SQLite) | chaque push sur `main` (automatique) |
| Données du jeu (dictionnaire, planning, tables des manches) | R2 `semantique-data` | workflow manuel « Données du jeu » |

Le site et l'API partagent la même adresse : le Worker répond lui-même à `/api/*` et laisse Cloudflare servir les fichiers de `dist/` pour tout le reste. Une adresse inconnue (`/room/XXXXX`…) renvoie `index.html`, ce qui laisse l'application gérer l'adresse.

### Automatique : GitHub Actions

- **`.github/workflows/deploy.yml`, « Vérifier et déployer »**
  - à chaque **push sur `main`** : vérification des types, build, puis `wrangler deploy` (1 à 2 minutes) ;
  - sur une **pull request** : vérification et build seulement, sans déploiement ;
  - si les secrets Cloudflare manquent, le déploiement est ignoré avec un avertissement, sans faire échouer le workflow.
- **`.github/workflows/data.yml`, « Données du jeu »** (lancement manuel : onglet *Actions*, puis *Run workflow*)
  1. récupère le planning existant sur R2 (les mots déjà joués ne changent pas) ;
  2. relance `pipeline/build.py` avec la graine secrète ;
  3. renvoie les données sur R2.

  À utiliser pour ajouter des manches (paramètre `rounds`, par exemple 4000), ou après une modification de `pipeline/` ou de la blocklist.

### À faire une seule fois : les secrets GitHub

Dans GitHub : **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Valeur | Où la trouver |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | jeton d'API Cloudflare | dash.cloudflare.com → *My Profile* → *API Tokens* → *Create Token* → modèle **« Edit Cloudflare Workers »**, puis ajouter la permission **Account · Workers R2 Storage · Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | identifiant du compte | dash.cloudflare.com → *Workers & Pages* (colonne de droite, *Account ID*), ou `npx wrangler whoami` |
| `SECRET_SEED` | contenu de `data/secret_seed` | sur ta machine : `pbcopy < data/secret_seed`. Ne le colle **nulle part ailleurs** : avec ce fichier, on peut retrouver tous les mots à venir. |

Si la ligne de commande GitHub (`gh`) est installée et connectée, on peut aussi faire : `gh secret set SECRET_SEED < data/secret_seed`.

### Signalement de bugs (bouton 🐞 → issue GitHub)

Le bouton « Un bug, une idée ? » (en bas de page) envoie le texte au Worker (`POST /api/bug`), qui crée une **issue GitHub** avec le libellé `bug`. Les joueurs n'ont pas besoin de compte GitHub.
- Infos techniques jointes, si le joueur accepte : version, page, mode, manche, appareil. **Jamais** le code de room ni les mots joués : le dépôt est public.
- Anti-spam : 3 signalements par quart d'heure et par adresse IP.
- Le dépôt cible est défini dans `wrangler.jsonc`, variable `GITHUB_REPO`.

À configurer une fois, sinon le bouton ouvre simplement le formulaire « New issue » de GitHub, pré-rempli :
1. GitHub → *Settings* → *Developer settings* → *Fine-grained tokens* → *Generate new token* ;
   - Repository access : **Only select repositories → Semantique** ;
   - Permissions : **Issues → Read and write** (rien d'autre).
2. `npx wrangler secret put GITHUB_TOKEN`, puis colle le jeton. Il reste chiffré chez Cloudflare et n'est jamais dans le code.

### À la main, depuis ton poste

```sh
npx wrangler login                          # une fois
npx wrangler r2 bucket create semantique-data   # une fois (R2 doit être activé sur le compte)
npm run seed:remote                         # envoie data/out/fr sur R2
npm run deploy                              # build + wrangler deploy
```

### Exploitation

- **Logs en direct :** `npx wrangler tail`, ou le tableau de bord du Worker (*Observability* est activé).
- **Revenir à la version précédente :** `npx wrangler rollback` (ou *Deployments* dans le tableau de bord). Ça ne touche ni les données R2 ni les rooms.
- **Modifier la classe `Room` :** si on la renomme ou la supprime, il faut ajouter une entrée dans `migrations` de `wrangler.jsonc`. Ajouter des tables ou des colonnes ne demande rien : c'est géré dans le constructeur avec `CREATE TABLE IF NOT EXISTS`.
- **Coût :** offre gratuite de Workers (100 000 requêtes/jour), R2 (10 Go, environ 230 Mo utilisés) et Durable Objects SQLite. Les manches étant précalculées, le Worker ne fait que lire et reste sous la limite de 10 ms de calcul par requête.

### Que contient le stockage R2 (`semantique-data`) ?

Le stockage R2 contient les mêmes fichiers que `data/out/fr/`, 67 au total (environ 660 Mo pour les 3 niveaux). Les fichiers **`.bin`** sont des fichiers **binaires** : de simples suites de nombres, sans texte ni JSON, donc illisibles dans un éditeur. Ce n'est ni une erreur ni une archive.

| Fichier | Taille | Contenu |
|---|---|---|
| `fr/public/meta.json` | 1 Ko | date de début, durée d'une manche (3600 s), taille du vocabulaire, version |
| `fr/public/vocab.txt` | 280 Ko | les ≈ 28 800 mots jouables, un par ligne ; le numéro de ligne sert d'identifiant du mot |
| `fr/public/forms.json` | 1,8 Mo | formes fléchies et version sans accents, vers l'identifiant du mot (*chevaux* → *cheval*) |
| `fr/public/vec.bin` | 1,3 Mo | pour chaque mot, 48 petits nombres (son « sens » compressé) : sert à regrouper tes essais en **pistes** |
| `fr/private/{kid,teen,adult}/schedule.json` | 23 Ko | 🔒 le mot secret de chaque manche, dans l'ordre, par niveau |
| `fr/private/{kid,teen,adult}/rounds/0000.bin` … `0019.bin` | 11,5 Mo chacun | 🔒 les **réponses précalculées** de 100 manches (voir ci-dessous) |

**Pourquoi `rounds/*.bin` ?** Pour chaque manche, il faut connaître à l'avance, pour *chacun* des 28 800 mots, sa proximité avec le mot secret et son rang. C'est ce qui donne la température quand tu proposes un mot. Le Worker gratuit n'a droit qu'à 10 ms de calcul par requête, donc ces tables sont calculées une fois pour toutes par le script de préparation, puis rangées ainsi :

- un fichier = 100 manches à la suite ;
- une manche = 28 800 similarités (entiers sur 2 octets, ×10000), puis 28 800 rangs (entiers sur 2 octets), soit 4 × 28 800 = 115 Ko ;
- le Worker ne télécharge que les 115 Ko de la manche en cours (lecture partielle de R2), puis les garde en mémoire.

En binaire, une manche pèse 115 Ko au lieu d'environ 1 Mo en JSON, et se lit instantanément (`Int16Array` / `Uint16Array`). Le dossier `private/` n'est jamais accessible depuis le navigateur. Seul le Worker le lit, ce qui garde les mots secrets à l'abri.

3 niveaux × 20 fichiers × 100 manches = **2000 heures de jeu par niveau, soit environ 83 jours**. En kid, les 633 mots possibles reviennent par cycles d'environ 26 jours. Pour aller plus loin : `pipeline/build.py fr --rounds 4000`, puis `npm run seed:remote`.

---

## Prochaines étapes

1. Tester l'installation sur iPhone et Android, et jouer une vraie room à plusieurs.
2. Relecture de `pipeline/blocklist_fr.txt` (mots à ne jamais tirer).
3. Version anglaise : écrire `english_lexicon` dans `pipeline/languages.py`, puis traduire l'interface.

## Crédits

- Vecteurs : Jean-Philippe Fauconnier, frWac (CC-BY), https://fauconnier.github.io/#data
- Lexique 3.83 : Boris New & Christophe Pallier (CC BY-SA 4.0), http://www.lexique.org
