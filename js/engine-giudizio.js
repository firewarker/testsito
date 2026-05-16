// ============================================================
// ENGINE-GIUDIZIO — Giudizio Finale + Coro dei Moduli
// ============================================================
// Cuore del sistema BettingPro V11+. Estratto da app.js (V16).
//
// computeGiudizioFinale fonde fino a 10 moduli analitici:
//   1. AI Statistico (pick base)        6. Trap Detector
//   2. Presagio (pre-analisi xG)        7. Reverse Quote
//   3. Reverse xG Protocol              8. Consensus Engine
//   4. Regression Score                 9. SuperAlgo (Oracle)
//   5. GAP Analyser                    10. SuperAI (Llama)
//
// Helper interni (definiti come closure nested):
//   • scoreMarket(opts) - costruisce un mercato con superScore
//   • getPresagioBonus_v11(pickValue) - bonus moltiplicativo
//   • getRevQuoteBonus_v11(pickValue, modelProb)
//   • getReverseXgBonus_v11(pickValue)
//   • getTrapBonus_v11(pickValue)
//   • getConsensusBonus_v11(pickValue)
//   • getRegressionBonus_v11()
//   • getGapBonus_v11(pickValue)
//   • getMLWeight, getSuperConf, getSuperScore
//
// Espone:
//   window.BettingProEngine.Giudizio.compute(match, analysis, superAnalysis, superAIAnalysis)
//     → { topMarkets, modulesList, choirAlta, hasSuperAlgo, hasSuperAI, ... }
//
// Dipendenze esterne:
//   • window.state (gia' esposto da V11)
//   • window.BettingProEngine.Trap (V14)
//   • window.BettingProEngine.Reverse (V15)
//   • window.Multigol (V12.2)
//   • window.Presagio (V11)
//
// Author: BettingPro V16 — Turno 4 step 4 (ULTIMO modulo del refactoring)
// ============================================================

