// ============================================================
// FANTADRAFT — rose.js
// Tab Rose: visualizza rose di tutti i manager + admin panel
// ============================================================

import { db, ref, get, set, push, update } from "./firebase.js";
import { parseCSVRose, roleBadge, roleColor, capLevelBadge, contractYearCost, calcAge } from "./utils.js";

// ── STATE ────────────────────────────────────────
let _leagueId   = null;
let _league     = null;
let _user       = null;
let _isAdmin    = false;
let _players    = {};   // db_giocatori/{leagueId}
let _filterTeam = "all";
let _filterRole = "all";
let _search     = "";

// ── INIT ─────────────────────────────────────────
export async function renderRose(leagueId, league, user) {
  _leagueId = leagueId;
  _league   = league;
  _user     = user;
  _isAdmin  = league.commissionerUid === user.uid;

  const el = document.getElementById("tab-rose");

  // Carica giocatori del db della lega
  const snap = await get(ref(db, `db_giocatori/${leagueId}`));
  _players = snap.val() || {};

  el.innerHTML = buildRoseHTML();
  bindRoseEvents();
}

// ── HTML ─────────────────────────────────────────
function buildRoseHTML() {
  const teams    = Object.values(_league.teams || {});
  const settings = _league.settings || {};
  const myTeam   = teams.find(t => t.ownerUid === _user.uid);

  // Scadenza contratti (default 31 ottobre)
  const deadline     = settings.contractDeadline || "31/10";
  const deadlineDate = parseDeadline(deadline);
  const now          = new Date();
  const contractOpen = now <= deadlineDate;
  const daysLeft     = contractOpen
    ? Math.ceil((deadlineDate - now) / (1000*60*60*24))
    : 0;

  return `
    <div class="page-header">
      <span class="ph-icon">🌹</span>
      <h1>Rose</h1>
    </div>

    <!-- BANNER CONTRATTI (se finestra aperta) -->
    ${contractOpen ? `
    <div class="contract-banner">
      📋 <strong>Finestra contratti aperta</strong> — Assegna i contratti ai tuoi giocatori entro il
      <strong>${deadline}</strong> (${daysLeft} giorni rimasti).
      I giocatori senza contratto riceveranno automaticamente <strong>1 anno</strong>.
      ${myTeam ? `<button class="btn btn-primary btn-sm" id="assign-contracts-btn" style="margin-left:12px">✏️ Assegna contratti</button>` : ""}
    </div>` : ""}

    <!-- TOOLBAR -->
    <div class="rose-toolbar">
      <div class="rose-filters">
        <select class="form-input" id="rose-filter-team" style="max-width:200px">
          <option value="all">Tutte le squadre</option>
          ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}
        </select>
        <div class="role-filter-btns">
          ${["all","P","D","C","A"].map(r => `
            <button class="role-btn ${r === _filterRole ? "active" : ""}" data-role="${r}">
              ${r === "all" ? "Tutti" : r}
            </button>`).join("")}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-input" id="rose-search" placeholder="🔍 Cerca giocatore..." style="max-width:200px" value="${_search}">
        ${_isAdmin ? `<button class="btn btn-primary btn-sm" id="rose-admin-btn">⚙️ Admin</button>` : ""}
      </div>
    </div>

    <!-- ROSE GRID -->
    <div id="rose-grid">
      ${buildRoseGrid()}
    </div>

    <!-- MODAL CONTRATTI (manager) -->
    <div id="contracts-modal" class="modal-overlay hidden">
      <div class="modal" style="max-width:680px">
        <div class="modal-header">
          <div class="modal-title">📋 Assegna Contratti — ${myTeam?.name || ""}</div>
          <button class="modal-close" id="contracts-modal-close">✕</button>
        </div>
        <div id="contracts-modal-body"></div>
      </div>
    </div>

    <!-- ADMIN PANEL -->
    ${_isAdmin ? buildAdminPanel() : ""}
  `;
}

