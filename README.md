# GestiLoc Libreville — version 4

Application web installable (PWA) pour gérer un patrimoine locatif. Le compte démarre **sans bien, locataire, paiement ou document fictif**.

## Fonctionnalités

- Connexion e-mail/mot de passe, création de compte, confirmation par e-mail et récupération de mot de passe via Netlify Identity.
- Données de chaque compte isolées dans Netlify Database. Sauvegarde et import JSON, photos incluses, depuis les paramètres.
- Menus déroulants, fiches liées pour biens, logements et locataires, recherche dans les listes et tableau de bord.
- Parcours du locataire : entrée, bail prérempli, loyers, états des lieux d'entrée et de sortie, clôture de location avec conservation de l'historique.
- Paiements avec montant, mois, date, mode d'encaissement, référence et observations ; reçus et factures imprimables.
- États des lieux remplis par le propriétaire, grille détaillée, photos prises depuis le téléphone ou ajoutées depuis la galerie, signatures tracées au doigt ou à la souris, finalisation, impression et enregistrement PDF par le navigateur.
- PWA avec icônes et lancement direct depuis l'écran d'accueil du téléphone.

## Mettre en ligne sur Netlify

1. Décompressez l'archive dans un dépôt GitHub et importez ce dépôt comme projet Netlify.
2. Les paramètres de `netlify.toml` exécutent `npm run build`, publient `dist` et déploient les fonctions dans `netlify/functions`.
3. Dans le projet Netlify, activez **Identity**. Choisissez l'inscription ouverte si les propriétaires créent eux-mêmes leur compte, ou **Invite only** puis invitez les adresses e-mail autorisées. Conservez la confirmation par e-mail activée.
4. Dans **Data & Storage > Database**, vérifiez que Netlify Database est provisionnée. Les migrations SQL de `netlify/database/migrations` créent la table applicative. En cas de projet ancien sans base, créez-la depuis ce menu et redéployez.
5. Ouvrez le site en HTTPS. Créez/confirmez le premier compte ou acceptez une invitation, puis saisissez les coordonnées du bailleur dans **Paramètres**.
6. Vérifiez en déploiement que la création d'une propriété et son enregistrement affichent **Synchronisé**. Testez aussi un état des lieux avec une photo et une signature avant d'utiliser le site pour des dossiers réels.

`ACCESS_CODES` n'est plus utilisé. Les anciens espaces protégés par code de la v2/v3 ne sont pas automatiquement transférés : si vous y aviez de vraies données, exportez-les depuis l'ancienne application, puis importez ce fichier dans le nouveau compte.

## Développement

```bash
npm ci
npm run build
npm run dev
```

Le build produit les fichiers statiques dans `dist`. L'authentification Identity et l'accès aux services Netlify doivent être vérifiés sur un déploiement Netlify, y compris un déploiement de prévisualisation. Un simple serveur HTTP local permet de voir l'écran de connexion, mais ne fournit pas l'identité, la base ni les photos.

## Installer sur téléphone

- Android avec Chrome/Edge : ouvrez le site HTTPS, puis utilisez **Installer l'application** si proposé ou l'option du menu du navigateur.
- iPhone avec Safari : **Partager > Sur l'écran d'accueil**.

L'icône ouvre le site directement en mode application. Une connexion Internet reste nécessaire pour accéder aux dossiers et aux photos ; le cache PWA contient seulement l'interface.

## Documents et limites

Le bail est un modèle prérempli avec des champs et clauses complémentaires éditables. Relisez-le et adaptez-le aux obligations applicables avant signature. La signature manuscrite tracée dans l'application est conservée avec le constat et apparaît à l'impression ; le produit ne fournit ni horodatage qualifié, ni vérification d'identité, ni service de signature électronique certifiée. L'impression du navigateur permet aussi d'enregistrer un PDF.

Les photos sont stockées dans Netlify Blobs (JPEG, PNG ou WebP, 3 Mo maximum par fichier) et servies uniquement après vérification du compte et du dossier. Les autres données sont dans un document JSON par compte dans Netlify Database, avec contrôle de révision. Les exports de sauvegarde intègrent les images dans le fichier JSON, qui peut donc devenir volumineux. Cette architecture convient à un portefeuille de taille modérée. Gardez des exports réguliers de vos dossiers.