(function() {
  'use strict';

function computeGiudizioFinale(match, analysis, superAnalysis, superAIAnalysis) {
  const { xG, p1X2, pOU, pBTTS, exactScores, multigoal, multigoalHome, multigoalAway,
          temporalDistribution, h2hInfo, corners, cards, homeForm, awayForm } = analysis;
  const homeXG = xG.home, awayXG = xG.away, totXG = xG.total;

  const formScore = (f) => {
    if (!f || f === 'N/A') return 2.5;
    return f.slice(0,5).split('').reduce((s,c) => s + (c==='W'?1:c==='D'?0.4:0), 0);
  };
  const hFS = formScore(homeForm), aFS = formScore(awayForm);

  const h2h = h2hInfo || {};
  const h2hGames = (h2h.homeWins||0) + (h2h.awayWins||0) + (h2h.draws||0) || 1;
  const h2hAvgGoals = parseFloat(h2h.avgGoals) || totXG;
  const h2hBTTS = h2h.bttsCount ? (h2h.bttsCount / h2hGames) * 100 : pBTTS;
  const h2hOver25 = h2h.over25Count ? (h2h.over25Count / h2hGames) * 100 : pOU[2.5].over;

  const getMLWeight = (market) => {
    const data = window.state.mlThresholds && window.state.mlThresholds[market];
    if (!data || data.totalPredictions < 10) return 0.50;
    return Math.min(0.92, Math.max(0.35, parseFloat(data.accuracy) / 100));
  };

  const hCS = analysis.homeData?.cleanSheetPct || 25;
  const aCS = analysis.awayData?.cleanSheetPct || 25;
  const hFTS = analysis.homeData?.failedToScorePct || 25;
  const aFTS = analysis.awayData?.failedToScorePct || 25;

  const esProb = (fn) => (exactScores || []).filter(fn).reduce((s,e) => s + (e.p || e.prob || 0), 0);
  const drawExact = esProb(s => s.h === s.a);
  const homeWinExact = esProb(s => s.h > s.a);
  const awayWinExact = esProb(s => s.h < s.a);
  const over25Exact = esProb(s => s.h + s.a >= 3);
  const bttsExact = esProb(s => s.h >= 1 && s.a >= 1);

  const bk = analysis.bookmakerOdds || {};
  const bkHome = bk.home || 0;
  const bkDraw = bk.draw || 0;
  const bkAway = bk.away || 0;
  const hasBookmaker = bkHome > 0;

  // === SUPER ALGORITHM DATA ===
  const hasSuperAlgo = !!(superAnalysis && superAnalysis.picks && superAnalysis.picks.length > 0);
  const superPicks = hasSuperAlgo ? superAnalysis.picks : [];
  const getSuperScore = (valueMatch) => {
    const found = superPicks.find(p => {
      const v = (p.value||'').toLowerCase();
      const m = valueMatch.toLowerCase();
      return v === m || v.includes(m) || m.includes(v);
    });
    return found ? found.superScore : 0;
  };
  const getSuperConf = (valueMatch) => {
    const found = superPicks.find(p => {
      const v = (p.value||'').toLowerCase();
      const m = valueMatch.toLowerCase();
      return v === m || v.includes(m) || m.includes(v);
    });
    return found ? found.confidence : null;
  };

  // === SUPER AI (Claude/Groq) DATA ===
  const hasSuperAI = !!(superAIAnalysis && superAIAnalysis.bestPick && !superAIAnalysis.error);
  const aiBestPick = hasSuperAI ? (superAIAnalysis.bestPick || '').toLowerCase() : '';
  const aiConfidence = hasSuperAI ? (superAIAnalysis.confidence || 50) : 0;
  const aiRecommendation = hasSuperAI ? superAIAnalysis.recommendation : '';
  const aiAlgoConfirmed = hasSuperAI ? superAIAnalysis.algoConfirmed : false;
  const aiTop3 = hasSuperAI ? (superAIAnalysis.adjustedTop3 || []).map(s => s.toLowerCase()) : [];

  // Global AI penalty/bonus
  const aiGlobalMult = aiRecommendation === 'SKIP' ? 0.85 : aiRecommendation === 'GIOCA' ? 1.05 : 1.0;

  // ════════════════════════════════════════════════════════════════════
  // PATCH V11: GIUDIZIO ARMONICO — pre-calcolo dei 7 moduli laterali
  // I dati sono calcolati UNA VOLTA qui, poi scoreMarket li usa
  // ════════════════════════════════════════════════════════════════════

  // --- Trap Detector (globale: rischi situazionali della partita) ---
  let trapData_v11 = null;
  try {
    if (typeof calculateTrapScore === 'function') {
      trapData_v11 = (window.BettingProEngine && window.BettingProEngine.Trap ? window.BettingProEngine.Trap.calculate(match, analysis) : null);
    }
  } catch(e) { console.warn('V11 Trap pre-calc fail:', e); }

  // --- Reverse xG Protocol (globale: confronto Poisson inverso) ---
  let reverseXgData_v11 = null;
  try {
    if (bk && bk.homeOdd && typeof calculateReverseXG === 'function') {
      reverseXgData_v11 = (window.BettingProEngine && window.BettingProEngine.Reverse ? window.BettingProEngine.Reverse.calcXG(bk, homeXG, awayXG) : null);
    }
  } catch(e) { console.warn('V11 ReverseXG pre-calc fail:', e); }

  // --- Presagio (globale: pre-analisi con 5 metriche + 6 predizioni) ---
  let presagioData_v11 = null;
  try {
    if (typeof window !== 'undefined' && window.Presagio && typeof window.Presagio.calculate === 'function') {
      presagioData_v11 = window.Presagio.calculate(analysis, match);
    }
  } catch(e) { console.warn('V11 Presagio pre-calc fail:', e); }

  // --- Regression Score (globale: grade qualita' predizione) ---
  const regressionData_v11 = window.state.regressionScore || null;

  // --- Consensus Engine (globale: voto pesato dei moduli) ---
  const consensusData_v11 = window.state.consensus || null;

  // --- Gap Analyzer (globale: True Spread basato su differenziale xG) ---
  const gapValue_v11 = homeXG - awayXG;
  const gapMagnitude_v11 = Math.abs(gapValue_v11);
  const gapFavorsHome_v11 = gapValue_v11 > 0;

  // ════════════════════════════════════════════════════════════════════
  // PATCH V11.3: MATRICE DI COMPATIBILITÀ TRA MERCATI
  // Risolve il bug per cui "Presagio Under 3.5" veniva considerato in
  // disaccordo con "pick Under 2.5", quando in realta' Under 2.5 ⊂ Under 3.5
  // (se vince Under 2.5, automaticamente vince anche Under 3.5).
  // ════════════════════════════════════════════════════════════════════

  // Parse di una linea Over/Under da stringa tipo "Over 1.5", "Under 2.5", ecc.
  function parseOULine(pickStr) {
    const m = String(pickStr || '').match(/(over|under)\s*(\d+(?:\.\d+)?)/i);
    if (!m) return null;
    return { direction: m[1].toLowerCase(), line: parseFloat(m[2]) };
  }

  // Relazione tra due linee Over/Under (pick vs modulo)
  // Ritorna: 'match' | 'support-strong' | 'support-weak' | 'compatible' | 'conflict'
  function ouRelation(pickOU, modOU) {
    if (!pickOU || !modOU) return null;
    if (pickOU.direction === modOU.direction) {
      if (pickOU.line === modOU.line) return 'match';
      // Stessa direzione, linea diversa = supporto (a forza variabile).
      // Over: linea piu' alta = piu' restrittiva (3+ gol vs 2+ gol).
      // Se il modulo e' piu' restrittivo e ne e' confidente, supporta forte il pick.
      if (pickOU.direction === 'over') {
        return modOU.line > pickOU.line ? 'support-strong' : 'support-weak';
      }
      // Under: linea piu' bassa = piu' restrittiva (0-1 gol vs 0-1-2-3 gol).
      return modOU.line < pickOU.line ? 'support-strong' : 'support-weak';
    }
    // Direzioni opposte: dipende dalle linee.
    // Over X intersecato con Under Y e' non-vuoto sse X < Y.
    // Esempi: Over 1.5 ∩ Under 3.5 → gol ∈ {2, 3} → COMPATIBILI.
    //         Over 2.5 ∩ Under 2.5 → ∅ → CONFLITTO.
    //         Over 2.5 ∩ Under 3.5 → gol = 3 → COMPATIBILI.
    let nonEmpty;
    if (pickOU.direction === 'over') {
      // Pick Over X, modulo Under Y → non-vuoto sse Y > X.
      nonEmpty = modOU.line > pickOU.line;
    } else {
      // Pick Under X, modulo Over Y → non-vuoto sse Y < X.
      nonEmpty = modOU.line < pickOU.line;
    }
    return nonEmpty ? 'compatible' : 'conflict';
  }

  // Parse di un range Multigol da stringa tipo "Multigol 2-4", "MG 1-3", "2-4"
  function parseMultigolRange(pickStr) {
    const m = String(pickStr || '').match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!m) return null;
    return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  }

  // Relazione tra due range Multigol (pick vs modulo)
  // Ritorna: 'match' | 'overlap' | 'disjoint' | 'subset' | 'superset'
  function multigolRelation(pickMG, modMG) {
    if (!pickMG || !modMG) return null;
    if (pickMG.min === modMG.min && pickMG.max === modMG.max) return 'match';
    // Sottoinsieme proprio?
    if (modMG.min >= pickMG.min && modMG.max <= pickMG.max) return 'subset';   // modulo ⊂ pick
    if (pickMG.min >= modMG.min && pickMG.max <= modMG.max) return 'superset'; // pick ⊂ modulo
    // Intersezione non-vuota?
    const interMin = Math.max(pickMG.min, modMG.min);
    const interMax = Math.min(pickMG.max, modMG.max);
    if (interMin <= interMax) return 'overlap';
    return 'disjoint';
  }

  // Helper: estrae bonus Reverse Quote per il pick specifico
  // PATCH V11.3: ora supporta tutte le linee OU (1.5, 2.5, 3.5) via parseOULine.
  function getRevQuoteBonus_v11(pickValue, modelProb) {
    const oddsLab_v11 = window.state.oddsLab;
    if (!oddsLab_v11 || !oddsLab_v11.bookmakers || oddsLab_v11.bookmakers.length === 0) return 1.0;
    const v = (pickValue || '').toLowerCase();
    const pickOU = parseOULine(v);
    const isGG = /^gg\b|^ng\b/i.test(v);
    // Reverse Quote serve solo se abbiamo dati sharp per OU 2.5 o GG/NG.
    // Per altre linee (Over 1.5, Over 3.5, ecc.) i bookie raramente
    // pubblicano sharp odds attendibili, quindi restiamo neutri.
    if (!isGG && !(pickOU && pickOU.line === 2.5)) return 1.0;
    let avgO=0, avgU=0, avgGG=0, avgNG=0, countO=0, countG=0;
    oddsLab_v11.bookmakers.forEach(function(bm) {
      if (bm.ou25 && bm.ou25.over > 1 && bm.ou25.under > 1) { avgO+=bm.ou25.over; avgU+=bm.ou25.under; countO++; }
      if (bm.btts && bm.btts.yes > 1 && bm.btts.no > 1) { avgGG+=bm.btts.yes; avgNG+=bm.btts.no; countG++; }
    });
    if (countO > 0) { avgO/=countO; avgU/=countO; }
    if (countG > 0) { avgGG/=countG; avgNG/=countG; }
    let bookProb = null;
    if (pickOU && pickOU.line === 2.5 && pickOU.direction === 'over' && countO > 0) {
      const tot = 1/avgO + 1/avgU; bookProb = (1/avgO/tot) * 100;
    } else if (pickOU && pickOU.line === 2.5 && pickOU.direction === 'under' && countO > 0) {
      const tot = 1/avgO + 1/avgU; bookProb = (1/avgU/tot) * 100;
    } else if (/^gg/i.test(v) && countG > 0) {
      const tot = 1/avgGG + 1/avgNG; bookProb = (1/avgGG/tot) * 100;
    } else if (/^ng/i.test(v) && countG > 0) {
      const tot = 1/avgGG + 1/avgNG; bookProb = (1/avgNG/tot) * 100;
    }
    if (bookProb == null) return 1.0;
    const delta = modelProb - bookProb;
    if (delta > 8) return 1.08;
    if (delta > 3) return 1.03;
    if (delta < -8) return 0.90;
    if (delta < -3) return 0.96;
    return 1.0;
  }

  // Helper: bonus Presagio, ora con matrice di compatibilita' completa.
  // PATCH V11.3: copre tutte le linee OU (1.5/2.5/3.5), Multigol con
  // inclusione/intersezione, GG/NG, 1X2 e Doppia Chance.
  function getPresagioBonus_v11(pickValue) {
    if (!presagioData_v11 || !presagioData_v11.predictions) return { bonus: 1.0, agrees: null };
    const v = (pickValue || '').toLowerCase();
    const preds = presagioData_v11.predictions;

    // === 1) Mercato Over/Under (qualsiasi linea) ===
    const pickOU = parseOULine(v);
    if (pickOU && preds.overUnder && preds.overUnder.value) {
      const modOU = parseOULine(preds.overUnder.value);
      const psgProb = preds.overUnder.prob || 0;
      const rel = ouRelation(pickOU, modOU);
      if (rel === 'match') {
        if (psgProb >= 60) return { bonus: 1.10, agrees: true };
        if (psgProb >= 50) return { bonus: 1.05, agrees: true };
        return { bonus: 1.02, agrees: true };
      }
      if (rel === 'support-strong' && psgProb >= 55) return { bonus: 1.08, agrees: true };
      if (rel === 'support-weak' && psgProb >= 55) return { bonus: 1.03, agrees: true };
      if (rel === 'conflict' && psgProb >= 55) return { bonus: 0.90, agrees: false };
      if (rel === 'conflict' && psgProb >= 45) return { bonus: 0.95, agrees: false };
      // 'compatible' o low confidence → neutro
      return { bonus: 1.0, agrees: null };
    }

    // === 2) Mercato Multigol ===
    const pickMG = parseMultigolRange(v);
    const isPickMG = pickMG && /multigol|^mg\b/i.test(v);
    if (isPickMG && preds.multigol && preds.multigol.value) {
      const modMG = parseMultigolRange(preds.multigol.value);
      const psgProb = preds.multigol.prob || 0;
      const rel = multigolRelation(pickMG, modMG);
      if (rel === 'match') {
        if (psgProb >= 55) return { bonus: 1.10, agrees: true };
        if (psgProb >= 45) return { bonus: 1.05, agrees: true };
        return { bonus: 1.02, agrees: true };
      }
      if (rel === 'subset' && psgProb >= 50) return { bonus: 1.06, agrees: true };
      if (rel === 'superset' && psgProb >= 50) return { bonus: 1.03, agrees: true };
      if (rel === 'overlap' && psgProb >= 50) return { bonus: 1.02, agrees: true };
      if (rel === 'disjoint' && psgProb >= 50) return { bonus: 0.93, agrees: false };
      return { bonus: 1.0, agrees: null };
    }

    // === 3) GG/NG ===
    if (/^gg\b|^ng\b/i.test(v) && preds.ggng) {
      const psgPick = (preds.ggng.value || '').toLowerCase();
      const psgProb = preds.ggng.prob || 0;
      const pickIsGG = /^gg\b/.test(v);
      const psgIsGG = /gg/.test(psgPick) && !/ng/.test(psgPick);
      const sameDir = pickIsGG === psgIsGG;
      if (sameDir && psgProb >= 60) return { bonus: 1.10, agrees: true };
      if (sameDir && psgProb >= 50) return { bonus: 1.05, agrees: true };
      if (!sameDir && psgProb >= 55) return { bonus: 0.90, agrees: false };
      if (!sameDir && psgProb >= 45) return { bonus: 0.95, agrees: false };
      return { bonus: 1.0, agrees: null };
    }

    // === 4) Segno secco 1X2 (1, X, 2) ===
    if (/^[12x]\s*[\(\s]|^[12x]$/.test(v) && preds.segnoSecco && preds.segnoSecco.value) {
      const pickSign = v.charAt(0); // '1', 'x', '2'
      const psgSign = String(preds.segnoSecco.value).trim().charAt(0).toLowerCase();
      const psgProb = preds.segnoSecco.prob || 0;
      if (pickSign === psgSign) {
        if (psgProb >= 60) return { bonus: 1.10, agrees: true };
        if (psgProb >= 45) return { bonus: 1.05, agrees: true };
        return { bonus: 1.02, agrees: true };
      }
      if (psgProb >= 50) return { bonus: 0.92, agrees: false };
      return { bonus: 1.0, agrees: null };
    }

    // === 5) Doppia Chance (1X, X2, 12) ===
    if (/^1x|^x2|^12/i.test(v) && preds.doppiaChance && preds.doppiaChance.value) {
      const pickDC = v.replace(/\s.*$/, '').toLowerCase(); // "1x", "x2", "12"
      const psgDC = String(preds.doppiaChance.value).toLowerCase().replace(/\s.*$/, '');
      const psgProb = preds.doppiaChance.prob || 0;
      if (pickDC === psgDC) {
        if (psgProb >= 65) return { bonus: 1.08, agrees: true };
        if (psgProb >= 55) return { bonus: 1.04, agrees: true };
        return { bonus: 1.02, agrees: true };
      }
      // Doppie chance diverse possono comunque sovrapporsi (1X e 12 condividono "1")
      const sharedChars = pickDC.split('').filter(c => psgDC.indexOf(c) >= 0).length;
      if (sharedChars >= 1) return { bonus: 1.0, agrees: null };
      return { bonus: 0.95, agrees: false };
    }

    return { bonus: 1.0, agrees: null };
  }

  // Helper: bonus dal Trap Detector — globale per tutti i mercati 1X2
  function getTrapBonus_v11(pickValue) {
    if (!trapData_v11 || typeof trapData_v11.score !== 'number') return 1.0;
    const v = (pickValue || '').toLowerCase();
    const is1X2 = /^1\b|^2\b|^x\b|^1x|^x2|^12/i.test(v) && !/over|under|^gg|^ng/i.test(v);
    // Il Trap Detector e' nato per 1X2; per OU/GG ha effetto attenuato
    const factor = is1X2 ? 1.0 : 0.4;
    const score = trapData_v11.score;
    if (score >= 70) return 1.0 - 0.15 * factor; // penalty forte
    if (score >= 55) return 1.0 - 0.08 * factor;
    if (score >= 40) return 1.0 - 0.04 * factor;
    if (score <= 20) return 1.0 + 0.05 * factor; // safe → bonus
    return 1.0;
  }

  // Helper: bonus Reverse xG — solo per 1X2
  function getReverseXgBonus_v11(pickValue) {
    if (!reverseXgData_v11) return 1.0;
    const v = (pickValue || '').toLowerCase();
    const ts = reverseXgData_v11.trapStatus;
    // "trappola" = bookmaker sopravvaluta favorito → penalty se gioco favorito
    // "valore" = bookmaker sottovaluta squadra → bonus se gioco quella squadra
    const homeD = parseFloat(reverseXgData_v11.homeDelta);
    const awayD = parseFloat(reverseXgData_v11.awayDelta);
    if (/^1 \(|^1$|^1x|^12/i.test(v) && !/^x/.test(v)) {
      // Pick pro-casa
      if (ts === 'trappola' && homeD < -0.3) return 0.88;
      if (homeD > 0.35) return 1.08;
    } else if (/^2 \(|^2$|^x2|^12/i.test(v) && !/^x/.test(v)) {
      // Pick pro-ospite
      if (ts === 'trappola' && awayD < -0.3) return 0.88;
      if (awayD > 0.35) return 1.08;
    }
    return 1.0;
  }

  // Helper: bonus Regression Score — globale, scalato sul grade
  function getRegressionBonus_v11() {
    if (!regressionData_v11 || !regressionData_v11.grade) return 1.0;
    const g = regressionData_v11.grade.toUpperCase();
    if (g === 'A+') return 1.10;
    if (g === 'A')  return 1.05;
    if (g === 'B')  return 1.00;
    if (g === 'C')  return 0.95;
    if (g === 'D')  return 0.88;
    return 1.0;
  }

  // Helper: bonus Consensus — se il pick attuale corrisponde al consensus pick
  function getConsensusBonus_v11(pickValue) {
    if (!consensusData_v11 || !consensusData_v11.pick) return { bonus: 1.0, agrees: null };
    const cPick = (consensusData_v11.pick || '').toLowerCase();
    const v = (pickValue || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
    const agrees = v === cPick || v.indexOf(cPick) === 0 || cPick.indexOf(v) === 0;
    if (!agrees) return { bonus: 1.0, agrees: false };
    const agreement = parseFloat(consensusData_v11.agreement) || 0;
    if (agreement >= 80) return { bonus: 1.12, agrees: true };
    if (agreement >= 60) return { bonus: 1.07, agrees: true };
    if (agreement >= 40) return { bonus: 1.03, agrees: true };
    return { bonus: 1.0, agrees: true };
  }

  // Helper: bonus Gap Analyzer — bonus se gap forte e pick favorisce la stessa squadra
  function getGapBonus_v11(pickValue) {
    const v = (pickValue || '').toLowerCase();
    if (gapMagnitude_v11 < 0.4) return 1.0; // gap troppo piccolo
    if (/over 2\.5/i.test(v)) {
      // xG totale alto + gap presente = piu' probabile Over
      return totXG >= 2.5 ? 1.04 : 1.0;
    }
    if (/under 2\.5/i.test(v)) {
      return totXG < 2.0 ? 1.04 : 1.0;
    }
    // Pick 1X2
    const pickFavorsHome = /^1\b|^1\s|^1\(|^1x|^12/i.test(v) && !/^x/.test(v);
    const pickFavorsAway = /^2\b|^2\s|^2\(|^x2|^12/i.test(v) && !/^x/.test(v);
    if (pickFavorsHome && gapFavorsHome_v11) {
      return gapMagnitude_v11 > 1.0 ? 1.10 : gapMagnitude_v11 > 0.75 ? 1.06 : 1.03;
    }
    if (pickFavorsAway && !gapFavorsHome_v11) {
      return gapMagnitude_v11 > 1.0 ? 1.10 : gapMagnitude_v11 > 0.75 ? 1.06 : 1.03;
    }
    // Pick contro il gap (es. gioco 1 ma gap favorisce ospite)
    if ((pickFavorsHome && !gapFavorsHome_v11) || (pickFavorsAway && gapFavorsHome_v11)) {
      return gapMagnitude_v11 > 1.0 ? 0.90 : 0.95;
    }
    // Pareggio in caso di gap basso
    if (/^x\b|^x$|^x\s/.test(v) && gapMagnitude_v11 < 0.3) return 1.05;
    return 1.0;
  }

  const markets = [];

  function scoreMarket(opts) {
    const { value, icon, prob, signals, weights, mlKey, contextBonus } = opts;
    const totalWeight = weights.reduce((s,w) => s + w, 0);
    const activeWeight = signals.reduce((s, active, i) => s + (active ? weights[i] : 0), 0);
    const convergence = totalWeight > 0 ? activeWeight / totalWeight : 0;
    const mlW = getMLWeight(mlKey || value);
    const ctx = contextBonus || 1.0;

    // === SUPER ALGO BONUS ===
    // Se il Super Algorithm concorda (alto superScore), boost convergenza
    let superBonus = 1.0;
    const sScore = getSuperScore(value);
    const sConf = getSuperConf(value);
    if (hasSuperAlgo) {
      if (sScore >= 40) superBonus = 1.15;
      else if (sScore >= 25) superBonus = 1.08;
      else if (sScore >= 15) superBonus = 1.03;
      else superBonus = 0.95;
      // Extra boost se il Super Algorithm gli da confidenza alta
      if (sConf === 'high') superBonus *= 1.08;
    }

    // === SUPER AI (Claude) BONUS ===
    let aiBonus = 1.0;
    if (hasSuperAI) {
      const valLower = value.toLowerCase();
      // bestPick match diretto
      if (aiBestPick.includes(valLower) || valLower.includes(aiBestPick) ||
          (aiBestPick.includes('casa') && valLower.includes('casa')) ||
          (aiBestPick.includes('ospite') && valLower.includes('ospite')) ||
          (aiBestPick === valLower)) {
        aiBonus = 1.20 + (aiConfidence - 50) * 0.003; // Fino a +35% per confidenza 100
        if (aiAlgoConfirmed) aiBonus *= 1.05;
      }
      // In top 3
      else if (aiTop3.some(t => t.includes(valLower) || valLower.includes(t))) {
        aiBonus = 1.10;
      }
      // Non in top 3: leggera penalita'
      else {
        aiBonus = 0.97;
      }
      // Applica moltiplicatore globale (SKIP/GIOCA)
      aiBonus *= aiGlobalMult;
    }

    // ════════════════════════════════════════════════════════════════
    // PATCH V11: APPLICA I 7 MOLTIPLICATORI DEI MODULI LATERALI
    // Ogni modulo restituisce un numero (tipicamente tra 0.85 e 1.15)
    // ════════════════════════════════════════════════════════════════
    const trapBonus_v11        = getTrapBonus_v11(value);
    const revQuoteBonus_v11    = getRevQuoteBonus_v11(value, prob);
    const revXgBonus_v11       = getReverseXgBonus_v11(value);
    const presagioResult_v11   = getPresagioBonus_v11(value);
    const presagioBonus_v11    = presagioResult_v11.bonus;
    const regressionBonus_v11  = getRegressionBonus_v11();
    const consensusResult_v11  = getConsensusBonus_v11(value);
    const consensusBonus_v11   = consensusResult_v11.bonus;
    const gapBonus_v11         = getGapBonus_v11(value);

    // Conta i moduli che supportano (>1.02), contraddicono (<0.98), o sono neutri
    const moduleVotes_v11 = [
      { name: 'Trap Det.',    bonus: trapBonus_v11 },
      { name: 'Rev Quote',    bonus: revQuoteBonus_v11 },
      { name: 'Rev xG',       bonus: revXgBonus_v11 },
      { name: 'Presagio',     bonus: presagioBonus_v11 },
      { name: 'Regression',   bonus: regressionBonus_v11 },
      { name: 'Consensus',    bonus: consensusBonus_v11 },
      { name: 'Gap',          bonus: gapBonus_v11 },
      { name: 'Super Algo',   bonus: superBonus },
      { name: 'Oracle AI',    bonus: aiBonus }
    ];
    const supportingModules_v11 = moduleVotes_v11.filter(m => m.bonus > 1.02);
    const contradictingModules_v11 = moduleVotes_v11.filter(m => m.bonus < 0.98);
    const neutralModules_v11 = moduleVotes_v11.filter(m => m.bonus >= 0.98 && m.bonus <= 1.02);

    const rawScore = (prob / 100) * Math.pow(convergence, 0.7) * (0.4 + 0.6 * mlW) * ctx
                    * superBonus * aiBonus
                    * trapBonus_v11 * revQuoteBonus_v11 * revXgBonus_v11
                    * presagioBonus_v11 * regressionBonus_v11 * consensusBonus_v11 * gapBonus_v11;
    const superScore = rawScore * 100;

    let confidence;
    if (prob >= 72 && convergence >= 0.60 && mlW >= 0.55) confidence = 'high';
    else if (prob >= 55 && convergence >= 0.45) confidence = 'mid';
    else confidence = 'low';
    // Upgrade se TUTTI concordano
    if (confidence === 'mid' && superBonus >= 1.10 && aiBonus >= 1.10) confidence = 'high';
    // PATCH V11: upgrade se almeno 5 moduli su 9 supportano
    if (confidence === 'mid' && supportingModules_v11.length >= 5 && contradictingModules_v11.length === 0) confidence = 'high';
    // PATCH V11: downgrade se 3+ moduli contraddicono
    if (confidence === 'high' && contradictingModules_v11.length >= 3) confidence = 'mid';
    if (confidence === 'mid' && contradictingModules_v11.length >= 4) confidence = 'low';

    return { value, icon, prob, convergence, superScore, confidence,
             mlAccuracy: (mlW*100).toFixed(0), signalHits: signals.filter(Boolean).length, signalTotal: signals.length,
             superAlgoScore: sScore.toFixed(1), superAlgoConf: sConf || '-',
             aiMatch: aiBonus > 1.05 ? 'bestPick' : aiBonus > 1.02 ? 'top3' : '-',
             superBonus: superBonus.toFixed(2), aiBonus: aiBonus.toFixed(2),
             // PATCH V11: metadati nuovi moduli per "Coro dei moduli"
             v11: {
               trapBonus: trapBonus_v11.toFixed(2),
               revQuoteBonus: revQuoteBonus_v11.toFixed(2),
               revXgBonus: revXgBonus_v11.toFixed(2),
               presagioBonus: presagioBonus_v11.toFixed(2),
               presagioAgrees: presagioResult_v11.agrees,
               regressionBonus: regressionBonus_v11.toFixed(2),
               consensusBonus: consensusBonus_v11.toFixed(2),
               consensusAgrees: consensusResult_v11.agrees,
               gapBonus: gapBonus_v11.toFixed(2),
               supporting: supportingModules_v11.length,
               contradicting: contradictingModules_v11.length,
               neutral: neutralModules_v11.length,
               totalModules: moduleVotes_v11.length,
               modulesList: moduleVotes_v11
             }
           };
  }

  // Build all markets (same signals as before)
  const balanced = Math.abs(homeXG - awayXG) < 0.4;

  // 1. VITTORIA CASA
  markets.push(scoreMarket({ value: '1 (Casa)', icon: '\u{1F3E0}', prob: p1X2.home, mlKey: '1',
    signals: [p1X2.home>=50, homeXG>awayXG*1.15, hFS>=3.0, (h2h.homeWins||0)>(h2h.awayWins||0), homeWinExact>45, hasBookmaker?bkHome>=45:p1X2.home>=48, aFTS>=28, hFS>aFS, homeXG>=1.3, p1X2.home>=55],
    weights: [3,3,2,2,2,3,1.5,1,1,2.5],
    contextBonus: (hasBookmaker&&bkHome>=55)?1.12:homeXG>awayXG*1.3?1.08:1.0 }));

  // 2. PAREGGIO
  markets.push(scoreMarket({ value: 'X (Pareggio)', icon: '\u{1F91D}', prob: p1X2.draw, mlKey: 'X',
    signals: [p1X2.draw>=26, balanced, Math.abs(p1X2.home-p1X2.away)<12, drawExact>=25, totXG<2.5, hasBookmaker?bkDraw>=28:p1X2.draw>=27, (h2h.draws||0)>=h2hGames*0.25, hFS>=1.5&&hFS<=3.5&&aFS>=1.5&&aFS<=3.5, pOU[2.5].under>=48, Math.abs(hFS-aFS)<1.5],
    weights: [3,2.5,2,3,2,2.5,1.5,1.5,1.5,1],
    contextBonus: balanced&&drawExact>=28?1.15:1.0 }));

  // 3. VITTORIA OSPITE
  markets.push(scoreMarket({ value: '2 (Ospite)', icon: '\u2708\uFE0F', prob: p1X2.away, mlKey: '2',
    signals: [p1X2.away>=35, awayXG>homeXG, aFS>=3.0, (h2h.awayWins||0)>=(h2h.homeWins||0), awayWinExact>30, hasBookmaker?bkAway>=35:p1X2.away>=38, hFTS>=28, aFS>hFS, awayXG>=1.1, p1X2.away>=40],
    weights: [3,3,2,2,2,3,1.5,1,1.5,2.5],
    contextBonus: (hasBookmaker&&bkAway>=45)?1.12:awayXG>homeXG*1.2?1.08:1.0 }));

  // 4. OVER 1.5
  markets.push(scoreMarket({ value: 'Over 1.5', icon: '\u26BD', prob: pOU[1.5].over, mlKey: 'Over 1.5',
    signals: [pOU[1.5].over>=75, totXG>=2.3, h2hAvgGoals>=2.0, homeXG>=0.9&&awayXG>=0.7, hFS+aFS>=4.0, over25Exact+esProb(s=>s.h+s.a===2)>=60, hFTS<30&&aFTS<35, pBTTS>=45],
    weights: [3,2.5,2,2,1.5,2,1.5,1.5] }));

  // 5. OVER 2.5
  markets.push(scoreMarket({ value: 'Over 2.5', icon: '\u{1F525}', prob: pOU[2.5].over, mlKey: 'Over 2.5',
    signals: [pOU[2.5].over>=55, totXG>=2.8, h2hAvgGoals>=2.5, homeXG>=1.2&&awayXG>=1.0, pBTTS>=55, over25Exact>=40, h2hOver25>=50, hFS+aFS>=4.5],
    weights: [3,3,2,2.5,2,2,1.5,1.5],
    contextBonus: totXG>=3.3?1.08:1.0 }));

  // 6. UNDER 2.5
  markets.push(scoreMarket({ value: 'Under 2.5', icon: '\u{1F6E1}\uFE0F', prob: pOU[2.5].under, mlKey: 'Under 2.5',
    signals: [pOU[2.5].under>=50, totXG<2.3, h2hAvgGoals<2.5, pBTTS<50, hFTS>=25||aFTS>=25, hCS>=30||aCS>=30, esProb(s=>s.h+s.a<=2)>=50, hFS+aFS<5.0],
    weights: [3,3,2,2,1.5,1.5,2.5,1],
    contextBonus: totXG<2.0?1.08:1.0 }));

  // 7. GG (BTTS)
  markets.push(scoreMarket({ value: 'GG (BTTS Si)', icon: '\u26A1', prob: pBTTS, mlKey: 'GG',
    signals: [pBTTS>=55, homeXG>=0.9&&awayXG>=0.9, h2hBTTS>=50, hFTS<30&&aFTS<30, bttsExact>=55, pOU[1.5].over>=72, hFS>=2.0&&aFS>=2.0, hCS<40&&aCS<40],
    weights: [3,3,2,2,2.5,1.5,1.5,1] }));

  // 8. NO GG
  const noGG = 100 - pBTTS;
  markets.push(scoreMarket({ value: 'NG (BTTS No)', icon: '\u{1F6AB}', prob: noGG, mlKey: 'NG',
    signals: [noGG>=50, hFTS>=28||aFTS>=28, hCS>=30||aCS>=30, totXG<2.5, esProb(s=>s.h===0||s.a===0)>=45, pOU[2.5].under>=45, h2hBTTS<55],
    weights: [3,2,2,2,2.5,1.5,1.5] }));

  // 9. 1X
  const p1X = p1X2.home + p1X2.draw;
  markets.push(scoreMarket({ value: '1X', icon: '\u{1F3E0}\u{1F91D}', prob: p1X, mlKey: '1X',
    signals: [p1X>=70, homeXG>=awayXG, hFS>=2.5, p1X2.away<30, hasBookmaker?(bkHome+bkDraw)>=68:p1X>=68, homeWinExact+drawExact>=65],
    weights: [3,2,1.5,2,2.5,2] }));

  // 10. X2
  const pX2 = p1X2.draw + p1X2.away;
  markets.push(scoreMarket({ value: 'X2', icon: '\u{1F91D}\u2708\uFE0F', prob: pX2, mlKey: 'X2',
    signals: [pX2>=55, awayXG>=homeXG*0.85, aFS>=2.5, p1X2.home<45, hasBookmaker?(bkDraw+bkAway)>=50:pX2>=52, awayWinExact+drawExact>=45],
    weights: [3,2,1.5,2,2.5,2] }));

  // 11. OVER 3.5
  markets.push(scoreMarket({ value: 'Over 3.5', icon: '\u{1F4A5}', prob: pOU[3.5].over, mlKey: 'Over 3.5',
    signals: [pOU[3.5].over>=40, totXG>=3.5, pBTTS>=60, h2hAvgGoals>=3.0, over25Exact>=50],
    weights: [3,3,2,2,2] }));

  // 12. UNDER 3.5
  markets.push(scoreMarket({ value: 'Under 3.5', icon: '\u{1F512}', prob: pOU[3.5].under, mlKey: 'Under 3.5',
    signals: [pOU[3.5].under>=65, totXG<3.0, esProb(s=>s.h+s.a<=3)>=65],
    weights: [3,3,2.5] }));

  // 13. MULTIGOL — PATCH V12.2: usa il modulo window.Multigol per i top 5
  // pronostici Multigol ordinati per probabilita'. Niente piu' un solo MG
  // dal cherry-picking di analysis.multigol — adesso vengono valutati tutti
  // i range globali + per squadra e i migliori entrano nel ranking.
  try {
    if (typeof window !== 'undefined' && window.Multigol) {
      const mgTopPicks = window.Multigol.getTopPicks(analysis, {
        minProb: 55, maxProb: 93, limit: 5
      });
      mgTopPicks.forEach(function(mg) {
        markets.push(scoreMarket({
          value: mg.label,
          icon: mg.icon || '\u{1F3AF}',
          prob: mg.prob,
          mlKey: mg.label.indexOf('Casa') >= 0 ? 'MG Casa' :
                 mg.label.indexOf('Ospite') >= 0 ? 'MG Ospite' :
                 'Multigol',
          signals: [
            mg.prob >= 65,
            totXG >= 1.8 && totXG <= 4.0,
            // Coerenza con la fascia di gol: se il range include 2-3 gol e xG totale ≈ 2.5, segnale forte
            (mg.min <= Math.round(totXG) && Math.round(totXG) <= mg.max)
          ],
          weights: [3, 2, 3]
        }));
      });
    }
  } catch(e) {
    console.warn('Multigol V12.2 integration failed:', e);
  }

  markets.sort((a, b) => b.superScore - a.superScore);

  const topExact = (exactScores || []).slice(0, 10).map((s, i) => ({
    score: s.h + '-' + s.a, prob: s.p || s.prob, rank: i + 1
  }));

  // === AI VERDICT DATA ===
  const aiVerdict = hasSuperAI ? {
    bestPick: superAIAnalysis.bestPick,
    bestPickProb: superAIAnalysis.bestPickProb,
    reasoning: superAIAnalysis.bestPickReasoning || superAIAnalysis.aiVerdict || '',
    recommendation: superAIAnalysis.recommendation,
    confidence: superAIAnalysis.confidence,
    keyNews: superAIAnalysis.keyNews || [],
    keyFactors: superAIAnalysis.keyFactors || [],
    warningFlags: (superAIAnalysis.warningFlags || []).filter(w => w && w.length > 0),
    riskLevel: superAIAnalysis.riskLevel || '',
    alternativePick: superAIAnalysis.alternativePick || '',
    alternativeProb: superAIAnalysis.alternativePickProb || 0,
    teamsContext: superAIAnalysis.teamsContext || ''
  } : null;

  const meta = {
    xGTotal: totXG.toFixed(2), xGHome: homeXG.toFixed(2), xGAway: awayXG.toFixed(2),
    formaHome: homeForm || 'N/A', formaAway: awayForm || 'N/A',
    h2hPartite: h2hGames, h2hMediaGol: h2hAvgGoals.toFixed(1), bttsPct: pBTTS.toFixed(0),
    lineupsUsed: analysis.lineupsAvailable || false,
    bookmakerUsed: hasBookmaker, bookmakerName: bk.bookmakerName || '',
    fatigueHome: analysis.homeFatigue || 1.0, fatigueAway: analysis.awayFatigue || 1.0,
    quality: analysis.quality || 'base', dixonColes: true,
    signalsAnalyzed: markets.reduce((s,m) => s + m.signalTotal, 0),
    hasSuperAlgo, hasSuperAI,
    // PATCH V11: flag presenza moduli laterali
    v11_modulesActive: {
      trap: !!trapData_v11,
      reverseXg: !!reverseXgData_v11,
      presagio: !!presagioData_v11,
      regression: !!regressionData_v11,
      consensus: !!consensusData_v11,
      gap: true,
      revQuote: !!(window.state.oddsLab && window.state.oddsLab.bookmakers && window.state.oddsLab.bookmakers.length > 0)
    }
  };

  return { topMarkets: markets.slice(0, 10), topExact, meta, aiVerdict, computedAt: Date.now(), hasSuperAlgo, hasSuperAI };
}

  // ---------------------------------------------------------
  // EXPORT su window.BettingProEngine.Giudizio
  // ---------------------------------------------------------
  window.BettingProEngine = window.BettingProEngine || {};
  window.BettingProEngine.Giudizio = {
    compute: computeGiudizioFinale
  };

  try {
    if (window.console && window.console.log) {
      console.log('%c✓ BettingProEngine.Giudizio module loaded', 'color:#fbbf24;font-weight:bold;');
    }
  } catch(e) {}

})();
