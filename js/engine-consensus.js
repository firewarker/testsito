// ============================================================
// ENGINE-CONSENSUS — Consensus Engine + Regression Score
// ============================================================
// Estratto da app.js (V14). Self-contained. Espone:
//   window.BettingProEngine.Consensus.regression(match, analysis, oddsLab)
//     → { score, grade, factors, adjustedProb }
//   window.BettingProEngine.Consensus.build(match, analysis, ai, oddsLab,
//                                            regressionResult, superAI, superAlgo)
//     → { topPick, agreement, sources, alternatives, ... }
//
// Dipendenze esterne: nessuna (helper clamp duplicato inline).
//
// Author: BettingPro V15 — Turno 4 step 3
// ============================================================

(function() {
  'use strict';

  // Helper locale (duplicato da app.js, 1 riga)
  const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

function calculateRegressionScore(match, analysis, oddsLab) {
  if (!analysis) return null;
  
  const factors = [];
  let totalScore = 0;
  let totalWeight = 0;
  
  const p1X2 = analysis.p1X2 || { home: 33, draw: 33, away: 33 };
  const xG = analysis.xG || { home: 1.2, away: 1.0, total: 2.2 };
  const hD = analysis.homeData || {};
  const aD = analysis.awayData || {};
  const bk = analysis.bookmakerOdds || {};
  const pBTTS = analysis.pBTTS || 50;
  const pOU = analysis.pOU || {};
  
  // Chi è il favorito dal nostro modello
  const favIs = p1X2.home > p1X2.away ? 'home' : 'away';
  const favProb = favIs === 'home' ? p1X2.home : p1X2.away;
  const favXG = favIs === 'home' ? xG.home : xG.away;
  const undXG = favIs === 'home' ? xG.away : xG.home;
  
  // FATTORE 1: Forza Poisson (peso 25%)
  // Il nostro modello Poisson quanto è convinto?
  {
    const w = 25;
    const score = clamp(0, (favProb - 30) * (100/40), 100); // 30%=0, 70%=100
    factors.push({ name: '🎯 Forza Poisson', score: score.toFixed(0), weight: w, color: score > 65 ? '#00e5a0' : (score > 40 ? '#fbbf24' : '#f87171') });
    totalScore += score * w;
    totalWeight += w;
  }
  
  // FATTORE 2: Dominanza xG (peso 20%)
  {
    const w = 20;
    const xgDiff = favXG - undXG;
    const score = clamp(0, (xgDiff / 1.5) * 100, 100); // Diff 1.5+ = 100
    factors.push({ name: '⚽ Dominanza xG', score: score.toFixed(0), weight: w, color: score > 65 ? '#00e5a0' : (score > 40 ? '#fbbf24' : '#f87171') });
    totalScore += score * w;
    totalWeight += w;
  }
  
  // FATTORE 3: Conferma Bookmaker (peso 20%)
  {
    const w = 20;
    let score = 50; // default neutro
    if (oddsLab && oddsLab.consensus) {
      const bkFavProb = favIs === 'home' ? oddsLab.consensus.home : oddsLab.consensus.away;
      score = clamp(0, (bkFavProb - 25) * (100/45), 100);
    } else if (bk && bk.home > 0) {
      const bkFavProb = favIs === 'home' ? bk.home : bk.away;
      score = clamp(0, (bkFavProb - 25) * (100/45), 100);
    }
    factors.push({ name: '💰 Conferma Quote', score: score.toFixed(0), weight: w, color: score > 65 ? '#00e5a0' : (score > 40 ? '#fbbf24' : '#f87171') });
    totalScore += score * w;
    totalWeight += w;
  }
  
  // FATTORE 4: Forma recente (peso 15%)
  {
    const w = 15;
    const favForm = favIs === 'home' ? (analysis.homeForm || '') : (analysis.awayForm || '');
    let score = 50;
    if (favForm.length >= 3) {
      const recent = favForm.slice(0, 5).split('');
      const wins = recent.filter(r => r === 'W').length;
      const losses = recent.filter(r => r === 'L').length;
      score = clamp(0, ((wins - losses + 2.5) / 5) * 100, 100);
    }
    factors.push({ name: '📈 Forma Recente', score: score.toFixed(0), weight: w, color: score > 65 ? '#00e5a0' : (score > 40 ? '#fbbf24' : '#f87171') });
    totalScore += score * w;
    totalWeight += w;
  }
  
  // FATTORE 5: Solidità difensiva (peso 10%)
  {
    const w = 10;
    const favGA = favIs === 'home' ? (hD.goalsAgainst || 1.2) : (aD.goalsAgainst || 1.2);
    const score = clamp(0, (1.8 - favGA) / 1.5 * 100, 100); // 0.3 GA=100, 1.8+=0
    factors.push({ name: '🛡️ Difesa', score: score.toFixed(0), weight: w, color: score > 65 ? '#00e5a0' : (score > 40 ? '#fbbf24' : '#f87171') });
    totalScore += score * w;
    totalWeight += w;
  }
  
  // FATTORE 6: Steam Move / Smart Money (peso 10%)
  {
    const w = 10;
    let score = 50;
    if (oddsLab && oddsLab.steamMoves.length > 0) {
      const favSteam = oddsLab.steamMoves.find(s => s.direction === favIs && s.type === 'bullish');
      const undSteam = oddsLab.steamMoves.find(s => s.direction !== favIs && s.type === 'bullish');
      if (favSteam) {
        const delta = parseFloat(favSteam.delta);
        score = isNaN(delta) ? 80 : (80 + delta);
      }
      else if (undSteam) score = 20;
    }
    score = clamp(0, isNaN(score) ? 50 : score, 100);
    factors.push({ name: '🔥 Smart Money', score: score.toFixed(0), weight: w, color: score > 65 ? '#00e5a0' : (score > 40 ? '#fbbf24' : '#f87171') });
    totalScore += score * w;
    totalWeight += w;
  }
  
  const finalScore = totalWeight > 0 ? totalScore / totalWeight : 50;
  
  let grade, gradeColor;
  if (finalScore >= 80) { grade = 'A+'; gradeColor = '#00e5a0'; }
  else if (finalScore >= 70) { grade = 'A'; gradeColor = '#00d4ff'; }
  else if (finalScore >= 60) { grade = 'B+'; gradeColor = '#3b82f6'; }
  else if (finalScore >= 50) { grade = 'B'; gradeColor = '#fbbf24'; }
  else if (finalScore >= 40) { grade = 'C'; gradeColor = '#f97316'; }
  else { grade = 'D'; gradeColor = '#f87171'; }
  
  return {
    score: finalScore.toFixed(0),
    grade, gradeColor,
    factors,
    favIs,
    favName: favIs === 'home' ? match.home.name : match.away.name,
    recommendation: finalScore >= 70 ? 'FORTE' : (finalScore >= 55 ? 'GIOCABILE' : 'EVITARE')
  };
}

// ============================================================
// 4. CONSENSUS ENGINE — Fusione intelligente di tutte le fonti
// ============================================================
function buildConsensusEngine(match, analysis, ai, oddsLab, regressionResult, superAI, superAlgo) {
  if (!analysis) return null;
  
  const sources = [];
  const pickVotes = {}; // { 'pick': { count, totalWeight, sources } }
  
  // Funzione helper per aggiungere un voto
  function addVote(name, pick, prob, weight, icon) {
    if (!pick || pick === 'N/A') return;
    // Normalizza pick AGGRESSIVO — mappa tutte le varianti allo stesso pick canonico
    const normalizedPick = normalizePick(pick);
    const src = { name, pick: normalizedPick, prob: parseFloat(prob) || 0, weight, icon };
    sources.push(src);
    
    if (!pickVotes[normalizedPick]) pickVotes[normalizedPick] = { count: 0, totalWeight: 0, maxProb: 0, sources: [] };
    pickVotes[normalizedPick].count++;
    pickVotes[normalizedPick].totalWeight += weight;
    pickVotes[normalizedPick].maxProb = Math.max(pickVotes[normalizedPick].maxProb, src.prob);
    pickVotes[normalizedPick].sources.push(name);
  }
  
  function normalizePick(raw) {
    if (!raw) return raw;
    const p = raw.trim().toLowerCase();
    
    // === Double Chance (PRIMA di X per evitare che "1x casa o pareggio" matchi "pareggio" → X) ===
    if (/^1x(\s|\(|$)/i.test(p) || p === '1x' || p.includes('casa o pareggio') || p.includes('1x (')) return '1X';
    if (/^x2(\s|\(|$)/i.test(p) || p === 'x2' || p.includes('pareggio o ospite') || p.includes('x2 (')) return 'X2';
    if (/^12(\s|$)/i.test(p) || p === '12' || p.includes('no pareggio')) return '12';
    
    // === 1X2 ===
    if (/^1(\s|\(|$)/.test(p) || p.includes('vittoria casa') || p.includes('casa vince') || p.includes('home win')) return '1';
    if (/^2(\s|\(|$)/.test(p) || p.includes('vittoria ospite') || p.includes('ospite vince') || p.includes('away win')) return '2';
    if (/^x(\s|\(|$)/.test(p) || p === 'pareggio' || p === 'x (pareggio)' || p === 'draw') return 'X';
    
    // === Over/Under ===
    if (/over\s*0\.?5/i.test(p)) return 'Over 0.5';
    if (/over\s*1\.?5/i.test(p)) return 'Over 1.5';
    if (/over\s*2\.?5/i.test(p)) return 'Over 2.5';
    if (/over\s*3\.?5/i.test(p)) return 'Over 3.5';
    if (/under\s*0\.?5/i.test(p)) return 'Under 0.5';
    if (/under\s*1\.?5/i.test(p)) return 'Under 1.5';
    if (/under\s*2\.?5/i.test(p)) return 'Under 2.5';
    if (/under\s*3\.?5/i.test(p)) return 'Under 3.5';
    
    // === GG/NG ===
    if (p === 'gg' || p.includes('gol gol') || p.includes('both teams') || p.includes('btts') || p.includes('entrambe segnano')) return 'GG';
    if (p === 'ng' || p === 'no gol' || p.includes('no gol') || p.includes('no goal')) return 'NG';
    
    // Fallback
    return raw.trim();
  }
  
  // 1. Modello Poisson/Dixon-Coles (peso 3)
  if (ai && ai.pick) {
    addVote('Poisson AI', ai.pick, ai.prob, 3, '🎯');
  }
  
  // 2. Bookmaker consensus (peso 3)
  if (oddsLab && oddsLab.consensus) {
    const c = oddsLab.consensus;
    const maxP = Math.max(c.home, c.draw, c.away);
    const bkPick = c.home === maxP ? '1' : (c.away === maxP ? '2' : 'X');
    addVote('Bookmakers', bkPick, maxP, 3, '💰');
  } else if (analysis.bookmakerOdds) {
    const b = analysis.bookmakerOdds;
    const maxP = Math.max(b.home, b.draw, b.away);
    const bkPick = b.home === maxP ? '1' : (b.away === maxP ? '2' : 'X');
    addVote('Bookmaker', bkPick, maxP, 2.5, '💰');
  }
  
  // 3. Regression Score (peso 2)
  if (regressionResult && regressionResult.score >= 55) {
    const rPick = regressionResult.favIs === 'home' ? '1' : '2';
    addVote('Regressione', rPick, regressionResult.score, 2, '📊');
  }
  
  // 4. Super AI con news (peso 2)
  if (superAI && !superAI.error && superAI.bestPick) {
    addVote('Oracle AI', superAI.bestPick, superAI.confidence || 60, 2, '🔮');
  }
  
  // 5. Super Algoritmo locale (peso 2)
  if (superAlgo && superAlgo.topPick) {
    addVote('Super Algo', superAlgo.topPick.value, superAlgo.topPick.prob, 2, '⚡');
  }
  
  // 6. Steam Move (peso 1.5)
  if (oddsLab && oddsLab.steamMoves.length > 0) {
    const bullish = oddsLab.steamMoves.find(s => s.type === 'bullish');
    if (bullish) {
      const steamPick = bullish.direction === 'home' ? '1' : '2';
      addVote('Smart Money', steamPick, 65, 1.5, '🔥');
    }
  }
  
  // Trova il pick con il peso cumulativo più alto
  const sortedPicks = Object.entries(pickVotes)
    .map(([pick, data]) => ({ pick, ...data, score: data.totalWeight * (data.maxProb / 100) * data.count }))
    .sort((a, b) => b.score - a.score);
  
  if (sortedPicks.length === 0) return null;
  
  const winner = sortedPicks[0];
  const totalSources = sources.length;
  const agreeSources = sources.filter(s => s.pick === winner.pick).length;
  const agreement = totalSources > 0 ? (agreeSources / totalSources * 100) : 0;
  
  // Confidence calibrata
  let confidence = 'medium', confidenceColor = '#fbbf24';
  if (agreement >= 80 && winner.maxProb >= 60) { confidence = 'MASSIMA'; confidenceColor = '#00e5a0'; }
  else if (agreement >= 60 && winner.maxProb >= 55) { confidence = 'ALTA'; confidenceColor = '#00d4ff'; }
  else if (agreement >= 40) { confidence = 'MEDIA'; confidenceColor = '#fbbf24'; }
  else { confidence = 'BASSA'; confidenceColor = '#f87171'; }
  
  // Calcola prob ponderata
  const agreeingSources = sources.filter(s => s.pick === winner.pick);
  let weightedProb = 0, sumWeights = 0;
  agreeingSources.forEach(s => { weightedProb += s.prob * s.weight; sumWeights += s.weight; });
  const finalProb = sumWeights > 0 ? weightedProb / sumWeights : winner.maxProb;
  
  return {
    pick: winner.pick,
    prob: finalProb.toFixed(1),
    confidence,
    confidenceColor,
    agreement: agreement.toFixed(0),
    agreeSources,
    totalSources,
    sources: sources.map(s => ({ ...s, agrees: s.pick === winner.pick })),
    alternatives: sortedPicks.slice(1, 3).map(p => ({ pick: p.pick, sources: p.count, prob: p.maxProb.toFixed(0) }))
  };
}

  // ---------------------------------------------------------
  // EXPORT su window.BettingProEngine.Consensus
  // ---------------------------------------------------------
  window.BettingProEngine = window.BettingProEngine || {};
  window.BettingProEngine.Consensus = {
    regression: calculateRegressionScore,
    build: buildConsensusEngine
  };

  try {
    if (window.console && window.console.log) {
      console.log('%c✓ BettingProEngine.Consensus module loaded', 'color:#00d4ff;font-weight:bold;');
    }
  } catch(e) {}

})();
