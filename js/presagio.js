// ============================================================
// PRESAGIO — Pre-analisi avanzata per BettingPro
// ============================================================
// Modulo self-contained che legge state.analysis (gia' calcolato
// da buildAnalysis in app.js) e produce:
//   • 5 metriche visuali (IRC, MOT, FOR per squadra + Classifica
//     Congrua e Tendenza O/U globali)
//   • 6 pronostici (Segno Secco, Doppia Chance, Over/Under,
//     GG/NG, Over 0.5 PT, Multigol)
//   • Risultato esatto Poisson + top 3
//
// Integrazione: include questo file DOPO app.js. Espone
// window.Presagio.render(match, analysis) -> string HTML
// e window.presagioReveal(matchId) -> trigger del click ANALIZZA.
// ============================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  // UTIL
  // ------------------------------------------------------------
  const clamp = (lo, x, hi) => Math.max(lo, Math.min(hi, x));
  const round = (x) => Math.round(x);
  const safe = (x, fb) => (typeof x === 'number' && !isNaN(x)) ? x : fb;
  const escHTML = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Memoization per evitare ricalcoli durante re-render
  // (state.analysis e' immutabile per matchId, quindi il risultato e' stabile)
  const calcCache = new Map(); // matchId -> result

  // ------------------------------------------------------------
  // METRICHE
  // ------------------------------------------------------------

  // IRC — Indice Reattivita' Comparata (0-100)
  // Misura quanto la squadra rende rispetto alla media campionato.
  // Combina efficienza offensiva, difensiva, clean sheet% e
  // failed-to-score%.
  function calcIRC(teamData) {
    if (!teamData) return 50;
    const goalsFor      = safe(teamData.goalsFor, 1.3);
    const goalsAgainst  = safe(teamData.goalsAgainst, 1.2);
    const cleanSheetPct = safe(teamData.cleanSheetPct, 25);
    const failedToScore = safe(teamData.failedToScorePct, 25);

    let irc = 50;
    irc += 25 * (goalsFor / 1.4 - 1);          // efficienza offensiva
    irc -= 18 * (goalsAgainst / 1.3 - 1);      // efficienza difensiva
    irc += 0.4 * (cleanSheetPct - 25);         // bonus clean sheet
    irc -= 0.25 * (failedToScore - 25);        // malus failed-to-score
    return round(clamp(0, irc, 100));
  }

  // MOT — Motivazione (0-100)
  // Funzione a gradini sulla posizione + bonus casa.
  function calcMOT(position, totalTeams, isHome) {
    const totalT = (totalTeams && totalTeams >= 10) ? totalTeams : 20;
    if (!position || position <= 0) {
      return isHome ? 55 : 50;
    }
    const ratio = position / totalT;

    let mot;
    if (ratio <= 0.15)      mot = 82;   // lotta titolo (top ~3)
    else if (ratio >= 0.85) mot = 78;   // lotta salvezza (ultime ~3)
    else if (ratio <= 0.30) mot = 65;   // zona Champions
    else if (ratio <= 0.50) mot = 52;   // zona Europa
    else if (ratio >= 0.70) mot = 60;   // sopra retrocessione
    else                    mot = 42;   // meta' classifica

    if (isHome) mot += 5;
    return round(clamp(0, mot, 100));
  }

  // FOR — Forbice/Forma (0-100)
  // Calcolo letterale dalle ultime 5: (W*3 + D*1) / 15 * 100.
  function calcFOR(formStr) {
    if (!formStr || typeof formStr !== 'string') return 50;
    const last5 = formStr.replace(/[^WDL]/g, '').slice(-5);
    if (last5.length === 0) return 50;
    let pts = 0;
    for (const c of last5) {
      if (c === 'W') pts += 3;
      else if (c === 'D') pts += 1;
    }
    const max = last5.length * 3;
    return round((pts / max) * 100);
  }

  // Classifica Congrua (0-100, 50 = neutro)
  // Confronta punti reali vs attesi (basati sul differenziale gol).
  // >50 = sta meglio di quanto meriti, <50 = sfortunata.
  function calcCongruity(homeData, awayData) {
    function teamCong(t) {
      if (!t || !t.played || t.played < 3) return 50;
      const expectedPpg = 1.0 + (safe(t.goalsFor, 1.3) - safe(t.goalsAgainst, 1.2)) * 0.6;
      const actualPpg   = ((safe(t.wins, 0) * 3) + safe(t.draws, 0)) / t.played;
      return 50 + (actualPpg - expectedPpg) * 35;
    }
    const avg = (teamCong(homeData) + teamCong(awayData)) / 2;
    return round(clamp(0, avg, 100));
  }

  // Tendenza Over/Under (0-100, >50 = tendenza Over)
  // Combina media gol stagionali (60%) e xG di questa partita (40%).
  function calcTendenza(homeData, awayData, xG) {
    const hF = safe(homeData?.goalsFor, 1.3) + safe(homeData?.goalsAgainst, 1.2);
    const aF = safe(awayData?.goalsFor, 1.3) + safe(awayData?.goalsAgainst, 1.2);
    const seasonalRate = (hF + aF) / 2;                 // gol totali medi
    const matchXG      = safe(xG?.total, 2.5);
    const tendency     = 50 + (seasonalRate - 2.5) * 18 + (matchXG - 2.5) * 12;
    return round(clamp(0, tendency, 100));
  }

  // ------------------------------------------------------------
  // PRONOSTICI (lettura diretta da analysis)
  // ------------------------------------------------------------

  function pickSegnoSecco(p1X2) {
    const h = safe(p1X2?.home, 33), d = safe(p1X2?.draw, 33), a = safe(p1X2?.away, 33);
    const m = Math.max(h, d, a);
    if (h === m) return { value: '1', prob: h };
    if (a === m) return { value: '2', prob: a };
    return { value: 'X', prob: d };
  }

  function pickDoppiaChance(p1X2) {
    const h = safe(p1X2?.home, 33), d = safe(p1X2?.draw, 33), a = safe(p1X2?.away, 33);
    const opts = [
      { value: '1X', prob: h + d },
      { value: 'X2', prob: d + a },
      { value: '12', prob: h + a }
    ];
    return opts.reduce((b, c) => c.prob > b.prob ? c : b);
  }

  function pickOverUnder(pOU) {
    if (!pOU) return { value: 'Over 1.5', prob: 75 };
    const opts = [
      { value: 'Over 1.5',  prob: safe(pOU[1.5]?.over,  0) },
      { value: 'Over 2.5',  prob: safe(pOU[2.5]?.over,  0) },
      { value: 'Under 2.5', prob: safe(pOU[2.5]?.under, 0) },
      { value: 'Under 3.5', prob: safe(pOU[3.5]?.under, 0) }
    ].filter(o => o.prob > 0);
    if (!opts.length) return { value: 'Over 1.5', prob: 75 };
    return opts.reduce((b, c) => c.prob > b.prob ? c : b);
  }

  function pickGGNG(pBTTS) {
    const p = safe(pBTTS, 50);
    return p >= 50 ? { value: 'GG', prob: p } : { value: 'NG', prob: 100 - p };
  }

  // Over 0.5 PT — Poisson con lambda primo tempo (~42% del totale match)
  function pickOver05PT(xG, temporal) {
    let lambdaPT;
    if (temporal && typeof temporal.firstHalf === 'number') {
      lambdaPT = temporal.firstHalf;
    } else {
      lambdaPT = safe(xG?.total, 2.5) * 0.42;
    }
    lambdaPT = clamp(0.1, lambdaPT, 4);
    const probNoGoal = Math.exp(-lambdaPT) * 100;
    const probSi     = 100 - probNoGoal;
    return probSi >= 50
      ? { value: 'SÌ', prob: probSi }
      : { value: 'NO', prob: probNoGoal };
  }

  // Multigol — sceglie il range con la probabilita' piu' alta tra
  // i range "scommessibili" classici.
  function pickMultigol(multigoal) {
    const ranges = ['1-2', '1-3', '2-3', '2-4', '3-4', '0-2'];
    if (!Array.isArray(multigoal) || multigoal.length === 0) {
      return { value: '1-3', prob: 65 };
    }
    let best = null;
    for (const r of ranges) {
      const m = multigoal.find(x => x.range === r);
      if (m && (!best || safe(m.prob, 0) > best.prob)) {
        best = { value: r, prob: safe(m.prob, 0) };
      }
    }
    return best || { value: '1-3', prob: 65 };
  }

  function pickExactScore(exactScores) {
    if (!Array.isArray(exactScores) || exactScores.length === 0) {
      return {
        best: { score: '1-1', prob: 12 },
        top3: [{ score: '1-1', prob: 12 }]
      };
    }
    // calcExactScores in app.js produce oggetti con campi { h, a, p, prob }.
    // Manteniamo fallback verso { home, away, score } per robustezza futura.
    const top3 = exactScores.slice(0, 3).map(s => {
      const h = (s.h ?? s.home);
      const a = (s.a ?? s.away);
      const score = s.score || (h != null && a != null ? h + '-' + a : '?-?');
      const prob = safe(s.prob ?? s.p, 0);
      return { score, prob };
    });
    return { best: top3[0], top3 };
  }

  // ------------------------------------------------------------
  // CALCOLO COMPLETO
  // ------------------------------------------------------------

  function calculate(analysis, match) {
    if (!analysis || !match) return null;

    // Cache check (stabile per matchId finche' state.analysis e' lo stesso)
    const cacheKey = match.id + '_' + (analysis.xG?.total || 0).toFixed(3);
    if (calcCache.has(cacheKey)) return calcCache.get(cacheKey);

    try {
      const {
        xG, p1X2, pOU, pBTTS, exactScores, multigoal, temporalDistribution,
        homeData, awayData, homePosition, awayPosition, miniStandings,
        homeForm, awayForm
      } = analysis;

      // Numero squadre nel campionato (fallback 20)
      const totalTeams = (Array.isArray(miniStandings) && miniStandings.length >= 10)
        ? miniStandings.length
        : 20;

      const ircHome = calcIRC(homeData);
      const ircAway = calcIRC(awayData);
      const motHome = calcMOT(homePosition, totalTeams, true);
      const motAway = calcMOT(awayPosition, totalTeams, false);
      const forHome = calcFOR(homeForm);
      const forAway = calcFOR(awayForm);

      const totalHome = ircHome + motHome + forHome;   // 0-300
      const totalAway = ircAway + motAway + forAway;

      const congruity = calcCongruity(homeData, awayData);
      const tendenza  = calcTendenza(homeData, awayData, xG);

      const predictions = {
        segnoSecco:   pickSegnoSecco(p1X2),
        doppiaChance: pickDoppiaChance(p1X2),
        overUnder:    pickOverUnder(pOU),
        ggng:         pickGGNG(pBTTS),
        over05PT:     pickOver05PT(xG, temporalDistribution),
        multigol:     pickMultigol(multigoal)
      };

      const exact = pickExactScore(exactScores);

      const result = {
        metrics: {
          home: { irc: ircHome, mot: motHome, for: forHome, total: totalHome },
          away: { irc: ircAway, mot: motAway, for: forAway, total: totalAway },
          congruity,
          tendenza
        },
        predictions,
        exactResult: exact,
        meta: {
          calculatedAt: Date.now(),
          dataQuality: analysis.quality || 'base'
        }
      };

      calcCache.set(cacheKey, result);
      return result;
    } catch (e) {
      console.warn('Presagio.calculate error:', e);
      return null;
    }
  }

  // Confidence -> classe CSS per bordo colorato (verde/giallo/rosso)
  function confidenceClass(prob) {
    if (prob >= 70) return 'psg-conf-hi';
    if (prob >= 50) return 'psg-conf-md';
    return 'psg-conf-lo';
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------

  function render(match, analysis) {
    if (!analysis) {
      return '<div class="psg-empty">⏳ Dati partita ancora in caricamento...</div>';
    }

    const p = calculate(analysis, match);
    if (!p) {
      return '<div class="psg-empty">⚠️ Impossibile calcolare il Presagio per questa partita</div>';
    }

    const matchId = match.id;
    const revealed = !!(window.state?.presagioRevealed?.[matchId]);

    const homeName = escHTML(match.home?.name || 'Casa');
    const awayName = escHTML(match.away?.name || 'Ospite');
    const homeLogo = escHTML(match.home?.logo || '');
    const awayLogo = escHTML(match.away?.logo || '');

    // ===== HEADER + PUNTEGGI TOTALI =====
    let html = '<div class="psg">';

    html += '<div class="psg-brand">';
    html +=   '<div class="psg-brand-mark">◇</div>';
    html +=   '<div class="psg-brand-name">PRESAGIO</div>';
    html +=   '<div class="psg-brand-tag">pre-analisi</div>';
    html += '</div>';

    html += '<div class="psg-totals">';
    html +=   '<div class="psg-team">';
    html +=     (homeLogo ? '<img class="psg-team-logo" src="' + homeLogo + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="psg-team-logo-fallback">' + homeName.substring(0,2).toUpperCase() + '</div>');
    html +=     '<div class="psg-team-name">' + homeName + '</div>';
    html +=     '<div class="psg-team-total">' + p.metrics.home.total + '</div>';
    html +=   '</div>';
    html +=   '<div class="psg-vs">VS</div>';
    html +=   '<div class="psg-team">';
    html +=     (awayLogo ? '<img class="psg-team-logo" src="' + awayLogo + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="psg-team-logo-fallback">' + awayName.substring(0,2).toUpperCase() + '</div>');
    html +=     '<div class="psg-team-name">' + awayName + '</div>';
    html +=     '<div class="psg-team-total">' + p.metrics.away.total + '</div>';
    html +=   '</div>';
    html += '</div>';

    // ===== SLIDER DOPPI (IRC, MOT, FOR) =====
    html += renderDualSlider('IRC · REATTIVITÀ',  p.metrics.home.irc, p.metrics.away.irc);
    html += renderDualSlider('MOT · MOTIVAZIONE', p.metrics.home.mot, p.metrics.away.mot);
    html += renderDualSlider('FOR · FORBICE',     p.metrics.home.for, p.metrics.away.for);

    // ===== SLIDER SINGOLI =====
    html += renderSingleSlider('CLASSIFICA CONGRUA',     p.metrics.congruity);
    html += renderSingleSlider('TENDENZA OVER / UNDER',  p.metrics.tendenza);

    // ===== AZIONE / RISULTATI =====
    if (!revealed) {
      html += '<button class="psg-analyze" onclick="presagioReveal(' + matchId + ')">';
      html +=   '<span class="psg-analyze-icon">▶</span>';
      html +=   '<span>ANALIZZA</span>';
      html += '</button>';
    } else {
      html += renderResults(p, matchId);
    }

    html += '</div>';
    return html;
  }

  function renderDualSlider(label, homeVal, awayVal) {
    // larghezza barra: valore/2 (max 50% per lato → si toccano al centro a valore 100)
    const wL = clamp(0, homeVal / 2, 50);
    const wR = clamp(0, awayVal / 2, 50);
    return '' +
      '<div class="psg-sl">' +
        '<div class="psg-sl-label">' + escHTML(label) + '</div>' +
        '<div class="psg-sl-row">' +
          '<div class="psg-sl-val">' + homeVal + '</div>' +
          '<div class="psg-sl-bar">' +
            '<div class="psg-sl-bar-l" style="width:' + wL.toFixed(1) + '%"></div>' +
            '<div class="psg-sl-bar-r" style="width:' + wR.toFixed(1) + '%"></div>' +
          '</div>' +
          '<div class="psg-sl-val">' + awayVal + '</div>' +
        '</div>' +
      '</div>';
  }

  function renderSingleSlider(label, value) {
    const w = clamp(0, value, 100);
    return '' +
      '<div class="psg-sl">' +
        '<div class="psg-sl-label">' + escHTML(label) + '</div>' +
        '<div class="psg-ss-val">' + value + '</div>' +
        '<div class="psg-ss-bar">' +
          '<div class="psg-ss-fill" style="width:' + w + '%"></div>' +
        '</div>' +
      '</div>';
  }

  function renderResults(p, matchId) {
    const preds = p.predictions;
    const ex    = p.exactResult;

    let h = '<div class="psg-results">';

    // Header risultati
    h += '<div class="psg-results-head">';
    h +=   '<div class="psg-results-title">I PRONOSTICI <span class="psg-poisson-tag">POISSON</span></div>';
    h +=   '<button class="psg-recalc" onclick="presagioRecalc(' + matchId + ')" title="Ricalcola">↻</button>';
    h += '</div>';

    // Griglia 6 box pronostici
    h += '<div class="psg-grid">';
    h += renderPredBox('SEGNO SECCO',     preds.segnoSecco);
    h += renderPredBox('DOPPIA CHANCE',   preds.doppiaChance);
    h += renderPredBox('OVER / UNDER',    preds.overUnder);
    h += renderPredBox('GG / NG',         preds.ggng);
    h += renderPredBox('OVER 0.5 PT',     preds.over05PT);
    h += renderPredBox('MULTIGOL',        preds.multigol);
    h += '</div>';

    // Risultato esatto + top 3
    h += '<div class="psg-exact">';
    h +=   '<div class="psg-exact-label">RISULTATO ESATTO PIÙ PROBABILE</div>';
    h +=   '<div class="psg-exact-score">' + escHTML(ex.best.score) + '</div>';
    h +=   '<div class="psg-exact-prob">probabilità Poisson ' + ex.best.prob.toFixed(1) + '%</div>';
    h +=   '<div class="psg-exact-top3">';
    ex.top3.forEach(s => {
      h += '<div class="psg-exact-top3-item">' +
             '<b>' + escHTML(s.score) + '</b>' +
             '<span>' + s.prob.toFixed(1) + '%</span>' +
           '</div>';
    });
    h +=   '</div>';
    h += '</div>';

    h += '</div>';
    return h;
  }

  function renderPredBox(category, pred) {
    const prob = clamp(0, safe(pred?.prob, 0), 100);
    const cls  = confidenceClass(prob);
    const val  = escHTML(pred?.value || '—');
    return '' +
      '<div class="psg-pred ' + cls + '">' +
        '<div class="psg-pred-cat">' + escHTML(category) + '</div>' +
        '<div class="psg-pred-val">' + val + '</div>' +
        '<div class="psg-pred-bar">' +
          '<div class="psg-pred-fill" style="width:' + prob.toFixed(0) + '%"></div>' +
        '</div>' +
        '<div class="psg-pred-conf">' + prob.toFixed(0) + '%</div>' +
      '</div>';
  }

  // ------------------------------------------------------------
  // ACTION HANDLERS (esposti su window per onclick inline)
  // ------------------------------------------------------------

  function reveal(matchId) {
    if (!window.state) return;
    if (!window.state.presagioRevealed) window.state.presagioRevealed = {};
    window.state.presagioRevealed[matchId] = true;
    if (typeof window.render === 'function') window.render();
  }

  // Forza ricalcolo (svuota cache memoization per quel match)
  function recalc(matchId) {
    for (const key of Array.from(calcCache.keys())) {
      if (key.startsWith(matchId + '_')) calcCache.delete(key);
    }
    if (typeof window.render === 'function') window.render();
  }

  // ------------------------------------------------------------
  // EXPORT
  // ------------------------------------------------------------

  window.Presagio = {
    render,
    calculate,
    // espongo le metriche per debug / test
    _internals: { calcIRC, calcMOT, calcFOR, calcCongruity, calcTendenza }
  };
  window.presagioReveal = reveal;
  window.presagioRecalc = recalc;

  console.log('✅ Presagio module caricato');
})();
