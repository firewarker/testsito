// ============================================================
// MULTIGOL — Modulo Multigol per BettingPro
// ============================================================
// File separato sullo stesso pattern di presagio.js. Calcola tutte
// le combinazioni Multigol (globali + per squadra) usando Poisson +
// Dixon-Coles e restituisce i top pronostici ordinati per probabilità.
//
// Integrazione: includere DOPO app.js. Espone:
//   window.Multigol.calculate(analysis) -> array di pronostici
//   window.Multigol.getTopPicks(analysis, opts) -> top N per scoring
//   window.Multigol.allMarkets() -> elenco di tutti i mercati definiti
//
// Author: BettingPro V12.2 — Fase 2 refactoring
// ============================================================

(function() {
  'use strict';

  // ---------------------------------------------------------
  // FUNZIONI MATEMATICHE (Poisson + Dixon-Coles)
  // Copiate da app.js per renderle indipendenti — nessun side effect.
  // ---------------------------------------------------------

  function poisson(lambda, k) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    let logP = -lambda + k * Math.log(lambda);
    for (let i = 2; i <= k; i++) logP -= Math.log(i);
    return Math.exp(logP);
  }

  function dixonColesTau(i, j, lH, lA, rho) {
    if (i === 0 && j === 0) return 1 - lH * lA * rho;
    if (i === 1 && j === 0) return 1 + lA * rho;
    if (i === 0 && j === 1) return 1 + lH * rho;
    if (i === 1 && j === 1) return 1 - rho;
    return 1;
  }

  function calcRho(homeXG, awayXG) {
    const totalXG = homeXG + awayXG;
    if (totalXG < 1.5) return 0.18;
    if (totalXG < 2.0) return 0.14;
    if (totalXG < 2.5) return 0.11;
    if (totalXG < 3.0) return 0.09;
    if (totalXG < 3.5) return 0.07;
    return 0.05;
  }

  // ---------------------------------------------------------
  // CORE: matrice score 7x7 con Dixon-Coles applicato
  // Restituisce { matrix, total } dove matrix[i][j] = P(home=i, away=j)
  // ---------------------------------------------------------
  function buildScoreMatrix(homeXG, awayXG, maxGoals) {
    maxGoals = maxGoals || 6;
    const rho = calcRho(homeXG, awayXG);
    const matrix = [];
    let total = 0;
    for (let i = 0; i <= maxGoals; i++) {
      matrix[i] = [];
      for (let j = 0; j <= maxGoals; j++) {
        const rawP = poisson(homeXG, i) * poisson(awayXG, j);
        if (isNaN(rawP)) { matrix[i][j] = 0; continue; }
        const tau = dixonColesTau(i, j, homeXG, awayXG, rho);
        const p = rawP * tau;
        matrix[i][j] = p > 0 ? p : 0;
        total += matrix[i][j];
      }
    }
    return { matrix, total };
  }

  // ---------------------------------------------------------
  // MERCATI MULTIGOL DEFINITI
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // CALCOLO PROBABILITÀ PER MERCATO
  // ---------------------------------------------------------
  function calcGlobalRange(matrix, total, min, max) {
    if (total <= 0) return 0;
    let p = 0;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const tot = i + j;
        if (tot >= min && tot <= max) p += matrix[i][j];
      }
    }
    return (p / total) * 100;
  }

  function calcTeamRange(matrix, total, axis, min, max) {
    // axis = 'home' (riga i) o 'away' (colonna j)
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

  // ---------------------------------------------------------
  // API PUBBLICA
  // ---------------------------------------------------------

  /**
   * Calcola tutte le probabilità Multigol per una partita.
   * @param {Object} analysis - state.analysis (deve avere xG.home, xG.away)
   * @returns {Array} array di { id, label, prob, min, max, type, icon, color }
   */
  function calculate(analysis) {
    if (!analysis || !analysis.xG) return [];
    const homeXG = analysis.xG.home;
    const awayXG = analysis.xG.away;
    if (typeof homeXG !== 'number' || typeof awayXG !== 'number') return [];
    if (homeXG < 0 || awayXG < 0) return [];

    const { matrix, total } = buildScoreMatrix(homeXG, awayXG, 6);
    if (total <= 0) return [];

    const result = [];

    GLOBAL_RANGES.forEach(function(r) {
      const prob = calcGlobalRange(matrix, total, r.min, r.max);
      result.push({
        id: r.id, label: r.label, prob: prob,
        min: r.min, max: r.max, type: r.type,
        icon: '🎯', color: '#06b6d4'
      });
    });

    HOME_RANGES.forEach(function(r) {
      const prob = calcTeamRange(matrix, total, 'home', r.min, r.max);
      result.push({
        id: r.id, label: r.label, prob: prob,
        min: r.min, max: r.max, type: r.type,
        icon: '🏠', color: '#d97706'
      });
    });

    AWAY_RANGES.forEach(function(r) {
      const prob = calcTeamRange(matrix, total, 'away', r.min, r.max);
      result.push({
        id: r.id, label: r.label, prob: prob,
        min: r.min, max: r.max, type: r.type,
        icon: '✈️', color: '#059669'
      });
    });

    return result;
  }

  /**
   * Restituisce i top N pronostici Multigol ordinati per probabilità,
   * filtrati per soglia minima e prob massima (per evitare range degeneri
   * come "Multigol 0-6" che ovviamente fa 100%).
   * @param {Object} analysis
   * @param {Object} opts - { minProb=50, maxProb=95, limit=5, excludeTypes=[] }
   * @returns {Array}
   */
  function getTopPicks(analysis, opts) {
    opts = opts || {};
    const minProb = opts.minProb != null ? opts.minProb : 50;
    const maxProb = opts.maxProb != null ? opts.maxProb : 95;
    const limit = opts.limit != null ? opts.limit : 5;
    const excludeTypes = opts.excludeTypes || [];

    const all = calculate(analysis);
    return all
      .filter(function(m) {
        if (excludeTypes.indexOf(m.type) >= 0) return false;
        if (m.prob < minProb || m.prob > maxProb) return false;
        return true;
      })
      .sort(function(a, b) { return b.prob - a.prob; })
      .slice(0, limit);
  }

  /**
   * Elenco di tutti i mercati definiti (per debug / introspezione).
   */
  function allMarkets() {
    return {
      global: GLOBAL_RANGES.slice(),
      home: HOME_RANGES.slice(),
      away: AWAY_RANGES.slice()
    };
  }

  // ---------------------------------------------------------
  // EXPORT su window
  // ---------------------------------------------------------
  window.Multigol = {
    calculate: calculate,
    getTopPicks: getTopPicks,
    allMarkets: allMarkets,
    _internals: { buildScoreMatrix: buildScoreMatrix, calcRho: calcRho }
  };

  // Marker per debug
  try {
    if (window.console && window.console.log) {
      console.log('%c✓ Multigol module loaded', 'color:#06b6d4;font-weight:bold;');
    }
  } catch(e) {}

})();
