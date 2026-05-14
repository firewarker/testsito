# BettingPro V10 — Changelog

## Filosofia della patch
Il codice V9.1 aveva moduli sofisticati (Trap Detector, Reverse Quote, Presagio, Super AI) che però **non parlavano con il Consiglio AI**. Calcolavano i loro verdetti e li mostravano in UI, ma il pick finale era deciso solo dai numeri grezzi del modello statistico (xG, p1X2, pOU, pBTTS).

V10 collega tutti i moduli al `Consiglio AI`, in modo che il pronostico finale sia una sintesi armonica di tutti i segnali. Il pick diventa **consapevole** del mercato sharp, dei rischi situazionali, della pre-analisi Presagio e dell'Oracle AI.

---

## Modifiche file `js/app.js`

### 1. Tracking quote REALI (fix critico al calcolo ROI)

**Bug V9.1**: In `trackPrematchBet` e `trackFromHome` la quota salvata era `(100 / safeProb).toFixed(2)` — una quota SINTETICA derivata dalla probabilità del modello, non la quota vera del bookmaker. Conseguenza: il ROI mostrato nel dashboard (+22% nello storico Firebase) era matematicamente fittizio. Tutti i 1559 bet storici hanno questo problema.

**Fix**:
- Nuovo registro globale `state.lastKnownOdds[matchId]` aggiornato a ogni fetch di `getBookmakerOdds` (quote 1X2) e di `fetchOddsLab` (quote OU/BTTS).
- Nuova funzione `resolveRealOddsForPick(matchId, pickName)` che mappa il nome del pick alla quota reale corrispondente.
- `trackPrematchBet` e `trackFromHome` ora provano prima la quota reale; fallback alla sintetica solo se non disponibile.
- Nuovo flag `syntheticOdds: boolean` sul bet object per distinguere bet con quote vere da quelli con quote sintetiche.
- Nuova funzione `migrateLegacyOddsFlag()` lanciata all'avvio: marca retroattivamente tutti i bet storici come `syntheticOdds: true` (perché creati con la vecchia logica).
- Nuove funzioni globali esposte su `window`:
  - `window.getRealROIStats()` → ROI calcolato solo sui bet con quote reali
  - `window.getSyntheticROIStats()` → ROI sui bet storici (per confronto, con disclaimer)

### 2. Market Reality Check (fix architetturale)

`generateAIAdvice` ora chiama `applyMarketRealityCheck(advice, analysis, match)` come ultimo passo, prima del `return advice`. Questa funzione applica in cascata:

#### 2a. Reverse Quote OU/BTTS
Confronta `pOU[2.5]` e `pBTTS` del modello con le quote sharp (Pinnacle/Bet365/Unibet) o medie del bookmaker pool. Se delta > 15%, confidence high→medium o medium→low, probabilità fusa al 60/40 (modello/bookie). Se delta < -15%, propone il mercato opposto come prima alternativa.

#### 2b. Reverse Quote 1X2
Stesso meccanismo ma su `p1X2` vs `state.bookmakerOdds.{home,draw,away}Odd`. Copre i pick `1/X/2/1X/X2`.

#### 2c. Trap Detector
Chiama `calculateTrapScore(match, analysis, advice)`. Threshold dipende dal tipo di pick:
- Pick 1X2 → threshold 50 (più sensibile)
- Pick mercati (Over/Under/GG/NG) → threshold 65

Se score ≥ threshold+10: downgrade confidence, riduce prob del 15%, suggerisce trapPick come alternativa.

#### 2d. Presagio alignment
Chiama `window.Presagio.calculate(analysis, match)` e confronta il pick del Consiglio AI col pick di Presagio sullo stesso mercato. Se divergono e Presagio è confidente (≥55%), penalizza la confidence.

#### 2e. Super AI / Oracle
Se `state.superAIAnalysis.recommendation === 'SKIP'`, declassa di 2 livelli di confidence. Se Oracle conferma ad alta fiducia, aggiunge reason positiva.

#### 2f. Consensus sintetico
Conta i "conflictPoints" dei moduli sopra:
- 3+ punti → forza `confidence='low'` con reason di consensus negativo
- 0 punti + prob≥70 → upgrade a `confidence='high'` se era medium

### 3. Versioning

Header del file aggiornato da `BETTINGPRO v7` a `BETTINGPRO v10`. Title di `index.html` aggiornato da `V3` a `V10`.

---

## Cosa NON è stato fatto in questa patch (per scelta)

- **Backtest engine Python**: rinviato. Prima serve accumulare 200-300 bet con quote reali (post-V10) per avere dati su cui ha senso fare il backtest. Senza il fix tracking, qualunque backtest era inutile.
- **Modifica UI per mostrare i nuovi reasons**: i nuovi reasons (Reverse Quote, Presagio, Oracle) sono già aggiunti all'array `advice.reasons` e quindi compaiono automaticamente nella UI esistente che li renderizza.
- **Estensione di getBookmakerOdds per popolare lastKnownOdds anche per i match della home (daily picks)**: attualmente le quote reali sono disponibili solo per il match attualmente analizzato (non per tutti i daily picks). Estendere richiederebbe chiamate API massive (1 per match al giorno) che sforerebbero il rate limit del piano API-Football.

---

## Come verificare la patch funzioni

1. **Deploy** del codice via Cloudflare Pages (sostituire `js/app.js`).
2. **Aprire un match** qualsiasi e tracciare un pick. Aprire console browser e verificare:
   - Il bet salvato in `state.trackedBets` ha `syntheticOdds: false` (se le quote erano disponibili)
   - Il messaggio "✅ Pronostico tracciato!" mostra l'origine della quota (es. "OU25", "BTTS", "1X2")
3. **Console**: digitare `getRealROIStats()` per vedere il ROI reale (dovrebbe essere `null` o pochi bet finché non si accumulano dati post-patch).
4. **Verifica fusione moduli**: aprire una partita dove c'è una divergenza modello/mercato. Nel Consiglio AI dovrebbero comparire reasons del tipo "⚠️ Reverse Quote: forte disaccordo..." e la confidence dovrebbe essere coerentemente declassata.

---

## File invariati
- `presagio.js` — già self-contained e ben progettato. Nessuna modifica.
- `style.css` — nessuna modifica UI necessaria; i nuovi reasons usano gli stili esistenti.
