/**
 * H PROJECT — Google Apps Script v2
 *
 * DÉPLOIEMENT :
 * 1. script.google.com → ton projet → remplace TOUT le code par ceci
 * 2. Déployer → Gérer les déploiements → crayon → Nouvelle version → Enregistrer
 * (L'URL reste identique)
 *
 * STRUCTURE DE LA FEUILLE (colonnes A→L) :
 * A: Date/Heure  B: Niveau  C: REP(XP)  D: Eddies(E$)  E: Streak
 * F: Dailies  G: Gigs  H: Portfolio  I: Mémoire  J: Score  K: Statut  L: JSON
 */

var SECRET_PIN = "48960"; // ← ton PIN
var MAX_ROWS = 300; // cap l'historique : au-delà, doGet() doit lire/parser chaque ligne
                     // à chaque sync, donc une feuille non bornée ralentit (et finit par
                     // timeout) tous les appareils, en particulier sur réseau mobile

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _score(d) {
  if (!d || !d.player) return 0;
  return (d.player.xp || 0) + (d.player.ip || 0) + ((d.totalDone || 0) * 10);
}

function _done(arr) {
  if (!Array.isArray(arr)) return '-';
  var n = arr.filter(function(x){ return x.done; }).length;
  return n + '/' + arr.length;
}

function _sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('SYNC') || ss.getActiveSheet();
}

function _headers(sheet) {
  if (sheet.getLastRow() > 0) return; // déjà initialisé
  sheet.appendRow([
    'DATE / HEURE','NIVEAU','REP (XP)','EDDIES (E$)','STREAK',
    'DAILIES','GIGS','PORTFOLIO','MÉMOIRE','SCORE','STATUT','JSON'
  ]);
  var h = sheet.getRange(1, 1, 1, 12);
  h.setBackground('#0b1118');
  h.setFontColor('#fcee0a');
  h.setFontWeight('bold');
  h.setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(12, 60);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var raw = e.postData.contents;
    var obj = null;
    try { obj = JSON.parse(raw); } catch(_) {}

    // ── Authentification ──
    if (obj && obj.action === 'auth') {
      return ContentService
        .createTextOutput(obj.pin === SECRET_PIN ? 'AUTH_SUCCESS' : 'AUTH_DENIED')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // ── Validation données ──
    if (!obj || !obj.player) {
      return ContentService.createTextOutput('UPLOAD_SUCCESS')
        .setMimeType(ContentService.MimeType.TEXT);
    }
    var score = _score(obj);
    if (score <= 0) {
      // Données nulles : refus silencieux (ne rien écrire)
      return ContentService.createTextOutput('UPLOAD_SUCCESS')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // ── Écriture ──
    var sheet = _sheet();
    _headers(sheet);
    var p   = obj.player;
    var row = [
      new Date(),
      'Niv. ' + (p.level || 1),
      p.xp    || 0,
      p.ip    || 0,
      (p.streak || 0) + ' j.',
      _done(obj.dailies),
      _done(obj.weeklies),
      _done(obj.portfolio),
      _done(obj.memoire),
      score,
      'OK',
      raw
    ];
    sheet.appendRow(row);

    // Style de la nouvelle ligne (un seul appel setBackground + un seul setFontColors
    // au lieu de 5 appels Range séparés — chaque appel Sheets coûte du temps d'exécution,
    // et c'est ce budget qui manque le plus quand le script tourne à froid)
    var lr = sheet.getLastRow();
    var r  = sheet.getRange(lr, 1, 1, 12);
    r.setBackground(lr % 2 === 0 ? '#0f1923' : '#141d26');
    r.setFontColors([[
      '#e0e0e0','#e0e0e0','#fcee0a','#00f0ff','#e0e0e0',
      '#e0e0e0','#e0e0e0','#e0e0e0','#e0e0e0','#00f0ff','#00ff66','#e0e0e0'
    ]]);
    sheet.getRange(lr, 10, 1, 2).setFontWeight('bold'); // Score + Statut

    // Purge des lignes les plus anciennes au-delà de MAX_ROWS pour garder doGet() rapide
    var dataRows = lr - 1;
    if (dataRows > MAX_ROWS) {
      sheet.deleteRows(2, dataRows - MAX_ROWS);
    }

    return ContentService.createTextOutput('UPLOAD_SUCCESS')
      .setMimeType(ContentService.MimeType.TEXT);

  } catch(err) {
    return ContentService.createTextOutput('ERREUR: ' + err.toString())
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    var sheet  = _sheet();
    var lastRow = sheet.getLastRow();

    // ── Fallback : ancien format (1 ligne, colonne B = JSON brut) ──
    // Si la feuille a 1 seule ligne sans header "DATE / HEURE"
    if (lastRow === 1) {
      var cell = sheet.getRange(1, 2).getValue();
      if (cell && typeof cell === 'string' && cell.indexOf('"player"') !== -1) {
        try {
          var old = JSON.parse(cell);
          if (old && old.player && _score(old) > 0) {
            return ContentService.createTextOutput(JSON.stringify({
              current:      old,
              currentTs:    sheet.getRange(1, 1).getValue().toString(),
              currentScore: _score(old),
              snapshots:    [{ ts: sheet.getRange(1, 1).getValue().toString(), score: _score(old), data: old }]
            })).setMimeType(ContentService.MimeType.JSON);
          }
        } catch(_) {}
      }
    }

    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ current: null, snapshots: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Lecture des lignes (on saute la ligne de header) ──
    var startRow = (sheet.getRange(1,11).getValue() === 'STATUT') ? 2 : 1;
    var numRows  = lastRow - startRow + 1;
    if (numRows <= 0) {
      return ContentService.createTextOutput(JSON.stringify({ current: null, snapshots: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getRange(startRow, 1, numRows, 12).getValues();

    var current      = null;
    var currentTs    = null;
    var currentScore = 0;
    var snapshots    = [];

    // Parcourir du plus récent (bas) au plus ancien (haut)
    for (var i = data.length - 1; i >= 0; i--) {
      var row    = data[i];
      var status = row[10]; // col K
      var json   = row[11]; // col L
      var ts     = row[0];  // col A

      if (status !== 'OK' || !json) continue;

      try {
        var state = JSON.parse(json);
        if (!state || !state.player) continue;
        var sc = row[9] || _score(state);
        var tsStr = ts instanceof Date ? ts.toISOString() : String(ts);

        // current = ligne la plus récente valide (première trouvée en descendant)
        if (!current) {
          current      = state;
          currentTs    = tsStr;
          currentScore = sc;
        }

        // snapshots = 30 derniers
        if (snapshots.length < 30) {
          snapshots.push({ ts: tsStr, score: sc, data: state });
        }
      } catch(_) {}
    }

    return ContentService.createTextOutput(JSON.stringify({
      current:      current,
      currentTs:    currentTs,
      currentScore: currentScore,
      snapshots:    snapshots
    })).setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
