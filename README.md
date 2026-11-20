# Sémantique

Trouver un mot secret grâce à la proximité de sens (dans l'esprit de Cémantix et Semantle), avec un **nouveau mot toutes les heures** et une ergonomie revue : température en °C, saisie tolérante (pluriels, conjugaisons, accents), indices progressifs, regroupement des essais par pistes.

## Lancer en local

```sh
npm install
npm run dev   # API Hono sur :8787 + interface Svelte/Vite
```

Il faut d'abord générer les données, voir ci-dessous. Les fichiers privés ne sont pas dans le dépôt.

## Préparation des données

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python pipeline/build.py fr --rounds 2000 --start 2026-11-20T00:00:00+01:00
```

Télécharge les données brutes dans `data/raw/fr/` (~270 Mo, une seule fois) puis écrit `data/out/fr/` :

- `public/` peut être envoyé au navigateur. Il ne contient pas le mot secret.
  - `vocab.txt` : mots jouables
  - `forms.json` : formes saisies vers le mot de base, plus une table sans accents
  - `vec.bin` : vecteurs réduits, pour regrouper les essais par piste
  - `meta.json`
- `private/` reste côté serveur uniquement.
  - `schedule.json` : début, durée d'une manche (3600 s) et le mot secret de chaque manche. Il est stable : relancer le script ne fait qu'ajouter des manches.
  - `vectors.f32` : vecteurs complets ; le serveur calcule la table de chaque manche à la volée (~15 ms) et la garde en mémoire
- `data/secret_seed` : graine aléatoire du tirage, non versionnée. Le dépôt étant public, c'est elle qui empêche de deviner les mots à venir. Ne pas la perdre.

Pour exclure un mot des tirages, ajoute-le dans `pipeline/blocklist_fr.txt`.

## Anglais (préparé)

La configuration `EN` dans `pipeline/languages.py` (fuseau horaire, modèle fastText, format attendu des mots) est en place. Il manque l'adaptateur de lexique `english_lexicon` : formes fléchies vers lemmes, et fréquences (par exemple SUBTLEX-US). Le reste du pipeline ne dépend pas de la langue.

## Crédits

- Vecteurs : Jean-Philippe Fauconnier, frWac (CC-BY), https://fauconnier.github.io/#data
- Lexique 3.83 : Boris New & Christophe Pallier (CC BY-SA 4.0), http://www.lexique.org
