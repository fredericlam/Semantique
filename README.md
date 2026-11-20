# Sémantique 🌴

Trouve le mot secret grâce à la **température** : plus ton mot est proche du secret *par le sens*, plus il est chaud (100° = trouvé). Un **nouveau mot toutes les heures**. On peut jouer seul ou entre amis dans une **room**.

Le jeu s'inspire de [Cémantix](https://cemantix.certitudes.org/) et de [Semantle](https://semantle.com/), avec une ergonomie revue.

---

## Statut du projet (20 novembre 2026)

| Domaine | État |
|---|---|
| Données françaises (vocabulaire, formes, vecteurs, planning) | ✅ fait |
| Jeu solo : température, saisie tolérante, indices, pistes, partage | ✅ fait |
| Un mot par heure, compte à rebours, archives (`?manche=N`) | ✅ fait |
| Design rétro Miami, mobile d'abord, mode sombre | ✅ fait |
| App installable (PWA) + page `/installer/` + icône | ✅ fait |
| API sur Cloudflare Workers (Hono) + données sur R2 | ✅ fait, testé en local |
| **Rooms** : serveur (Durable Object) | ✅ fait, testé en local |
| **Rooms** : interface (rejoindre, tableau en direct, classement) | 🚧 en cours |
| Mise en ligne sur Cloudflare | ⏳ à faire (compte connecté) |
| Version anglaise | 🧩 préparée, pas branchée |
| Classement général hors rooms (D1) | 💤 reporté |

### Fonctionnalités

- **Température en °C** calculée à partir du rang du mot, ce qui donne une progression lisible dès le premier essai. Le petit **n°** affiché à côté est le rang (n°1 = le mot le plus proche).
- **Saisie tolérante** : *chevaux* compte comme *cheval*, *mangeait* comme *manger*. Les accents sont facultatifs (« peche » propose aussi pêche et pécher), et une faute de frappe propose des corrections.
- **Indices progressifs** : d'abord un mot du top 1000, puis à chaque fois un mot environ 4 fois plus proche que ton meilleur essai. Au rang 1, plus d'indice.
- **Pistes** : tes essais sont regroupés automatiquement par thème.
- **Abandonner** ne révèle le mot qu'à la fin de l'heure, pour ne pas fausser la compétition dans les rooms.
- **Rooms** : un code de 5 caractères (sans O/0 ni I/1) et un pseudo, refusé s'il est déjà pris dans la room. Tout le monde joue le mot de l'heure. La progression des autres s'affiche en direct, sans leurs mots. Points par manche : 5 / 3 / 2 pour les trois premiers à trouver, puis 1, avec +1 si aucun indice n'a été utilisé. Une room s'efface après 30 jours sans activité.

---

## Architecture

```
navigateur (Svelte 5 + Vite, PWA)
   │  /api/*
   ▼
Cloudflare Worker (Hono) ──► R2 « semantique-data »  (dictionnaire, tables des manches, planning)
   │
   └──► Durable Object « Room » (un par room, SQLite + WebSockets en direct)
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
  - `schedule.json` : le mot secret de chaque manche ;
  - `rounds/NNNN.bin` : 100 manches par fichier ; pour chaque manche, `int16[V]` similarité ×10000 puis `uint16[V]` rang.
- `data/secret_seed` : graine du tirage des mots, **non versionnée et à ne pas perdre**. Le dépôt étant public, c'est elle qui empêche de deviner les mots à venir.

Relancer le script de préparation garde le planning existant et ne fait qu'ajouter des manches. Pour exclure un mot des tirages, ajoute-le dans `pipeline/blocklist_fr.txt`.

---

## Mise en ligne (Cloudflare)

```sh
npx wrangler login                 # déjà fait
npx wrangler r2 bucket create semantique-data
npm run seed:remote                # envoie les données sur R2
npm run deploy                     # build + wrangler deploy
```

Offre gratuite : les manches sont précalculées, donc le Worker ne fait que lire (pas de calcul lourd). Les rooms reposent sur des Durable Objects SQLite, inclus dans l'offre gratuite.

---

## Prochaines étapes

1. Interface des rooms : bouton « Rejoindre la room », tableau des joueurs en direct, classement, parcours de chacun en fin de manche.
2. Première mise en ligne, puis test de l'installation sur iPhone et Android.
3. Relecture de `pipeline/blocklist_fr.txt` (mots à ne jamais tirer).
4. Version anglaise : écrire `english_lexicon` dans `pipeline/languages.py`, puis traduire l'interface.

## Crédits

- Vecteurs : Jean-Philippe Fauconnier, frWac (CC-BY), https://fauconnier.github.io/#data
- Lexique 3.83 : Boris New & Christophe Pallier (CC BY-SA 4.0), http://www.lexique.org