function buildRoseGrid() {
  const teams = Object.values(_league.teams || {})
    .filter(t => _filterTeam === "all" || t.id === _filterTeam);

  if (teams.length === 0) return `
    <div class="empty-state">
      <div class="es-icon">🌹</div>
      <h3>Nessuna squadra trovata</h3>
    </div>`;

  return teams.map(team => {
    const players = Object.values(team.players || {})
      .filter(p => {
        const roleOk = _filterRole === "all" || p.roles?.includes(_filterRole);
        const searchOk = !_search || p.name.toLowerCase().includes(_search.toLowerCase());
        return roleOk && searchOk;
      })
      .sort((a, b) => {
        const roleOrder = { P:0, D:1, Dd:1, Ds:1, Dc:1, E:2, M:2, C:2, W:2, T:2, A:3, Pc:3, Att:3 };
        const ra = Math.min(...(a.roles || ["C"]).map(r => roleOrder[r] ?? 2));
        const rb = Math.min(...(b.roles || ["C"]).map(r => roleOrder[r] ?? 2));
        return ra - rb || a.name.localeCompare(b.name);
      });

    const totalCap = players.reduce((s, p) => s + (p.currentCost || 0), 0);
    const capLevel = getCapLevel(totalCap, _league.settings);
    const isMyTeam = team.ownerUid === _user.uid;

    return `
      <div class="rose-team-card ${isMyTeam ? "my-team" : ""}">
        <div class="rose-team-header">
          <div>
            <div class="rose-team-name">${team.name}</div>
            <div class="rose-team-manager">${team.ownerName}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge ${capLevelBadge(capLevel)}">${capLevelLabel(capLevel)}</span>
            <span style="font-family:'Outfit',sans-serif;font-weight:700;font-size:15px;color:var(--accent)">${totalCap} FM</span>
          </div>
        </div>

        ${players.length === 0
          ? `<div style="padding:20px;text-align:center;color:var(--text2);font-size:13px">
               Nessun giocatore${_filterRole !== "all" || _search ? " (filtri attivi)" : " in rosa"}
             </div>`
          : `<div class="rose-players-list">
              <div class="rose-player-header">
                <span>Ruolo</span><span>Giocatore</span><span>Squadra</span>
                <span>Costo</span><span>Contratto</span>
              </div>
              ${players.map(p => buildPlayerRow(p, isMyTeam)).join("")}
             </div>`
        }

        <div class="rose-team-footer">
          <span>${players.length} giocatori</span>
          <span style="color:var(--text2);font-size:12px">
            Min: ${_league.settings?.minRosterSize || 23} · Max: ${_league.settings?.maxRosterSize || 30}
          </span>
        </div>
      </div>`;
  }).join("");
}

function buildPlayerRow(p, isMyTeam) {
  const roles    = (p.roles || ["?"]).join("/");
  const cost     = p.currentCost || p.draftCost || 0;
  const years    = p.contractYears || 1;
  const yearDone = p.contractYearsDone || 0;
  const remaining = years - yearDone;
  const isBandiera = p.bandiera || false;
  const isUnder21  = p.under21 || false;

  // Colore contratto
  const contractColor = remaining <= 0 ? "var(--red)" : remaining === 1 ? "var(--orange)" : "var(--green)";

  return `
    <div class="rose-player-row" data-pid="${p.id || ""}">
      <span class="rose-role-badge" style="background:${roleColor(roles)}">${roles}</span>
      <span class="rose-player-name">
        ${p.name}
        ${isBandiera ? `<span title="Giocatore Bandiera" style="color:var(--accent)">⭐</span>` : ""}
        ${isUnder21  ? `<span title="Under 21" style="color:var(--blue);font-size:10px">U21</span>` : ""}
      </span>
      <span style="color:var(--text2);font-size:12px">${p.team || "—"}</span>
      <span style="font-weight:700;color:var(--accent)">${cost} FM</span>
      <span style="color:${contractColor};font-size:12px;font-weight:600">
        ${isBandiera ? "∞" : remaining > 0 ? `${remaining}a` : "Scad."}
      </span>
    </div>`;
}

