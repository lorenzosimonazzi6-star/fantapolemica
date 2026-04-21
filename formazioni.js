// ============================================================
// FANTADRAFT — formazioni.js
// Tab Formazioni: schieramento titolari + panchina Mantra
// ============================================================

import { db, ref, get, set, update } from "./firebase.js";
import { MANTRA_MODULI } from "./matches.js";
import { roleColor, macroRole } from "./utils.js";

// ── STATE ────────────────────────────────────────
let _leagueId   = null;
let _league     = null;
let _user       = null;
let _isAdmin    = false;
let _teamId     = null;
let _teamPlayers = [];
let _gw         = 1;
let _modulo     = "3-4-3";
let _titolari   = {};   // { slotId: playerObj }
let _panchina   = [];   // [playerObj, ...]
let _saving     = false;

// ── INIT ─────────────────────────────────────────
export async function renderFormazioni(leagueId, league, user) {
  _leagueId = leagueId;
  _league   = league;
  _user     = user;
  _isAdmin  = league.commissionerUid === user.uid;

  const teams    = Object.values(league.teams || {});
  const myTeam   = teams.find(t => t.ownerUid === user.uid);
  const settings = league.settings || {};
  _gw = settings.gwStart || 1;

  const el = document.getElementById("tab-formazioni");
  el.innerHTML = buildFormazioniHTML(teams, myTeam, settings);
  bindFormazioniEvents(teams, myTeam, settings);

  // Carica formazione del team selezionato
  if (myTeam) {
    _teamId = myTeam.id;
    _teamPlayers = Object.values(myTeam.players || []);
    await loadFormazione(myTeam.id, _gw);
  }
}

