# GestiLoc Libreville — version 6

Application web installable (PWA) pour gérer un patrimoine locatif. Le compte démarre **sans bien, locataire, paiement ou document fictif**.

## Fonctionnalités

- Connexion e-mail/mot de passe du propriétaire, invitation et récupération de mot de passe via Netlify Identity. Le rôle `admin` est exigé pour lire ou modifier les données et les photos. Les locataires n'ont aucun compte dans l'application.
- Données de chaque compte isolées dans Netlify Database. Sauvegarde et import JSON, photos incluses, depuis les paramètres.
- Menus déroulants, fiches liées pour biens (dont studios et appartements), logements et locataires, recherche dans les listes et tableau de bord. Le propriétaire administrateur peut modifier et supprimer les fiches. Le statut du logement propose **Vacant**, **Occupé** et **En travaux**.
- Composition guidée : plusieurs pièces de même type, W.C. intégré à la salle d'eau ou séparé, équipements propres à chaque pièce (placards, chauffe-eau, miroir, etc.). Le descriptif du logement et les éléments du constat sont produits à partir de ces choix.
- Parcours du locataire : entrée, bail prérempli, loyers, états des lieux d'entrée et de sortie, clôture de location avec conservation de l'historique.
- Paiements avec montant, mois, date, mode d'encaissement, référence et observations ; reçus et factures imprimables.
- Parcours guidé **propriété → logement → locataire et bail → état d'entrée**. Un logement indiqué « Occupé » ouvre la saisie du locataire ; le bail se préremplit dès que son dossier est enregistré.
- Bail généré dynamiquement à partir des fiches bailleur, bien, logement et locataire. Il reprend les **24 rubriques du modèle fourni**, corrige la double mention contradictoire du dépôt et signale les renseignements restant à compléter.
- États des lieux remplis par le propriétaire avec les sections et éléments détaillés du modèle transmis, adaptés aux pièces réellement saisies. Le constat de sortie compare les éléments et compteurs avec l'entrée. Photos prises ou ajoutées **pendant la saisie du constat**, puis ajoutables depuis sa fiche ; signatures tracées au doigt ou à la souris, finalisation, impression et enregistrement PDF par le navigateur.
- Cloche de notifications dans l'application : loyers à recevoir ou en retard pour le mois en cours, anciennes factures encore impayées, bail expiré ou à échéance, entrée non signée, sortie en brouillon, travaux urgents. Vue globale : occupation, encaissements, soldes, baux, travaux, diagrammes circulaires et historique des six derniers mois.
- PWA avec icônes et lancement direct depuis l'écran d'accueil du téléphone.

## Mettre en ligne sur Netlify

1. Décompressez l'archive dans un dépôt GitHub et importez ce dépôt comme projet Netlify.
2. Les paramètres de `netlify.toml` exécutent `npm run build`, publient `dist` et déploient les fonctions dans `netlify/functions`.
3. Dans le projet Netlify, activez **Identity**, choisissez **Invite only** dans **Identity > Registration > Registration preferences**, puis invitez **votre adresse e-mail** depuis **Identity > Users**. Sur la fiche de cet utilisateur, ouvrez **Edit settings** et ajoutez exactement le rôle `admin` (en minuscules). Acceptez l'invitation, créez le mot de passe et reconnectez-vous après l'attribution du rôle. Aucun locataire ne doit être invité.
4. Dans **Data & Storage > Database**, vérifiez que Netlify Database est provisionnée. Les migrations SQL de `netlify/database/migrations` créent la table applicative. En cas de projet ancien sans base, créez-la depuis ce menu et redéployez.
5. Ouvrez le site en HTTPS. Acceptez votre invitation, connectez-vous avec l'adresse disposant du rôle `admin`, puis saisissez vos coordonnées dans **Paramètres**.
6. Vérifiez en déploiement que la création d'une propriété et son enregistrement affichent **Synchronisé**. Testez aussi un état des lieux avec une photo et une signature avant d'utiliser le site pour des dossiers réels.

`ACCESS_CODES` n'est plus utilisé. Les anciens espaces protégés par code de la v2/v3 ne sont pas automatiquement transférés : si vous y aviez de vraies données, exportez-les depuis l'ancienne application, puis importez ce fichier dans le nouveau compte.

Les données v4 restent liées à l'identifiant du même compte Identity après la mise à jour ; utilisez la même adresse et ne supprimez pas l'utilisateur Identity. Une propriété sans dossier locatif peut être supprimée avec ses logements vacants et interventions associées. Si elle possède un historique de locataires, la commande l'archive et conserve cet historique ; utilisez **Voir les archives** pour la retrouver ou la restaurer. Une propriété occupée ne peut pas être archivée avant la clôture du bail.

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

Les notifications sont visibles dans l'application lorsqu'elle est ouverte ou actualisée. Aucun message push hors ligne, SMS ou e-mail automatique n'est envoyé par cette version.

## Documents et limites

Le bail reprend les 24 intitulés et la logique du modèle transmis. Son texte est reformulé pour éviter de recopier ses clauses contradictoires ou ses informations personnelles ; aucune conformité juridique n'est certifiée. Les renseignements des fiches sont injectés à chaque ouverture du document ; modifiez la fiche concernée pour mettre à jour le bail. Relisez-le et adaptez les conditions et obligations applicables avant signature. La signature manuscrite tracée dans l'application est conservée avec le constat et apparaît à l'impression ; le produit ne fournit ni horodatage qualifié, ni vérification d'identité, ni service de signature électronique certifiée. L'impression du navigateur permet aussi d'enregistrer un PDF.

Les photos sont stockées dans Netlify Blobs (JPEG, PNG ou WebP, 3 Mo maximum par fichier) et servies uniquement après vérification du compte et du dossier. Les autres données sont dans un document JSON par compte dans Netlify Database, avec contrôle de révision. Les exports de sauvegarde intègrent les images dans le fichier JSON, qui peut donc devenir volumineux. Cette architecture convient à un portefeuille de taille modérée. Gardez des exports réguliers de vos dossiers.
