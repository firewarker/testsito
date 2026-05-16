// ============================================================
// MULTIPLA — Generatore automatico di multiple per BettingPro
// ============================================================
// Modulo self-contained che legge state.dailyPicks.matchAdvices
// (gia' calcolato in app.js) e produce una multipla ottimizzata:
//   • L'utente sceglie numero di eventi + quota target
//   • L'algoritmo seleziona i pick con quota individuale piu' vicina
//     alla "quota ideale" (= radice N-esima della quota target)
//   • Filtra solo pick con prob >= 55% e confidence != low
//   • Calcola quota composta e probabilita' congiunta
//
// Integrazione: include questo file DOPO multigol.js. Espone:
//   window.Multipla.generate(opts) -> { picks, totalOdds, compositeProb }
//   window.Multipla.openPanel()    -> apre il pannello inline in home
//   window.Multipla.renderPanel()  -> ritorna HTML del pannello
//
// Author: BettingPro V13 — Turno 3
// ============================================================

(function() {
  'use strict';

  // ---------------------------------------------------------
  // STATO INTERNO DEL MODULO
  // ---------------------------------------------------------
  const config = {
    numEvents: 4,
    targetOdds: 10,
    open: false,
    lastResult: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------------------------------------------------------
  // CORE ALGORITMO
  // ---------------------------------------------------------

  /**
   * Genera una multipla ottimizzata.
   * @param {Object} opts - { numEvents, targetOdds, minProb=55, maxProb=88 }
   * @returns {Object} { picks, totalOdds, compositeProb, deviation, error? }
   */
  function generate(opts) {
    opts = opts || {};
    const numEvents = Math.max(2, Math.min(8, opts.numEvents || 4));
    const targetOdds = Math.max(2, opts.targetOdds || 10);
    const minProb = opts.minProb != null ? opts.minProb : 55;
    const maxProb = opts.maxProb != null ? opts.maxProb : 88;

    const state = window.state;
    if (!state || !state.dailyPicks || !state.dailyPicks.matchAdvices) {
      return { error: 'Pronostici giornalieri non ancora calcolati. Carica le partite di oggi.' };
    }

    // Filtra candidati di qualità
    const candidates = state.dailyPicks.matchAdvices.filter(function(a) {
      if (!a.prob || a.prob < minProb || a.prob > maxProb) return false;
      if (a.confidence === 'low') return false;
      // Salta partite gia' iniziate/finite
      if (a.match && ['1H','2H','HT','ET','P','LIVE','FT','AET','PEN'].indexOf(a.match.status) >= 0) return false;
      return true;
    });

    if (candidates.length < numEvents) {
      return {
        error: 'Non ci sono abbastanza pronostici di qualità (' +
          candidates.length + ' candidati con prob ' + minProb + '-' + maxProb +
          '%). Riduci il numero di eventi, allarga il filtro probabilità, o aspetta che vengano caricate piu\' partite.'
      };
    }

    // Quota individuale ideale (radice N-esima della quota target)
    const idealOddsPerPick = Math.pow(targetOdds, 1 / numEvents);

    // Score di "fitness" per ogni candidato:
    // Penalita' esponenziale per distanza dalla quota ideale,
    // moltiplicata per qualita' della confidence.
    // Cosi' i pick con prob TROPPO alta (= quota troppo bassa rispetto al target)
    // vengono scartati a favore di pick piu' bilanciati.
    candidates.forEach(function(c) {
      const synthOdds = 100 / c.prob;
      c._synthOdds = synthOdds;
      const oddsDiff = Math.abs(synthOdds - idealOddsPerPick);
      const proximityScore = Math.exp(-oddsDiff * 1.5); // 1.0 al match esatto, scende veloce
      const qScore = c.confidence === 'high' ? 1.0 : c.confidence === 'medium' ? 0.85 : 0.65;
      c._fitness = proximityScore * qScore;
    });

    // Ordina per fitness decrescente
    const sorted = candidates.slice().sort(function(a, b) { return b._fitness - a._fitness; });

    // Seleziona top N evitando duplicati di lega (per diversificazione opzionale)
    const selected = [];
    const usedMatchIds = {};
    for (let i = 0; i < sorted.length && selected.length < numEvents; i++) {
      const c = sorted[i];
      if (!usedMatchIds[c.matchId]) {
        selected.push(c);
        usedMatchIds[c.matchId] = true;
      }
    }

    if (selected.length < numEvents) {
      return { error: 'Selezionati solo ' + selected.length + ' su ' + numEvents + ' richiesti.' };
    }

    // Calcolo aggregato
    let totalOdds = 1;
    let compositeProb = 1;
    selected.forEach(function(s) {
      totalOdds *= s._synthOdds;
      compositeProb *= (s.prob / 100);
    });

    return {
      picks: selected,
      totalOdds: totalOdds,
      compositeProb: compositeProb * 100,
      targetOdds: targetOdds,
      deviation: ((totalOdds - targetOdds) / targetOdds * 100),
      idealOddsPerPick: idealOddsPerPick
    };
  }

  // ---------------------------------------------------------
  // UI: pannello inline
  // ---------------------------------------------------------

  function renderResult(result) {
    if (!result) return '';
    if (result.error) {
      return '<div style="margin-top:14px;padding:12px;background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.25);border-radius:10px;color:#f87171;font-size:0.8rem;">' +
        '⚠️ ' + esc(result.error) +
        '</div>';
    }

    const devColor = Math.abs(result.deviation) < 15 ? '#00e5a0' :
                     Math.abs(result.deviation) < 35 ? '#fbbf24' : '#f87171';
    const devLabel = Math.abs(result.deviation) < 15 ? 'in target' :
                     Math.abs(result.deviation) < 35 ? 'discreta' : 'lontana';

    let html = '<div style="margin-top:14px;background:linear-gradient(135deg,rgba(0,229,160,0.04),rgba(0,212,255,0.04));border:1.5px solid rgba(0,229,160,0.25);border-radius:14px;padding:14px;">';

    // Header riassunto
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">';
    html += '<div>';
    html += '<div style="font-size:0.65rem;color:var(--text-dark);text-transform:uppercase;letter-spacing:0.8px;font-weight:700;">🎰 Multipla Generata</div>';
    html += '<div style="font-size:0.75rem;color:var(--text-light);margin-top:2px;">' + result.picks.length + ' eventi · Target ' + result.targetOdds.toFixed(2) + 'x</div>';
    html += '</div>';
    html += '<div style="text-align:right;">';
    html += '<div style="font-size:1.6rem;font-weight:900;color:#00e5a0;line-height:1;">' + result.totalOdds.toFixed(2) + '<span style="font-size:1rem;">x</span></div>';
    html += '<div style="font-size:0.6rem;color:' + devColor + ';font-weight:700;letter-spacing:0.4px;margin-top:2px;">' +
            (result.deviation >= 0 ? '+' : '') + result.deviation.toFixed(0) + '% ' + devLabel + '</div>';
    html += '</div>';
    html += '</div>';

    // Prob composta
    html += '<div style="display:flex;gap:10px;margin-bottom:12px;font-size:0.7rem;flex-wrap:wrap;">';
    html += '<div style="flex:1;min-width:120px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;">';
    html += '<div style="font-size:0.6rem;color:var(--text-dark);text-transform:uppercase;letter-spacing:0.6px;">Prob. composta</div>';
    html += '<div style="font-size:1rem;font-weight:800;color:#00d4ff;">' + result.compositeProb.toFixed(2) + '%</div>';
    html += '</div>';
    html += '<div style="flex:1;min-width:120px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;">';
    html += '<div style="font-size:0.6rem;color:var(--text-dark);text-transform:uppercase;letter-spacing:0.6px;">Vincita su 10€</div>';
    html += '<div style="font-size:1rem;font-weight:800;color:#fbbf24;">' + (10 * result.totalOdds).toFixed(2) + '€</div>';
    html += '</div>';
    html += '</div>';

    // Lista dei pick
    html += '<div style="display:flex;flex-direction:column;gap:6px;">';
    result.picks.forEach(function(p, idx) {
      const probColor = p.prob >= 75 ? '#00e5a0' : p.prob >= 65 ? '#fbbf24' : '#00d4ff';
      const confEmoji = p.confidence === 'high' ? '🟢' : p.confidence === 'medium' ? '🟡' : '⚪';
      html += '<div onclick="(function(){ var m=(window.state.matches||[]).find(function(x){return x.id===' + p.matchId + '}); if(m && typeof analyzeMatch===\'function\') analyzeMatch(m); })()" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;">';
      html += '<div style="width:24px;height:24px;background:linear-gradient(135deg,#00d4ff,#a855f7);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:900;color:#0a0f1e;flex-shrink:0;">' + (idx + 1) + '</div>';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:0.7rem;color:var(--text-dark);margin-bottom:1px;">' + esc(p.league) + ' · ' + esc(p.time) + '</div>';
      html += '<div style="font-size:0.78rem;font-weight:700;color:var(--text-white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.homeName) + ' vs ' + esc(p.awayName) + '</div>';
      html += '<div style="font-size:0.7rem;color:' + probColor + ';font-weight:700;margin-top:2px;">' + confEmoji + ' ' + esc(p.pick) + ' · ' + p.prob.toFixed(0) + '%</div>';
      html += '</div>';
      html += '<div style="text-align:right;flex-shrink:0;">';
      html += '<div style="font-size:0.85rem;font-weight:800;color:#fbbf24;">' + p._synthOdds.toFixed(2) + '</div>';
      html += '<div style="font-size:0.55rem;color:var(--text-dark);">quota</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    html += '<div style="margin-top:10px;padding:8px 10px;background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.15);border-radius:8px;font-size:0.62rem;color:var(--text-gray);">';
    html += '💡 La probabilita\' composta e\' calcolata assumendo indipendenza fra gli eventi. Le quote sono stime sintetiche dal modello (100/prob), non quote bookmaker reali. Tap su un pick per analizzare la partita.';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderPanel() {
    const numOptions = [2, 3, 4, 5, 6];
    const oddsOptions = [3, 5, 10, 20, 50];

    let html = '<div class="panel" id="multiplaPanel" style="margin-bottom:16px;">';
    html += '<div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" onclick="window.Multipla.toggle()">';
    html += '<span>🎰 Crea Multipla Auto</span>';
    html += '<span style="font-size:0.65rem;color:var(--text-dark);font-weight:600;">' + (config.open ? '▾ chiudi' : '▸ apri') + '</span>';
    html += '</div>';

    if (!config.open) {
      html += '<div style="font-size:0.7rem;color:var(--text-dark);margin-top:4px;">Decidi numero eventi e quota target — il sistema seleziona i pick migliori in autonomia.</div>';
      html += '</div>';
      return html;
    }

    // Form
    html += '<div style="margin-top:10px;">';

    // Numero eventi
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:0.62rem;color:var(--text-dark);text-transform:uppercase;letter-spacing:0.6px;font-weight:700;margin-bottom:6px;">N° Eventi</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    numOptions.forEach(function(n) {
      const active = config.numEvents === n;
      html += '<button onclick="window.Multipla.setNumEvents(' + n + ')" style="' +
        'padding:7px 14px;border-radius:18px;font-size:0.74rem;font-weight:700;cursor:pointer;' +
        'border:1.5px solid ' + (active ? 'var(--accent-cyan)' : 'var(--border)') + ';' +
        'background:' + (active ? 'rgba(0,212,255,0.12)' : 'var(--bg-input)') + ';' +
        'color:' + (active ? 'var(--accent-cyan)' : 'var(--text-gray)') + ';' +
        '">' + n + '</button>';
    });
    html += '</div></div>';

    // Quota target
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:0.62rem;color:var(--text-dark);text-transform:uppercase;letter-spacing:0.6px;font-weight:700;margin-bottom:6px;">Quota Target</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    oddsOptions.forEach(function(o) {
      const active = config.targetOdds === o;
      html += '<button onclick="window.Multipla.setTargetOdds(' + o + ')" style="' +
        'padding:7px 14px;border-radius:18px;font-size:0.74rem;font-weight:700;cursor:pointer;' +
        'border:1.5px solid ' + (active ? '#fbbf24' : 'var(--border)') + ';' +
        'background:' + (active ? 'rgba(251,191,36,0.12)' : 'var(--bg-input)') + ';' +
        'color:' + (active ? '#fbbf24' : 'var(--text-gray)') + ';' +
        '">' + o + 'x</button>';
    });
    html += '</div></div>';

    // Bottone genera
    html += '<button onclick="window.Multipla.runAndRender()" style="' +
      'width:100%;padding:11px;background:linear-gradient(135deg,#00d4ff,#a855f7);color:#fff;' +
      'border:none;border-radius:10px;font-size:0.85rem;font-weight:800;cursor:pointer;' +
      'letter-spacing:0.5px;display:flex;align-items:center;justify-content:center;gap:8px;">' +
      '🎲 Genera Multipla</button>';

    // Risultato precedente (se c'è)
    if (config.lastResult) {
      html += '<div id="multiplaResultBox">' + renderResult(config.lastResult) + '</div>';
    }

    html += '</div></div>';
    return html;
  }

  // ---------------------------------------------------------
  // HANDLER
  // ---------------------------------------------------------
  function setNumEvents(n) {
    config.numEvents = n;
    rerender();
  }
  function setTargetOdds(o) {
    config.targetOdds = o;
    rerender();
  }
  function toggle() {
    config.open = !config.open;
    config.lastResult = null;
    rerender();
  }
  function runAndRender() {
    config.lastResult = generate({
      numEvents: config.numEvents,
      targetOdds: config.targetOdds
    });
    rerender();
  }
  function rerender() {
    const panel = document.getElementById('multiplaPanel');
    if (panel && panel.parentNode) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderPanel();
      panel.parentNode.replaceChild(wrapper.firstChild, panel);
    }
  }

  // ---------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------
  window.Multipla = {
    generate: generate,
    renderPanel: renderPanel,
    setNumEvents: setNumEvents,
    setTargetOdds: setTargetOdds,
    toggle: toggle,
    runAndRender: runAndRender,
    _config: config
  };

  try {
    if (window.console && window.console.log) {
      console.log('%c✓ Multipla module loaded', 'color:#00e5a0;font-weight:bold;');
    }
  } catch(e) {}

})();
