# AUDIT — H PROJECT index.html
> État au commit 59112fe · 2718 lignes

---

## A. BUGS

### A1 — CRITIQUE : bloc `alert` debug dans `pullFromCloud` (ligne 2650)
Dans la branche `if(best && bestScore > 0)`, un `alert()` debug tourne en production :
```js
setTimeout(()=>alert('DEBUG CLOUD\nstreak dans cloud: '+_dbgStreak+'\nlastStreakDate: '+_dbgDate+...),800);
```
`_dbgStreak` et `_dbgDate` ne sont **jamais déclarés** → `ReferenceError` systématique lors de toute restauration cloud réussie.  
**Action : supprimer ce bloc entier (le `setTimeout(…alert…)`)**

### A2 — `escape()` / `unescape()` dépréciés

| Lieu | Code | Sens |
|------|------|------|
| `exportData()` ligne 2326 | `btoa(unescape(encodeURIComponent(json)))` | encode → base64 |
| `_applyImportText()` ligne 2378 | `decodeURIComponent(escape(atob(cleaned)))` | base64 → decode |

Ces deux fonctions sont dépréciées (retirées de certains environnements stricts).  
Remplacement sûr avec `TextEncoder`/`TextDecoder` sans changer le résultat base64.  
**À traiter après validation que la sortie est byte-pour-byte identique.**

### A3 — Variable `gActive` calculée mais jamais utilisée (ligne 1775)
```js
const gActive = S.guitare.find(g => !g.done); // résultat ignoré
```
Pas un crash, mais code inutile.

---

## B. PERF

### B1 — CRITIQUE : allocations canvas dans `drawFrame` (lignes 1290–1305)
À chaque frame, pour chaque slice dans `slices[]` :
```js
const tmp = document.createElement('canvas');
tmp.width = GW; tmp.height = sh;
const tc = tmp.getContext('2d');
```
Pendant les phases de glitch (`intensity > 0.008`), `buildSlices()` crée entre 5 et ~20 slices. À 60 fps pendant ~2 s, cela représente **jusqu'à ~2 400 allocations canvas** par animation de level-up.

