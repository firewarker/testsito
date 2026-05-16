// ============================================================
// ENGINE-REVERSE — Reverse xG Protocol + Reverse Quote
// ============================================================
// Estratto da app.js (V15). Espone:
//   window.BettingProEngine.Reverse.calcXG(oddsResult, homeXG, awayXG)
//     → Newton-Raphson inverse Poisson → implied bookie xG
//     → { homeDelta, awayDelta, trapStatus, trapMessage, ... }
//   window.BettingProEngine.Reverse.getQuoteForPick(analysis, pickName)
//     → reverseQuote per Over/Under e GG/NG
//   window.BettingProEngine.Reverse.getQuote1X2(analysis, pickName)
//     → reverseQuote per 1, X, 2, 1X, X2
//
// Dipendenze: window.state (gia' esposto da V11).
//
// Author: BettingPro V15 — Turno 4 step 3 (Reverse)
// ============================================================

(function() {
  'use strict';

function calculateReverseXG(oddsResult, homeXG, awayXG) {
    if (!oddsResult || !oddsResult.homeOdd) return null;

    // === MARGIN REMOVAL: Metodo PROPORZIONALE (corretto vs equal) ===
    const rawH = 1/oddsResult.homeOdd;
    const rawD = 1/oddsResult.drawOdd;
    const rawA = 1/oddsResult.awayOdd;
    const overround = rawH + rawD + rawA;
    // Prob reali senza margine
    const realHomeProb = Math.min(0.95, Math.max(0.02, rawH / overround));
    const realDrawProb = Math.min(0.95, Math.max(0.02, rawD / overround));
    const realAwayProb = Math.min(0.95, Math.max(0.02, rawA / overround));

    // === POISSON INVERSION via Newton-Raphson ===
    // Trova lambda tale che P(X wins | lambda_X, lambda_opp) ≈ realProb
    // Approccio: usa la relazione Poisson P(win) e cerca iterativamente
    function poissonPMF(l, k) {
        if (l <= 0) return k === 0 ? 1 : 0;
        let r = 1; for (let i = 1; i <= k; i++) r *= l / i;
        return r * Math.exp(-l);
    }
    function pWinPoisson(lH, lA) {
        let w = 0;
        for (let h = 0; h <= 7; h++) for (let a = 0; a <= 7; a++) {
            if (h > a) w += poissonPMF(lH, h) * poissonPMF(lA, a);
        }
        return w;
    }
    // Newton: trova lambda_home dato P(home wins) e lambda_away fisso (media lega ~1.15)
    function invertPoisson(targetProb, oppLambda) {
        let lambda = 1.3; // starting guess
        for (let iter = 0; iter < 20; iter++) {
            const pW = pWinPoisson(lambda, oppLambda);
            const err = pW - targetProb;
            if (Math.abs(err) < 0.001) break;
            // Numerical derivative
            const pW2 = pWinPoisson(lambda + 0.05, oppLambda);
            const deriv = (pW2 - pW) / 0.05;
            if (Math.abs(deriv) < 0.0001) break;
            lambda -= err / deriv;
            lambda = Math.max(0.1, Math.min(4.0, lambda));
        }
        return lambda;
    }

    // Stima xG bookmaker: usa l'xG avversario come dato noto
    const bookieHomeXG = invertPoisson(realHomeProb, awayXG);
    const bookieAwayXG = invertPoisson(realAwayProb, homeXG);

    // Delta: positivo = nostro xG > bookie (sottovalutato), negativo = nostro xG < bookie (sopravvalutato)
    const homeDelta = homeXG - bookieHomeXG;
    const awayDelta = awayXG - bookieAwayXG;

    let trapStatus = "neutro";
    let trapMessage = "Quote allineate alle statistiche. Δ Casa: " + homeDelta.toFixed(2) + " | Δ Ospite: " + awayDelta.toFixed(2);
    let trapColor = "rgba(148,163,184,0.1)";
    let textColor = "#94a3b8";
    let icon = "⚖️";

    // TRAPPOLA: il bookmaker sopravvaluta il favorito (xG reale < bookie xG)
    if (oddsResult.homeOdd < 2.0 && homeDelta < -0.30) {
        trapStatus = "trappola";
        trapMessage = `TRAPPOLA CASA: Il bookmaker vede xG ${bookieHomeXG.toFixed(2)} ma il nostro modello calcola solo ${homeXG.toFixed(2)} (Δ${homeDelta.toFixed(2)}). La quota @${oddsResult.homeOdd} è gonfiata — evitare l'1 secco.`;
        trapColor = "rgba(248,113,113,0.15)";
        textColor = "#f87171";
        icon = "🚨";
    } else if (oddsResult.awayOdd < 2.0 && awayDelta < -0.30) {
        trapStatus = "trappola";
        trapMessage = `TRAPPOLA OSPITE: Quota @${oddsResult.awayOdd} troppo bassa. Bookie stima xG ${bookieAwayXG.toFixed(2)} ma reale è solo ${awayXG.toFixed(2)} (Δ${awayDelta.toFixed(2)}).`;
        trapColor = "rgba(248,113,113,0.15)";
        textColor = "#f87171";
        icon = "🚨";
    }
    // VALUE: il bookmaker sottovaluta una squadra (xG reale > bookie xG)
    else if (homeDelta > 0.35) {
        trapStatus = "valore";
        trapMessage = `VALUE CASA: Il bookmaker sottovaluta la casa. Modello: ${homeXG.toFixed(2)} xG vs Bookie: ${bookieHomeXG.toFixed(2)} (Δ+${homeDelta.toFixed(2)}). Quota @${oddsResult.homeOdd} interessante.`;
        trapColor = "rgba(0,229,160,0.15)";
        textColor = "#00e5a0";
        icon = "💎";
    } else if (awayDelta > 0.35) {
        trapStatus = "valore";
        trapMessage = `VALUE OSPITE: Sottovalutati dal mercato. Modello: ${awayXG.toFixed(2)} xG vs Bookie: ${bookieAwayXG.toFixed(2)} (Δ+${awayDelta.toFixed(2)}). Quota @${oddsResult.awayOdd} da considerare.`;
        trapColor = "rgba(0,229,160,0.15)";
        textColor = "#00e5a0";
        icon = "💎";
    }

    return {
        bookieHomeXG: bookieHomeXG.toFixed(2),
        bookieAwayXG: bookieAwayXG.toFixed(2),
        homeDelta: homeDelta.toFixed(2),
        awayDelta: awayDelta.toFixed(2),
        realHomeProb: (realHomeProb * 100).toFixed(1),
        realAwayProb: (realAwayProb * 100).toFixed(1),
        margin: ((overround - 1) * 100).toFixed(1),
        trapStatus,
        trapMessage,
        trapColor,
        textColor,
        icon
    };
}

function getReverseQuoteForPick(analysis, pickName) {
  const oddsLab = window.state.oddsLab;
  if (!oddsLab || !oddsLab.bookmakers || oddsLab.bookmakers.length === 0) return null;

  let avgOver=0, avgUnder=0, ouCount=0;
  let avgGG=0, avgNG=0, ggCount=0;
  let sharpOver=null, sharpUnder=null, sharpGG=null, sharpNG=null;

  oddsLab.bookmakers.forEach(function(bk) {
    if (bk.ou25 && bk.ou25.over > 1 && bk.ou25.under > 1) {
      avgOver += bk.ou25.over; avgUnder += bk.ou25.under; ouCount++;
      if (bk.isSharp && sharpOver == null) { sharpOver = bk.ou25.over; sharpUnder = bk.ou25.under; }
    }
    if (bk.btts && bk.btts.yes > 1 && bk.btts.no > 1) {
      avgGG += bk.btts.yes; avgNG += bk.btts.no; ggCount++;
      if (bk.isSharp && sharpGG == null) { sharpGG = bk.btts.yes; sharpNG = bk.btts.no; }
    }
  });
  if (ouCount > 0) { avgOver /= ouCount; avgUnder /= ouCount; }
  if (ggCount > 0) { avgGG /= ggCount; avgNG /= ggCount; }

  // Preferisci sharp (Pinnacle/Bet365/Unibet) se disponibile
  const ou1 = sharpOver || avgOver;
  const ou2 = sharpUnder || avgUnder;
  const gg1 = sharpGG || avgGG;
  const gg2 = sharpNG || avgNG;

  function implied(o1, o2) {
    if (!o1 || !o2 || o1 <= 1 || o2 <= 1) return null;
    const tot = 1/o1 + 1/o2;
    return { p1: (1/o1/tot)*100, p2: (1/o2/tot)*100 };
  }

  const pOU = analysis.pOU || {};
  const pBTTS = analysis.pBTTS || 50;
  let modelProb, bookProb, market, oppositePick;

  if (/Over 2\.5/i.test(pickName)) {
    const impl = implied(ou1, ou2); if (!impl) return null;
    modelProb = (pOU[2.5] && pOU[2.5].over) || 50;
    bookProb = impl.p1; market = 'Over 2.5'; oppositePick = 'Under 2.5';
  } else if (/Under 2\.5/i.test(pickName)) {
    const impl = implied(ou1, ou2); if (!impl) return null;
    modelProb = (pOU[2.5] && pOU[2.5].under) || 50;
    bookProb = impl.p2; market = 'Under 2.5'; oppositePick = 'Over 2.5';
  } else if (/^GG/i.test(pickName)) {
    const impl = implied(gg1, gg2); if (!impl) return null;
    modelProb = pBTTS; bookProb = impl.p1; market = 'GG'; oppositePick = 'NG';
  } else if (/^NG/i.test(pickName)) {
    const impl = implied(gg1, gg2); if (!impl) return null;
    modelProb = 100 - pBTTS; bookProb = impl.p2; market = 'NG'; oppositePick = 'GG';
  } else {
    return null; // 1X2/1X/X2/X gestiti dal Trap Detector
  }

  const delta = modelProb - bookProb;
  return { delta, modelProb, bookProb, market, oppositePick };
}

// Confronta il pick 1X2 col mercato (window.state.bookmakerOdds) per gli stessi
// motivi di overconfidence (modello vs mercato sui mercati 1X2).
function getReverseQuote1X2(analysis, pickName) {
  const bk = window.state.bookmakerOdds;
  if (!bk || !bk.homeOdd || !bk.drawOdd || !bk.awayOdd) return null;
  const p1X2 = analysis.p1X2 || {};

  function impliedFrom1X2(oH, oD, oA) {
    const rH = 1/oH, rD = 1/oD, rA = 1/oA;
    const tot = rH + rD + rA;
    return { home: (rH/tot)*100, draw: (rD/tot)*100, away: (rA/tot)*100 };
  }
  const book = impliedFrom1X2(bk.homeOdd, bk.drawOdd, bk.awayOdd);

  let modelProb, bookProb, market;
  if (/^1 \(|^1$/i.test(pickName))      { modelProb = p1X2.home || 33; bookProb = book.home; market = '1'; }
  else if (/^2 \(|^2$/i.test(pickName)) { modelProb = p1X2.away || 33; bookProb = book.away; market = '2'; }
  else if (/^X \(|^X$/i.test(pickName)) { modelProb = p1X2.draw || 33; bookProb = book.draw; market = 'X'; }
  else if (/^1X/i.test(pickName))       { modelProb = (p1X2.home || 33) + (p1X2.draw || 33); bookProb = book.home + book.draw; market = '1X'; }
  else if (/^X2/i.test(pickName))       { modelProb = (p1X2.away || 33) + (p1X2.draw || 33); bookProb = book.away + book.draw; market = 'X2'; }
  else return null;

  return { delta: modelProb - bookProb, modelProb, bookProb, market };
}

// Cerca un eventuale consenso/conflitto tra Presagio e l'AI Advice.
// Se Presagio (con metriche IRC/MOT/FOR/Tendenza) propone una direzione
// opposta, e' un segnale di debolezza interna.

  // ---------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------
  window.BettingProEngine = window.BettingProEngine || {};
  window.BettingProEngine.Reverse = {
    calcXG: calculateReverseXG,
    getQuoteForPick: getReverseQuoteForPick,
    getQuote1X2: getReverseQuote1X2
  };

  try {
    if (window.console && window.console.log) {
      console.log('%c✓ BettingProEngine.Reverse module loaded', 'color:#a855f7;font-weight:bold;');
    }
  } catch(e) {}

})();
