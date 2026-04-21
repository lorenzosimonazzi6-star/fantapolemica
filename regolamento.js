// ============================================================
// FANTADRAFT — regolamento.js
// Tab Regolamento: documento completo navigabile
// ============================================================

export function renderRegolamento(leagueId, league, user) {
  const el       = document.getElementById("tab-regolamento");
  const settings = league.settings || {};
  const cap      = settings.salaryCap      || 320;
  const softMax  = settings.softCapMax     || 340;
  const hardMax  = settings.hardCapMax     || 360;
  const luxThr   = settings.luxuryTaxThreshold || 360;
  const gwStart  = settings.gwStart        || 1;

  el.innerHTML = `
    <div class="page-header">
      <span class="ph-icon">📖</span>
      <h1>Regolamento</h1>
    </div>

    <!-- INDICE -->
    <div class="reg-toc card card-sm" style="margin-bottom:24px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
        Indice
      </div>
      <div class="reg-toc-links">
        ${[
          ["reg-draft",       "📝 Draft"],
          ["reg-salaryca",    "💰 Salary Cap"],
          ["reg-contratti",   "📋 Contratti"],
          ["reg-scambi",      "🔄 Scambi"],
          ["reg-rose",        "🌹 Rose & Formazioni"],
          ["reg-punteggio",   "⚽ Punteggio"],
          ["reg-calendario",  "📅 Calendario & Playoff"],
          ["reg-lottery",     "🎰 Lottery"],
          ["reg-premi",       "🏆 Premi & Penalità"],
        ].map(([id, label]) => `<a class="reg-toc-link" href="#${id}">${label}</a>`).join("")}
      </div>
    </div>

    <!-- SEZIONI -->
    <div class="reg-body">

      ${section("reg-draft", "📝", "Draft", `
        <p>La lega prevede <strong>2 Draft per stagione</strong>: un Draft estivo (post calciomercato estivo) e un Draft di riparazione (febbraio, post calciomercato invernale).</p>

        ${ruleBlock("Draft Estivo", [
          `Salary Cap: <strong>${cap} FM</strong>`,
          "Base d'acquisto: quotazione attuale Fantacalcio.it",
          "Modalità: Mantra",
          "L'ordine del 1° giro è determinato dalla Lottery (vedi sezione Lottery)",
          "Dal 2° giro in poi: ordine inverso della classifica della Regular Season precedente",
          "Non si può svincolare un giocatore preso nella stessa sessione",
          "Sono consentiti scambi durante il Draft",
          "Gli svincoli vengono comunicati in ordine di classifica, dal 1° all'ultimo",
        ])}

        ${ruleBlock("Draft di Riparazione", [
          "Budget supplementare: <strong>0 FM</strong> aggiuntivi",
          "Base d'acquisto: quotazione attuale Fantacalcio.it",
          "Ordine: inverso della classifica attuale",
          "Un giocatore svincolato non può tornare al suo proprietario originale nella stessa sessione",
          "Rinnovi: è possibile rinnovare i giocatori in scadenza di contratto",
          "Numero svincoli: illimitati",
        ])}

        ${ruleBlock("Svincoli — Rimborso FM", [
          "<strong>Taglio volontario:</strong> 50% subito + 50% restante alla scadenza originale del contratto",
          "<strong>Venduto all'estero:</strong> 100% rimborso + scelta extra nello stesso giro del Draft",
          "<strong>Infortunio ≥ 3 mesi:</strong> 100% rimborso (calcolato dall'ultima partita alla prima convocazione)",
          "<strong>Parametro zero / retrocessione in Serie B:</strong> rimborso del costo della stagione corrente (no scelta extra)",
          "<strong>Prestito interrotto poi ceduto/prestato all'estero:</strong> nessuna scelta extra",
        ])}

        ${ruleBlock("Scelta Extra per Vendita all'Estero", [
          "Se il giocatore era stato scelto nelle prime 3 tornate del Draft estivo → scelta extra al 1° giro del Draft di riparazione",
          "Se scelto dal 4° al 6° giro → scelta extra al 2° giro del Draft di riparazione, e così via",
          "Se il giocatore acquistato a gennaio con contratto pluriennale viene venduto all'estate → scelta extra al Draft di settembre pari al giro di acquisizione + 10 giri",
          "Se più manager hanno più scelte nello stesso giro, l'ordine è dato dall'inverso della classifica attuale",
        ])}
      `)}

      ${section("reg-salaryca", "💰", "Salary Cap", `
        <p>Ogni manager ha a disposizione <strong>${cap} FM</strong> per comporre la propria rosa.</p>

        <div class="cap-grid" style="margin:16px 0">
          <div class="cap-card cc-cap">
            <div class="cap-card-label">✓ Cap Standard</div>
            <div class="cap-card-range">≤ ${cap} FM</div>
            <div class="cap-card-desc">Nessuna limitazione di mercato</div>
          </div>
          <div class="cap-card cc-soft">
            <div class="cap-card-label">Soft Cap</div>
            <div class="cap-card-range">${cap+1}–${softMax} FM</div>
            <div class="cap-card-desc">Raggiungibile solo tramite scambi. Nessuna penalità. Cap massimo al prossimo Draft: ${softMax} FM</div>
          </div>
          <div class="cap-card cc-hard">
            <div class="cap-card-label">Hard Cap</div>
            <div class="cap-card-range">${softMax+1}–${hardMax} FM</div>
            <div class="cap-card-desc">Scambi con differenza max 10 FM. Cap al prossimo Draft: stessa cifra (max 2 stagioni consecutive, poi torna a ${softMax} FM)</div>
          </div>
          <div class="cap-card cc-luxury">
            <div class="cap-card-label">Luxury Tax</div>
            <div class="cap-card-range">≥ ${luxThr+1} FM</div>
            <div class="cap-card-desc">Nessuno scambio. Perdita scelte (1 ogni 2 FM sopra il limite). Cap al prossimo Draft: ${softMax} FM obbligatorio</div>
          </div>
        </div>

        ${ruleBlock("Penalità di Classifica (valide la stagione successiva)", [
          `<strong>6° classificato:</strong> -1 FM sul tetto di spesa`,
          `<strong>7° classificato:</strong> -2 FM sul tetto di spesa`,
          `<strong>8° classificato:</strong> -3 FM sul tetto di spesa + max 355 FM per la stagione`,
          `<strong>9° classificato:</strong> -4 FM sul tetto di spesa + max 350 FM per la stagione`,
          `<strong>10° classificato:</strong> -6 FM sul tetto di spesa + max Soft Cap + no clausola Bandiera`,
        ])}
      `)}

      ${section("reg-contratti", "📋", "Contratti", `
        <p>Ogni manager ha <strong>fino alla fine di settembre</strong> per dichiarare la durata del contratto di ogni giocatore acquistato al Draft estivo.</p>

        ${ruleBlock("Durata e costi", [
          "Contratti da 1 a 3 anni (Draft estivo) · da 6 mesi a 3 anni e 6 mesi (Draft riparazione)",
          "<strong>Anno 1:</strong> costo invariato",
          "<strong>Anno 2:</strong> +30% (under 21: +10%) — rincaro minimo 1 FM",
          "<strong>Anno 3:</strong> +20% sul costo anno 2 — rincaro minimo 1 FM",
          "I rinnovi scattano automaticamente il <strong>1° giugno</strong> di ogni anno",
        ])}

        ${ruleBlock("Rinnovo scadenza", [
          "+40% sul costo attuale — solo 1 anno aggiuntivo — possibile solo 1 volta per giocatore",
          "I rinnovi si effettuano entro fine febbraio. Dal 1° aprile i giocatori sono Free Agent",
        ])}

        ${ruleBlock("Clausola Giocatore Bandiera", [
          "Applicabile a un singolo giocatore <strong>Under 21</strong>",
          "Il costo di acquisto rimane fisso per sempre (nessun incremento)",
          "Nessun vincolo contrattuale: può restare nella rosa per qualsiasi numero di anni",
          "Se il giocatore lascia la Serie A: rimborso del costo d'acquisto + eventuali bonus scelta",
          "<strong>Attivabile solo 1 volta ogni 5 anni</strong> di Fantacalcio",
          "Non disponibile per i manager con penalità 10° classificato nella stagione precedente",
        ])}
      `)}

      ${section("reg-scambi", "🔄", "Scambi", `
        <p>Gli scambi sono aperti dal <strong>Draft iniziale fino alla fine di marzo</strong>. Riaprono dal <strong>1° giugno</strong> (dopo i rinnovi).</p>

        ${ruleBlock("Regole generali", [
          "Ogni scambio concordato da due manager diventa automaticamente ufficiale",
          "Un terzo manager può richiedere l'annullamento solo se tutti gli altri 7 manager sono concordi",
          "Gli scambi devono comprendere i contratti interi dei giocatori coinvolti",
          "Sono consentiti scambi a 3 o 4 vie contemporaneamente",
        ])}

        ${ruleBlock("Vincoli per livello di Cap", [
          "<strong>Cap/Soft Cap:</strong> scambi liberi senza vincoli di costo",
          "<strong>Hard Cap:</strong> differenza max di 10 FM tra i giocatori coinvolti (riferimento: costo a bilancio)",
          "<strong>Luxury Tax:</strong> nessuno scambio consentito",
        ])}

        ${ruleBlock("Scelte Draft negli scambi", [
          "Si possono includere solo scelte dei <strong>primi 3 giri</strong> del Draft estivo",
          "Massimo <strong>3 scelte</strong> per singolo Draft per scambio",
          "Massimo <strong>3 stagioni</strong> future di scelte scambiabili",
          "Non si possono scambiare scelte del Draft di riparazione",
        ])}
      `)}

      ${section("reg-rose", "🌹", "Rose & Formazioni", `
        ${ruleBlock("Composizione rosa", [
          "Minimo <strong>23 giocatori</strong> (di cui almeno 2 portieri) — massimo <strong>30 giocatori</strong>",
          "Nessun vincolo numerico per ruolo",
        ])}

        ${ruleBlock("Formazioni", [
          "Schieramento entro l'inizio delle partite della giornata",
          "In caso di dimenticanza: recupero dell'ultima formazione salvata",
          "Dal 4° recupero in poi: penale di <strong>5€</strong> per ogni formazione non inserita",
          "Moduli consentiti: tutti i moduli previsti in modalità <strong>Mantra standard</strong>",
          "Non è consentito giocare volontariamente in 10 uomini o meno (pena: rimozione 1a scelta Draft)",
        ])}

        ${ruleBlock("Panchina e sostituzioni", [
          "<strong>12 giocatori in panchina</strong> — divieto di schierare indisponibili quando possibile",
          "<strong>5 sostituzioni</strong> in modalità <strong>Master</strong>",
        ])}
      `)}

      ${section("reg-punteggio", "⚽", "Punteggio", `
        ${ruleBlock("Sistema di voti", [
          "<strong>Voti:</strong> forniti da Sofascore (redazione statistico — Alvin)",
          "<strong>Cartellini:</strong> Fantacalcio.it",
          "Standard base per prestazione normale: <strong>6.5</strong>",
        ])}

        ${ruleBlock("Bonus Gol (per ruolo)", [
          "Portieri e difensori: <strong>+5.5</strong> per gol",
          "Centrocampisti (E, M, C, T, W): <strong>+4.5</strong> per gol",
          "Attaccanti (A, Pc, Att, Tr): <strong>+3</strong> per gol",
        ])}

        ${ruleBlock("Bonus Assist", [
          "Portieri e difensori (Dc, Dd, Ds): <strong>+2</strong>",
          "Centrocampisti: <strong>+1.5</strong>",
          "Attaccanti: <strong>+1</strong>",
        ])}

        ${ruleBlock("Bonus Portiere", [
          "Porta inviolata: <strong>+2</strong>",
          "Rigore parato: <strong>+3</strong>",
          "Gol subito: <strong>-1</strong> per gol",
        ])}

        ${ruleBlock("Malus", [
          "Ammonizione: <strong>-0.5</strong>",
          "Espulsione: <strong>-1</strong>",
          "Autogol: <strong>-2</strong>",
          "Rigore sbagliato: <strong>-3</strong>",
        ])}

        ${ruleBlock("Conversione Fantapunti → Gol", [
          "66–71.5 FP = <strong>1 gol</strong>",
          "72–76.5 FP = <strong>2 gol</strong>",
          "77–80.5 FP = <strong>3 gol</strong>",
          "81–84.5 FP = <strong>4 gol</strong>",
          "Ogni 4 FP aggiuntivi sopra 85 = +1 gol",
        ])}

        ${ruleBlock("Partite rinviate", [
          "Rinvio prima dell'inizio (causa naturale imprevista): <strong>6 politico</strong> a tutti i giocatori coinvolti",
          "Se le partite rinviate sono <strong>≥ 4</strong>: si attende la disputa delle gare",
          "Caso Supercoppa Italiana / eventi organizzativi: si attende il risultato (max 2 giornate intercorrenti)",
          "Partita sospesa dopo l'inizio: si attende il risultato finale",
          "Partita non disputata assegnata a tavolino: <strong>6 d'ufficio</strong> a tutti (inclusi infortunati)",
        ])}
      `)}

      ${section("reg-calendario", "📅", "Calendario & Playoff", `
        ${ruleBlock("Regular Season", [
          `Inizia alla <strong>GW${gwStart}</strong> di Serie A e termina alla <strong>GW34</strong>`,
          "Formato: round-robin bilanciato tra tutti i manager",
          "Con numero dispari di manager: una squadra riposa (BYE) ogni giornata, ruotando",
          "La classifica finale della Regular Season determina i premi principali e l'ordine per la Lottery",
          "L'ultimo in classifica dovrà vestirsi da Sailor Moon (o simile imbarazzante) al prossimo Draft",
        ])}

        ${ruleBlock("Playoff", [
          "<strong>GW35 — Turno Preliminare:</strong> 7° vs 10° e 8° vs 9° · Fattore campo +2 per la squadra meglio classificata · gara secca",
          "<strong>GW36 — Quarti di Finale:</strong> 8 squadre (top 6 + 2 vincitori play-in) · gara secca",
          "<strong>GW37 — Semifinali:</strong> gara secca",
          "<strong>GW38 — Finale:</strong> gara secca",
          "Il fattore campo (+2) è valido <strong>solo nel turno preliminare</strong>",
        ])}
      `)}

      ${section("reg-lottery", "🎰", "Lottery", `
        <p>La Lottery determina le prime 3 posizioni di scelta al 1° giro del Draft. I <strong>top 3</strong> classificati non partecipano.</p>

        ${ruleBlock("Probabilità base", [
          "4°–6°: <strong>10%</strong> ciascuno",
          "7°–8°: <strong>15%</strong> ciascuno",
          "9°–10°: <strong>20%</strong> ciascuno",
        ])}

        ${ruleBlock("Sistema Anti-Tanking", [
          "Le probabilità vengono corrette in base ai FantaPunti totali stagionali",
          "<strong>IndiceTank (IT)</strong> = (FPTeam - FPmin) / (FPmax - FPmin) · varia tra 0 e 1",
          "<strong>Fattore di Correzione (FC)</strong> = 0.75 + 0.25 × IT",
          "La squadra con FP più bassi mantiene il 75% della probabilità base (FC = 0.75)",
          "La squadra con FP più alti mantiene il 100% della probabilità base (FC = 1.00)",
          "<strong>Clausola Anti-Scostamento Estremo:</strong> se la differenza con la squadra superiore supera 100 FP → ulteriore -10% sulla probabilità finale",
          "Le probabilità vengono normalizzate al 100% dopo le correzioni",
        ])}

        ${ruleBlock("Procedura", [
          "3 estrazioni sequenziali senza rimpiazzo determinano le prime 3 scelte",
          "Dal 4° slot in poi: ordine inverso della classifica Regular Season",
          "I giri 2+ seguono sempre l'ordine inverso della classifica",
        ])}
      `)}

      ${section("reg-premi", "🏆", "Premi & Penalità", `
        ${ruleBlock("Premi Regular Season", [
          "1° classificato: <strong>250€</strong>",
          "2° classificato: <strong>100€</strong>",
          "3° classificato: <strong>50€</strong>",
        ])}

        ${ruleBlock("Premi Playoff", [
          "Vincitore Playoff: <strong>75€</strong>",
          "Finalista Playoff: <strong>25€</strong>",
        ])}

        ${ruleBlock("Penalità di gioco", [
          "Dal 4° recupero formazione: <strong>5€</strong> per ogni formazione non inserita",
          "Giocare volontariamente in inferiorità numerica: rimozione 1a scelta disponibile al Draft",
          "10° classificato Regular Season: vestirsi da Sailor Moon al prossimo Draft",
        ])}

        ${ruleBlock("Quota di partecipazione", [
          "<strong>50€</strong> a stagione per partecipante",
        ])}
      `)}

    </div>
  `;

  // Smooth scroll per i link dell'indice
  document.querySelectorAll(".reg-toc-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const target = document.getElementById(link.getAttribute("href").slice(1));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ── HELPERS HTML ──────────────────────────────────
function section(id, icon, title, content) {
  return `
    <div class="reg-section" id="${id}">
      <div class="reg-section-title">
        <span>${icon}</span> ${title}
      </div>
      <div class="reg-section-body">
        ${content}
      </div>
    </div>`;
}

function ruleBlock(title, rules) {
  return `
    <div class="reg-rule-block">
      <div class="reg-rule-title">${title}</div>
      <ul class="reg-rule-list">
        ${rules.map(r => `<li>${r}</li>`).join("")}
      </ul>
    </div>`;
}
