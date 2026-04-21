// ============================================================
// FANTADRAFT — admin.js
// Pannello Commissioner: tutte le funzionalità di gestione lega
// ============================================================

import { db, ref, get, set, push, update } from "./firebase.js";
import { parseCSVRose, calcAge, getCapLevel, roleColor } from "./utils.js";
import { generateRoundRobin } from "./classifica.js";
import { applyDefaultContracts } from "./rose.js";

// ── INIT ─────────────────────────────────────────
export async function renderAdmin(leagueId, league, user) {
  const el = document.getElementById("tab-admin");
  if (league.commissionerUid !== user.uid) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🔒</div>
        <h3>Accesso negato</h3>
        <p>Questa sezione è riservata al Commissioner della lega.</p>
      </div>`;
    return;
  }

  const teams    = Object.values(league.teams || {});
  const settings = league.settings || {};

  // Carica dati necessari
  const [dbSnap, scheduleSnap, draftSnap] = await Promise.all([
    get(ref(db, `db_giocatori/${leagueId}`)),
    get(ref(db, `leagues/${leagueId}/schedule`)),
    get(ref(db, `leagues/${leagueId}/draftState`)),
  ]);
  const dbPlayers  = dbSnap.val()    || {};
  const schedule   = scheduleSnap.val() || {};
  const draftState = draftSnap.val();

  el.innerHTML = buildAdminHTML(teams, settings, dbPlayers, schedule, draftState, leagueId);
  bindAdminEvents(leagueId, league, teams, settings, schedule, draftState);
}

// ── MAIN HTML ─────────────────────────────────────
function buildAdminHTML(teams, settings, dbPlayers, schedule, draftState, leagueId) {
  const dbCount      = Object.keys(dbPlayers).length;
  const scheduleGws  = Object.keys(schedule).length;
  const draftStatus  = draftState?.status || "idle";
  const cap          = settings.salaryCap || 320;

  return `
    <div class="page-header">
      <span class="ph-icon">⚙️</span>
      <h1>Pannello <span style="color:var(--accent)">Commissioner</span></h1>
    </div>

    <!-- STATO LEGA KPI -->
    <div class="card-grid" style="margin-bottom:24px">
      ${kpi("👥", "Manager",       `${teams.length} / ${settings.maxManagers || "?"}`,   teams.length >= (settings.maxManagers||10) ? "green" : "orange")}
      ${kpi("🗄️", "DB Giocatori",  `${dbCount} giocatori`,                               dbCount > 0 ? "green" : "red")}
      ${kpi("📅", "Calendario",    scheduleGws > 0 ? `${scheduleGws} GW generate` : "Non generato", scheduleGws > 0 ? "green" : "red")}
      ${kpi("📝", "Draft",         draftStatus === "done" ? "Completato" : draftStatus === "active" ? "In corso" : draftStatus === "idle" ? "Non avviato" : draftStatus, draftStatus === "done" ? "green" : draftStatus === "active" ? "orange" : "red")}
    </div>

    <!-- SEZIONI ACCORDION -->
    <div class="admin-sections">

      ${adminSection("admin-s-settings", "⚙️", "Impostazioni Lega", buildSettingsSection(settings, leagueId))}
      ${adminSection("admin-s-players",  "🗄️", "Database Giocatori", buildPlayersSection(dbPlayers, dbCount))}
      ${adminSection("admin-s-teams",    "👥", "Gestione Manager", buildTeamsSection(teams, settings))}
      ${adminSection("admin-s-rose",     "🌹", "Gestione Rose & Contratti", buildRoseManagementSection(teams, dbPlayers, settings))}
      ${adminSection("admin-s-calendar", "📅", "Calendario", buildCalendarSection(teams, settings, schedule))}
      ${adminSection("admin-s-scores",   "⚽", "Inserimento Voti / Punteggi", buildScoresSection(teams, settings))}
      ${adminSection("admin-s-contracts","📋", "Contratti Automatici", buildContractsSection(settings))}
      ${adminSection("admin-s-cap",      "💰", "Penalità & CAP", buildCapSection(teams, settings))}
      ${adminSection("admin-s-draft",    "📝", "Stato Draft", buildDraftSection(draftState, teams))}
      ${adminSection("admin-s-danger",   "🗑️", "Zona Pericolosa", buildDangerSection())}

    </div>
  `;
}

// ── SEZIONI ───────────────────────────────────────

function buildSettingsSection(settings, leagueId) {
  return `
    <div class="form-grid" style="margin-bottom:16px">
      <div class="form-group">
        <label class="form-label">GW Inizio stagione</label>
        <input class="form-input" id="s-gwstart" type="number" min="1" max="10" value="${settings.gwStart||1}">
      </div>
      <div class="form-group">
        <label class="form-label">Salary Cap (FM)</label>
        <input class="form-input" id="s-cap" type="number" min="100" value="${settings.salaryCap||320}">
      </div>
      <div class="form-group">
        <label class="form-label">Soft Cap max (FM)</label>
        <input class="form-input" id="s-soft" type="number" value="${settings.softCapMax||340}">
      </div>
      <div class="form-group">
        <label class="form-label">Hard Cap max (FM)</label>
        <input class="form-input" id="s-hard" type="number" value="${settings.hardCapMax||360}">
      </div>
      <div class="form-group">
        <label class="form-label">Max Manager</label>
        <input class="form-input" id="s-maxm" type="number" min="2" max="20" value="${settings.maxManagers||10}">
      </div>
      <div class="form-group">
        <label class="form-label">Fattore Campo Playoff (+FM)</label>
        <input class="form-input" id="s-hf" type="number" min="0" value="${settings.homefieldBonus||2}">
      </div>
      <div class="form-group">
        <label class="form-label">Min giocatori rosa</label>
        <input class="form-input" id="s-minr" type="number" value="${settings.minRosterSize||23}">
      </div>
      <div class="form-group">
        <label class="form-label">Max giocatori rosa</label>
        <input class="form-input" id="s-maxr" type="number" value="${settings.maxRosterSize||30}">
      </div>
    </div>
    <div id="settings-error" class="form-error" style="margin-bottom:8px"></div>
    <button class="btn btn-primary btn-sm" id="save-settings-btn">💾 Salva impostazioni</button>
  `;
}

function buildPlayersSection(dbPlayers, dbCount) {
  const byTeam = {};
  Object.values(dbPlayers).forEach(p => {
    byTeam[p.team] = (byTeam[p.team] || 0) + 1;
  });
  const teamCount = Object.keys(byTeam).length;

  return `
    <div style="margin-bottom:16px">
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div style="font-size:13px;color:var(--text2)">
          Giocatori nel DB: <strong style="color:${dbCount>0?"var(--green)":"var(--red)"}">${dbCount}</strong>
        </div>
        <div style="font-size:13px;color:var(--text2)">
          Squadre presenti: <strong style="color:var(--text)">${teamCount} / 20</strong>
        </div>
      </div>

      ${dbCount > 0 ? `
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text2)">
        Squadre caricate: ${Object.keys(byTeam).sort().join(", ")}
      </div>` : `
      <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--red)">
        ⚠ Nessun giocatore nel database. Carica il CSV per abilitare il Draft.
      </div>`}
    </div>

    <p style="color:var(--text2);font-size:13px;margin-bottom:12px">
      Formato CSV: <code style="color:var(--accent)">Ruolo;Ruolo Mantra;Nome;Squadra;Quotazione;DataNascita</code><br>
      DataNascita: <code style="color:var(--accent)">gg/mm/aaaa</code> · Separatore: punto e virgola
    </p>

    <div class="upload-zone" id="admin-csv-zone">
      <span style="font-size:36px">📂</span>
      <p>Trascina il CSV qui oppure</p>
      <label class="btn btn-secondary btn-sm" style="cursor:pointer">
        Scegli file CSV
        <input type="file" id="admin-csv-input" accept=".csv" style="display:none">
      </label>
    </div>
    <div id="admin-csv-status" style="margin-top:12px;font-size:13px"></div>

    ${dbCount > 0 ? `
    <div style="margin-top:16px">
      <button class="btn btn-ghost btn-sm" id="admin-clear-db-btn" style="color:var(--red)">
        🗑️ Svuota database giocatori
      </button>
    </div>` : ""}
  `;
}

function buildTeamsSection(teams, settings) {
  return `
    <!-- Lista manager -->
    <div style="margin-bottom:20px">
      <h4 style="font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
        Manager (${teams.length}/${settings.maxManagers||10})
      </h4>
      ${teams.map(t => `
        <div class="team-row" style="margin-bottom:6px">
          <div>
            <div class="team-row-name">${t.name}</div>
            <div class="team-row-owner">${t.ownerName} · ${Object.keys(t.players||{}).length} giocatori · ${t.currentCap||0} FM</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="badge badge-cap" style="font-size:9px">${t.capLevel||"under"}</span>
            <button class="btn btn-ghost btn-sm admin-rename-team-btn" data-tid="${t.id}" data-tname="${t.name}" style="font-size:11px">✏️</button>
          </div>
        </div>`).join("")}
    </div>

    <!-- Codice invito -->
    <div class="league-code-box">
      Codice invito lega: <span class="league-code" id="league-code-display">caricamento...</span>
      <button class="btn btn-ghost btn-sm" id="copy-code-btn" style="margin-left:8px;font-size:11px">📋 Copia</button>
    </div>

    <!-- Rinomina squadra modal inline -->
    <div id="rename-team-wrap" class="hidden" style="margin-top:14px">
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label">Nuovo nome squadra</label>
        <input class="form-input" id="rename-team-input" placeholder="Es. Dynamo FC">
        <input type="hidden" id="rename-team-id">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="rename-team-confirm-btn">Salva</button>
        <button class="btn btn-ghost btn-sm" id="rename-team-cancel-btn">Annulla</button>
      </div>
      <div id="rename-error" class="form-error" style="margin-top:6px"></div>
    </div>
  `;
}

function buildRoseManagementSection(teams, dbPlayers, settings) {
  const dbCount = Object.keys(dbPlayers).length;
  return `
    <div class="form-group" style="margin-bottom:16px;max-width:280px">
      <label class="form-label">Squadra da gestire</label>
      <select class="form-input" id="rm-team-select">
        <option value="">Seleziona manager...</option>
        ${teams.map(t => `<option value="${t.id}">${t.name} (${t.ownerName})</option>`).join("")}
      </select>
    </div>

    <!-- ROSA CORRENTE -->
    <div id="rm-current-roster" style="margin-bottom:20px">
      <div style="color:var(--text2);font-size:13px">Seleziona una squadra per vedere la rosa.</div>
    </div>

    <!-- AGGIUNGI -->
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-bottom:16px">
      <h4 class="admin-section-title">➕ Aggiungi giocatore</h4>
      ${dbCount === 0 ? `<div style="color:var(--red);font-size:13px">⚠ Carica prima il CSV dei giocatori.</div>` : `
      <div class="form-grid" style="margin-bottom:10px">
        <div class="form-group">
          <label class="form-label">Cerca nel DB</label>
          <input class="form-input" id="rm-search-player" placeholder="Nome giocatore...">
        </div>
        <div class="form-group">
          <label class="form-label">Costo acquisto (FM)</label>
          <input class="form-input" id="rm-player-cost" type="number" min="1" placeholder="Es. 15">
        </div>
        <div class="form-group">
          <label class="form-label">Anni contratto</label>
          <select class="form-input" id="rm-player-years">
            <option value="1">1 anno</option><option value="2">2 anni</option><option value="3">3 anni</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Under 21?</label>
          <select class="form-input" id="rm-player-u21">
            <option value="auto">Auto (da data nascita)</option>
            <option value="1">Sì</option><option value="0">No</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Giocatore Bandiera?</label>
          <select class="form-input" id="rm-player-bandiera">
            <option value="0">No</option><option value="1">Sì (solo U21)</option>
          </select>
        </div>
      </div>
      <div id="rm-search-results" style="margin-bottom:10px"></div>
      <div id="rm-add-error" class="form-error" style="margin-bottom:8px"></div>
      <button class="btn btn-primary btn-sm" id="rm-add-btn">➕ Aggiungi alla rosa</button>`}
    </div>

    <!-- MODIFICA CONTRATTO -->
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-bottom:16px">
      <h4 class="admin-section-title">📋 Modifica contratto</h4>
      <div class="form-grid" style="margin-bottom:10px">
        <div class="form-group">
          <label class="form-label">Giocatore</label>
          <select class="form-input" id="rm-contract-player"><option value="">Prima seleziona squadra</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Costo corrente (FM)</label>
          <input class="form-input" id="rm-contract-cost" type="number" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">Anni contratto totali</label>
          <select class="form-input" id="rm-contract-years">
            <option value="1">1 anno</option><option value="2">2 anni</option><option value="3">3 anni</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Anni già scontati</label>
          <select class="form-input" id="rm-contract-done">
            <option value="0">0</option><option value="1">1</option><option value="2">2</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Under 21?</label>
          <select class="form-input" id="rm-contract-u21">
            <option value="0">No</option><option value="1">Sì</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Giocatore Bandiera?</label>
          <select class="form-input" id="rm-contract-bandiera">
            <option value="0">No</option><option value="1">Sì</option>
          </select>
        </div>
      </div>
      <div id="rm-contract-error" class="form-error" style="margin-bottom:8px"></div>
      <button class="btn btn-primary btn-sm" id="rm-contract-save-btn">💾 Salva contratto</button>
    </div>

    <!-- RIMUOVI -->
    <div style="border-top:1px solid var(--border);padding-top:16px">
      <h4 class="admin-section-title">🗑️ Rimuovi giocatore dalla rosa</h4>
      <div class="form-grid" style="margin-bottom:10px">
        <div class="form-group">
          <label class="form-label">Giocatore</label>
          <select class="form-input" id="rm-remove-player"><option value="">Prima seleziona squadra</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Motivo svincolo</label>
          <select class="form-input" id="rm-remove-reason">
            <option value="admin">Correzione admin (nessun rimborso)</option>
            <option value="voluntary">Taglio volontario (50% subito + 50% scadenza)</option>
            <option value="abroad">Venduto estero (100% + scelta extra)</option>
            <option value="injury">Infortunio 3+ mesi (100%)</option>
            <option value="zeroparam">Parametro zero / Serie B</option>
          </select>
        </div>
      </div>
      <div id="rm-remove-info" style="font-size:12px;color:var(--text2);margin-bottom:8px"></div>
      <div id="rm-remove-error" class="form-error" style="margin-bottom:8px"></div>
      <button class="btn btn-danger btn-sm" id="rm-remove-btn">🗑️ Rimuovi</button>
    </div>
  `;
}

function buildCalendarSection(teams, settings, schedule) {
  const gwStart     = settings.gwStart || 1;
  const gwEnd       = settings.gwEnd   || 34;
  const hasSchedule = Object.keys(schedule).length > 0;

  return `
    <div style="color:var(--text2);font-size:13px;margin-bottom:16px;line-height:1.6">
      Genera il calendario con sistema <strong style="color:var(--text)">round-robin bilanciato</strong>.
      Con numero dispari di squadre, una squadra riposa (BYE) per giornata, ruotando.<br>
      ${hasSchedule ? `<span style="color:var(--orange)">⚠ Rigenera sovrascriverà il calendario esistente (${Object.keys(schedule).length} GW).</span>` : ""}
    </div>
    <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
      <div class="form-group">
        <label class="form-label">GW Inizio</label>
        <input class="form-input" id="cal-gwstart" type="number" min="1" max="10" value="${gwStart}" style="width:80px">
      </div>
      <div class="form-group">
        <label class="form-label">GW Fine</label>
        <input class="form-input" value="${gwEnd}" disabled style="width:80px;opacity:.6">
      </div>
      <div class="form-group">
        <label class="form-label">Squadre</label>
        <input class="form-input" value="${teams.length}" disabled style="width:80px;opacity:.6">
      </div>
    </div>
    <div id="cal-error" class="form-error" style="margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="cal-generate-btn">
        🗓 ${hasSchedule ? "Rigenera" : "Genera"} Calendario
      </button>
      ${hasSchedule ? `<button class="btn btn-ghost btn-sm" id="cal-preview-btn">👁 Anteprima GW1-3</button>` : ""}
    </div>
    <div id="cal-preview-result" style="margin-top:14px"></div>
  `;
}

function buildScoresSection(teams, settings) {
  const gwStart = settings.gwStart || 1;
  const gwEnd   = settings.gwEnd   || 34;
  const gwOpts  = Array.from({length: gwEnd - gwStart + 1}, (_,i) => gwStart + i);

  return `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
      Inserisci manualmente i FantaPunti per una giornata (utile se i voti Sofascore non arrivano).
      I FP vengono usati per calcolare classifica, risultati e playoff.
    </p>
    <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
      <div class="form-group">
        <label class="form-label">Giornata</label>
        <select class="form-input" id="scores-gw" style="max-width:120px">
          ${gwOpts.map(g => `<option value="${g}">GW ${g}</option>`).join("")}
        </select>
      </div>
      <button class="btn btn-secondary btn-sm" id="scores-load-btn">📂 Carica valori</button>
    </div>
    <div id="scores-form" style="margin-bottom:14px"></div>
    <div id="scores-error" class="form-error" style="margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm hidden" id="scores-save-btn">💾 Salva punteggi manuali</button>
      <button class="btn btn-secondary btn-sm hidden" id="scores-calc-btn">⚡ Calcola FP automaticamente</button>
    </div>
    <div id="scores-calc-result" style="font-size:13px;margin-top:8px"></div>
  `;
}

function buildContractsSection(settings) {
  return `
    <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px">
      <div class="form-group">
        <label class="form-label">Data scadenza contratti (gg/mm)</label>
        <input class="form-input" id="deadline-input" placeholder="31/10"
          value="${settings.contractDeadline||'31/10'}" style="width:120px">
      </div>
      <button class="btn btn-secondary btn-sm" id="save-deadline-btn">💾 Salva</button>
    </div>
    <div id="deadline-error" class="form-error" style="margin-bottom:12px"></div>

    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px;font-size:13px;color:var(--text2)">
      Dopo la scadenza, i giocatori senza contratto assegnato ricevono automaticamente <strong style="color:var(--text)">1 anno</strong>.
    </div>
    <button class="btn btn-danger btn-sm" id="apply-default-btn">
      ⚡ Applica 1 anno a tutti i giocatori senza contratto
    </button>
    <div id="default-contracts-result" style="font-size:13px;margin-top:8px"></div>
  `;
}

function buildCapSection(teams, settings) {
  return `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
      Applica penalità di fine stagione in base alla classifica Regular Season.
      Le penalità sono valide per la stagione successiva.
    </p>

    <!-- Applica penalità per posizione -->
    <div class="form-grid" style="margin-bottom:14px">
      <div class="form-group">
        <label class="form-label">Squadra</label>
        <select class="form-input" id="penalty-team">
          <option value="">Seleziona...</option>
          ${teams.map(t => `<option value="${t.id}">${t.name} (${t.ownerName})</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Tipo penalità</label>
        <select class="form-input" id="penalty-type">
          <option value="-1">6° classif. (-1 FM)</option>
          <option value="-2">7° classif. (-2 FM)</option>
          <option value="-3">8° classif. (-3 FM)</option>
          <option value="-4">9° classif. (-4 FM)</option>
          <option value="-6">10° classif. (-6 FM)</option>
          <option value="custom">Personalizzata</option>
        </select>
      </div>
      <div class="form-group hidden" id="penalty-custom-wrap">
        <label class="form-label">FM (negativo = riduce cap)</label>
        <input class="form-input" id="penalty-custom-val" type="number" placeholder="-2">
      </div>
    </div>
    <div id="penalty-error" class="form-error" style="margin-bottom:8px"></div>
    <button class="btn btn-primary btn-sm" id="apply-penalty-btn">Applica penalità</button>

    <!-- Stato penalità attuali -->
    <div style="margin-top:20px">
      <h4 style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
        Penalità attive
      </h4>
      ${teams.filter(t => t.capPenalty && t.capPenalty !== 0).length === 0
        ? `<div style="color:var(--text3);font-size:13px">Nessuna penalità attiva</div>`
        : teams.filter(t => t.capPenalty && t.capPenalty !== 0).map(t => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${t.name}</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="badge badge-penalty">${t.capPenalty} FM</span>
              <button class="btn btn-ghost btn-sm admin-clear-penalty-btn" data-tid="${t.id}" style="font-size:11px;color:var(--red)">✕ Rimuovi</button>
            </div>
          </div>`).join("")}
    </div>
  `;
}

function buildDraftSection(draftState, teams) {
  const status = draftState?.status || "idle";
  const picks  = Object.values(draftState?.picks || {}).filter(p => !p.skipped);

  return `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;margin-bottom:8px">
        Stato: <strong style="color:${status==="done"?"var(--green)":status==="active"?"var(--orange)":"var(--text2)"}">${status}</strong>
        ${picks.length > 0 ? `· <span style="color:var(--text2)">${picks.length} pick effettuati</span>` : ""}
      </div>

      ${status === "active" ? `
      <div style="background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2);border-radius:8px;padding:10px;font-size:12px;color:var(--orange);margin-bottom:12px">
        ⚠ Draft in corso. Puoi metterlo in pausa o terminarlo.
      </div>` : ""}
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${status==="active"  ? `<button class="btn btn-secondary btn-sm" id="admin-draft-pause-btn">⏸ Pausa</button>
                               <button class="btn btn-danger btn-sm"   id="admin-draft-end-btn">⏹ Termina</button>` : ""}
      ${status==="paused"  ? `<button class="btn btn-primary btn-sm"   id="admin-draft-resume-btn">▶ Riprendi</button>
                               <button class="btn btn-danger btn-sm"   id="admin-draft-end-btn">⏹ Termina</button>` : ""}
      ${status==="done"||status==="idle" ? `<button class="btn btn-ghost btn-sm" id="admin-draft-reset-btn" style="color:var(--red)">↺ Reset Draft</button>` : ""}
    </div>

    ${picks.length > 0 ? `
    <div style="margin-top:16px">
      <h4 style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
        Ultimi pick
      </h4>
      ${picks.slice(-5).reverse().map(p => {
        const team = teams.find(t => t.id === p.teamId);
        return `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:8px">
          <span style="color:var(--accent)">G${p.round}.${p.posInRound}</span>
          <span style="flex:1">${p.playerName}</span>
          <span style="color:var(--text2)">${team?.ownerName||"—"}</span>
          <span style="color:var(--accent)">${p.cost}FM</span>
        </div>`;
      }).join("")}
    </div>` : ""}
  `;
}

function buildDangerSection() {
  return `
    <div style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:16px;margin-bottom:14px;font-size:13px;color:var(--text2)">
      ⚠ Le azioni seguenti sono <strong style="color:var(--red)">irreversibili</strong>. Procedere con estrema cautela.
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-danger btn-sm" id="danger-clear-scores-btn" style="width:fit-content">
        🗑️ Azzera tutti i punteggi della stagione
      </button>
      <button class="btn btn-danger btn-sm" id="danger-clear-schedule-btn" style="width:fit-content">
        🗑️ Elimina calendario
      </button>
      <button class="btn btn-danger btn-sm" id="danger-clear-roster-btn" style="width:fit-content">
        🗑️ Svuota tutte le rose
      </button>
    </div>
    <div id="danger-error" class="form-error" style="margin-top:8px"></div>
  `;
}

// ── ACCORDION HELPER ──────────────────────────────
function adminSection(id, icon, title, content) {
  return `
    <div class="admin-acc-item" id="${id}">
      <div class="admin-acc-header" data-section="${id}">
        <span>${icon} ${title}</span>
        <span class="admin-acc-chevron">▼</span>
      </div>
      <div class="admin-acc-body hidden">
        ${content}
      </div>
    </div>`;
}

function kpi(icon, label, value, color) {
  const colors = { green:"var(--green)", orange:"var(--orange)", red:"var(--red)", blue:"var(--blue)" };
  return `
    <div class="stat-card">
      <span class="sc-icon">${icon}</span>
      <div>
        <div class="sc-label">${label}</div>
        <div class="sc-value" style="color:${colors[color]||"var(--text)"}">${value}</div>
      </div>
    </div>`;
}

// ── EVENTS ────────────────────────────────────────
function bindAdminEvents(leagueId, league, teams, settings, schedule, draftState) {

  // Accordion
  document.getElementById("tab-admin")?.addEventListener("click", e => {
    const hdr = e.target.closest(".admin-acc-header");
    if (!hdr) return;
    const body = hdr.nextElementSibling;
    if (!body) return;
    body.classList.toggle("hidden");
    hdr.querySelector(".admin-acc-chevron").textContent =
      body.classList.contains("hidden") ? "▼" : "▲";
  });

  // ── GESTIONE ROSE ──
  // Carica la rosa quando si seleziona una squadra
  document.getElementById("rm-team-select")?.addEventListener("change", async e => {
    const teamId = e.target.value;
    if (!teamId) {
      document.getElementById("rm-current-roster").innerHTML =
        `<div style="color:var(--text2);font-size:13px">Seleziona una squadra.</div>`;
      return;
    }
    await refreshRmRoster(leagueId, teamId, teams);
    populateRmPlayerSelects(teamId, teams);
  });

  // Ricerca giocatore nel DB
  const dbSnap = await get(ref(db, `db_giocatori/${leagueId}`));
  const dbPlayers = dbSnap.val() || {};

  document.getElementById("rm-search-player")?.addEventListener("input", e => {
    const q       = e.target.value.toLowerCase().trim();
    const results = document.getElementById("rm-search-results");
    if (!results) return;
    if (q.length < 2) { results.innerHTML = ""; return; }
    const matches = Object.values(dbPlayers)
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { results.innerHTML = `<p style="color:var(--text2);font-size:12px">Nessun risultato</p>`; return; }
    results.innerHTML = `<div class="player-search-results">
      ${matches.map(p => `
        <div class="player-result-item"
          data-id="${p.id||p.name}" data-name="${p.name}"
          data-team="${p.team}" data-roles="${(p.roles||[]).join(";")}"
          data-cost="${p.quotazione||1}" data-dob="${p.dataNascita||""}">
          <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:9px">${(p.roles||[]).join("/")}</span>
          <span style="flex:1;font-size:12px">${p.name}</span>
          <span style="color:var(--text2);font-size:11px">${p.team}</span>
          <span style="color:var(--accent);font-size:11px">${p.quotazione} FM</span>
        </div>`).join("")}
    </div>`;
    results.querySelectorAll(".player-result-item").forEach(item => {
      item.addEventListener("click", () => {
        const inp = document.getElementById("rm-search-player");
        inp.value = item.dataset.name;
        inp.dataset.selectedId    = item.dataset.id;
        inp.dataset.selectedName  = item.dataset.name;
        inp.dataset.selectedTeam  = item.dataset.team;
        inp.dataset.selectedRoles = item.dataset.roles;
        inp.dataset.selectedDob   = item.dataset.dob;
        document.getElementById("rm-player-cost").value = item.dataset.cost;
        results.innerHTML = "";
      });
    });
  });

  // Aggiungi giocatore alla rosa
  document.getElementById("rm-add-btn")?.addEventListener("click", async () => {
    const teamId  = document.getElementById("rm-team-select").value;
    const inp     = document.getElementById("rm-search-player");
    const pName   = inp?.dataset.selectedName;
    const pTeam   = inp?.dataset.selectedTeam;
    const pRoles  = (inp?.dataset.selectedRoles||"").split(";").filter(Boolean);
    const pDob    = inp?.dataset.selectedDob||"";
    const cost    = parseInt(document.getElementById("rm-player-cost").value)||0;
    const years   = parseInt(document.getElementById("rm-player-years").value)||1;
    const u21Sel  = document.getElementById("rm-player-u21").value;
    const bandiera = document.getElementById("rm-player-bandiera").value === "1";
    const errEl   = document.getElementById("rm-add-error");
    errEl.textContent = "";

    if (!teamId) { errEl.textContent = "Seleziona una squadra"; return; }
    if (!pName)  { errEl.textContent = "Seleziona un giocatore dal DB"; return; }
    if (!cost)   { errEl.textContent = "Inserisci un costo valido"; return; }

    const team = teams.find(t => t.id === teamId);
    if (Object.values(team?.players||{}).some(p => p.name === pName)) {
      errEl.textContent = "Giocatore già in rosa"; return;
    }

    const age    = pDob ? calcAge(pDob) : null;
    const under21 = u21Sel === "auto" ? (age !== null && age <= 21) : u21Sel === "1";

    try {
      const pRef = push(ref(db, `leagues/${leagueId}/teams/${teamId}/players`));
      await set(pRef, {
        id: pRef.key, name: pName, team: pTeam,
        roles: pRoles, draftCost: cost, currentCost: cost,
        contractYears: years, contractYearsDone: 0,
        under21, dataNascita: pDob||null, bandiera,
        addedBy: "admin", addedAt: Date.now(),
      });
      // Aggiorna cap
      const newCap = Object.values(team?.players||{}).reduce((s,p)=>s+(p.currentCost||0),0) + cost;
      await update(ref(db, `leagues/${leagueId}/teams/${teamId}`), {
        currentCap: newCap, capLevel: calcCapLevel(newCap, settings),
      });
      showStatus("rm-add-error", `✓ ${pName} aggiunto a ${team.name}`, "green");
      inp.value = ""; inp.dataset.selectedName = "";
      document.getElementById("rm-player-cost").value = "";
      await refreshRmRoster(leagueId, teamId, teams);
      populateRmPlayerSelects(teamId, teams);
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent = e.message; }
  });

  // Popola select contratto quando cambia squadra (ascolta anche il change globale)
  document.getElementById("rm-team-select")?.addEventListener("change", e => {
    populateRmPlayerSelects(e.target.value, teams);
  });

  // Pre-compila campi contratto quando si seleziona giocatore
  document.getElementById("rm-contract-player")?.addEventListener("change", e => {
    const teamId = document.getElementById("rm-team-select").value;
    const team   = teams.find(t => t.id === teamId);
    const player = Object.values(team?.players||{}).find(p => p.id === e.target.value);
    if (!player) return;
    document.getElementById("rm-contract-cost").value    = player.currentCost || player.draftCost || "";
    document.getElementById("rm-contract-years").value   = player.contractYears || 1;
    document.getElementById("rm-contract-done").value    = player.contractYearsDone || 0;
    document.getElementById("rm-contract-u21").value     = player.under21 ? "1" : "0";
    document.getElementById("rm-contract-bandiera").value = player.bandiera ? "1" : "0";
  });

  // Pre-compila info rimozione
  document.getElementById("rm-remove-player")?.addEventListener("change", updateRmRemoveInfo.bind(null, teams, settings));
  document.getElementById("rm-remove-reason")?.addEventListener("change", updateRmRemoveInfo.bind(null, teams, settings));

  // Salva contratto
  document.getElementById("rm-contract-save-btn")?.addEventListener("click", async () => {
    const teamId = document.getElementById("rm-team-select").value;
    const pid    = document.getElementById("rm-contract-player").value;
    const errEl  = document.getElementById("rm-contract-error");
    if (!teamId || !pid) { errEl.textContent = "Seleziona squadra e giocatore"; return; }

    const cost    = parseInt(document.getElementById("rm-contract-cost").value)||0;
    const years   = parseInt(document.getElementById("rm-contract-years").value)||1;
    const done    = parseInt(document.getElementById("rm-contract-done").value)||0;
    const under21 = document.getElementById("rm-contract-u21").value === "1";
    const bandiera = document.getElementById("rm-contract-bandiera").value === "1";
    if (!cost) { errEl.textContent = "Inserisci un costo valido"; return; }

    try {
      await update(ref(db, `leagues/${leagueId}/teams/${teamId}/players/${pid}`), {
        currentCost: cost, contractYears: years,
        contractYearsDone: done, under21, bandiera,
        contractAssignedAt: Date.now(),
      });
      // Ricalcola cap
      const snap   = await get(ref(db, `leagues/${leagueId}/teams/${teamId}/players`));
      const newCap = Object.values(snap.val()||{}).reduce((s,p)=>s+(p.currentCost||0),0);
      await update(ref(db, `leagues/${leagueId}/teams/${teamId}`), {
        currentCap: newCap, capLevel: calcCapLevel(newCap, settings),
      });
      showStatus("rm-contract-error", "✓ Contratto salvato", "green");
      await refreshRmRoster(leagueId, teamId, teams);
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent=e.message; }
  });

  // Rimuovi giocatore
  document.getElementById("rm-remove-btn")?.addEventListener("click", async () => {
    const teamId = document.getElementById("rm-team-select").value;
    const pid    = document.getElementById("rm-remove-player").value;
    const reason = document.getElementById("rm-remove-reason").value;
    const errEl  = document.getElementById("rm-remove-error");
    if (!teamId || !pid) { errEl.textContent = "Seleziona squadra e giocatore"; return; }

    const team   = teams.find(t => t.id === teamId);
    const player = Object.values(team?.players||{}).find(p => p.id === pid);
    if (!confirm(`Rimuovere ${player?.name} da ${team?.name}?`)) return;

    try {
      const cost = player.draftCost || player.currentCost || 0;
      // Log svincolo (se non è correzione admin)
      if (reason !== "admin") {
        const capRefund = reason === "voluntary" ? Math.ceil(cost/2) : cost;
        await push(ref(db, `leagues/${leagueId}/releases`), {
          teamId, playerName: player.name, reason, cost,
          capRefund, releasedAt: Date.now(), releasedBy: "admin",
        });
      }
      await set(ref(db, `leagues/${leagueId}/teams/${teamId}/players/${pid}`), null);
      // Ricalcola cap
      const snap   = await get(ref(db, `leagues/${leagueId}/teams/${teamId}/players`));
      const newCap = Object.values(snap.val()||{}).reduce((s,p)=>s+(p.currentCost||0),0);
      await update(ref(db, `leagues/${leagueId}/teams/${teamId}`), {
        currentCap: newCap, capLevel: calcCapLevel(newCap, settings),
      });
      showStatus("rm-remove-error", `✓ ${player?.name} rimosso`, "green");
      await refreshRmRoster(leagueId, teamId, teams);
      populateRmPlayerSelects(teamId, teams);
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent=e.message; }
  });

  // ── IMPOSTAZIONI ──
  document.getElementById("save-settings-btn")?.addEventListener("click", async () => {
    const btn   = document.getElementById("save-settings-btn");
    const errEl = document.getElementById("settings-error");
    btn.disabled = true; btn.textContent = "⏳"; errEl.textContent = "";
    try {
      await update(ref(db, `leagues/${leagueId}/settings`), {
        gwStart:          parseInt(document.getElementById("s-gwstart").value)||1,
        salaryCap:        parseInt(document.getElementById("s-cap").value)||320,
        softCapMax:       parseInt(document.getElementById("s-soft").value)||340,
        hardCapMax:       parseInt(document.getElementById("s-hard").value)||360,
        luxuryTaxThreshold: parseInt(document.getElementById("s-hard").value)||360,
        maxManagers:      parseInt(document.getElementById("s-maxm").value)||10,
        homefieldBonus:   parseInt(document.getElementById("s-hf").value)||2,
        minRosterSize:    parseInt(document.getElementById("s-minr").value)||23,
        maxRosterSize:    parseInt(document.getElementById("s-maxr").value)||30,
      });
      errEl.style.color = "var(--green)";
      errEl.textContent = "✓ Impostazioni salvate";
      setTimeout(() => errEl.textContent = "", 3000);
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent = e.message; }
    finally { btn.disabled=false; btn.textContent="💾 Salva impostazioni"; }
  });

  // ── DB GIOCATORI ──
  const csvInput = document.getElementById("admin-csv-input");
  csvInput?.addEventListener("change", () => handleCSVUpload(leagueId));

  const zone = document.getElementById("admin-csv-zone");
  zone?.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone?.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone?.addEventListener("drop", e => {
    e.preventDefault(); zone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) {
      csvInput.files = e.dataTransfer.files;
      handleCSVUpload(leagueId);
    }
  });

  document.getElementById("admin-clear-db-btn")?.addEventListener("click", async () => {
    if (!confirm("Svuotare il database giocatori? Questa azione è irreversibile.")) return;
    await set(ref(db, `db_giocatori/${leagueId}`), null);
    showStatus("admin-csv-status", "✓ Database svuotato", "green");
    setTimeout(() => location.reload(), 1000);
  });

  // ── MANAGER ──
  document.getElementById("copy-code-btn")?.addEventListener("click", () => {
    navigator.clipboard.writeText(leagueId).then(() => {
      const btn = document.getElementById("copy-code-btn");
      btn.textContent = "✓ Copiato!";
      setTimeout(() => btn.textContent = "📋 Copia", 2000);
    });
  });
  // Mostra codice
  const codeEl = document.getElementById("league-code-display");
  if (codeEl) codeEl.textContent = leagueId;

  document.querySelectorAll(".admin-rename-team-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const wrap = document.getElementById("rename-team-wrap");
      document.getElementById("rename-team-id").value    = btn.dataset.tid;
      document.getElementById("rename-team-input").value = btn.dataset.tname;
      wrap?.classList.remove("hidden");
    });
  });
  document.getElementById("rename-team-cancel-btn")?.addEventListener("click", () =>
    document.getElementById("rename-team-wrap")?.classList.add("hidden")
  );
  document.getElementById("rename-team-confirm-btn")?.addEventListener("click", async () => {
    const tid  = document.getElementById("rename-team-id").value;
    const name = document.getElementById("rename-team-input").value.trim();
    const errEl = document.getElementById("rename-error");
    if (!name) { errEl.textContent = "Inserisci un nome"; return; }
    try {
      await update(ref(db, `leagues/${leagueId}/teams/${tid}`), { name });
      showStatus("rename-error", "✓ Nome aggiornato", "green");
      setTimeout(() => location.reload(), 800);
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent = e.message; }
  });

  // ── CALENDARIO ──
  document.getElementById("cal-generate-btn")?.addEventListener("click", async () => {
    const btn     = document.getElementById("cal-generate-btn");
    const errEl   = document.getElementById("cal-error");
    const gwStart = parseInt(document.getElementById("cal-gwstart").value) || settings.gwStart || 1;
    const gwEnd   = settings.gwEnd || 34;
    if (teams.length < 2) { errEl.textContent = "Servono almeno 2 squadre"; return; }
    if (!confirm(`Generare calendario GW${gwStart}–GW${gwEnd} con ${teams.length} squadre?`)) return;
    btn.disabled = true; btn.textContent = "⏳ Generando..."; errEl.textContent = "";
    try {
      const newSched = generateRoundRobin(teams.map(t=>t.id), gwStart, gwEnd);
      await set(ref(db, `leagues/${leagueId}/schedule`), newSched);
      await update(ref(db, `leagues/${leagueId}/settings`), { gwStart });
      errEl.style.color = "var(--green)";
      errEl.textContent = `✓ Calendario generato: ${Object.keys(newSched).length} giornate`;
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent = e.message; }
    finally { btn.disabled=false; btn.textContent="🗓 Rigenera Calendario"; }
  });

  document.getElementById("cal-preview-btn")?.addEventListener("click", () => {
    const el = document.getElementById("cal-preview-result");
    if (!el) return;
    if (!el.classList.contains("hidden") && el.innerHTML) { el.innerHTML=""; return; }
    let html = "";
    for (let gw = (settings.gwStart||1); gw <= Math.min((settings.gwStart||1)+2, settings.gwEnd||34); gw++) {
      const matches = schedule[String(gw)]||[];
      html += `<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:4px">GW${gw}</div>
        ${matches.map(m => {
          const h = teams.find(t=>t.id===m.homeId); const a = teams.find(t=>t.id===m.awayId);
          return `<div style="font-size:12px;color:var(--text2);padding:2px 0">${h?.name||"?"} vs ${a?.name||"?"}</div>`;
        }).join("")}</div>`;
    }
    el.innerHTML = html;
  });

  // ── PUNTEGGI ──
  document.getElementById("scores-load-btn")?.addEventListener("click", async () => {
    const gw   = document.getElementById("scores-gw").value;
    const form = document.getElementById("scores-form");
    const snap = await get(ref(db, `leagues/${leagueId}/scores`));
    const scores = snap.val() || {};
    form.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${teams.map(t => `
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px">${t.name}</div>
            <div class="form-group">
              <label class="form-label">FantaPunti GW${gw}</label>
              <input class="form-input" data-tid="${t.id}" type="number" step="0.5"
                value="${scores[t.id]?.[gw]?.fp ?? ""}" placeholder="Es. 87.5">
            </div>
          </div>`).join("")}
      </div>`;
    document.getElementById("scores-save-btn")?.classList.remove("hidden");
    document.getElementById("scores-calc-btn")?.classList.remove("hidden");
  });

  document.getElementById("scores-calc-btn")?.addEventListener("click", async () => {
    const gw    = document.getElementById("scores-gw").value;
    const btn   = document.getElementById("scores-calc-btn");
    const resEl = document.getElementById("scores-calc-result");
    btn.disabled = true; btn.textContent = "⏳ Calcolo...";
    resEl.textContent = "";
    try {
      const { calcAndSaveGwScores } = await import("./calendario.js");
      const snap = await get(ref(db, `leagues/${leagueId}`));
      const results = await calcAndSaveGwScores(leagueId, snap.val(), parseInt(gw));
      const lines = Object.entries(results)
        .map(([tid, fp]) => {
          const team = teams.find(t => t.id === tid);
          return fp !== null ? `${team?.name||tid}: ${fp} FP` : `${team?.name||tid}: nessun dato`;
        }).join(" · ");
      resEl.style.color = "var(--green)";
      resEl.textContent = `✓ GW${gw} calcolata — ${lines}`;
      // Aggiorna i campi manuali con i valori calcolati
      const scoresSnap = await get(ref(db, `leagues/${leagueId}/scores`));
      const scores = scoresSnap.val() || {};
      document.querySelectorAll("#scores-form [data-tid]").forEach(inp => {
        const fp = scores[inp.dataset.tid]?.[gw]?.fp;
        if (fp != null) inp.value = fp;
      });
    } catch(e) {
      resEl.style.color = "var(--red)";
      resEl.textContent = "✗ " + e.message;
    } finally {
      btn.disabled = false; btn.textContent = "⚡ Calcola FP automaticamente";
    }
  });

  document.getElementById("scores-save-btn")?.addEventListener("click", async () => {
    const gw    = document.getElementById("scores-gw").value;
    const btn   = document.getElementById("scores-save-btn");
    const errEl = document.getElementById("scores-error");
    btn.disabled = true; btn.textContent = "⏳"; errEl.textContent = "";
    try {
      const updates = {};
      document.querySelectorAll("#scores-form [data-tid]").forEach(inp => {
        const fp = parseFloat(inp.value);
        if (!isNaN(fp)) updates[`leagues/${leagueId}/scores/${inp.dataset.tid}/${gw}`] = { fp, savedAt: Date.now() };
      });
      await update(ref(db), updates);
      errEl.style.color = "var(--green)";
      errEl.textContent = `✓ Punteggi GW${gw} salvati`;
      setTimeout(() => errEl.textContent="", 3000);
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent = e.message; }
    finally { btn.disabled=false; btn.textContent="💾 Salva punteggi"; }
  });

  // ── CONTRATTI ──
  document.getElementById("save-deadline-btn")?.addEventListener("click", async () => {
    const val   = document.getElementById("deadline-input")?.value.trim();
    const errEl = document.getElementById("deadline-error");
    if (!/^\d{1,2}\/\d{1,2}$/.test(val)) { errEl.textContent="Formato: gg/mm"; return; }
    try {
      await update(ref(db, `leagues/${leagueId}/settings`), { contractDeadline: val });
      showStatus("deadline-error","✓ Data salvata","green");
    } catch(e) { errEl.textContent=e.message; }
  });

  document.getElementById("apply-default-btn")?.addEventListener("click", async () => {
    if (!confirm("Assegnare 1 anno a tutti i giocatori senza contratto?")) return;
    const snap  = await get(ref(db, `leagues/${leagueId}`));
    const count = await applyDefaultContracts(leagueId, snap.val());
    const el    = document.getElementById("default-contracts-result");
    if (el) { el.style.color="var(--green)"; el.textContent = count>0 ? `✓ ${count} giocatori aggiornati` : "✓ Nessun giocatore senza contratto"; }
  });

  // ── CAP / PENALITÀ ──
  document.getElementById("penalty-type")?.addEventListener("change", e => {
    const wrap = document.getElementById("penalty-custom-wrap");
    wrap?.classList.toggle("hidden", e.target.value !== "custom");
  });

  document.getElementById("apply-penalty-btn")?.addEventListener("click", async () => {
    const teamId = document.getElementById("penalty-team").value;
    const type   = document.getElementById("penalty-type").value;
    const errEl  = document.getElementById("penalty-error");
    if (!teamId) { errEl.textContent="Seleziona una squadra"; return; }
    const val = type === "custom"
      ? parseInt(document.getElementById("penalty-custom-val").value)||0
      : parseInt(type);
    try {
      await update(ref(db, `leagues/${leagueId}/teams/${teamId}`), { capPenalty: val });
      showStatus("penalty-error", `✓ Penalità ${val} FM applicata`, "green");
      setTimeout(() => location.reload(), 800);
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent=e.message; }
  });

  document.querySelectorAll(".admin-clear-penalty-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await update(ref(db, `leagues/${leagueId}/teams/${btn.dataset.tid}`), { capPenalty: 0 });
      showStatus("penalty-error","✓ Penalità rimossa","green");
      setTimeout(() => location.reload(), 600);
    });
  });

  // ── DRAFT STATE ──
  document.getElementById("admin-draft-pause-btn")?.addEventListener("click",  async ()=>{ await update(ref(db,`leagues/${leagueId}/draftState`),{status:"paused"}); location.reload(); });
  document.getElementById("admin-draft-resume-btn")?.addEventListener("click", async ()=>{ await update(ref(db,`leagues/${leagueId}/draftState`),{status:"active",turnStartedAt:Date.now()}); location.reload(); });
  document.getElementById("admin-draft-end-btn")?.addEventListener("click",    async ()=>{ if(confirm("Terminare il draft?")) { await update(ref(db,`leagues/${leagueId}/draftState`),{status:"done"}); location.reload(); } });
  document.getElementById("admin-draft-reset-btn")?.addEventListener("click",  async ()=>{ if(confirm("Reset draft? I giocatori nelle rose NON vengono rimossi.")) { await set(ref(db,`leagues/${leagueId}/draftState`),{status:"idle"}); location.reload(); } });

  // ── ZONA PERICOLOSA ──
  document.getElementById("danger-clear-scores-btn")?.addEventListener("click", async () => {
    if (!confirm("Azzerare TUTTI i punteggi della stagione? Irreversibile.")) return;
    await set(ref(db, `leagues/${leagueId}/scores`), null);
    showStatus("danger-error","✓ Punteggi azzerati","green");
  });
  document.getElementById("danger-clear-schedule-btn")?.addEventListener("click", async () => {
    if (!confirm("Eliminare il calendario? Irreversibile.")) return;
    await set(ref(db, `leagues/${leagueId}/schedule`), null);
    showStatus("danger-error","✓ Calendario eliminato","green");
    setTimeout(() => location.reload(), 800);
  });
  document.getElementById("danger-clear-roster-btn")?.addEventListener("click", async () => {
    if (!confirm("Svuotare TUTTE le rose di tutti i manager? Irreversibile.")) return;
    if (!confirm("Sei SICURO? Questa azione non può essere annullata.")) return;
    const updates = {};
    teams.forEach(t => { updates[`leagues/${leagueId}/teams/${t.id}/players`] = null; });
    await update(ref(db), updates);
    showStatus("danger-error","✓ Rose svuotate","green");
    setTimeout(() => location.reload(), 800);
  });
}