function buildAdminPanel() {
  const teams = Object.values(_league.teams || {});
  const season = new Date().getFullYear();

  return `
    <div id="rose-admin-panel" class="hidden">
      <div class="card" style="margin-top:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <h3 style="font-size:17px">⚙️ Admin — Gestione Rose</h3>
          <button class="btn btn-ghost btn-sm" id="rose-admin-close">✕ Chiudi</button>
        </div>

        <!-- SEZIONE: Aggiungi giocatore manualmente -->
        <div class="admin-section">
          <h4 class="admin-section-title">➕ Aggiungi giocatore manualmente</h4>
          <div class="form-grid" style="margin-bottom:12px">
            <div class="form-group">
              <label class="form-label">Squadra</label>
              <select class="form-input" id="admin-add-team">
                <option value="">Seleziona squadra</option>
                ${teams.map(t => `<option value="${t.id}">${t.name} (${t.ownerName})</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Giocatore (dal DB)</label>
              <input class="form-input" id="admin-player-search" placeholder="Cerca nel DB Serie A...">
            </div>
            <div class="form-group">
              <label class="form-label">Costo acquisto (FM)</label>
              <input class="form-input" type="number" id="admin-player-cost" min="1" placeholder="Es. 15">
            </div>
            <div class="form-group">
              <label class="form-label">Anni contratto</label>
              <select class="form-input" id="admin-player-years">
                <option value="1">1 anno</option>
                <option value="2">2 anni</option>
                <option value="3">3 anni</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Under 21?</label>
              <select class="form-input" id="admin-player-u21">
                <option value="0">No</option>
                <option value="1">Sì</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Giocatore Bandiera?</label>
              <select class="form-input" id="admin-player-bandiera">
                <option value="0">No</option>
                <option value="1">Sì (Under 21)</option>
              </select>
            </div>
          </div>
          <div id="admin-player-results" style="margin-bottom:12px"></div>
          <div id="admin-add-error" class="form-error"></div>
          <button class="btn btn-primary btn-sm" id="admin-add-player-btn">➕ Aggiungi</button>
        </div>

        <!-- SEZIONE: Rimuovi giocatore -->
        <div class="admin-section" style="margin-top:24px">
          <h4 class="admin-section-title">🗑️ Rimuovi giocatore da una rosa</h4>
          <div class="form-grid" style="margin-bottom:12px">
            <div class="form-group">
              <label class="form-label">Squadra</label>
              <select class="form-input" id="admin-remove-team">
                <option value="">Seleziona squadra</option>
                ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Giocatore</label>
              <select class="form-input" id="admin-remove-player">
                <option value="">Prima seleziona squadra</option>
              </select>
            </div>
          </div>
          <div id="admin-remove-error" class="form-error"></div>
          <button class="btn btn-danger btn-sm" id="admin-remove-player-btn">🗑️ Rimuovi</button>
        </div>

        <!-- SEZIONE: Carica DB giocatori da CSV -->
        <div class="admin-section" style="margin-top:24px">
          <h4 class="admin-section-title">📤 Carica database giocatori (CSV Fantacalcio.it)</h4>
          <p style="color:var(--text2);font-size:13px;margin-bottom:12px">
            Formato atteso: <code style="color:var(--accent)">Ruolo;Ruolo Mantra;Nome;Squadra;Quotazione;DataNascita</code><br>
            DataNascita: <code style="color:var(--accent)">gg/mm/aaaa</code> · Quotazione = costo FM · Separatore: punto e virgola
          </p>
          <div class="upload-zone" id="csv-upload-zone">
            <span style="font-size:32px">📂</span>
            <p>Trascina il CSV qui oppure</p>
            <label class="btn btn-secondary btn-sm" style="cursor:pointer">
              Scegli file
              <input type="file" id="csv-file-input" accept=".csv" style="display:none">
            </label>
          </div>
          <div id="csv-status" style="margin-top:12px;font-size:13px"></div>
        </div>

        <!-- SEZIONE: Contratti — scadenza e auto-assign -->
        <div class="admin-section" style="margin-top:24px">
          <h4 class="admin-section-title">📋 Contratti — Scadenza e Default</h4>
          <p style="color:var(--text2);font-size:13px;margin-bottom:12px">
            Imposta la data limite entro cui i manager devono assegnare i contratti.
            Dopo la scadenza, usa "Applica default" per assegnare 1 anno a chi non ha ancora scelto.
          </p>
          <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
            <div class="form-group">
              <label class="form-label">Data scadenza contratti (gg/mm)</label>
              <input class="form-input" id="admin-deadline-input" placeholder="31/10"
                value="${_league.settings?.contractDeadline||'31/10'}" style="width:100px">
            </div>
            <button class="btn btn-secondary btn-sm" id="admin-save-deadline-btn">Salva data</button>
          </div>
          <div id="admin-deadline-error" class="form-error" style="margin-bottom:8px"></div>
          <button class="btn btn-danger btn-sm" id="admin-apply-default-contracts-btn">
            ⚡ Applica contratti default (1 anno) a tutti i giocatori senza contratto
          </button>
          <div id="admin-default-contracts-result" style="font-size:13px;margin-top:8px"></div>
        </div>

        <!-- SEZIONE: Svincola giocatore -->
        <div class="admin-section" style="margin-top:24px">
          <h4 class="admin-section-title">✂️ Svincola giocatore</h4>
          <p style="color:var(--text2);font-size:13px;margin-bottom:12px">
            Taglio volontario: il manager recupera il 50% subito, l'altra metà alla scadenza originale del contratto.
          </p>
          <div class="form-grid" style="margin-bottom:12px">
            <div class="form-group">
              <label class="form-label">Squadra</label>
              <select class="form-input" id="admin-release-team">
                <option value="">Seleziona squadra</option>
                ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Giocatore</label>
              <select class="form-input" id="admin-release-player">
                <option value="">Prima seleziona squadra</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Motivo svincolo</label>
              <select class="form-input" id="admin-release-reason">
                <option value="voluntary">Taglio volontario (50% subito)</option>
                <option value="abroad">Venduto all'estero (100% + scelta extra)</option>
                <option value="injury">Infortunio 3+ mesi (100%)</option>
                <option value="zeroparam">A parametro zero / retrocesso (rimborso stagione)</option>
              </select>
            </div>
          </div>
          <div id="admin-release-info" style="font-size:13px;color:var(--text2);margin-bottom:8px"></div>
          <div id="admin-release-error" class="form-error"></div>
          <button class="btn btn-danger btn-sm" id="admin-release-btn">✂️ Svincola</button>
        </div>

      </div>
    </div>`;
}

// ── EVENTS ────────────────────────────────────────
function bindRoseEvents() {
  // Filtro squadra
  document.getElementById("rose-filter-team")?.addEventListener("change", e => {
    _filterTeam = e.target.value;
    document.getElementById("rose-grid").innerHTML = buildRoseGrid();
    bindPlayerRowEvents();
  });

  // Filtro ruolo
  document.querySelectorAll(".role-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _filterRole = btn.dataset.role;
      document.querySelectorAll(".role-btn").forEach(b => b.classList.toggle("active", b.dataset.role === _filterRole));
      document.getElementById("rose-grid").innerHTML = buildRoseGrid();
      bindPlayerRowEvents();
    });
  });

  // Ricerca
  document.getElementById("rose-search")?.addEventListener("input", e => {
    _search = e.target.value;
    document.getElementById("rose-grid").innerHTML = buildRoseGrid();
    bindPlayerRowEvents();
  });

  // Admin panel toggle
  if (_isAdmin) {
    document.getElementById("rose-admin-btn")?.addEventListener("click", () => {
      document.getElementById("rose-admin-panel")?.classList.remove("hidden");
    });
    document.getElementById("rose-admin-close")?.addEventListener("click", () => {
      document.getElementById("rose-admin-panel")?.classList.add("hidden");
    });
    bindAdminEvents();
  }

  // Assegna contratti (manager)
  document.getElementById("assign-contracts-btn")?.addEventListener("click", () => {
    showContractsModal();
  });
  document.getElementById("contracts-modal-close")?.addEventListener("click", () => {
    document.getElementById("contracts-modal")?.classList.add("hidden");
  });
  document.getElementById("contracts-modal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("contracts-modal"))
      document.getElementById("contracts-modal").classList.add("hidden");
  });
}

function bindPlayerRowEvents() {
  // (future: click per dettaglio giocatore)
}

function bindAdminEvents() {
  // ── Deadline contratti ──
  document.getElementById("admin-save-deadline-btn")?.addEventListener("click", async () => {
    const val   = document.getElementById("admin-deadline-input")?.value.trim();
    const errEl = document.getElementById("admin-deadline-error");
    if (!val || !/^\d{1,2}\/\d{1,2}$/.test(val)) {
      errEl.textContent = "Formato non valido (usa gg/mm, es. 31/10)"; return;
    }
    try {
      await update(ref(db, `leagues/${_leagueId}/settings`), { contractDeadline: val });
      errEl.style.color = "var(--green)";
      errEl.textContent = "✓ Data salvata";
      setTimeout(() => errEl.textContent = "", 2000);
    } catch(e) { errEl.textContent = e.message; }
  });

  // ── Applica contratti default ──
  document.getElementById("admin-apply-default-contracts-btn")?.addEventListener("click", async () => {
    if (!confirm("Assegnare 1 anno di contratto a tutti i giocatori senza contratto?")) return;
    const { applyDefaultContracts } = await import("./rose.js");
    const snap = await get(ref(db, `leagues/${_leagueId}`));
    const count = await applyDefaultContracts(_leagueId, snap.val());
    const el = document.getElementById("admin-default-contracts-result");
    if (el) {
      el.style.color = "var(--green)";
      el.textContent = count > 0
        ? `✓ ${count} giocatori aggiornati con contratto di 1 anno`
        : "✓ Nessun giocatore senza contratto trovato";
    }
  });

  // ── Ricerca giocatore nel DB ──
  const playerSearchInput = document.getElementById("admin-player-search");
  playerSearchInput?.addEventListener("input", () => {
    const q = playerSearchInput.value.toLowerCase().trim();
    const results = document.getElementById("admin-player-results");
    if (!q || q.length < 2) { results.innerHTML = ""; return; }
    const matches = Object.values(_players)
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { results.innerHTML = `<p style="color:var(--text2);font-size:13px">Nessun risultato</p>`; return; }
    results.innerHTML = `<div class="player-search-results">
      ${matches.map(p => `
        <div class="player-result-item" data-id="${p.id}" data-name="${p.name}" data-team="${p.team}" data-roles="${p.roles?.join(";") || ""}" data-cost="${p.quotazione || 1}">
          <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0] || "C")};font-size:10px">${(p.roles || []).join("/")}</span>
          <span style="flex:1">${p.name}</span>
          <span style="color:var(--text2);font-size:12px">${p.team}</span>
          <span style="color:var(--accent);font-size:12px">${p.quotazione} FM</span>
        </div>`).join("")}
    </div>`;
    // Click per selezionare
    results.querySelectorAll(".player-result-item").forEach(item => {
      item.addEventListener("click", () => {
        playerSearchInput.value = item.dataset.name;
        playerSearchInput.dataset.selectedId   = item.dataset.id;
        playerSearchInput.dataset.selectedName = item.dataset.name;
        playerSearchInput.dataset.selectedTeam = item.dataset.team;
        playerSearchInput.dataset.selectedRoles = item.dataset.roles;
        document.getElementById("admin-player-cost").value = item.dataset.cost;
        results.innerHTML = "";
      });
    });
  });

  // ── Aggiungi giocatore ──
  document.getElementById("admin-add-player-btn")?.addEventListener("click", async () => {
    const teamId   = document.getElementById("admin-add-team").value;
    const pName    = document.getElementById("admin-player-search").dataset.selectedName;
    const pId      = document.getElementById("admin-player-search").dataset.selectedId;
    const pTeam    = document.getElementById("admin-player-search").dataset.selectedTeam;
    const pRoles   = (document.getElementById("admin-player-search").dataset.selectedRoles || "").split(";").filter(Boolean);
    const cost     = parseInt(document.getElementById("admin-player-cost").value) || 0;
    const years    = parseInt(document.getElementById("admin-player-years").value) || 1;
    const under21  = document.getElementById("admin-player-u21").value === "1";
    const bandiera = document.getElementById("admin-player-bandiera").value === "1";
    const errEl    = document.getElementById("admin-add-error");
    errEl.textContent = "";

    if (!teamId) { errEl.textContent = "Seleziona una squadra"; return; }
    if (!pName)  { errEl.textContent = "Seleziona un giocatore dal DB"; return; }
    if (!cost)   { errEl.textContent = "Inserisci un costo valido"; return; }

    const team = Object.values(_league.teams || {}).find(t => t.id === teamId);
    const existingPlayers = Object.values(team?.players || {});
    if (existingPlayers.some(p => p.name === pName)) {
      errEl.textContent = "Questo giocatore è già in rosa"; return;
    }

    try {
      const playerRef = push(ref(db, `leagues/${_leagueId}/teams/${teamId}/players`));
      const pid = playerRef.key;
      const playerData = {
        id: pid, name: pName, team: pTeam,
        roles: pRoles, draftCost: cost,
        currentCost: cost,
        contractYears: years, contractYearsDone: 0,
        under21, bandiera,
        addedBy: "admin", addedAt: Date.now(),
      };
      await set(playerRef, playerData);
      // Aggiorna cap squadra
      const newCap = existingPlayers.reduce((s, p) => s + (p.currentCost || 0), 0) + cost;
      await update(ref(db, `leagues/${_leagueId}/teams/${teamId}`), {
        currentCap: newCap,
        capLevel: getCapLevel(newCap, _league.settings),
      });
      document.getElementById("admin-player-search").value = "";
      document.getElementById("admin-player-search").dataset.selectedId = "";
      document.getElementById("admin-player-cost").value = "";
      errEl.textContent = "";
      errEl.style.color = "var(--green)";
      errEl.textContent = `✓ ${pName} aggiunto a ${team.name}`;
      setTimeout(() => errEl.textContent = "", 3000);
    } catch(e) {
      errEl.textContent = e.message;
    }
  });

  // ── Popola select giocatori al cambio squadra (rimuovi) ──
  document.getElementById("admin-remove-team")?.addEventListener("change", e => {
    populatePlayerSelect(e.target.value, "admin-remove-player");
  });
  document.getElementById("admin-release-team")?.addEventListener("change", e => {
    populatePlayerSelect(e.target.value, "admin-release-player");
    updateReleaseInfo();
  });
  document.getElementById("admin-release-player")?.addEventListener("change", updateReleaseInfo);
  document.getElementById("admin-release-reason")?.addEventListener("change", updateReleaseInfo);

  // ── Rimuovi giocatore ──
  document.getElementById("admin-remove-player-btn")?.addEventListener("click", async () => {
    const teamId = document.getElementById("admin-remove-team").value;
    const pid    = document.getElementById("admin-remove-player").value;
    const errEl  = document.getElementById("admin-remove-error");
    if (!teamId || !pid) { errEl.textContent = "Seleziona squadra e giocatore"; return; }
    const team = Object.values(_league.teams || {}).find(t => t.id === teamId);
    const player = Object.values(team?.players || {}).find(p => p.id === pid);
    if (!confirm(`Rimuovere ${player?.name} da ${team?.name}?`)) return;
    try {
      await set(ref(db, `leagues/${_leagueId}/teams/${teamId}/players/${pid}`), null);
      const remaining = Object.values(team.players || {}).filter(p => p.id !== pid);
      const newCap = remaining.reduce((s, p) => s + (p.currentCost || 0), 0);
      await update(ref(db, `leagues/${_leagueId}/teams/${teamId}`), {
        currentCap: newCap, capLevel: getCapLevel(newCap, _league.settings),
      });
      errEl.style.color = "var(--green)";
      errEl.textContent = `✓ ${player?.name} rimosso`;
      setTimeout(() => errEl.textContent = "", 3000);
      populatePlayerSelect(teamId, "admin-remove-player");
    } catch(e) { errEl.textContent = e.message; }
  });

  // ── Svincola ──
  document.getElementById("admin-release-btn")?.addEventListener("click", async () => {
    const teamId  = document.getElementById("admin-release-team").value;
    const pid     = document.getElementById("admin-release-player").value;
    const reason  = document.getElementById("admin-release-reason").value;
    const errEl   = document.getElementById("admin-release-error");
    if (!teamId || !pid) { errEl.textContent = "Seleziona squadra e giocatore"; return; }
    const team   = Object.values(_league.teams || {}).find(t => t.id === teamId);
    const player = Object.values(team?.players || {}).find(p => p.id === pid);
    if (!confirm(`Svincolare ${player?.name}?`)) return;

    const cost    = player.draftCost || player.currentCost || 0;
    let capRefund = 0;
    let deferredRefund = 0;
    let extraPick = false;

    switch(reason) {
      case "voluntary":
        capRefund = Math.ceil(cost / 2);
        deferredRefund = Math.floor(cost / 2);
        break;
      case "abroad":
        capRefund = cost; extraPick = true; break;
      case "injury":
        capRefund = cost; break;
      case "zeroparam":
        capRefund = player.currentCost || cost; break;
    }

    try {
      // Rimuovi dalla rosa
      await set(ref(db, `leagues/${_leagueId}/teams/${teamId}/players/${pid}`), null);
      // Log svincolo
      const releaseRef = push(ref(db, `leagues/${_leagueId}/releases`));
      await set(releaseRef, {
        teamId, playerName: player.name, playerTeam: player.team,
        reason, cost, capRefund, deferredRefund, extraPick,
        releasedAt: Date.now(),
        releasedBy: _user.uid,
        originalContractYears: player.contractYears,
        contractYearsDone: player.contractYearsDone,
      });
      // Aggiorna cap (il refund aumenta lo spazio)
      const remaining = Object.values(team.players || {}).filter(p => p.id !== pid);
      const baseCap = remaining.reduce((s, p) => s + (p.currentCost || 0), 0);
      // Il cap si riduce del currentCost del giocatore (già tolto dalla rosa)
      await update(ref(db, `leagues/${_leagueId}/teams/${teamId}`), {
        currentCap: baseCap,
        capLevel: getCapLevel(baseCap, _league.settings),
      });
      errEl.style.color = "var(--green)";
      errEl.textContent = `✓ ${player.name} svincolato. Rimborso: ${capRefund} FM${extraPick ? " + scelta extra Draft" : ""}`;
      setTimeout(() => errEl.textContent = "", 4000);
      populatePlayerSelect(teamId, "admin-release-player");
    } catch(e) { errEl.textContent = e.message; }
  });

  // ── CSV Upload ──
  const csvInput = document.getElementById("csv-file-input");
  csvInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById("csv-status");
    status.style.color = "var(--text2)";
    status.textContent = "⏳ Caricamento in corso...";
    try {
      const text = await file.text();
      const players = parseCSVRose(text);
      if (!players.length) throw new Error("Nessun giocatore trovato nel CSV");
      // Carica in chunks
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
        await update(ref(db, `db_giocatori/${_leagueId}`), updates);
      }
      // Ricarica
      const snap = await get(ref(db, `db_giocatori/${_leagueId}`));
      _players = snap.val() || {};
      status.style.color = "var(--green)";
      status.textContent = `✓ ${count} giocatori caricati nel database della lega.`;
    } catch(err) {
      status.style.color = "var(--red)";
      status.textContent = `✗ Errore: ${err.message}`;
    }
  });

  // Drag & drop CSV
  const zone = document.getElementById("csv-upload-zone");
  zone?.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone?.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone?.addEventListener("drop", e => {
    e.preventDefault(); zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) { csvInput.files = e.dataTransfer.files; csvInput.dispatchEvent(new Event("change")); }
  });
}

// ── HELPERS ──────────────────────────────────────
function populatePlayerSelect(teamId, selectId) {
  const sel  = document.getElementById(selectId);
  if (!sel) return;
  const team = Object.values(_league.teams || {}).find(t => t.id === teamId);
  const players = Object.values(team?.players || {}).sort((a,b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Seleziona giocatore</option>` +
    players.map(p => `<option value="${p.id}">${p.name} (${(p.roles||[]).join("/")} · ${p.currentCost}FM)</option>`).join("");
}

