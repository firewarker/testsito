// ============================================================
// MULTIGOL — Modulo Multigol per BettingPro
// ============================================================
// File separato sullo stesso pattern di presagio.js. Calcola tutte
// le combinazioni Multigol (globali + per squadra) usando le funzioni
// matematiche condivise da window.BettingProMath.
//
// Integrazione: includere DOPO engine-math.js e DOPO app.js. Espone:
//   window.Multigol.calculate(analysis) -> array di pronostici
//   window.Multigol.getTopPicks(analysis, opts) -> top N per scoring
//   window.Multigol.allMarkets() -> elenco di tutti i mercati definiti
//
// Author: BettingPro V13 — refactoring step 1 (usa BettingProMath)
// ============================================================

(function() {
  'use strict';

  function getMath() {
    if (window.BettingProMath) return window.BettingProMath;
    console.warn('window.BettingProMath non caricato — fallback inline');
    return {
      buildScoreMatrix: function() { return { matrix: [], total: 0 }; },
      probMultigol: function() { return 0; }
    };
  }

  const GLOBAL_RANGES = [
    { id: 'mg_0_1', label: 'Multigol 0-1', min: 0, max: 1, type: 'global' },
    { id: 'mg_0_2', label: 'Multigol 0-2', min: 0, max: 2, type: 'global' },
    { id: 'mg_1_2', label: 'Multigol 1-2', min: 1, max: 2, type: 'global' },
    { id: 'mg_1_3', label: 'Multigol 1-3', min: 1, max: 3, type: 'global' },
    { id: 'mg_1_4', label: 'Multigol 1-4', min: 1, max: 4, type: 'global' },
    { id: 'mg_2_3', label: 'Multigol 2-3', min: 2, max: 3, type: 'global' },
    { id: 'mg_2_4', label: 'Multigol 2-4', min: 2, max: 4, type: 'global' },
    { id: 'mg_2_5', label: 'Multigol 2-5', min: 2, max: 5, type: 'global' },
    { id: 'mg_3_4', label: 'Multigol 3-4', min: 3, max: 4, type: 'global' },
    { id: 'mg_3_5', label: 'Multigol 3-5', min: 3, max: 5, type: 'global' },
    { id: 'mg_3_6', label: 'Multigol 3-6', min: 3, max: 6, type: 'global' },
    { id: 'mg_4_6', label: 'Multigol 4-6', min: 4, max: 6, type: 'global' }
  ];

  const HOME_RANGES = [
    { id: 'mgH_1_2', label: 'MG Casa 1-2', min: 1, max: 2, type: 'home' },
    { id: 'mgH_1_3', label: 'MG Casa 1-3', min: 1, max: 3, type: 'home' },
    { id: 'mgH_2_3', label: 'MG Casa 2-3', min: 2, max: 3, type: 'home' }
  ];

  const AWAY_RANGES = [
    { id: 'mgA_1_2', label: 'MG Ospite 1-2', min: 1, max: 2, type: 'away' },
    { id: 'mgA_1_3', label: 'MG Ospite 1-3', min: 1, max: 3, type: 'away' },
    { id: 'mgA_2_3', label: 'MG Ospite 2-3', min: 2, max: 3, type: 'away' }
  ];

  function calcTeamRange(matrix, total, axis, min, max) {
    if (total <= 0) return 0;
    let p = 0;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const v = axis === 'home' ? i : j;
        if (v >= min && v <= max) p += matrix[i][j];
      }
    }
    return (p / total) * 100;
  }

  function calculate(analysis) {
    if (!analysis || !analysis.xG) return [];
    const homeXG = analysis.xG.home;
    const awayXG = analysis.xG.away;
    if (typeof homeXG !== 'number' || typeof awayXG !== 'number') return [];
    if (homeXG < 0 || awayXG < 0) return [];

    const M = getMath();
    const built = M.buildScoreMatrix(homeXG, awayXG, 6);
    if (built.total <= 0) return [];

    const result = [];

    GLOBAL_RANGES.forEach(function(r) {
      const prob = M.probMultigol(homeXG, awayXG, r.min, r.max);
      result.push({
        id: r.id, label: r.label, prob: prob,
        min: r.min, max: r.max, type: r.type,
        icon: '🎯', color: '#06b6d4'
      });
    });

    HOME_RANGES.forEach(function(r) {
      const prob = calcTeamRange(built.matrix, built.total, 'home', r.min, r.max);
      result.push({
        id: r.id, label: r.label, prob: prob,
        min: r.min, max: r.max, type: r.type,
        icon: '🏠', color: '#d97706'
      });
    });

    AWAY_RANGES.forEach(function(r) {
      const prob = calcTeamRange(built.matrix, built.total, 'away', r.min, r.max);
      result.push({
        id: r.id, label: r.label, prob: prob,
        min: r.min, max: r.max, type: r.type,
        icon: '✈️', color: '#059669'
      });
    });

    return result;
  }

  function getTopPicks(analysis, opts) {
    opts = opts || {};
    const minProb = opts.minProb != null ? opts.minProb : 50;
    const maxProb = opts.maxProb != null ? opts.maxProb : 95;
    const limit = opts.limit != null ? opts.limit : 5;
    const excludeTypes = opts.excludeTypes || [];

    return calculate(analysis)
      .filter(function(m) {
        if (excludeTypes.indexOf(m.type) >= 0) return false;
        if (m.prob < minProb || m.prob > maxProb) return false;
        return true;
      })
      .sort(function(a, b) { return b.prob - a.prob; })
      .slice(0, limit);
  }

  function allMarkets() {
    return {
      global: GLOBAL_RANGES.slice(),
      home: HOME_RANGES.slice(),
      away: AWAY_RANGES.slice()
    };
  }

  window.Multigol = {
    calculate: calculate,
    getTopPicks: getTopPicks,
    allMarkets: allMarkets
  };

  try {
    if (window.console && window.console.log) {
      console.log('%c✓ Multigol module loaded (using BettingProMath)', 'color:#06b6d4;font-weight:bold;');
    }
  } catch(e) {}

})();
