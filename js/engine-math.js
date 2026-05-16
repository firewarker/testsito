// ============================================================
// ENGINE-MATH — Funzioni matematiche condivise per BettingPro
// ============================================================
// Modulo "engine" puro, senza side effect, senza dipendenze.
// Contiene tutte le funzioni matematiche che servono ai vari
// moduli (multigol, multipla, futuri engine-* file).
//
// Espone su window.BettingProMath:
//   • poisson(lambda, k)
//   • dixonColesTau(i, j, lH, lA, rho)
//   • calcDixonColesRho(homeXG, awayXG)
//   • buildScoreMatrix(homeXG, awayXG, maxGoals) -> {matrix, total}
//   • prob1X2(homeXG, awayXG)
//   • probOverUnder(homeXG, awayXG, line)
//   • probBTTS(homeXG, awayXG)
//   • probMultigol(homeXG, awayXG, min, max)
//
// Author: BettingPro V13 — Turno 4 (refactoring step 1)
// ============================================================

(function() {
  'use strict';

  // ---------------------------------------------------------
  // PRIMITIVE
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

  function calcDixonColesRho(homeXG, awayXG) {
    const totalXG = homeXG + awayXG;
    if (totalXG < 1.5) return 0.18;
    if (totalXG < 2.0) return 0.14;
    if (totalXG < 2.5) return 0.11;
    if (totalXG < 3.0) return 0.09;
    if (totalXG < 3.5) return 0.07;
    return 0.05;
  }

  // ---------------------------------------------------------
  // MATRICE SCORE 7×7 (default) CON DIXON-COLES APPLICATO
  // ---------------------------------------------------------

  function buildScoreMatrix(homeXG, awayXG, maxGoals) {
    maxGoals = maxGoals || 6;
    if (isNaN(homeXG) || isNaN(awayXG) || homeXG < 0 || awayXG < 0) {
      return { matrix: [], total: 0 };
    }
    const rho = calcDixonColesRho(homeXG, awayXG);
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
    return { matrix: matrix, total: total };
  }

  // ---------------------------------------------------------
  // PROBABILITÀ PER MERCATO (con Dixon-Coles)
  // ---------------------------------------------------------

  function prob1X2(homeXG, awayXG) {
    const { matrix, total } = buildScoreMatrix(homeXG, awayXG, 5);
    if (total <= 0) return { home: 33.33, draw: 33.33, away: 33.33 };
    let pH = 0, pD = 0, pA = 0;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const p = matrix[i][j];
        if (i > j) pH += p;
        else if (i === j) pD += p;
        else pA += p;
      }
    }
    return {
      home: (pH / total) * 100,
      draw: (pD / total) * 100,
      away: (pA / total) * 100
    };
  }

  function probOverUnder(homeXG, awayXG, line) {
    const { matrix, total } = buildScoreMatrix(homeXG, awayXG, 5);
    if (total <= 0) return { over: 50, under: 50 };
    let pUnder = 0;
    const floorLine = Math.floor(line);
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        if (i + j <= floorLine) pUnder += matrix[i][j];
      }
    }
    const under = (pUnder / total) * 100;
    return { over: 100 - under, under: under };
  }

  function probBTTS(homeXG, awayXG) {
    if (isNaN(homeXG) || isNaN(awayXG) || homeXG < 0 || awayXG < 0) return 50;
    // P(home segna >=1) * P(away segna >=1) — xG con home advantage incluso
    const p = (1 - poisson(homeXG, 0)) * (1 - poisson(awayXG, 0)) * 100;
    return isNaN(p) ? 50 : Math.max(5, Math.min(95, p));
  }

  function probMultigol(homeXG, awayXG, min, max) {
    const { matrix, total } = buildScoreMatrix(homeXG, awayXG, 6);
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

  // ---------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------
  window.BettingProMath = {
    poisson: poisson,
    dixonColesTau: dixonColesTau,
    calcDixonColesRho: calcDixonColesRho,
    buildScoreMatrix: buildScoreMatrix,
    prob1X2: prob1X2,
    probOverUnder: probOverUnder,
    probBTTS: probBTTS,
    probMultigol: probMultigol,
    version: '1.0.0'
  };

  try {
    if (window.console && window.console.log) {
      console.log('%c✓ BettingProMath module loaded (v1.0.0)', 'color:#fbbf24;font-weight:bold;');
    }
  } catch(e) {}

})();
