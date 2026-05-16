// ============================================================
// ENGINE-TRAP — Trap Detector per BettingPro
// ============================================================
// Estratto da app.js (V13). Self-contained. Espone:
//   window.BettingProEngine.Trap.calculate(match, d, ai)
//     → { score, level, label, color, traps, trapPick? }
//   window.BettingProEngine.Trap.generatePick(...)
//     → result con pick alternativo "anti-trappola"
//
// Le funzioni hanno UNA SOLA dipendenza esterna su state:
//   window.state.superAIAnalysis
//   window.state.superAnalysis
// (gia' esposto su window in V11).
//
// Author: BettingPro V14 — Turno 4 (estrazione Trap Detector)
// ============================================================

(function() {
  'use strict';

function calculateTrapScore(match, d, ai) {
  const traps = [];
  let totalScore = 0;
  
  const hD = d.homeData || {};
  const aD = d.awayData || {};
  const p = d.p1X2 || { home: 33, draw: 33, away: 33 };
  const xG = d.xG || { home: 1.2, away: 1.0, total: 2.2 };
  const pOU = d.pOU || {};
  const pBTTS = d.pBTTS || 50;
  const bk = d.bookmakerOdds || {};
  
  // Chi è il favorito?
  const favIs = p.home > p.away ? 'home' : 'away';
  const favProb = favIs === 'home' ? p.home : p.away;
  const undProb = favIs === 'home' ? p.away : p.home;
  const favName = favIs === 'home' ? match.home.name : match.away.name;
  const undName = favIs === 'home' ? match.away.name : match.home.name;
  const favData = favIs === 'home' ? hD : aD;
  const undData = favIs === 'home' ? aD : hD;
  const favXG = favIs === 'home' ? xG.home : xG.away;
  const undXG = favIs === 'home' ? xG.away : xG.home;
  const favForm = favIs === 'home' ? (d.homeForm || '') : (d.awayForm || '');
  const undForm = favIs === 'home' ? (d.awayForm || '') : (d.homeForm || '');
  const favFatigue = favIs === 'home' ? (d.homeFatigue || 1.0) : (d.awayFatigue || 1.0);
  const undFatigue = favIs === 'home' ? (d.awayFatigue || 1.0) : (d.homeFatigue || 1.0);
  const favInjuries = favIs === 'home' ? (d.homeInjuries || []) : (d.awayInjuries || []);
  const undInjuries = favIs === 'home' ? (d.awayInjuries || []) : (d.homeInjuries || []);
  const favPos = favIs === 'home' ? d.homePosition : d.awayPosition;
  const undPos = favIs === 'home' ? d.awayPosition : d.homePosition;
  
  // Se non c'è un favorito chiaro, nessuna trappola possibile
  if (favProb < 45) {
    return { score: 0, level: 'none', label: 'Equilibrata', color: '#64748b', traps: [{ factor: 'Partita equilibrata', detail: 'Nessun favorito chiaro (' + p.home.toFixed(0) + '% / ' + p.away.toFixed(0) + '%). Il concetto di trappola non si applica.', weight: 0, icon: 'ℹ️' }], trapPick: null };
  }
  
  // === FATTORE 1: Forma gonfiata — vittorie senza dominare ===
  if (favForm && favForm.length >= 3) {
    const recent = favForm.slice(0, 5).split('');
    const wins = recent.filter(function(r) { return r === 'W'; }).length;
    const losses = recent.filter(function(r) { return r === 'L'; }).length;
    
    if (wins >= 3 && favData.goalsFor && favData.goalsFor < 1.5) {
      var w = 15;
      totalScore += w;
      traps.push({ factor: 'Forma gonfiata', detail: favName + ': ' + wins + 'V nelle ultime 5 ma solo ' + favData.goalsFor.toFixed(1) + ' gol/g — vittorie risicate senza dominare.', weight: w, icon: '🎭' });
    }
    if (wins >= 3 && favData.goalsAgainst && favData.goalsAgainst >= 1.5) {
      var w = 10;
      totalScore += w;
      traps.push({ factor: 'Vince ma subisce', detail: favName + ': vince spesso ma subisce ' + favData.goalsAgainst.toFixed(1) + ' gol/g — basta un gol per ribaltare.', weight: w, icon: '🎭' });
    }
    if (losses >= 2) {
      var w = 12;
      totalScore += w;
      traps.push({ factor: 'Forma in calo', detail: favName + ': ' + losses + ' sconfitte nelle ultime 5. Tendenza negativa.', weight: w, icon: '📉' });
    }
  }
  
  // === FATTORE 2: H2H scomodo ===
  const h2h = d.h2hInfo || {};
  if (h2h.awayMultiplier && h2h.awayMultiplier > 1.05 && favIs === 'home') {
    var w = 14;
    totalScore += w;
    traps.push({ factor: 'H2H sfavorevole', detail: undName + ' ha un buon rendimento storico contro ' + favName + '. Possibile "bestia nera".', weight: w, icon: '👻' });
  } else if (h2h.homeMultiplier && h2h.homeMultiplier > 1.05 && favIs === 'away') {
    var w = 14;
    totalScore += w;
    traps.push({ factor: 'H2H sfavorevole', detail: undName + ' ha un buon rendimento storico contro ' + favName + '. Possibile "bestia nera".', weight: w, icon: '👻' });
  }
  
  // === FATTORE 3: Motivazione asimmetrica ===
  if (favPos && undPos) {
    if (favPos <= 4 && undPos >= 15) {
      var w = 12;
      totalScore += w;
      traps.push({ factor: 'Motivazione asimmetrica', detail: favName + ' (' + favPos + '°) già al sicuro. ' + undName + ' (' + undPos + '°) lotta per la salvezza — motivazione 120%.', weight: w, icon: '🔥' });
    }
    if (favPos >= 8 && favPos <= 14 && (undPos <= 5 || undPos >= 17)) {
      var w = 8;
      totalScore += w;
      traps.push({ factor: 'Favorito senza obiettivo', detail: favName + ' (' + favPos + '°) in terra di nessuno. Rischio rilassamento.', weight: w, icon: '😴' });
    }
  }
  
  // === FATTORE 4: Fatica / Calendario fitto ===
  if (favFatigue < 0.95) {
    var w = Math.min(18, Math.round((1 - favFatigue) * 120));
    totalScore += w;
    traps.push({ factor: 'Stanchezza favorito', detail: favName + ': calendario fitto, energia ' + (favFatigue * 100).toFixed(0) + '%. Gambe pesanti.', weight: w, icon: '🥵' });
  }
  
  // === FATTORE 5: Clean sheet bassa del favorito ===
  if (favData.cleanSheetPct != null && favData.cleanSheetPct < 25) {
    var w = favData.cleanSheetPct < 15 ? 14 : 10;
    totalScore += w;
    traps.push({ factor: 'Difesa permeabile', detail: favName + ': porta inviolata solo nel ' + favData.cleanSheetPct.toFixed(0) + '%. L\'underdog troverà il gol.', weight: w, icon: '🚪' });
  }
  
  // === FATTORE 6: Assenze INTELLIGENTI ===
  // Solo lo squilibrio conta — le assenze di lunga data sono già nei dati
  {
    const favInj = favInjuries.length;
    const undInj = undInjuries.length;
    const delta = favInj - undInj;
    
    if (delta >= 4) {
      var w = 12;
      totalScore += w;
      traps.push({ factor: 'Squilibrio assenze', detail: favName + ': ' + favInj + ' indisponibili vs ' + undInj + ' di ' + undName + ' (Δ' + delta + '). Differenza pesante.', weight: w, icon: '🏥' });
    } else if (delta >= 2 && favInj >= 3) {
      var w = 7;
      totalScore += w;
      traps.push({ factor: 'Più assenti', detail: favName + ': ' + favInj + ' assenti vs ' + undInj + '. Leggero svantaggio.', weight: w, icon: '🏥' });
    }
  }
  
  // === FATTORE 7: Quote troppo basse ===
  // FIX: bk.home è la PROBABILITÀ (0-100), le quote vere sono in bk.homeOdd / bk.awayOdd
  const bkHomeOdd = (bk.homeOdd && bk.homeOdd > 1) ? parseFloat(bk.homeOdd) : 0;
  const bkAwayOdd = (bk.awayOdd && bk.awayOdd > 1) ? parseFloat(bk.awayOdd) : 0;
  const favOdds = favIs === 'home' ? bkHomeOdd : bkAwayOdd;
  if (favOdds > 0 && favOdds <= 1.30) {
    var w = 16;
    totalScore += w;
    traps.push({ factor: 'Quota troppo bassa', detail: 'Quota @' + favOdds.toFixed(2) + ' — tutti puntano uguale, zero valore. Classica trappola.', weight: w, icon: '💰' });
  } else if (favOdds > 0 && favOdds <= 1.45) {
    var w = 8;
    totalScore += w;
    traps.push({ factor: 'Quota compressa', detail: 'Quota @' + favOdds.toFixed(2) + ' — profitto minimo anche vincendo.', weight: w, icon: '💰' });
  }
  
  // === FATTORE 8: Gap xG stretto mascherato ===
  const xgGap = Math.abs(favXG - undXG);
  if (favProb >= 60 && xgGap < 0.5) {
    var w = 14;
    totalScore += w;
    traps.push({ factor: 'xG ingannatore', detail: 'Prob ' + favProb.toFixed(0) + '% ma xG vicini (' + favXG.toFixed(2) + ' vs ' + undXG.toFixed(2) + '). Più equilibrata di quanto sembra.', weight: w, icon: '📊' });
  } else if (favProb >= 55 && xgGap < 0.35) {
    var w = 10;
    totalScore += w;
    traps.push({ factor: 'xG equilibrato', detail: 'Gap xG stretto: ' + favXG.toFixed(2) + ' vs ' + undXG.toFixed(2) + '. Il favorito non domina.', weight: w, icon: '📊' });
  }
  
  // === FATTORE 9: "TOO GOOD TO BE TRUE" ===
  // Quando TUTTO concorda per vittoria facile, il rischio paradossale sale
  {
    var perfSignals = 0;
    if (favProb >= 65) perfSignals++;
    if (favOdds > 0 && favOdds <= 1.45) perfSignals++;
    if (favForm && favForm.slice(0, 3) === 'WWW') perfSignals++;
    if (favXG > undXG * 1.8) perfSignals++;
    if (favData.winRate && favData.winRate >= 65) perfSignals++;
    
    if (perfSignals >= 4) {
      var w = 14;
      totalScore += w;
      traps.push({ factor: 'Troppo facile?', detail: 'Prob ' + favProb.toFixed(0) + '%, quota bassa, forma perfetta, xG dominante — quando tutto è "troppo bello" il rischio upset è massimo. Le partite facili non esistono.', weight: w, icon: '🪤' });
    } else if (perfSignals === 3) {
      var w = 8;
      totalScore += w;
      traps.push({ factor: 'Eccessiva sicurezza', detail: 'Troppi segnali positivi concordano (' + perfSignals + '/5). Attenzione alla sindrome "partita già vinta".', weight: w, icon: '🪤' });
    }
  }
  
  // === FATTORE 10: Momentum underdog ===
  // Se l'underdog sta migliorando è molto più pericoloso
  if (undForm && undForm.length >= 4) {
    const undRecent = undForm.slice(0, 5).split('');
    const undFirst2 = undRecent.slice(0, 2);
    const undLast3 = undRecent.slice(2);
    const undRecentPts = undFirst2.reduce(function(s, r) { return s + (r === 'W' ? 3 : r === 'D' ? 1 : 0); }, 0);
    const undOlderPts = undLast3.reduce(function(s, r) { return s + (r === 'W' ? 3 : r === 'D' ? 1 : 0); }, 0);
    const undOlderAvg = undLast3.length > 0 ? undOlderPts / undLast3.length : 1;
    const undRecentAvg = undFirst2.length > 0 ? undRecentPts / undFirst2.length : 1;
    
    if (undRecentAvg > undOlderAvg + 0.5 && undRecentPts >= 4) {
      var w = 12;
      totalScore += w;
      traps.push({ factor: 'Underdog in crescita', detail: undName + ': trend in netto miglioramento (' + undFirst2.join('') + ' vs ' + undLast3.join('') + '). Avversario pericoloso.', weight: w, icon: '📈' });
    } else if (undRecentAvg > undOlderAvg && undData.goalsFor >= 1.3) {
      var w = 7;
      totalScore += w;
      traps.push({ factor: 'Underdog in ripresa', detail: undName + ': forma in miglioramento e segna ' + undData.goalsFor.toFixed(1) + ' gol/g. Da non sottovalutare.', weight: w, icon: '📈' });
    }
  }
  
  // === FATTORE 11: Gap fisico (underdog riposato) ===
  if (favFatigue < 0.97 && undFatigue >= 1.0) {
    const fatigueGap = undFatigue - favFatigue;
    if (fatigueGap >= 0.06) {
      var w = 10;
      totalScore += w;
      traps.push({ factor: 'Gap fisico', detail: undName + ' riposato, ' + favName + ' affaticato. Differenza energia: ' + (fatigueGap * 100).toFixed(0) + '%.', weight: w, icon: '🏃' });
    }
  }
  
  // === FATTORE 12: SUPER AI WARNING FLAGS ===
  const superAI = window.state.superAIAnalysis;
  if (superAI && !superAI.error) {
    const warnings = (superAI.warningFlags || []).filter(function(wf) { return wf && wf.length > 2; });
    if (warnings.length > 0) {
      var w = Math.min(15, warnings.length * 6);
      totalScore += w;
      traps.push({ factor: 'Alert Oracle AI', detail: warnings.join(' | '), weight: w, icon: '🧠' });
    }
    if (superAI.recommendation === 'SKIP') {
      var w = 12;
      totalScore += w;
      traps.push({ factor: 'Oracle consiglia SKIP', detail: 'L\'analisi AI con news suggerisce di evitare questa partita.', weight: w, icon: '🛑' });
    }
    if (superAI.riskLevel === 'alto') {
      var w = 10;
      totalScore += w;
      traps.push({ factor: 'Rischio AI alto', detail: 'Oracle AI classifica il rischio come ALTO sulla base delle news.', weight: w, icon: '⚡' });
    }
  }
  
  // === FATTORE 13: Bassa convergenza Super Algoritmo ===
  const superAlgo = window.state.superAnalysis;
  if (superAlgo && superAlgo.picks && superAlgo.picks.length > 0) {
    if (superAlgo.avgConvergence < 0.45) {
      var w = 10;
      totalScore += w;
      traps.push({ factor: 'Segnali discordanti', detail: 'Super Algoritmo: convergenza ' + (superAlgo.avgConvergence * 100).toFixed(0) + '%. I segnali non concordano.', weight: w, icon: '🔀' });
    }
  }
  
  // === ATTENUANTE 1: Underdog sterile ===
  if (undData.failedToScorePct > 40) {
    totalScore -= 8;
    traps.push({ factor: 'Underdog sterile', detail: undName + ': non segna nel ' + undData.failedToScorePct.toFixed(0) + '% delle partite. Poco pericoloso.', weight: -8, icon: '🛡️' });
  }
  
  // === ATTENUANTE 2: Dominio reale del favorito ===
  if (favForm && favForm.length >= 5) {
    const fRecent = favForm.slice(0, 5).split('');
    const fWins = fRecent.filter(function(r) { return r === 'W'; }).length;
    if (fWins >= 4 && favData.goalsFor >= 2.0 && favData.goalsAgainst < 1.2) {
      totalScore -= 12;
      traps.push({ factor: 'Dominio reale', detail: favName + ': ' + fWins + 'V/5, segna ' + favData.goalsFor.toFixed(1) + ' e subisce solo ' + favData.goalsAgainst.toFixed(1) + '. Forma autentica.', weight: -12, icon: '🛡️' });
    }
  }
  
  // === ATTENUANTE 3: Oracle AI conferma con alta fiducia ===
  if (superAI && !superAI.error && superAI.confidence >= 75 && superAI.algoConfirmed) {
    totalScore -= 8;
    traps.push({ factor: 'Oracle AI conferma', detail: 'L\'AI con news conferma il pronostico con ' + superAI.confidence + '% di confidenza.', weight: -8, icon: '🛡️' });
  }
  
  // === ATTENUANTE 4: Underdog in crisi nera ===
  if (undForm && undForm.length >= 4) {
    const uRecent = undForm.slice(0, 4).split('');
    const uLosses = uRecent.filter(function(r) { return r === 'L'; }).length;
    if (uLosses >= 3 && undData.goalsFor < 0.8) {
      totalScore -= 10;
      traps.push({ factor: 'Underdog in crisi', detail: undName + ': ' + uLosses + ' sconfitte su 4 e segna solo ' + undData.goalsFor.toFixed(1) + ' gol/g. In crisi totale.', weight: -10, icon: '🛡️' });
    }
  }
  
  // Normalizza 0-100
  totalScore = Math.max(0, Math.min(100, totalScore));
  
  // Ordina: rischi prima (peso alto), poi attenuanti (negativi)
  traps.sort(function(a, b) { return b.weight - a.weight; });
  
  var level, label, color;
  if (totalScore <= 20) { level = 'safe'; label = 'SICURA'; color = '#10b981'; }
  else if (totalScore <= 40) { level = 'caution'; label = 'ATTENZIONE'; color = '#fbbf24'; }
  else if (totalScore <= 60) { level = 'risk'; label = 'RISCHIO'; color = '#f97316'; }
  else { level = 'trap'; label = 'TRAPPOLA'; color = '#ef4444'; }
  
  // === PRONO DEL TRAP ===
  const trapPick = generateTrapPick(totalScore, level, match, d, ai, favIs, favName, undName, favXG, undXG, favProb, pOU, pBTTS, superAI, superAlgo);
  
  return { score: totalScore, level, label, color, traps, trapPick, favName, undName, favProb, favOdds };
}
// === PRONO DEL TRAP — Pronostico intelligente anti-trappola ===
function generateTrapPick(trapScore, trapLevel, match, d, ai, favIs, favName, undName, favXG, undXG, favProb, pOU, pBTTS, superAI, superAlgo) {
  const p = d.p1X2 || { home: 33, draw: 33, away: 33 };
  const totXG = (d.xG || {}).total || 2.2;
  const result = { pick: '', prob: 0, reasoning: '', strategy: '', confidence: 'medium', alternatives: [] };
  
  // Raccogli i pick da tutte le fonti
  const aiPick = ai ? ai.pick : '';
  const oraclePick = (superAlgo && superAlgo.topPick) ? superAlgo.topPick.value : '';
  const aiNewsPick = (superAI && !superAI.error) ? (superAI.bestPick || '') : '';
  
  // Se trap è bassa: conferma il pick principale con extra fiducia
  if (trapLevel === 'safe') {
    result.pick = aiPick || oraclePick || 'Over 1.5';
    result.prob = ai ? ai.prob : 65;
    result.reasoning = 'Nessun segnale di trappola. Il pronostico principale è affidabile.';
    result.strategy = 'Via libera per singole e multiple.';
    result.confidence = 'high';
    // Aggiungi conferma fonti
    if (oraclePick && aiNewsPick) {
      const allAgree = aiPick.toLowerCase().includes(oraclePick.toLowerCase().split(' ')[0]) || oraclePick.toLowerCase().includes(aiPick.toLowerCase().split(' ')[0]);
      if (allAgree) result.reasoning = 'Tutte le fonti concordano e nessun segnale di trappola. Massima fiducia.';
    }
    return result;
  }
  
  // Se trap è TRAPPOLA o RISCHIO: suggerisci mercato sicuro
  if (trapLevel === 'trap' || trapLevel === 'risk') {
    // Strategia: evita esiti secchi (1, X, 2), preferisci mercati "proteggibili"
    const candidates = [];
    
    // Under 3.5 quasi sempre sicuro in partite trappola (poca qualità, tensione)
    if (pOU && pOU[3.5]) {
      candidates.push({ pick: 'Under 3.5', prob: pOU[3.5].under, reason: 'Le partite trappola tendono ad essere bloccate — tensione alta, pochi gol.' });
    }
    
    // Double chance del favorito (copertura pareggio)
    const dcPick = favIs === 'home' ? '1X' : 'X2';
    const dcProb = favIs === 'home' ? p.home + p.draw : p.away + p.draw;
    candidates.push({ pick: dcPick, prob: dcProb, reason: 'Double chance copre il pareggio — il favorito potrebbe non vincere ma difficilmente crolla del tutto.' });
    
    // Over 1.5 (quasi sempre passa)
    if (pOU && pOU[1.5] && pOU[1.5].over >= 70) {
      candidates.push({ pick: 'Over 1.5', prob: pOU[1.5].over, reason: 'Almeno 2 gol sono probabili anche nelle trappole. Mercato sicuro.' });
    }
    
    // GG se entrambe segnano spesso
    if (pBTTS >= 55 && favXG > 0.9 && undXG > 0.9) {
      candidates.push({ pick: 'GG', prob: pBTTS, reason: 'Entrambe segnano — l\'underdog motivato trova il gol, il favorito reagisce.' });
    }
    
    // Under 2.5 se partita è davvero bloccata
    if (totXG < 2.3 && pOU && pOU[2.5]) {
      candidates.push({ pick: 'Under 2.5', prob: pOU[2.5].under, reason: 'xG totale basso (' + totXG.toFixed(2) + ') + tensione da trappola = pochi gol.' });
    }
    
    // Ordina per probabilità
    candidates.sort((a, b) => b.prob - a.prob);
    
    if (candidates.length > 0) {
      const best = candidates[0];
      result.pick = best.pick;
      result.prob = best.prob;
      result.reasoning = best.reason;
      result.confidence = trapLevel === 'trap' ? 'high' : 'medium';
      result.strategy = trapLevel === 'trap' 
        ? '🚫 NON giocare il favorito secco. Usa questo pick sicuro o evita la partita.'
        : '⚡ Il favorito secco è rischioso. Questo pick gestisce il rischio.';
      result.alternatives = candidates.slice(1, 3).map(c => ({ pick: c.pick, prob: c.prob.toFixed(0) }));
    }
    return result;
  }
  
  // Se trap è ATTENZIONE: pick "ammorbidito"
  // Mantieni l'area del pick principale ma proteggi
  const candidates = [];
  
  // Se il pick AI è un esito secco (1, 2), suggerisci double chance
  if (aiPick && (aiPick.includes('Casa') || aiPick.includes('Ospite') || aiPick === '1' || aiPick === '2')) {
    const dcPick = (aiPick.includes('Casa') || aiPick === '1') ? '1X' : 'X2';
    const dcProb = (aiPick.includes('Casa') || aiPick === '1') ? p.home + p.draw : p.away + p.draw;
    candidates.push({ pick: dcPick, prob: dcProb, reason: 'Il favorito è dato vincente ma i segnali di attenzione suggeriscono di coprire il pareggio.' });
  }
  
  // Over 1.5 + Under 3.5 combo sicura
  if (pOU && pOU[1.5] && pOU[3.5]) {
    const o15 = pOU[1.5].over;
    const u35 = pOU[3.5].under;
    if (o15 >= 72 && u35 >= 60) {
      candidates.push({ pick: 'Over 1.5', prob: o15, reason: 'Mercato gol sicuro — almeno 2 gol sono molto probabili.' });
    }
  }
  
  // GG come alternativa
  if (pBTTS >= 55) {
    candidates.push({ pick: 'GG', prob: pBTTS, reason: 'Entrambe segnano — copre sia vittoria che pareggio con gol.' });
  }
  
  // Conferma AI se disponibile
  if (aiNewsPick && candidates.length === 0) {
    candidates.push({ pick: aiNewsPick, prob: (superAI || {}).bestPickProb || 60, reason: 'Oracle AI suggerisce questo pick basandosi anche sulle news.' });
  }
  
  candidates.sort((a, b) => b.prob - a.prob);
  
  if (candidates.length > 0) {
    const best = candidates[0];
    result.pick = best.pick;
    result.prob = best.prob;
    result.reasoning = best.reason;
    result.confidence = 'medium';
    result.strategy = '⚠️ Giocabile con cautela. Evita nelle multiple da 3+.';
    result.alternatives = candidates.slice(1, 3).map(c => ({ pick: c.pick, prob: c.prob.toFixed(0) }));
  } else {
    result.pick = aiPick || 'Over 1.5';
    result.prob = ai ? ai.prob : 65;
    result.reasoning = 'Segnali di attenzione limitati. Il pick principale resta valido.';
    result.confidence = 'medium';
    result.strategy = '✓ Giocabile come singola.';
  }
  
  return result;
}

  // ---------------------------------------------------------
  // EXPORT su window.BettingProEngine.Trap
  // ---------------------------------------------------------
  window.BettingProEngine = window.BettingProEngine || {};
  window.BettingProEngine.Trap = {
    calculate: calculateTrapScore,
    generatePick: generateTrapPick
  };

  try {
    if (window.console && window.console.log) {
      console.log('%c✓ BettingProEngine.Trap module loaded', 'color:#f87171;font-weight:bold;');
    }
  } catch(e) {}

})();