// ── CSV UPLOAD ────────────────────────────────────
async function handleCSVUpload(leagueId) {
  const input  = document.getElementById("admin-csv-input");
  const status = document.getElementById("admin-csv-status");
  const file   = input?.files?.[0];
  if (!file) return;

  status.style.color = "var(--text2)";
  status.textContent = "⏳ Caricamento in corso...";

  try {
    const text    = await file.text();
    const players = parseCSVRose(text);
    if (!players.length) throw new Error("Nessun giocatore trovato nel CSV");

    // Carica in chunks da 200
    const chunks = [];
    for (let i = 0; i < players.length; i += 200) chunks.push(players.slice(i, i+200));

    let count = 0;
    for (const chunk of chunks) {
      const updates = {};
      for (const p of chunk) {
        const key = p.name.replace(/[.#$[\]]/g, "_");
        updates[key] = p;
        count++;
      }
      await update(ref(db, `db_giocatori/${leagueId}`), updates);
    }

    status.style.color = "var(--green)";
    status.textContent = `✓ ${count} giocatori caricati da ${file.name}`;
    setTimeout(() => location.reload(), 1500);
  } catch(e) {
    status.style.color = "var(--red)";
    status.textContent = `✗ Errore: ${e.message}`;
  }
}

// ── UTILS ─────────────────────────────────────────
function showStatus(elId, msg, color) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.style.color = color === "green" ? "var(--green)" : "var(--red)";
  el.textContent = msg;
  setTimeout(() => el.textContent = "", 3000);
}

// ── ROSE MANAGEMENT HELPERS ───────────────────────

async function refreshRmRoster(leagueId, teamId, teams) {
  // Rilegge il team aggiornato da Firebase
  const snap   = await get(ref(db, `leagues/${leagueId}/teams/${teamId}`));
  const team   = snap.val();
  if (!team) return;

  // Aggiorna anche l'array teams in memoria
  const idx = teams.findIndex(t => t.id === teamId);
  if (idx >= 0) teams[idx] = team;

  const players = Object.values(team.players || {})
    .sort((a,b) => {
      const order = { Por:0, P:0, Dc:1, Dd:1, Ds:1, D:1, B:2, E:2, M:3, Mf:3, C:3, W:4, T:4, A:5, Att:5, Pc:5, Tr:5 };
      return (order[a.roles?.[0]] ?? 9) - (order[b.roles?.[0]] ?? 9) || a.name.localeCompare(b.name);
    });

  const el = document.getElementById("rm-current-roster");
  if (!el) return;

  if (!players.length) {
    el.innerHTML = `<div style="color:var(--text2);font-size:13px">Nessun giocatore in rosa.</div>`;
    return;
  }

  el.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
      Rosa ${team.name} — ${players.length} giocatori · ${team.currentCap||0} FM
    </div>
    <div class="table-wrap">
      <table class="table" style="font-size:12px">
        <thead>
          <tr>
            <th>Ruolo</th><th>Giocatore</th><th>Squadra</th>
            <th class="tc">Costo FM</th><th class="tc">Contratto</th><th class="tc">Età</th>
          </tr>
        </thead>
        <tbody>
          ${players.map(p => {
            const age = p.dataNascita ? calcAge(p.dataNascita) : null;
            const rem = (p.contractYears||1) - (p.contractYearsDone||0);
            const contractColor = rem <= 0 ? "var(--red)" : rem === 1 ? "var(--orange)" : "var(--green)";
            return `<tr>
              <td><span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:9px">${(p.roles||[]).join("/")}</span></td>
              <td style="font-weight:600">${p.name}${p.bandiera?"⭐":""}${p.under21?" 🔵":""}</td>
              <td style="color:var(--text2)">${p.team}</td>
              <td class="tc" style="color:var(--accent);font-weight:700">${p.currentCost} FM</td>
              <td class="tc" style="color:${contractColor}">${p.bandiera?"∞":p.contractYears?`${rem}a rimasti`:"—"}</td>
              <td class="tc" style="color:var(--text2)">${age!==null?age:"—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function populateRmPlayerSelects(teamId, teams) {
  const team    = teams.find(t => t.id === teamId);
  const players = Object.values(team?.players||{}).sort((a,b) => a.name.localeCompare(b.name));
  const opts    = `<option value="">Seleziona...</option>` +
    players.map(p => `<option value="${p.id}">${p.name} (${(p.roles||[]).join("/")} · ${p.currentCost}FM)</option>`).join("");

  const contractSel = document.getElementById("rm-contract-player");
  const removeSel   = document.getElementById("rm-remove-player");
  if (contractSel) contractSel.innerHTML = opts;
  if (removeSel)   removeSel.innerHTML   = opts;

  // Abilita bottoni aggiunta
  const addBtn = document.getElementById("rm-add-btn");
  if (addBtn) addBtn.disabled = !teamId;
}

function updateRmRemoveInfo(teams, settings) {
  const teamId = document.getElementById("rm-team-select")?.value;
  const pid    = document.getElementById("rm-remove-player")?.value;
  const reason = document.getElementById("rm-remove-reason")?.value;
  const infoEl = document.getElementById("rm-remove-info");
  if (!infoEl) return;
  if (!teamId || !pid) { infoEl.textContent = ""; return; }
  const team   = teams.find(t => t.id === teamId);
  const player = Object.values(team?.players||{}).find(p => p.id === pid);
  if (!player) { infoEl.textContent = ""; return; }
  const cost = player.draftCost || player.currentCost || 0;
  const msgs = {
    admin:     "Nessun rimborso — solo correzione",
    voluntary: `Rimborso: ${Math.ceil(cost/2)} FM subito + ${Math.floor(cost/2)} FM alla scadenza`,
    abroad:    `Rimborso: ${cost} FM + scelta extra Draft`,
    injury:    `Rimborso: ${cost} FM`,
    zeroparam: `Rimborso: ${player.currentCost||cost} FM`,
  };
  infoEl.textContent = msgs[reason] || "";
}

function calcCapLevel(cap, settings) {
  if (!settings) return "under";
  const { salaryCap, softCapMax, luxuryTaxThreshold } = settings;
  if (cap <= salaryCap)           return "under";
  if (cap <= softCapMax)          return "soft";
  if (cap <= luxuryTaxThreshold)  return "hard";
  return "luxury";
}
