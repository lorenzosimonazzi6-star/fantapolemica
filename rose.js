// ============================================================
// FANTADRAFT — rose.js
// Tab Rose: visualizza rose di tutti i manager + admin panel
// ============================================================

import { db, ref, get, update, PATH_DB_GIOCATORI } from "./firebase.js";
import { roleBadge, roleColor, capLevelBadge, contractYearCost, calcAge } from "./utils.js";

// ── STATE ────────────────────────────────────────
let _leagueId   = null;
let _league     = null;
let _user       = null;
let _players    = {};   // db_giocatori/{leagueId}
let _filterTeam = "all";
let _filterRole = "all";
let _search     = "";

// ── INIT ─────────────────────────────────────────
export async function renderRose(leagueId, league, user) {
  _leagueId = leagueId;
  _league   = league;
  _user     = user;

  const el = document.getElementById("tab-rose");

  // Carica giocatori dal db GLOBALE
  const snap = await get(ref(db, PATH_DB_GIOCATORI));
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

// ── HELPERS ──────────────────────────────────────
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
