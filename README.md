# GestiLoc Libreville

Application de gestion locative orientée propriétaire, conçue pour Libreville et prête pour GitHub + Netlify.

## Fonctionnalités incluses

- tableau de bord propriétaire avec encaissements, retards, occupation et travaux ;
- propriétés, logements et locataires ;
- enregistrement des paiements en FCFA ;
- émission en lot des factures mensuelles et impression ;
- états des lieux d'entrée et de sortie avec grille, observations et signatures ;
- suivi des travaux et dépenses ;
- rapports de rentabilité et de recouvrement ;
- navigation responsive avec menus déroulants ;
- PWA installable et mode local de secours ;
- synchronisation avec Netlify Database.

## Déploiement sur GitHub et Netlify

1. Créez un nouveau dépôt GitHub.
2. Décompressez ce projet puis placez-vous dans son dossier.
3. Lancez :

```bash
git init
git add .
git commit -m "Première version de GestiLoc Libreville"
git branch -M main
git remote add origin URL_DE_VOTRE_DEPOT
git push -u origin main
```

4. Dans Netlify, sélectionnez **Add new project > Import an existing project**.
5. Choisissez GitHub puis le dépôt.
6. Netlify détectera automatiquement `netlify.toml` :
   - commande de build : `npm run build` ;
   - dossier de publication : `dist` ;
   - fonctions : `netlify/functions`.
7. Lors du premier déploiement, Netlify détecte la migration dans `netlify/database/migrations` et provisionne la base PostgreSQL.

Si le projet Netlify existe déjà sans base, ouvrez **Data & Storage > Database**, puis créez la base, ou lancez `netlify database init` avec Netlify CLI.

## Développement local

```bash
npm install
npm run dev
```

Sans Netlify CLI ou sans base disponible, l'application continue de fonctionner avec le stockage local du navigateur. Une fois déployée sur Netlify, le bouton de synchronisation enregistre l'état dans Netlify Database.

## Structure

```text
gestiloc-libreville/
├── index.html
├── styles.css
├── app.js
├── manifest.webmanifest
├── sw.js
├── netlify.toml
├── netlify/
│   ├── database/migrations/
│   └── functions/state.mjs
└── scripts/build.mjs
```

## Important avant mise en production publique

Cette version est un MVP mono-propriétaire. Avant d'accueillir plusieurs propriétaires ou des données réelles, ajoutez une authentification et remplacez la clé propriétaire de démonstration par l'identité sécurisée de l'utilisateur côté fonction Netlify.