// ── HTML ─────────────────────────────────────────
function buildFormazioniHTML(teams, myTeam, settings) {
  const gwStart = settings.gwStart || 1;
  const gwEnd   = settings.gwEnd   || 34;
  const gwOpts  = Array.from({length: gwEnd - gwStart + 1}, (_, i) => gwStart + i);

  return `
    <div class="page-header">
      <span class="ph-icon">📋</span>
      <h1>Formazioni</h1>
    </div>

    <!-- TOOLBAR -->
    <div class="form-toolbar card card-sm" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">
      <div class="form-group" style="min-width:220px">
        <label class="form-label">Manager</label>
        <select class="form-input" id="fm-team-select">
          ${myTeam ? `<option value="${myTeam.id}" selected>🏠 ${myTeam.name} (la mia)</option>` : ""}
          ${teams.filter(t => !myTeam || t.id !== myTeam.id).map(t =>
            `<option value="${t.id}"${!myTeam && _isAdmin ? "" : " disabled"}>${t.name} (${t.ownerName})</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-group" style="min-width:100px">
        <label class="form-label">Giornata</label>
        <select class="form-input" id="fm-gw-select">
          ${gwOpts.map(g => `<option value="${g}" ${g === _gw ? "selected" : ""}>GW ${g}</option>`).join("")}
        </select>
      </div>
      <div class="form-group" style="min-width:130px">
        <label class="form-label">Modulo</label>
        <select class="form-input" id="fm-modulo-select">
          ${Object.keys(MANTRA_MODULI).map(m =>
            `<option value="${m}" ${m === _modulo ? "selected" : ""}>${m}</option>`
          ).join("")}
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;align-items:center">
        <button class="btn btn-primary" id="fm-save-btn">💾 Salva</button>
        <button class="btn btn-secondary" id="fm-load-btn">📂 Carica</button>
        <button class="btn btn-ghost" id="fm-reset-btn">🔄 Reset</button>
      </div>
    </div>

    <!-- STATS BAR -->
    <div class="fm-stats-bar" id="fm-stats-bar">
      <span id="fm-stat-titolari">Titolari: 0/11</span>
      <span id="fm-stat-panchina">Panchina: 0/12</span>
      <span id="fm-stat-fuoriruolo">Fuori ruolo: 0</span>
      <span id="fm-stat-penalita" style="color:var(--red)"></span>
      <span id="fm-stat-msg" style="margin-left:auto"></span>
    </div>

    <!-- MAIN LAYOUT: campo + lista giocatori -->
    <div class="fm-main">

      <!-- CAMPO -->
      <div class="fm-field-wrap">
        <div class="fm-field" id="fm-field">
          ${buildField()}
        </div>
        <!-- PANCHINA -->
        <div class="fm-bench-wrap">
          <div class="fm-bench-title">🪑 PANCHINA (0/12)</div>
          <div class="fm-bench-list" id="fm-bench-list"></div>
        </div>
      </div>

      <!-- LISTA GIOCATORI (rosa) -->
      <div class="fm-roster-panel">
        <div class="fm-roster-search">
          <input class="form-input" id="fm-search" placeholder="🔍 Cerca giocatore...">
          <div class="role-filter-btns" style="margin-top:8px">
            ${["all","P","D","C","A"].map(r => `
              <button class="role-btn ${r === "all" ? "active" : ""}" data-role="${r}">
                ${r === "all" ? "Tutti" : r}
              </button>`).join("")}
          </div>
        </div>
        <div class="fm-roster-list" id="fm-roster-list">
          <div style="color:var(--text2);font-size:13px;padding:20px">
            Seleziona una squadra e una giornata
          </div>
        </div>
      </div>

    </div>
  `;
}

function buildField() {
  const modulo = MANTRA_MODULI[_modulo];
  if (!modulo) return "";

  // Raggruppa slot per macro ruolo per posizionamento visivo
  const rows = { P:[], D:[], C:[], A:[] };
  for (const slot of modulo.slots) rows[slot.macro].push(slot);

  return `
    <div class="field-inner">
      ${["P","D","C","A"].map(macro => `
        <div class="field-row field-row-${macro.toLowerCase()}">
          ${rows[macro].map(slot => buildSlot(slot)).join("")}
        </div>`).join("")}
    </div>`;
}

function buildSlot(slot) {
  const player = _titolari[slot.id];
  const isEmpty = !player;
  const isWrong = player && !isCompatible(player, slot);

  return `
    <div class="field-slot ${isEmpty ? "slot-empty" : "slot-filled"} ${isWrong ? "slot-wrong" : ""}"
         data-slot="${slot.id}"
         data-macro="${slot.macro}"
         data-compatible="${slot.compatible.join(",")}">
      <div class="slot-label">${slot.label}</div>
      ${player
        ? `<div class="slot-player">
             <div class="slot-player-name">${shortName(player.name)}</div>
             <div class="slot-player-role" style="color:${roleColor(player.roles?.[0])}">${(player.roles||[]).join("/")}</div>
             <button class="slot-remove" data-slot="${slot.id}">✕</button>
           </div>`
        : `<div class="slot-placeholder">+</div>`}
    </div>`;
}

// ── RENDER AGGIORNAMENTO CAMPO ────────────────────
function refreshField() {
  document.getElementById("fm-field").innerHTML = buildField();
  refreshBench();
  refreshStats();
  refreshRoster();
  bindSlotEvents();
}

function refreshBench() {
  const bench = document.getElementById("fm-bench-list");
  const title = document.querySelector(".fm-bench-title");
  if (!bench) return;
  if (title) title.textContent = `🪑 PANCHINA (${_panchina.length}/12)`;
  bench.innerHTML = _panchina.map((p, i) => `
    <div class="bench-item" data-bench-idx="${i}">
      <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:10px">${(p.roles||[]).join("/")}</span>
      <span class="bench-name">${p.name}</span>
      <span style="color:var(--text2);font-size:11px">${p.team}</span>
      <button class="bench-remove" data-idx="${i}">✕</button>
    </div>`).join("") || `<div style="color:var(--text3);font-size:12px;padding:10px">Nessun giocatore in panchina</div>`;

  bench.querySelectorAll(".bench-remove").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      _panchina.splice(idx, 1);
      refreshBench();
      refreshStats();
      refreshRoster();
    });
  });
}

function refreshStats() {
  const titCount = Object.values(_titolari).filter(Boolean).length;
  const penCount = Object.entries(_titolari).filter(([slotId, p]) => {
    if (!p) return false;
    const slot = MANTRA_MODULI[_modulo]?.slots.find(s => s.id === slotId);
    return slot && !isCompatible(p, slot);
  }).length;

  document.getElementById("fm-stat-titolari").textContent = `Titolari: ${titCount}/11`;
  document.getElementById("fm-stat-panchina").textContent = `Panchina: ${_panchina.length}/12`;
  document.getElementById("fm-stat-fuoriruolo").textContent = `Fuori ruolo: ${penCount}`;
  const penEl = document.getElementById("fm-stat-penalita");
  if (penEl) penEl.textContent = penCount > 0 ? `⚠ ${penCount} penalità modulo` : "";
}

function refreshRoster() {
  const usedIds = new Set([
    ...Object.values(_titolari).filter(Boolean).map(p => p.id || p.name),
    ..._panchina.map(p => p.id || p.name),
  ]);
  const search   = document.getElementById("fm-search")?.value?.toLowerCase() || "";
  const roleFilter = document.querySelector(".role-btn.active")?.dataset?.role || "all";

  const filtered = _teamPlayers.filter(p => {
    const inUse    = usedIds.has(p.id || p.name);
    const roleOk   = roleFilter === "all" || macroRole(p.roles?.[0]) === roleFilter;
    const searchOk = !search || p.name.toLowerCase().includes(search);
    return !inUse && roleOk && searchOk;
  });

  const list = document.getElementById("fm-roster-list");
  if (!list) return;
  list.innerHTML = filtered.length === 0
    ? `<div style="color:var(--text2);font-size:13px;padding:16px">Nessun giocatore disponibile</div>`
    : filtered.map(p => `
        <div class="roster-item" data-pid="${p.id || p.name}" data-name="${p.name}">
          <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:10px;flex-shrink:0">${(p.roles||[]).join("/")}</span>
          <span style="flex:1;font-size:13px">${p.name}</span>
          <span style="color:var(--text2);font-size:11px">${p.team}</span>
          <span style="color:var(--accent);font-size:11px">${p.currentCost||0}FM</span>
        </div>`).join("");

  list.querySelectorAll(".roster-item").forEach(item => {
    item.addEventListener("click", () => {
      const pid  = item.dataset.pid;
      const player = _teamPlayers.find(p => (p.id || p.name) === pid);
      if (!player) return;
      // Trova il primo slot compatibile vuoto
      const modulo = MANTRA_MODULI[_modulo];
      let assigned = false;
      if (modulo) {
        for (const slot of modulo.slots) {
          if (!_titolari[slot.id] && isCompatible(player, slot)) {
            _titolari[slot.id] = player;
            assigned = true;
            break;
          }
        }
      }
      // Se non trovato slot, metti in panchina (se c'è posto)
      if (!assigned && _panchina.length < 12) {
        _panchina.push(player);
      } else if (!assigned) {
        const msg = document.getElementById("fm-stat-msg");
        if (msg) { msg.textContent = "⚠ Panchina piena (max 12)"; setTimeout(() => msg.textContent = "", 2000); }
      }
      refreshField();
    });
  });
}

// ── SLOT EVENTS ───────────────────────────────────
function bindSlotEvents() {
  document.querySelectorAll(".field-slot").forEach(slot => {
    slot.addEventListener("click", e => {
      if (e.target.classList.contains("slot-remove")) return;
      const slotId = slot.dataset.slot;
      const player = _titolari[slotId];
      if (player) {
        // Click su slot occupato → seleziona per spostare (TODO drag&drop)
        return;
      }
      // Slot vuoto → mostra giocatori compatibili (evidenzia nella lista)
      const compatible = slot.dataset.compatible.split(",");
      highlightCompatible(compatible);
    });
  });

  document.querySelectorAll(".slot-remove").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const slotId = btn.dataset.slot;
      delete _titolari[slotId];
      refreshField();
    });
  });
}

function highlightCompatible(roles) {
  document.querySelectorAll(".roster-item").forEach(item => {
    const pid    = item.dataset.pid;
    const player = _teamPlayers.find(p => (p.id || p.name) === pid);
    if (!player) return;
    const playerRoles = player.roles || [];
    const ok = playerRoles.some(r => roles.includes(r));
    item.style.background = ok ? "rgba(245,197,24,.08)" : "";
    item.style.borderColor = ok ? "rgba(245,197,24,.2)" : "";
  });
  setTimeout(() => {
    document.querySelectorAll(".roster-item").forEach(item => {
      item.style.background = "";
      item.style.borderColor = "";
    });
  }, 2000);
}

// ── LOAD / SAVE ───────────────────────────────────
async function loadFormazione(teamId, gw) {
  const snap = await get(ref(db, `leagues/${_leagueId}/formations/${teamId}/${gw}`));
  const data  = snap.val();
  if (data) {
    _modulo   = data.modulo || "3-4-3";
    _titolari = data.titolari || {};
    _panchina = data.panchina || [];
    // Aggiorna select modulo
    const sel = document.getElementById("fm-modulo-select");
    if (sel) sel.value = _modulo;
  } else {
    _titolari = {};
    _panchina = [];
  }
  refreshField();
}

async function saveFormazione() {
  if (_saving) return;
  _saving = true;
  const btn = document.getElementById("fm-save-btn");
  const msg = document.getElementById("fm-stat-msg");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Salvando..."; }

  try {
    const data = {
      teamId:    _teamId,
      gw:        _gw,
      modulo:    _modulo,
      titolari:  _titolari,
      panchina:  _panchina,
      savedAt:   Date.now(),
      savedBy:   _user.uid,
    };
    await set(ref(db, `leagues/${_leagueId}/formations/${_teamId}/${_gw}`), data);
    if (msg) { msg.textContent = "✓ Formazione salvata"; msg.style.color = "var(--green)"; }
    setTimeout(() => { if (msg) { msg.textContent = ""; } }, 3000);
  } catch(e) {
    if (msg) { msg.textContent = `✗ ${e.message}`; msg.style.color = "var(--red)"; }
  } finally {
    _saving = false;
    if (btn) { btn.disabled = false; btn.textContent = "💾 Salva"; }
  }
}

// ── EVENTS ────────────────────────────────────────
function bindFormazioniEvents(teams, myTeam, settings) {
  // Cambio team (solo admin)
  document.getElementById("fm-team-select")?.addEventListener("change", async e => {
    if (!_isAdmin && e.target.value !== myTeam?.id) return;
    _teamId = e.target.value;
    const team = teams.find(t => t.id === _teamId);
    _teamPlayers = Object.values(team?.players || {});
    _titolari = {};
    _panchina = [];
    await loadFormazione(_teamId, _gw);
  });

  // Cambio giornata
  document.getElementById("fm-gw-select")?.addEventListener("change", async e => {
    _gw = parseInt(e.target.value);
    _titolari = {};
    _panchina = [];
    if (_teamId) await loadFormazione(_teamId, _gw);
  });

  // Cambio modulo
  document.getElementById("fm-modulo-select")?.addEventListener("change", e => {
    _modulo = e.target.value;
    // Reset titolari che non sono compatibili con il nuovo modulo
    const newSlots = MANTRA_MODULI[_modulo]?.slots || [];
    const newTit = {};
    let slotIdx = 0;
    // Cerca di riassegnare i giocatori esistenti ai nuovi slot compatibili
    for (const [, player] of Object.entries(_titolari)) {
      if (!player) continue;
      while (slotIdx < newSlots.length) {
        const slot = newSlots[slotIdx++];
        if (!newTit[slot.id] && isCompatible(player, slot)) {
          newTit[slot.id] = player;
          break;
        }
      }
    }
    _titolari = newTit;
    refreshField();
  });

  // Salva
  document.getElementById("fm-save-btn")?.addEventListener("click", saveFormazione);

  // Carica
  document.getElementById("fm-load-btn")?.addEventListener("click", async () => {
    if (_teamId) await loadFormazione(_teamId, _gw);
  });

  // Reset
  document.getElementById("fm-reset-btn")?.addEventListener("click", () => {
    if (!confirm("Resettare la formazione?")) return;
    _titolari = {};
    _panchina = [];
    refreshField();
  });

  // Filtri ruolo roster
  document.getElementById("tab-formazioni")?.addEventListener("click", e => {
    const roleBtn = e.target.closest(".role-btn");
    if (!roleBtn) return;
    document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("active"));
    roleBtn.classList.add("active");
    refreshRoster();
  });

  // Ricerca
  document.getElementById("fm-search")?.addEventListener("input", refreshRoster);

  bindSlotEvents();
}

// ── HELPERS ──────────────────────────────────────
function isCompatible(player, slot) {
  const playerRoles = player.roles || [];
  return playerRoles.some(r => slot.compatible.includes(r));
}

function shortName(name) {
  if (!name) return "";
  const parts = name.split(" ");
  if (parts.length === 1) return name;
  // Es: "Federico Chiesa" → "F. Chiesa"
  return parts[0].length <= 3
    ? name  // Nome corto tipo "Van", mantieni
    : parts[0][0] + ". " + parts.slice(1).join(" ");
}