function updateReleaseInfo() {
  const teamId  = document.getElementById("admin-release-team")?.value;
  const pid     = document.getElementById("admin-release-player")?.value;
  const reason  = document.getElementById("admin-release-reason")?.value;
  const infoEl  = document.getElementById("admin-release-info");
  if (!infoEl) return;
  if (!teamId || !pid) { infoEl.textContent = ""; return; }
  const team   = Object.values(_league.teams || {}).find(t => t.id === teamId);
  const player = Object.values(team?.players || {}).find(p => p.id === pid);
  if (!player) { infoEl.textContent = ""; return; }
  const cost = player.draftCost || player.currentCost || 0;
  const msgs = {
    voluntary: `Rimborso immediato: ${Math.ceil(cost/2)} FM · Rimborso differito: ${Math.floor(cost/2)} FM alla scadenza contratto`,
    abroad:    `Rimborso: ${cost} FM + scelta extra al Draft (stesso giro di acquisizione)`,
    injury:    `Rimborso: ${cost} FM (infortunio ≥3 mesi)`,
    zeroparam: `Rimborso: ${player.currentCost || cost} FM (parametro zero / retrocessione)`,
  };
  infoEl.textContent = msgs[reason] || "";
}

function getCapLevel(cap, settings) {
  if (!settings) return "under";
  const { salaryCap, softCapMax, luxuryTaxThreshold } = settings;
  if (cap <= salaryCap) return "under";
  if (cap <= softCapMax) return "soft";
  if (cap <= luxuryTaxThreshold) return "hard";
  return "luxury";
}

