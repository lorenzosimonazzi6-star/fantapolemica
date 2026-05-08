// ============================================================
// FANTADRAFT — formazioni.js
// Tab Formazioni: campo interattivo con picker per slot
// ============================================================

import { db, ref, get, set } from "./firebase.js";
import { MANTRA_MODULI } from "./matches.js";
import { roleColor, macroRole } from "./utils.js";

// ── STATE ────────────────────────────────────────
let _leagueId    = null;
let _league      = null;
let _user        = null;
let _teamId      = null;
let _teamPlayers = [];
let _gw          = 1;
let _modulo      = "3-4-3";
let _titolari    = {};   // { slotId: playerObj }
let _panchina    = [];   // [playerObj, ...]
let _saving      = false;
let _activeSlot  = null; // slotId con picker aperto
let _pickerSearch = "";

// ── INIT ─────────────────────────────────────────
export async function renderFormazioni(leagueId, league, user) {
  _leagueId = leagueId;
  _league   = league;
  _user     = user;

  const teams    = Object.values(league.teams || {});
  const myTeam   = teams.find(t => t.ownerUid === user.uid);
  const settings = league.settings || {};
  _gw = settings.gwStart || 1;

  const el = document.getElementById("tab-formazioni");
  el.innerHTML = buildFormazioniHTML(teams, myTeam, settings);
  bindFormazioniEvents(teams, myTeam, settings);

  if (myTeam) {
    _teamId      = myTeam.id;
    _teamPlayers = Object.values(myTeam.players || {});
    await loadFormazione(myTeam.id, _gw);
  }
}

