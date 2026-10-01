# GestiLoc Libreville

Application de gestion locative orientée propriétaire, conçue pour Libreville et prête pour GitHub + Netlify.

Au premier lancement, choisissez un code d'accès configuré sur Netlify pour la synchronisation, ou le mode local. L'espace commence vide. Une démonstration peut être chargée depuis **Paramètres**, puis effacée avant de saisir vos propres données.

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
- modification et suppression de chaque élément, quittances de loyer, paramètres, export/import JSON ;
- accès protégé par code et synchronisation avec détection de conflits (Netlify Database).

Les données locales et les caches des différents codes d'accès restent séparés sur le même navigateur. Le code est conservé pendant la session de l'onglet, puis redemandé lors d'une nouvelle session.

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

Pour vérifier uniquement l'interface en mode local, sans installer Netlify CLI :

```bash
npm run build
python3 -m http.server 8080 --directory dist
```

Ouvrez ensuite `http://localhost:8080`. Sans Netlify CLI ou sans base disponible, l'application fonctionne avec le stockage local du navigateur. Une fois déployée sur Netlify, le bouton de synchronisation enregistre l'état du compte courant dans Netlify Database. La synchronisation serveur ne fonctionne pas avec le simple serveur HTTP local.

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

## Sécurité : code d'accès (obligatoire pour la synchronisation)

Dans Netlify : **Project configuration > Environment variables**, ajoutez `ACCESS_CODES` avec un ou plusieurs codes robustes séparés par des virgules (12 caractères minimum, ex. `Code-Fort-2026!`). Chaque code ouvre un espace de données distinct, donc un propriétaire par code. Sans cette variable, l'application reste en mode local. Conservez vos codes hors du dépôt Git.

Pour transférer des données déjà présentes en mode local vers un espace synchronisé, utilisez **Paramètres > Exporter**, connectez-vous avec le code, puis utilisez **Paramètres > Importer**. Pensez à conserver régulièrement une sauvegarde JSON.

## Installer l'application (PWA)

- **Android / Chrome / Edge / PC** : bouton ⤓ en haut de l'écran, ou menu du navigateur > Installer l'application.
- **iPhone (Safari)** : Partager > Sur l'écran d'accueil.

Les icônes sont dans `icons/`. Pour les régénérer : `npm run icons` (Python + Pillow).

## Limites connues

Pas de gestion de rôles : un code = un propriétaire complet. L'état est stocké en un JSON par propriétaire, adapté à un portefeuille de petite taille. Il n'y a pas de récupération de code perdue intégrée. Les documents imprimés reprennent les données disponibles au moment de l'impression ; conservez les exportations et les documents définitifs selon vos besoins.