function capLevelLabel(level) {
  return { under:"✓ Cap", soft:"Soft Cap", hard:"Hard Cap", luxury:"Luxury Tax" }[level] || level;
}

// ── CONTRATTI ─────────────────────────────────────

function parseDeadline(ddmm) {
  const [dd, mm] = (ddmm || "31/10").split("/").map(Number);
  const now  = new Date();
  let year   = now.getFullYear();
  const d    = new Date(year, (mm||10)-1, dd||31, 23, 59, 59);
  if (d < now) { d.setFullYear(year+1); }
  return d;
}

function showContractsModal() {
  const modal = document.getElementById("contracts-modal");
  const body  = document.getElementById("contracts-modal-body");
  if (!modal || !body) return;

  const myTeam  = Object.values(_league.teams||{}).find(t => t.ownerUid === _user.uid);
  if (!myTeam)  { alert("Non hai una squadra in questa lega"); return; }
  const players = Object.values(myTeam.players||{});
  const isRip   = false; // draft estivo default

  body.innerHTML = `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
      Assegna la durata del contratto per ogni giocatore.<br>
      I giocatori senza contratto riceveranno automaticamente <strong>1 anno</strong> alla scadenza.
    </p>
    <div style="max-height:480px;overflow-y:auto">
      <table class="table" style="font-size:12px">
        <thead>
          <tr>
            <th>Giocatore</th><th>Ruolo</th><th>Costo</th><th>Età</th>
            <th style="min-width:130px">Contratto</th><th>Costo Anno 2</th><th>Bandiera</th>
          </tr>
        </thead>
        <tbody>
          ${players.map(p => {
            const age   = p.dataNascita ? calcAge(p.dataNascita) : null;
            const isU21 = p.under21 || (age!==null && age<=21);
            const cost2 = contractYearCost(p.draftCost||p.currentCost, 2, isU21);
            const cost3 = contractYearCost(p.draftCost||p.currentCost, 3, isU21);
            const curr  = p.contractYears;
            return `<tr>
              <td style="font-weight:600">${p.name}</td>
              <td><span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:9px">${(p.roles||[]).join("/")}</span></td>
              <td style="color:var(--accent)">${p.currentCost}FM</td>
              <td>${age!==null?age:"—"}${isU21?" 🔵":""}</td>
              <td>
                <select class="form-input" data-pid="${p.id}" style="font-size:12px;padding:4px 8px">
                  <option value="1" ${curr===1?"selected":""}>1 anno</option>
                  <option value="2" ${curr===2?"selected":""}>2 anni (+${cost2-p.currentCost}FM/a2)</option>
                  <option value="3" ${curr===3?"selected":""}>3 anni (+${cost3-cost2}FM/a3)</option>
                </select>
              </td>
              <td style="color:var(--text2)">${cost2}FM</td>
              <td>
                ${isU21 ? `<input type="checkbox" data-pid-b="${p.id}" ${p.bandiera?"checked":""}
                  title="Clausola Bandiera — costo fisso per sempre">` : "—"}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div id="contracts-save-error" class="form-error" style="margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" id="contracts-save-btn">💾 Salva contratti</button>
      <button class="btn btn-ghost" id="contracts-cancel-btn">Annulla</button>
    </div>`;

  modal.classList.remove("hidden");

  document.getElementById("contracts-cancel-btn")?.addEventListener("click", () =>
    modal.classList.add("hidden")
  );

  document.getElementById("contracts-save-btn")?.addEventListener("click", async () => {
    const btn   = document.getElementById("contracts-save-btn");
    const errEl = document.getElementById("contracts-save-error");
    btn.disabled = true; btn.textContent = "⏳ Salvando...";
    errEl.textContent = "";

    try {
      const updates = {};
      // Contratti
      body.querySelectorAll("[data-pid]").forEach(sel => {
        const pid   = sel.dataset.pid;
        const years = parseInt(sel.value)||1;
        const p     = players.find(pl => pl.id===pid);
        if (!p) return;
        const isU21 = p.under21||(p.dataNascita?calcAge(p.dataNascita)<=21:false);
        // Costo anno corrente resta invariato (è solo anno 1 anche se contratto 2-3 anni)
        updates[`leagues/${_leagueId}/teams/${myTeam.id}/players/${pid}/contractYears`]     = years;
        updates[`leagues/${_leagueId}/teams/${myTeam.id}/players/${pid}/under21`]           = isU21;
        updates[`leagues/${_leagueId}/teams/${myTeam.id}/players/${pid}/contractAssignedAt`] = Date.now();
      });
      // Bandiera
      body.querySelectorAll("[data-pid-b]").forEach(chk => {
        const pid = chk.dataset.pidB;
        updates[`leagues/${_leagueId}/teams/${myTeam.id}/players/${pid}/bandiera`] = chk.checked;
      });

      await update(ref(db), updates);

      errEl.style.color = "var(--green)";
      errEl.textContent = "✓ Contratti salvati!";
      setTimeout(() => modal.classList.add("hidden"), 1500);

      // Refresh rose
      const snap = await get(ref(db, `leagues/${_leagueId}`));
      _league = snap.val();
      document.getElementById("rose-grid").innerHTML = buildRoseGrid();
    } catch(e) {
      errEl.style.color = "var(--red)";
      errEl.textContent = "✗ "+e.message;
    } finally {
      btn.disabled = false; btn.textContent = "💾 Salva contratti";
    }
  });
}

// Admin: applica contratti default (1 anno) a chi non ha ancora assegnato
export async function applyDefaultContracts(leagueId, league) {
  const teams   = Object.values(league.teams||{});
  const updates = {};
  let count     = 0;
  for (const team of teams) {
    for (const [pid, p] of Object.entries(team.players||{})) {
      if (!p.contractYears) {
        updates[`leagues/${leagueId}/teams/${team.id}/players/${pid}/contractYears`] = 1;
        updates[`leagues/${leagueId}/teams/${team.id}/players/${pid}/contractAssignedAt`] = Date.now();
        count++;
      }
    }
  }
  if (count > 0) await update(ref(db), updates);
  return count;
}
