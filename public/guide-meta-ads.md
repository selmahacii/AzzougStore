# Guide d'Intégration Meta Ads pour AzzougShop

Ce guide vous accompagne étape par étape pour configurer votre compte Facebook (Meta Ads) sur votre boutique AzzougShop.

## Pourquoi connecter Meta Ads ?
En connectant votre compte, vous permettez à la boutique d'envoyer vos événements d'achats directement via l'**API Conversions**. Cela garantit que :
- Vous ne perdez aucune donnée d'achat (même avec les bloqueurs de pub).
- Votre **ROAS (Retour sur Investissement)** est calculé automatiquement sur votre tableau de bord.

---

## Étape 1 : Récupérer votre "ID Compte Publicitaire"

1. Connectez-vous à votre **Gestionnaire de Publicités Facebook**.
2. Regardez dans le menu déroulant en haut à gauche. Vous verrez le nom de votre compte suivi d'un numéro entre parenthèses, par exemple : `Mon Business (1234567890)`.
3. Copiez uniquement les numéros (`1234567890`).
4. Dans le tableau de bord AzzougShop, ajoutez impérativement le préfixe **`act_`** devant ce numéro.
   - Exemple : **`act_1234567890`**

---

## Étape 2 : Récupérer votre "Pixel ID"

1. Rendez-vous dans les **Paramètres d'entreprise Meta** (Business Settings).
2. Dans le menu à gauche, sous **Sources de données**, cliquez sur **Ensembles de données** (ou *Pixels*).
   - *Si vous n'avez pas de Pixel :* Cliquez sur le bouton bleu **+ Ajouter**, nommez-le "Pixel AzzougShop" et validez.
3. Sélectionnez votre Pixel dans la liste. 
4. Au centre de la page, vous verrez un numéro bleu sous le nom de votre Pixel (par exemple : `26338621205813257`).
5. Copiez ce numéro et collez-le dans le champ **Pixel ID (Meta Pixel)** sur AzzougShop.

---

## Étape 3 : Générer le "Token d'accès API"

1. Toujours sur la page de votre Pixel (à l'Étape 2), cliquez sur le lien bleu **Ouvrir dans le gestionnaire d'évènements** situé au centre ou en haut à droite.
2. Une nouvelle page s'ouvre. Cliquez sur l'onglet **Paramètres** (Settings) juste sous le nom de votre Pixel.
3. Descendez tout en bas de la page jusqu'à la section **API Conversions**.
4. Sous *Configurer manuellement*, cliquez sur le lien bleu **Générer un jeton d'accès** (Generate access token).
5. Une longue série de caractères commençant par `EAA...` s'affiche.
6. Cliquez sur cette clé pour la copier, puis collez-la dans le champ **Token d'accès API (Conversions API)** sur AzzougShop.

---

## Étape 4 : Récupérer la "Vérification de Domaine"

1. Retournez dans les **Paramètres d'entreprise Meta** (Business Settings).
2. Dans le menu de gauche, descendez jusqu'à **Brand Safety et sécurité**, puis cliquez sur **Domaines**.
3. Cliquez sur le bouton bleu **Ajouter** puis sur **Créer un nouveau domaine**.
4. Entrez le lien de votre boutique (exemple : `maboutique.com` sans `https://`) et validez.
5. Meta affichera 3 options. Gardez celle par défaut : **Ajouter une balise meta à votre code source HTML**.
6. Vous verrez une phrase en gras comme : `<meta name="facebook-domain-verification" content="..." />`.
7. Cliquez sur cette phrase pour la copier.
8. Collez l'intégralité de cette phrase dans le champ **Vérification de Domaine (Meta Tag)** sur AzzougShop.

---

## Étape 5 : Activer la connexion

1. Vous avez rempli les 4 champs sur AzzougShop. Cliquez sur **Activer la connexion**.
2. Un message de succès vert doit s'afficher.
3. *Facultatif :* Retournez sur Facebook (étape 4) et cliquez sur le bouton vert **Vérifier le domaine**.

---

## TRÈS IMPORTANT : Le suivi de vos publicités (UTM)

Pour que AzzougShop puisse calculer votre ROAS et lier chaque achat à la bonne publicité, vous devez ajouter un paramètre à chaque publicité que vous créez.

Lors de la création de votre publicité sur Facebook :
1. Descendez tout en bas jusqu'à la section **Suivi** (Tracking).
2. Dans le champ **Paramètres d'URL** (URL Parameters), collez très exactement ceci :
   `utm_campaign={{campaign.name}}`

Sans cela, les revenus ne remonteront pas sur votre tableau de bord AzzougShop !