// ── MAIN HTML ─────────────────────────────────────
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
    <div class="fm-toolbar card card-sm">
      <div class="fm-toolbar-row">
        <div class="form-group" style="min-width:200px;flex:1">
          <label class="form-label">Manager</label>
          <select class="form-input" id="fm-team-select">
            ${myTeam ? `<option value="${myTeam.id}" selected>🏠 ${myTeam.name} (la mia)</option>` : ""}
            ${teams.filter(t => !myTeam || t.id !== myTeam.id).map(t =>
              `<option value="${t.id}" disabled>${t.name} (${t.ownerName})</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Giornata</label>
          <select class="form-input" id="fm-gw-select" style="width:100px">
            ${gwOpts.map(g => `<option value="${g}" ${g === _gw ? "selected" : ""}>GW ${g}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Modulo</label>
          <select class="form-input" id="fm-modulo-select" style="width:110px">
            ${Object.keys(MANTRA_MODULI).map(m =>
              `<option value="${m}" ${m === _modulo ? "selected" : ""}>${m}</option>`
            ).join("")}
          </select>
        </div>
        <div class="fm-toolbar-actions">
          <button class="btn btn-primary btn-sm" id="fm-save-btn">💾 Salva</button>
          <button class="btn btn-secondary btn-sm" id="fm-load-btn">📂 Carica</button>
          <button class="btn btn-ghost btn-sm" id="fm-reset-btn">🔄 Reset</button>
        </div>
      </div>
    </div>

    <!-- STATS BAR -->
    <div class="fm-stats-bar" id="fm-stats-bar">
      <span id="fm-stat-titolari">Titolari: 0/11</span>
      <span id="fm-stat-panchina">Panchina: 0/12</span>
      <span id="fm-stat-fuoriruolo" style="color:var(--orange)">Fuori ruolo: 0</span>
      <span id="fm-stat-penalita" style="color:var(--red)"></span>
      <span id="fm-stat-msg" style="margin-left:auto;font-size:12px"></span>
    </div>

    <!-- CAMPO + PANCHINA -->
    <div class="fm-main">
      <div class="fm-pitch-col">
        <div class="fm-pitch" id="fm-pitch">
          ${buildPitch()}
        </div>
      </div>

      <!-- PANCHINA PANEL -->
      <div class="fm-bench-col">
        <div class="fm-bench-panel">
          <div class="fm-bench-panel-hdr">
            <span class="fm-bench-title">🪑 Panchina</span>
            <span class="fm-bench-count" id="bench-strip-count">0 / 12</span>
          </div>
          <div class="fm-bench-list" id="fm-bench-items">
            <div class="fm-bench-empty">Usa il tasto 🪑 nel picker per aggiungere alla panchina</div>
          </div>
        </div>
      </div>
    </div>

    <!-- PICKER PANEL (slide-in) -->
    <div class="fm-picker" id="fm-picker">
      <div class="picker-header" id="picker-header">
        <div class="picker-slot-info">
          <span class="picker-slot-label" id="picker-slot-label">—</span>
          <span class="picker-slot-roles" id="picker-slot-roles"></span>
        </div>
        <button class="picker-close-btn" id="picker-close-btn">✕</button>
      </div>
      <div class="picker-search-wrap">
        <input class="form-input" id="picker-search" placeholder="🔍 Cerca giocatore..." autocomplete="off">
      </div>
      <div class="picker-body" id="picker-body"></div>
    </div>
    <div class="fm-picker-backdrop" id="fm-picker-backdrop"></div>
  `;
}

// ── CAMPO ─────────────────────────────────────────
function buildPitch() {
  const modulo = MANTRA_MODULI[_modulo];
  if (!modulo) return "";

  const rows = { A:[], C:[], D:[], P:[] };
  for (const slot of modulo.slots) rows[slot.macro].push(slot);

  return `
    <div class="pitch-decorations">
      <div class="pitch-line pitch-halfway"></div>
      <div class="pitch-circle"></div>
      <div class="pitch-penalty pitch-penalty-top"></div>
      <div class="pitch-penalty pitch-penalty-bot"></div>
      <div class="pitch-goal pitch-goal-top"></div>
      <div class="pitch-goal pitch-goal-bot"></div>
    </div>
    <div class="pitch-rows">
      ${["A","C","D","P"].map(macro => `
        <div class="pitch-row pitch-row-${macro.toLowerCase()}">
          ${rows[macro].map(slot => buildPitchSlot(slot)).join("")}
        </div>`).join("")}
    </div>`;
}

function buildPitchSlot(slot) {
  const player = _titolari[slot.id];
  const active = _activeSlot === slot.id;
  const offPos = player && !isCompatible(player, slot);
  const malus  = offPos && isWithMalus(player, slot);
  const wrong  = offPos && !malus;

  if (player) {
    const initials = player.name.split(" ").map(w => w[0]).slice(0,2).join("");
    const rc = roleColor(player.roles?.[0]);
    return `
      <div class="pitch-slot slot-filled${active ? " slot-active" : ""}${malus ? " slot-malus" : ""}${wrong ? " slot-wrong" : ""}"
           data-slot="${slot.id}" data-compatible="${slot.compatible.join(",")}">
        <div class="slot-token" style="background:linear-gradient(160deg,${rc}ee,${rc}77)">
          <span class="slot-initials">${initials}</span>
          <span class="slot-pos-tag">${slot.label}</span>
          ${malus ? `<span class="slot-malus-badge">-1</span>` : ""}
          ${wrong ? `<span class="slot-warn-badge">!</span>` : ""}
        </div>
        <div class="slot-name">${shortName(player.name)}</div>
        <button class="slot-remove-btn" data-slot="${slot.id}">✕</button>
      </div>`;
  } else {
    return `
      <div class="pitch-slot slot-empty${active ? " slot-active" : ""}"
           data-slot="${slot.id}" data-compatible="${slot.compatible.join(",")}">
        <div class="slot-token slot-token-empty">
          <span class="slot-empty-pos">${slot.label}</span>
          <span class="slot-add-plus">+</span>
        </div>
      </div>`;
  }
}

// ── REFRESH ───────────────────────────────────────
function refreshPitch() {
  const el = document.getElementById("fm-pitch");
  if (el) el.innerHTML = buildPitch();
  refreshBench();
  refreshStats();
  bindSlotEvents();
  if (_activeSlot) openPicker(_activeSlot);
}

function refreshBench() {
  const items = document.getElementById("fm-bench-items");
  const count = document.getElementById("bench-strip-count");
  if (!items) return;
  if (count) count.textContent = `${_panchina.length} / 12`;

  if (!_panchina.length) {
    items.innerHTML = `<div class="fm-bench-empty">Usa il tasto 🪑 nel picker per aggiungere alla panchina</div>`;
    return;
  }
  items.innerHTML = _panchina.map((p, i) => {
    const rc       = roleColor(p.roles?.[0]);
    const initials = p.name.split(" ").map(w => w[0]).slice(0,2).join("");
    return `
      <div class="bench-player-card" data-bench-idx="${i}">
        <span class="bench-card-order">${i + 1}</span>
        <div class="bench-card-avatar" style="background:linear-gradient(160deg,${rc}ee,${rc}66)">
          ${initials}
        </div>
        <div class="bench-card-info">
          <span class="bench-card-name">${shortName(p.name)}</span>
          <span class="bench-card-sub">${(p.roles||[]).join("/")} · ${p.team}</span>
        </div>
        <button class="bench-card-remove" data-idx="${i}">✕</button>
      </div>`;
  }).join("");

  items.querySelectorAll(".bench-card-remove").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _panchina.splice(parseInt(btn.dataset.idx), 1);
      refreshBench();
      refreshStats();
    });
  });
}

function refreshStats() {
  const titCount = Object.values(_titolari).filter(Boolean).length;
  const wrongCount = Object.entries(_titolari).filter(([slotId, p]) => {
    if (!p) return false;
    const slot = MANTRA_MODULI[_modulo]?.slots.find(s => s.id === slotId);
    return slot && !isCompatible(p, slot);
  }).length;

  document.getElementById("fm-stat-titolari").textContent   = `Titolari: ${titCount}/11`;
  document.getElementById("fm-stat-panchina").textContent   = `Panchina: ${_panchina.length}/12`;
  document.getElementById("fm-stat-fuoriruolo").textContent = `Fuori ruolo: ${wrongCount}`;
  const penEl = document.getElementById("fm-stat-penalita");
  if (penEl) penEl.textContent = wrongCount > 0 ? `⚠ ${wrongCount} penalità modulo` : "";
}

// ── PICKER ────────────────────────────────────────
function openPicker(slotId) {
  _activeSlot  = slotId;
  _pickerSearch = "";
  const slot = MANTRA_MODULI[_modulo]?.slots.find(s => s.id === slotId);
  if (!slot) return;

  const picker   = document.getElementById("fm-picker");
  const backdrop = document.getElementById("fm-picker-backdrop");
  const labelEl  = document.getElementById("picker-slot-label");
  const rolesEl  = document.getElementById("picker-slot-roles");
  const searchEl = document.getElementById("picker-search");

  if (labelEl)  labelEl.textContent  = `Slot: ${slot.label}`;
  if (rolesEl) {
    const compStr = slot.compatible.join(", ");
    const malusStr = slot.withMalus?.length ? ` · -1: ${slot.withMalus.join(", ")}` : "";
    rolesEl.textContent = `OK: ${compStr}${malusStr}`;
  }
  if (searchEl) { searchEl.value = ""; }
  if (picker)   picker.classList.add("open");
  if (backdrop) backdrop.classList.add("visible");

  renderPickerPlayers(slot);

  // Rende attivo lo slot visivamente
  document.querySelectorAll(".pitch-slot").forEach(el => el.classList.remove("slot-active"));
  document.querySelector(`.pitch-slot[data-slot="${slotId}"]`)?.classList.add("slot-active");
}

function closePicker() {
  _activeSlot = null;
  document.getElementById("fm-picker")?.classList.remove("open");
  document.getElementById("fm-picker-backdrop")?.classList.remove("visible");
  document.querySelectorAll(".pitch-slot").forEach(el => el.classList.remove("slot-active"));
}

function renderPickerPlayers(slot) {
  const body = document.getElementById("picker-body");
  if (!body) return;

  const usedIds = new Set([
    ...Object.values(_titolari).filter(Boolean).map(p => p.id || p.name),
    ..._panchina.map(p => p.id || p.name),
  ]);
  const q = _pickerSearch.toLowerCase();

  const available = _teamPlayers.filter(p => {
    const inUse = usedIds.has(p.id || p.name);
    const searchOk = !q || p.name.toLowerCase().includes(q) || (p.team||"").toLowerCase().includes(q);
    return !inUse && searchOk;
  });

  const compatible = available.filter(p => isCompatible(p, slot));
  const withMalus  = available.filter(p => isWithMalus(p, slot));

  if (!compatible.length && !withMalus.length) {
    body.innerHTML = `<div class="picker-empty">Nessun giocatore disponibile per questo slot</div>`;
    return;
  }

  body.innerHTML = `
    ${compatible.length ? `
      <div class="picker-section-label">✓ Compatibili (${compatible.length})</div>
      ${compatible.map(p => pickerPlayerItem(p, true)).join("")}` : ""}
    ${withMalus.length ? `
      <div class="picker-section-label" style="color:var(--orange)">⚠ Fuori ruolo -1 (${withMalus.length})</div>
      ${withMalus.map(p => pickerPlayerItem(p, false)).join("")}` : ""}
  `;

  body.querySelectorAll(".picker-player-item").forEach(item => {
    item.addEventListener("click", () => {
      const pid    = item.dataset.pid;
      const player = _teamPlayers.find(p => (p.id || p.name) === pid || p.name === pid);
      if (!player || !_activeSlot) return;
      _titolari[_activeSlot] = player;
      closePicker();
      refreshPitch();
    });
  });

  // Bench button
  body.querySelectorAll(".picker-bench-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const pid    = btn.closest(".picker-player-item").dataset.pid;
      const player = _teamPlayers.find(p => (p.id || p.name) === pid || p.name === pid);
      if (!player) return;
      if (_panchina.length >= 12) {
        const msg = document.getElementById("fm-stat-msg");
        if (msg) { msg.textContent = "⚠ Panchina piena (max 12)"; setTimeout(() => msg.textContent = "", 2000); }
        return;
      }
      _panchina.push(player);
      // Rimuovi da titolari se era lì
      for (const [sid, p] of Object.entries(_titolari)) {
        if (p && (p.id || p.name) === (player.id || player.name)) delete _titolari[sid];
      }
      closePicker();
      refreshPitch();
    });
  });
}

function pickerPlayerItem(player, compatible) {
  const cost = player.currentCost || player.draftCost || 0;
  return `
    <div class="picker-player-item ${compatible ? "" : "picker-incompatible"}"
         data-pid="${player.id || player.name}">
      <span class="picker-role-badge" style="background:${roleColor(player.roles?.[0])}">${(player.roles||[]).join("/")}</span>
      <div class="picker-player-info">
        <span class="picker-player-name">${player.name}</span>
        <span class="picker-player-sub">${player.team}</span>
      </div>
      <span class="picker-player-cost">${cost}FM</span>
      <button class="picker-bench-btn btn btn-ghost btn-sm" title="Metti in panchina">🪑</button>
    </div>`;
}

// ── SLOT EVENTS ───────────────────────────────────
function bindSlotEvents() {
  document.querySelectorAll(".pitch-slot").forEach(slotEl => {
    slotEl.addEventListener("click", e => {
      if (e.target.classList.contains("slot-remove-btn") ||
          e.target.closest(".slot-remove-btn")) return;
      const slotId = slotEl.dataset.slot;
      if (_activeSlot === slotId) { closePicker(); return; }
      openPicker(slotId);
    });
  });

  document.querySelectorAll(".slot-remove-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      delete _titolari[btn.dataset.slot];
      if (_activeSlot === btn.dataset.slot) closePicker();
      refreshPitch();
    });
  });
}

// ── LOAD / SAVE ───────────────────────────────────
async function loadFormazione(teamId, gw) {
  const snap = await get(ref(db, `leagues/${_leagueId}/formations/${teamId}/${gw}`));
  const data = snap.val();
  if (data) {
    _modulo   = data.modulo || "3-4-3";
    _titolari = data.titolari || {};
    _panchina = data.panchina || [];
    const sel = document.getElementById("fm-modulo-select");
    if (sel) sel.value = _modulo;
  } else {
    _titolari = {};
    _panchina = [];
  }
  refreshPitch();
}

async function saveFormazione() {
  if (_saving) return;
  _saving = true;
  const btn = document.getElementById("fm-save-btn");
  const msg = document.getElementById("fm-stat-msg");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Salvando..."; }
  try {
    await set(ref(db, `leagues/${_leagueId}/formations/${_teamId}/${_gw}`), {
      teamId: _teamId, gw: _gw, modulo: _modulo,
      titolari: _titolari, panchina: _panchina,
      savedAt: Date.now(), savedBy: _user.uid,
    });
    if (msg) { msg.textContent = "✓ Formazione salvata"; msg.style.color = "var(--green)"; }
    setTimeout(() => { if (msg) msg.textContent = ""; }, 3000);
  } catch(e) {
    if (msg) { msg.textContent = `✗ ${e.message}`; msg.style.color = "var(--red)"; }
  } finally {
    _saving = false;
    if (btn) { btn.disabled = false; btn.textContent = "💾 Salva"; }
  }
}

// ── EVENTS ────────────────────────────────────────
function bindFormazioniEvents(teams, myTeam, settings) {
  document.getElementById("fm-team-select")?.addEventListener("change", async e => {
    if (e.target.value !== myTeam?.id) return;
    _teamId      = e.target.value;
    _teamPlayers = Object.values(teams.find(t => t.id === _teamId)?.players || {});
    _titolari = {}; _panchina = [];
    await loadFormazione(_teamId, _gw);
  });

  document.getElementById("fm-gw-select")?.addEventListener("change", async e => {
    _gw = parseInt(e.target.value);
    _titolari = {}; _panchina = [];
    closePicker();
    if (_teamId) await loadFormazione(_teamId, _gw);
  });

  document.getElementById("fm-modulo-select")?.addEventListener("change", e => {
    _modulo = e.target.value;
    // Riassegna giocatori esistenti agli slot compatibili
    const newSlots = MANTRA_MODULI[_modulo]?.slots || [];
    const newTit = {};
    let idx = 0;
    for (const [, player] of Object.entries(_titolari)) {
      if (!player) continue;
      while (idx < newSlots.length) {
        const slot = newSlots[idx++];
        if (!newTit[slot.id] && isCompatible(player, slot)) {
          newTit[slot.id] = player;
          break;
        }
      }
    }
    _titolari = newTit;
    closePicker();
    refreshPitch();
  });

  document.getElementById("fm-save-btn")?.addEventListener("click", saveFormazione);

  document.getElementById("fm-load-btn")?.addEventListener("click", async () => {
    if (_teamId) await loadFormazione(_teamId, _gw);
  });

  document.getElementById("fm-reset-btn")?.addEventListener("click", () => {
    if (!confirm("Resettare la formazione?")) return;
    _titolari = {}; _panchina = [];
    closePicker();
    refreshPitch();
  });

  document.getElementById("picker-close-btn")?.addEventListener("click", closePicker);
  document.getElementById("fm-picker-backdrop")?.addEventListener("click", closePicker);

  document.getElementById("picker-search")?.addEventListener("input", e => {
    _pickerSearch = e.target.value;
    const slot = MANTRA_MODULI[_modulo]?.slots.find(s => s.id === _activeSlot);
    if (slot) renderPickerPlayers(slot);
  });

  bindSlotEvents();
}

// ── HELPERS ──────────────────────────────────────
function isCompatible(player, slot) {
  return (player.roles || []).some(r => (slot.compatible || []).includes(r));
}

function isWithMalus(player, slot) {
  if (isCompatible(player, slot)) return false;
  return (player.roles || []).some(r => (slot.withMalus || []).includes(r));
}

function shortName(name) {
  if (!name) return "";
  const parts = name.split(" ");
  if (parts.length === 1) return name;
  return parts[0].length <= 3 ? name : parts[0][0] + ". " + parts.slice(1).join(" ");
}
