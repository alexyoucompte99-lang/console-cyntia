# Console Cyntia

Console de suivi des missions de Cyntia (assistante d'Alex) : missions avec deadline / temps estimé / lien, cochage + temps réel, EOD quotidien (humeur, énergie, EOD Lauric), récap et data pour Alex.

- **Page live** : https://alexyoucompte99-lang.github.io/console-cyntia/ (vue Cyntia par défaut, vue Alex derrière le code `alex26`, ou `?vue=alex`).
- **Un seul fichier** : `index.html` (tout le rendu en JS, lit/écrit en direct via le pont).
- **Pont Apps Script** : dossier `pont/` (clasp, compte Alex par défaut). Données dans le Google Sheet « Console Cyntia (missions + EOD) » créé par le pont (onglets Missions, EOD). Secrets (token Telegram, id Sheet) dans les ScriptProperties, posés par `what=setup`.
- **Telegram** : message à Alex à chaque EOD envoyé (bot Console I3, chat 5282587091) + alerte 21h15 lundi-vendredi si l'EOD du jour manque (déclencheur `alertMissingEod`).

## Modifier le pont
```
cd pont && clasp push -f && clasp redeploy AKfycbwbkBFu8QWWAL4eL_J-A4N942w_so8qFP0Cb_3v4LnX91FGmclkBjMVCMgEVCiaxYp2vQ -d "desc"
```
Jamais `clasp deploy` (nouvelle URL). Si les scopes changent : relancer `autoriser()` dans l'éditeur.

## Setup (une fois)
```
curl -sL -X POST "$PONT" -H 'Content-Type: text/plain' -d '{"key":"<KEY>","what":"setup","tg_token":"<token>","tg_chat":"5282587091"}'
```
