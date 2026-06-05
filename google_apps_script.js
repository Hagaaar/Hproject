/**
 * H PROJECT — Google Apps Script (serveur de sync)
 *
 * DÉPLOIEMENT :
 * 1. Ouvre script.google.com → ton projet existant
 * 2. Remplace TOUT le code par ce fichier
 * 3. Clique "Déployer" → "Gérer les déploiements"
 * 4. Clique l'icône crayon sur le déploiement existant
 * 5. Sélectionne "Nouvelle version" → Enregistrer
 * (L'URL reste identique — rien à changer dans index.html)
 *
 * STOCKAGE : Script Properties (pas de feuille nécessaire)
 * - CURRENT  : dernier état reçu avec données non-nulles
 * - DAY_YYYY-MM-DD : meilleur snapshot de chaque jour (30 jours conservés)
 * Limite Script Properties : 9 MB total, 500 KB/propriété — largement suffisant
 */

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _score(d) {
  if (!d || !d.player) return 0;
  return (d.player.xp || 0) + (d.player.ip || 0) + ((d.totalDone || 0) * 10);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── POST : reçoit un état depuis le client ───────────────────────────────────

function doPost(e) {
  try {
    const incoming = JSON.parse(e.postData.contents);

    // Rejeter si pas de player ou données nulles
    if (!incoming || !incoming.player) {
      return _json({ ok: true, accepted: false, reason: 'no_player' });
    }
    const score = _score(incoming);
    if (score <= 0) {
      return _json({ ok: true, accepted: false, reason: 'zero_data' });
    }

    const store = PropertiesService.getScriptProperties();
    const ts    = new Date().toISOString();
    const day   = ts.slice(0, 10);             // "YYYY-MM-DD"
    const pkg   = JSON.stringify({ ts: ts, score: score, data: incoming });

    // 1. Toujours écraser CURRENT si les données sont valides
    store.setProperty('CURRENT', pkg);

    // 2. Snapshot quotidien : garder le meilleur de la journée
    const dayKey = 'DAY_' + day;
    const existing = store.getProperty(dayKey);
    let saveSnap = true;
    if (existing) {
      try {
        const ex = JSON.parse(existing);
        if (score <= (ex.score || 0)) saveSnap = false;
      } catch (_) {}
    }
    if (saveSnap) store.setProperty(dayKey, pkg);

    // 3. Nettoyer les snapshots > 30 jours
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const all = store.getProperties();
      Object.keys(all).forEach(function(k) {
        if (k.indexOf('DAY_') === 0) {
          if (new Date(k.slice(4)) < cutoff) store.deleteProperty(k);
        }
      });
    } catch (_) {}

    return _json({ ok: true, accepted: true, score: score });

  } catch (err) {
    return _json({ ok: false, error: err.toString() });
  }
}

// ─── GET : renvoie l'état courant + tous les snapshots ───────────────────────

function doGet(e) {
  try {
    const store = PropertiesService.getScriptProperties();
    const all   = store.getProperties();

    // État courant
    var current = null, currentTs = null, currentScore = 0;
    try {
      const c = JSON.parse(all['CURRENT'] || 'null');
      if (c) { current = c.data; currentTs = c.ts; currentScore = c.score || 0; }
    } catch (_) {}

    // Snapshots quotidiens (triés du plus récent au plus ancien)
    var snapshots = [];
    Object.keys(all).forEach(function(k) {
      if (k.indexOf('DAY_') === 0) {
        try {
          const s = JSON.parse(all[k]);
          snapshots.push({ date: k.slice(4), ts: s.ts, score: s.score || 0, data: s.data });
        } catch (_) {}
      }
    });
    snapshots.sort(function(a, b) { return b.date.localeCompare(a.date); });

    return _json({
      current:      current,
      currentTs:    currentTs,
      currentScore: currentScore,
      snapshots:    snapshots   // [{date, ts, score, data}, ...]
    });

  } catch (err) {
    return _json({ error: err.toString() });
  }
}
