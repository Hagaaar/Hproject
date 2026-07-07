/**
 * H PROJECT — Google Apps Script v4
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
var MAX_ROWS   = 100;     // nombre de lignes d'historique à conserver (hors header)

// ─── MAINTENANCE MANUELLE ──────────────────────────────────────────────────────
// À lancer UNE FOIS à la main depuis l'éditeur (menu ▶ Exécuter → trimSyncSheetNow)
// pour purger immédiatement un historique déjà accumulé au-delà de MAX_ROWS, sans
// attendre le prochain sync (la purge automatique dans doPost prend ensuite le relais).
function trimSyncSheetNow() {
  var sheet = _sheet();
  var lastRow = sheet.getLastRow();
  var headerRow = (sheet.getRange(1,11).getValue() === 'STATUT') ? 2 : 1;
  var dataRows = lastRow - headerRow + 1;
  if (dataRows > MAX_ROWS) {
    sheet.deleteRows(headerRow, dataRows - MAX_ROWS);
    Logger.log('Purgé : ' + (dataRows - MAX_ROWS) + ' lignes supprimées, ' + MAX_ROWS + ' conservées.');
  } else {
    Logger.log('Rien à purger (' + dataRows + ' lignes, sous la limite de ' + MAX_ROWS + ').');
  }
}

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
      return ContentService.createTextOutput('UPLOAD_SUCCESS')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    var sheet = _sheet();
    _headers(sheet);

    // ── GARDE ANTI-RÉGRESSION ──
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var lastJson = sheet.getRange(lastRow, 12).getValue();
      try {
        var lastState = JSON.parse(lastJson);
        if (lastState && (obj.totalDone || 0) < (lastState.totalDone || 0)) {
          return ContentService.createTextOutput('UPLOAD_SUCCESS')
            .setMimeType(ContentService.MimeType.TEXT);
        }
      } catch(_) {}
    }

    // ── Écriture ──
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

    var lr = sheet.getLastRow();
    var r  = sheet.getRange(lr, 1, 1, 12);
    r.setBackground(lr % 2 === 0 ? '#0f1923' : '#141d26');
    r.setFontColor('#e0e0e0');
    sheet.getRange(lr, 3).setFontColor('#fcee0a').setNumberFormat('0');
    sheet.getRange(lr, 4).setFontColor('#00f0ff').setNumberFormat('0');
    sheet.getRange(lr, 10).setFontColor('#00f0ff').setFontWeight('bold').setNumberFormat('0');
    sheet.getRange(lr, 11).setFontColor('#00ff66').setFontWeight('bold');

    if (lr > MAX_ROWS + 1) {
      sheet.deleteRows(2, lr - (MAX_ROWS + 1));
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

    var headerRow = (sheet.getRange(1,11).getValue() === 'STATUT') ? 2 : 1;
    var startRow  = Math.max(headerRow, lastRow - MAX_ROWS + 1);
    var numRows   = lastRow - startRow + 1;
    if (numRows <= 0) {
      return ContentService.createTextOutput(JSON.stringify({ current: null, snapshots: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getRange(startRow, 1, numRows, 12).getValues();

    var current      = null;
    var currentTs    = null;
    var currentScore = 0;
    var snapshots    = [];

    for (var i = data.length - 1; i >= 0; i--) {
      var row    = data[i];
      var status = row[10];
      var json   = row[11];
      var ts     = row[0];

      if (status !== 'OK' || !json) continue;

      try {
        var state = JSON.parse(json);
        if (!state || !state.player) continue;
        var sc = row[9] || _score(state);
        var tsStr = ts instanceof Date ? ts.toISOString() : String(ts);

        if (!current) {
          current      = state;
          currentTs    = tsStr;
          currentScore = sc;
        }

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