**Avant :** N allocations par frame (N = nombre de slices, jusqu'à ~20)  
**Après cible :** 0 allocation par frame — 1 canvas temporaire réutilisé, alloué une seule fois avant le premier `requestAnimationFrame`

Piste d'optimisation :
- Slices *non-chroma* (`r === 255 && g === 255 && b === 255`) → `drawImage(ofc, 0, sy, GW, sh, s.dx, sy+s.dy, GW, sh)` directement, sans canvas intermédiaire.
- Slices *chroma* (colorées) → utiliser un seul canvas temporaire réutilisé (`tmpCanvas` créé une fois, `.height` ajusté à la volée si `sh` change).

### B2 — rAF orphelin au dismiss de `showLevelUp`
Quand l'overlay est dismissé (clic, touch, ou timeout 4 s), `ov.remove()` est appelé mais `cancelAnimationFrame(rafId)` ne l'est pas. Le loop continue jusqu'à `CLEAR_END` (2,5 s max). Risque minimal car l'overlay disparaît avant le timeout naturel dans la grande majorité des cas, mais la boucle dessine dans un canvas détaché du DOM.

### B3 — `_snBreathe` / neon shop rAF
Non actif (voir C1), donc pas de leak réel actuellement.

---

## C. CODE MORT

### C1 — Système neon shop (lignes 2440–2507)
Fonctions : `_snBuild`, `_snBreathe`, `_snFlicker`, `_snRunSeq`, `initShopNeon`, `stopShopNeon`.  
Variables : `_snRaf`, `_snPhase`, `_snLastTs`, `_snInFlicker`, `_snNextFlicker`, `_snElapsed`, `_snGI`, `_snOn`.

`initShopNeon` et `stopShopNeon` ne sont **appelées nulle part** (`go()` ne les déclenche pas). Le système neon ne s'active jamais.

**Décision par défaut : SUPPRIMER** (recâbler rajouterait un effet invisible → violation contrainte esthétique).

### C2 — IIFE `_startOpFlicker` / `_stopOpFlicker` (lignes 2675–2715)
`window._startOpFlicker` et `window._stopOpFlicker` sont définis par l'IIFE mais uniquement appelés depuis `initShopNeon`/`stopShopNeon` (C1 → jamais actifs).  
L'IIFE s'exécute (inoffensif), mais l'effet de flicker d'opacité ne s'active jamais.

**Décision par défaut : SUPPRIMER** l'IIFE entière (même raison que C1).

### C3 — Formulaire custom shop (lignes 2094, 2111–2119)
`showAddForm` (variable), `toggleAddShop()`, `saveShopItem()` subsistent mais le bouton qui les déclenchait a été retiré du rendu `rShop()`. Aucun chemin UI ne mène à ces fonctions.  
`removeCustomItem()` est **vivant** (toujours appelé dans `rShop()` pour les items custom existants) — à conserver.

**Décision proposée : SUPPRIMER** `showAddForm`, `toggleAddShop`, `saveShopItem`.

### C4 — CSS mort

| Sélecteur | Lignes | Raison |
|-----------|--------|--------|
| `.btn-x { display:none }` | 51 | Les `<span class="btn-x">+</span>` dans `buildUI`/`exList` sont toujours hidden, jamais rendus visibles |
| `#nb-s {}` | 84 | Règle vide |
| `#s-st { padding-top:0px }` | 300 | Aucun élément `#s-st` dans le markup |
| `.wt-chart-wrap`, `.wt-chart-label`, `.wt-chart`, `.wt-chart svg` | 354–357 | Le graphe poids utilise des styles inline, pas ces classes |
| `.st-daily-chart`, `.dc-row`, `.dc-day`, `.dc-track`, `.dc-fill`, `.dc-cnt` | 371–377 | Le graphe d'activité journalière dans `rStats()` utilise des styles inline |
| `.scr-row`, `.scr-label`, `.scr-track`, `.scr-fill`, `.scr-track-txt`, `.scr-reward`, `.scr-earned` | 363–370 | Ancienne barre de progression de stats, `rStats()` ne génère plus ces classes |
| `.gig-count-badge` | 208 | Non référencée dans le JS actuel |

### C5 — Constantes dev (lignes 688–699)
`DEV_RECAP=false` et `MOCK_RECAP={…}` restent en production. Inoffensifs, mais du code qui ne sert jamais.

---

## D. ROBUSTESSE

### D1 — Validation import insuffisante (ligne 2371–2402)
À l'import, seule la présence de `player` est vérifiée avant d'écraser `S` :
```js
if(!d||!d.player) throw new Error('no player');
S=d; // écrase tout S
```
Un code tronqué, corrompu ou d'une app différente avec `player` peut écraser les données sans avertissement.

**Action :** Vérifier avant d'écraser :
- `player.xp`, `player.ip`, `player.level` sont des nombres
- `dailies`, `weeklies` sont des tableaux
- Optionnel : vérifier les ids connus (ex. `d1` dans `dailies`)

### D2 — `escape()` / `unescape()` (voir A2 ci-dessus)

---

## Résumé des priorités d'action

| Priorité | Tâche |
|----------|-------|
| 🔴 P0 | A1 – Supprimer `alert` debug `pullFromCloud` |
| 🔴 P1 | B1 – Refactorer allocations canvas dans `drawFrame` |
| 🟡 P2 | C1+C2 – Supprimer neon shop + IIFE flicker *(après validation)* |
| 🟡 P2 | C3 – Supprimer formulaire custom shop mort |
| 🟡 P2 | C4 – Supprimer CSS mort *(après validation)* |
| 🟠 P3 | A2+D2 – Remplacer `escape`/`unescape` par `TextEncoder`/`TextDecoder` |
| 🟠 P3 | D1 – Renforcer validation à l'import |
| 🔵 P4 | A3 – Supprimer variable `gActive` inutilisée |
| 🔵 P4 | B2 – Annuler rAF au dismiss level-up |
| 🔵 P4 | C5 – Nettoyer `DEV_RECAP`/`MOCK_RECAP` |
