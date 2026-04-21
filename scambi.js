// ============================================================
// FANTADRAFT — scambi.js
// Tab Scambi: proponi scambi, ricevi proposte, storico
// Regole cap: Cap/Soft = libero | Hard = diff max 10FM
//             Luxury = nessuno scambio
// Scelte draft: solo giri 1-3, max 3 per draft, max 3 stagioni
// ============================================================

import { db, ref, get, set, push, update } from "./firebase.js";
import { getCapLevel, capLevelLabel, capLevelBadge, roleColor } from "./utils.js";

// ── STATE ────────────────────────────────────────
let _leagueId  = null;
let _league    = null;
let _user      = null;
let _myTeam    = null;
let _teams     = [];
let _isAdmin   = false;

// Stato proposta corrente
let _proposalA = { teamId: null, players: [], picks: [] }; // manager 1 (io)
let _proposalB = { teamId: null, players: [], picks: [] }; // manager 2 (controparte)

// ── INIT ─────────────────────────────────────────
export async function renderScambi(leagueId, league, user) {
  _leagueId = leagueId;
  _league   = league;
  _user     = user;
  _teams    = Object.values(league.teams || {});
  _myTeam   = _teams.find(t => t.ownerUid === user.uid);
  _isAdmin  = league.commissionerUid === user.uid;

  // Reset stato proposta
  _proposalA = { teamId: _myTeam?.id || null, players: [], picks: [] };
  _proposalB = { teamId: null, players: [], picks: [] };

  const el = document.getElementById("tab-scambi");
  el.innerHTML = buildScambiHTML();
  await bindScambiEvents();
  await renderProposteRicevute();
  await renderProposteInviate();
  await renderStorico();
}

// ── MAIN HTML ─────────────────────────────────────
function buildScambiHTML() {
  const myCapLevel = getCapLevel(_myTeam?.currentCap || 0, _league.settings);
  const isLuxury   = myCapLevel === "luxury";

  return `
    <div class="page-header">
      <span class="ph-icon">🔄</span>
      <h1>Scambi</h1>
    </div>

    <!-- AVVISO LUXURY TAX -->
    ${isLuxury ? `
    <div class="alert alert-luxury">
      ✗ Sei in <strong>Luxury Tax</strong> — non puoi effettuare scambi finché non rientri sotto i ${_league.settings?.luxuryTaxThreshold || 360} FM.
    </div>` : ""}

    <!-- REGOLE VELOCI -->
    <div class="trade-rules-strip">
      <span>Cap/Soft: scambi liberi</span>
      <span class="rules-sep">·</span>
      <span>Hard Cap: diff. max <strong>10 FM</strong></span>
      <span class="rules-sep">·</span>
      <span>Luxury Tax: <strong style="color:var(--red)">nessuno scambio</strong></span>
      <span class="rules-sep">·</span>
      <span>Scelte: solo giri 1–3, max 3 per draft</span>
    </div>

    <!-- COSTRUTTORE SCAMBIO -->
    <div class="trade-builder" ${isLuxury ? 'style="opacity:.4;pointer-events:none"' : ""}>

      <div class="trade-block" id="trade-block-a">
        ${buildTradeBlock("a", _myTeam, true)}
      </div>

      <div class="trade-arrow">
        <div class="arrow-icon">⇄</div>
        <div id="trade-validation" class="trade-valid-msg"></div>
        <button class="btn btn-primary" id="trade-send-btn" ${isLuxury ? "disabled" : ""}>
          📤 Invia Proposta
        </button>
      </div>

      <div class="trade-block" id="trade-block-b">
        ${buildTradeBlock("b", null, false)}
      </div>

    </div>

    <!-- PROPOSTE RICEVUTE -->
    <div class="card" style="margin-top:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="font-size:15px">📥 Proposte Ricevute</h3>
        <button class="btn btn-ghost btn-sm" id="refresh-ricevute-btn">↺ Aggiorna</button>
      </div>
      <div id="proposte-ricevute-list">
        <div class="spinner" style="margin:20px auto"></div>
      </div>
    </div>

    <!-- PROPOSTE INVIATE -->
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="font-size:15px">📤 Proposte Inviate</h3>
        <button class="btn btn-ghost btn-sm" id="refresh-inviate-btn">↺ Aggiorna</button>
      </div>
      <div id="proposte-inviate-list">
        <div class="spinner" style="margin:20px auto"></div>
      </div>
    </div>

    <!-- STORICO -->
    <div class="card" style="margin-top:16px">
      <h3 style="font-size:15px;margin-bottom:16px">📋 Storico Scambi</h3>
      <div id="storico-list">
        <div class="spinner" style="margin:20px auto"></div>
      </div>
    </div>
  `;
}

// ── TRADE BLOCK ───────────────────────────────────
function buildTradeBlock(side, team, isMyBlock) {
  const proposal = side === "a" ? _proposalA : _proposalB;
  const otherTeams = _teams.filter(t => t.id !== _myTeam?.id);

  return `
    <div class="trade-block-inner">
      <!-- HEADER -->
      <div class="trade-block-header">
        ${isMyBlock
          ? `<div class="trade-team-name">${team?.name || "La mia squadra"}</div>`
          : `<select class="form-input" id="trade-team-b-select" style="font-weight:700;font-size:14px">
               <option value="">Seleziona manager...</option>
               ${otherTeams.map(t => `<option value="${t.id}">${t.name} (${t.ownerName})</option>`).join("")}
             </select>`}
        <div class="trade-block-cap" id="trade-cap-${side}">
          ${team ? buildCapInfo(team) : ""}
        </div>
      </div>

      <!-- GIOCATORI DA CEDERE -->
      <div class="trade-section-label">Giocatori da cedere</div>
      <div class="trade-players-selected" id="trade-players-${side}">
        <div style="color:var(--text3);font-size:12px;padding:8px 0">Nessun giocatore selezionato</div>
      </div>
      <div class="trade-total" id="trade-total-${side}">Totale: 0 FM</div>

      <!-- SCELTE DRAFT -->
      <div class="trade-section-label" style="margin-top:12px">
        Scelte Draft incluse
        <span style="color:var(--text3);font-size:10px">(solo giri 1–3, max 3)</span>
      </div>
      <div class="trade-picks-selected" id="trade-picks-${side}">
        <div style="color:var(--text3);font-size:12px;padding:6px 0">Nessuna scelta inclusa</div>
      </div>

      <!-- BOTTONI AGGIUNGI -->
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="trade-add-player-${side}-btn"
          ${!team && side === "b" ? "disabled" : ""}>
          + Giocatore
        </button>
        <button class="btn btn-secondary btn-sm" id="trade-add-pick-${side}-btn"
          ${!team && side === "b" ? "disabled" : ""}>
          + Scelta Draft
        </button>
      </div>

      <!-- MODALI SELEZIONE -->
      <div id="trade-player-modal-${side}" class="trade-mini-modal hidden"></div>
      <div id="trade-pick-modal-${side}"   class="trade-mini-modal hidden"></div>
    </div>
  `;
}

function buildCapInfo(team) {
  const cap   = team.currentCap || 0;
  const level = getCapLevel(cap, _league.settings);
  return `
    <span class="badge ${capLevelBadge(level)}" style="font-size:10px">${capLevelLabel(level)}</span>
    <span style="color:var(--accent);font-size:13px;font-weight:700;margin-left:6px">${cap} FM</span>
  `;
}

// ── RENDER SELECTED PLAYERS / PICKS ──────────────
function refreshTradeBlock(side) {
  const proposal = side === "a" ? _proposalA : _proposalB;
  const team     = _teams.find(t => t.id === proposal.teamId);

  // Giocatori
  const playersEl = document.getElementById(`trade-players-${side}`);
  const totalEl   = document.getElementById(`trade-total-${side}`);
  if (playersEl) {
    if (!proposal.players.length) {
      playersEl.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:8px 0">Nessun giocatore selezionato</div>`;
    } else {
      const total = proposal.players.reduce((s, p) => s + (p.currentCost || 0), 0);
      playersEl.innerHTML = proposal.players.map((p, i) => `
        <div class="trade-player-chip">
          <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:9px">${(p.roles||[]).join("/")}</span>
          <span style="flex:1;font-size:12px">${p.name}</span>
          <span style="color:var(--accent);font-size:11px">${p.currentCost}FM</span>
          <button class="trade-chip-remove" data-side="${side}" data-idx="${i}">✕</button>
        </div>`).join("");
      if (totalEl) totalEl.textContent = `Totale: ${total} FM`;
      // bind remove
      playersEl.querySelectorAll(".trade-chip-remove").forEach(btn => {
        btn.addEventListener("click", () => {
          const s = btn.dataset.side;
          const idx = parseInt(btn.dataset.idx);
          if (s === "a") _proposalA.players.splice(idx, 1);
          else           _proposalB.players.splice(idx, 1);
          refreshTradeBlock(s);
          validateTrade();
        });
      });
    }
  }

  // Scelte
  const picksEl = document.getElementById(`trade-picks-${side}`);
  if (picksEl) {
    if (!proposal.picks.length) {
      picksEl.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:6px 0">Nessuna scelta inclusa</div>`;
    } else {
      picksEl.innerHTML = proposal.picks.map((pk, i) => `
        <div class="trade-player-chip" style="background:rgba(245,197,24,.07)">
          <span style="font-size:11px;color:var(--accent);font-weight:700">${pk.year} · ${pk.round}° Giro</span>
          <button class="trade-chip-remove" data-side="${side}" data-idx="${i}" data-type="pick">✕</button>
        </div>`).join("");
      picksEl.querySelectorAll(".trade-chip-remove[data-type='pick']").forEach(btn => {
        btn.addEventListener("click", () => {
          const s = btn.dataset.side; const idx = parseInt(btn.dataset.idx);
          if (s === "a") _proposalA.picks.splice(idx, 1);
          else           _proposalB.picks.splice(idx, 1);
          refreshTradeBlock(s);
          validateTrade();
        });
      });
    }
  }

  validateTrade();
}

// ── PLAYER SELECTOR MODAL ─────────────────────────
function showPlayerModal(side) {
  const proposal = side === "a" ? _proposalA : _proposalB;
  const team     = _teams.find(t => t.id === proposal.teamId);
  if (!team) return;

  const usedIds = new Set(proposal.players.map(p => p.id || p.name));
  const players = Object.values(team.players || {}).filter(p => !usedIds.has(p.id || p.name));
  const modal   = document.getElementById(`trade-player-modal-${side}`);
  if (!modal) return;

  modal.innerHTML = `
    <div class="mini-modal-header">
      <span>Seleziona giocatore — ${team.name}</span>
      <button class="modal-close" id="close-pm-${side}">✕</button>
    </div>
    <input class="form-input" id="pm-search-${side}" placeholder="🔍 Cerca..." style="margin:8px 0">
    <div class="mini-modal-list" id="pm-list-${side}">
      ${players.map(p => `
        <div class="mini-modal-item" data-pid="${p.id||p.name}" data-side="${side}">
          <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:9px">${(p.roles||[]).join("/")}</span>
          <span style="flex:1;font-size:12px">${p.name}</span>
          <span style="color:var(--text2);font-size:11px">${p.team}</span>
          <span style="color:var(--accent);font-size:11px;font-weight:700">${p.currentCost}FM</span>
        </div>`).join("") || `<div style="color:var(--text2);font-size:12px;padding:12px">Nessun giocatore disponibile</div>`}
    </div>`;

  modal.classList.remove("hidden");

  document.getElementById(`close-pm-${side}`)?.addEventListener("click", () => modal.classList.add("hidden"));
  document.getElementById(`pm-search-${side}`)?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    modal.querySelectorAll(".mini-modal-item").forEach(item => {
      item.style.display = item.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });
  modal.querySelectorAll(".mini-modal-item").forEach(item => {
    item.addEventListener("click", () => {
      const pid    = item.dataset.pid;
      const player = Object.values(team.players || {}).find(p => (p.id||p.name) === pid);
      if (!player) return;
      if (side === "a") _proposalA.players.push(player);
      else              _proposalB.players.push(player);
      modal.classList.add("hidden");
      refreshTradeBlock(side);
    });
  });
}

// ── PICK SELECTOR MODAL ───────────────────────────
function showPickModal(side) {
  const proposal = side === "a" ? _proposalA : _proposalB;
  const team     = _teams.find(t => t.id === proposal.teamId);
  if (!team) return;
  if (proposal.picks.length >= 3) {
    alert("Massimo 3 scelte draft per scambio");
    return;
  }

  const currentYear = new Date().getFullYear();
  const years  = [currentYear, currentYear + 1, currentYear + 2];
  const rounds = [1, 2, 3];
  const modal  = document.getElementById(`trade-pick-modal-${side}`);
  if (!modal) return;

  const usedKeys = new Set(proposal.picks.map(pk => `${pk.year}_${pk.round}`));

  modal.innerHTML = `
    <div class="mini-modal-header">
      <span>Seleziona scelta Draft — ${team.name}</span>
      <button class="modal-close" id="close-pick-${side}">✕</button>
    </div>
    <div class="picks-selector-grid">
      <div></div>
      ${rounds.map(r => `<div class="picks-sel-header">${r}° Giro</div>`).join("")}
      ${years.map(y => `
        <div class="picks-sel-year">${y}</div>
        ${rounds.map(r => {
          const key  = `${y}_${r}`;
          const used = usedKeys.has(key);
          return `<button class="pick-sel-cell ${used ? "pick-sel-used" : ""}"
            data-year="${y}" data-round="${r}" data-side="${side}" ${used ? "disabled" : ""}>
            ${used ? "✓" : "+"}
          </button>`;
        }).join("")}`).join("")}
    </div>`;

  modal.classList.remove("hidden");
  document.getElementById(`close-pick-${side}`)?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.querySelectorAll(".pick-sel-cell:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => {
      const pk = { year: parseInt(btn.dataset.year), round: parseInt(btn.dataset.round) };
      if (side === "a") _proposalA.picks.push(pk);
      else              _proposalB.picks.push(pk);
      modal.classList.add("hidden");
      refreshTradeBlock(side);
    });
  });
}

// ── TRADE VALIDATION ──────────────────────────────
function validateTrade() {
  const el       = document.getElementById("trade-validation");
  const sendBtn  = document.getElementById("trade-send-btn");
  if (!el) return;

  const teamA    = _teams.find(t => t.id === _proposalA.teamId);
  const teamB    = _teams.find(t => t.id === _proposalB.teamId);

  if (!teamA || !teamB) {
    el.textContent = ""; el.className = "trade-valid-msg";
    if (sendBtn) sendBtn.disabled = true;
    return;
  }
  if (!_proposalA.players.length && !_proposalA.picks.length &&
      !_proposalB.players.length && !_proposalB.picks.length) {
    el.textContent = "Aggiungi giocatori o scelte da scambiare";
    el.className   = "trade-valid-msg msg-warn";
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  const levelA = getCapLevel(teamA.currentCap || 0, _league.settings);
  const levelB = getCapLevel(teamB.currentCap || 0, _league.settings);

  // Luxury = no scambi
  if (levelA === "luxury" || levelB === "luxury") {
    el.textContent = `✗ ${levelA === "luxury" ? teamA.name : teamB.name} è in Luxury Tax`;
    el.className   = "trade-valid-msg msg-error";
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  // Hard cap: diff max 10 FM
  const totalA = _proposalA.players.reduce((s, p) => s + (p.currentCost||0), 0);
  const totalB = _proposalB.players.reduce((s, p) => s + (p.currentCost||0), 0);
  const diff   = Math.abs(totalA - totalB);

  if ((levelA === "hard" || levelB === "hard") && _proposalA.players.length && _proposalB.players.length && diff > 10) {
    el.textContent = `✗ Hard Cap: differenza massima 10 FM (attuale: ${diff} FM)`;
    el.className   = "trade-valid-msg msg-error";
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  // Controlla numero scelte
  if (_proposalA.picks.length > 3 || _proposalB.picks.length > 3) {
    el.textContent = "✗ Massimo 3 scelte draft per lato";
    el.className   = "trade-valid-msg msg-error";
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  // Tutto ok
  el.textContent = `✓ Scambio valido${diff > 0 ? ` · differenza ${diff} FM` : ""}`;
  el.className   = "trade-valid-msg msg-ok";
  if (sendBtn) sendBtn.disabled = false;
}

// ── SEND TRADE ────────────────────────────────────
async function sendTrade() {
  const btn   = document.getElementById("trade-send-btn");
  const teamB = _teams.find(t => t.id === _proposalB.teamId);
  if (!teamB) return;

  if (!confirm(`Inviare la proposta di scambio a ${teamB.name}?`)) return;

  btn.disabled = true; btn.textContent = "⏳ Invio...";

  try {
    const tradeRef  = push(ref(db, `leagues/${_leagueId}/trades`));
    const trade = {
      id:          tradeRef.key,
      status:      "pending",   // pending | accepted | rejected | cancelled
      createdAt:   Date.now(),
      createdBy:   _user.uid,
      teamA: {
        id:      _proposalA.teamId,
        name:    _myTeam.name,
        players: _proposalA.players.map(p => ({ id: p.id||p.name, name: p.name, roles: p.roles, currentCost: p.currentCost, team: p.team })),
        picks:   _proposalA.picks,
      },
      teamB: {
        id:      _proposalB.teamId,
        name:    teamB.name,
        players: _proposalB.players.map(p => ({ id: p.id||p.name, name: p.name, roles: p.roles, currentCost: p.currentCost, team: p.team })),
        picks:   _proposalB.picks,
      },
    };
    await set(tradeRef, trade);

    // Reset
    _proposalA = { teamId: _myTeam?.id, players: [], picks: [] };
    _proposalB = { teamId: null, players: [], picks: [] };

    // Rebuild block
    const blockB = document.getElementById("trade-block-b");
    if (blockB) blockB.innerHTML = buildTradeBlock("b", null, false);
    refreshTradeBlock("a");
    refreshTradeBlock("b");
    bindTradeBlockEvents();

    const validEl = document.getElementById("trade-validation");
    if (validEl) { validEl.textContent = "✓ Proposta inviata!"; validEl.className = "trade-valid-msg msg-ok"; }
    setTimeout(() => { if (validEl) validEl.textContent = ""; }, 3000);

    await renderProposteInviate();
  } catch(e) {
    alert("Errore: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "📤 Invia Proposta";
  }
}

// ── PROPOSTE RICEVUTE ─────────────────────────────
async function renderProposteRicevute() {
  const el = document.getElementById("proposte-ricevute-list");
  if (!el || !_myTeam) return;

  const snap  = await get(ref(db, `leagues/${_leagueId}/trades`));
  const all   = snap.val() || {};
  const ricevute = Object.values(all).filter(t =>
    t.teamB?.id === _myTeam.id && t.status === "pending"
  );

  if (!ricevute.length) {
    el.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:8px 0">Nessuna proposta ricevuta</div>`;
    return;
  }

  el.innerHTML = ricevute.map(trade => buildTradeCard(trade, "received")).join("");
  el.querySelectorAll("[data-trade-action]").forEach(btn => {
    btn.addEventListener("click", () => handleTradeAction(btn.dataset.tradeId, btn.dataset.tradeAction));
  });
}

async function renderProposteInviate() {
  const el = document.getElementById("proposte-inviate-list");
  if (!el || !_myTeam) return;

  const snap   = await get(ref(db, `leagues/${_leagueId}/trades`));
  const all    = snap.val() || {};
  const inviate = Object.values(all).filter(t =>
    t.teamA?.id === _myTeam.id && t.status === "pending"
  );

  if (!inviate.length) {
    el.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:8px 0">Nessuna proposta in attesa</div>`;
    return;
  }

  el.innerHTML = inviate.map(trade => buildTradeCard(trade, "sent")).join("");
  el.querySelectorAll("[data-trade-action='cancel']").forEach(btn => {
    btn.addEventListener("click", () => handleTradeAction(btn.dataset.tradeId, "cancel"));
  });
}

async function renderStorico() {
  const el = document.getElementById("storico-list");
  if (!el || !_myTeam) return;

  const snap = await get(ref(db, `leagues/${_leagueId}/trades`));
  const all  = snap.val() || {};
  const done = Object.values(all)
    .filter(t => t.status !== "pending" && (t.teamA?.id === _myTeam.id || t.teamB?.id === _myTeam.id))
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

  if (!done.length) {
    el.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:8px 0">Nessuno scambio completato</div>`;
    return;
  }
  el.innerHTML = done.map(trade => buildTradeCard(trade, "history")).join("");
}

// ── TRADE CARD ────────────────────────────────────
function buildTradeCard(trade, mode) {
  const isReceived = mode === "received";
  const isSent     = mode === "sent";
  const isHistory  = mode === "history";

  const statusColor = {
    pending:   "var(--orange)",
    accepted:  "var(--green)",
    rejected:  "var(--red)",
    cancelled: "var(--text3)",
  }[trade.status] || "var(--text2)";

  const statusLabel = {
    pending:   "⏳ In attesa",
    accepted:  "✓ Accettato",
    rejected:  "✗ Rifiutato",
    cancelled: "× Annullato",
  }[trade.status] || trade.status;

  const date = new Date(trade.createdAt).toLocaleString("it-IT", {
    day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit"
  });

  return `
    <div class="trade-card">
      <div class="trade-card-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:14px">${trade.teamA.name}</span>
          <span style="color:var(--text3)">⇄</span>
          <span style="font-weight:700;font-size:14px">${trade.teamB.name}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:${statusColor};font-weight:700">${statusLabel}</span>
          <span style="font-size:11px;color:var(--text3)">${date}</span>
        </div>
      </div>

      <div class="trade-card-body">
        ${buildTradeSide(trade.teamA, "cede")}
        <div style="font-size:20px;color:var(--text3);align-self:center">⇄</div>
        ${buildTradeSide(trade.teamB, "cede")}
      </div>

      ${trade.status === "pending" ? `
      <div class="trade-card-actions">
        ${isReceived ? `
          <button class="btn btn-primary btn-sm" data-trade-id="${trade.id}" data-trade-action="accept">✓ Accetta</button>
          <button class="btn btn-danger btn-sm"  data-trade-id="${trade.id}" data-trade-action="reject">✗ Rifiuta</button>` : ""}
        ${isSent ? `
          <button class="btn btn-ghost btn-sm" data-trade-id="${trade.id}" data-trade-action="cancel">× Annulla</button>` : ""}
      </div>` : ""}
    </div>`;
}

function buildTradeSide(side, label) {
  return `
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">
        ${side.name} ${label}:
      </div>
      ${(side.players||[]).map(p => `
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px">
          <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:9px">${(p.roles||[]).join("/")}</span>
          <span style="flex:1">${p.name}</span>
          <span style="color:var(--accent)">${p.currentCost}FM</span>
        </div>`).join("")}
      ${(side.picks||[]).map(pk => `
        <div style="font-size:12px;color:var(--accent);margin-bottom:4px">
          📝 ${pk.year} · ${pk.round}° Giro
        </div>`).join("")}
      ${!side.players?.length && !side.picks?.length
        ? `<div style="color:var(--text3);font-size:12px">Nulla</div>` : ""}
      ${side.players?.length ? `
        <div style="font-size:11px;color:var(--text2);margin-top:4px">
          Totale: ${(side.players||[]).reduce((s,p)=>s+(p.currentCost||0),0)} FM
        </div>` : ""}
    </div>`;
}

// ── HANDLE TRADE ACTION ───────────────────────────
async function handleTradeAction(tradeId, action) {
  const snap  = await get(ref(db, `leagues/${_leagueId}/trades/${tradeId}`));
  const trade = snap.val();
  if (!trade) return;

  if (action === "cancel") {
    if (!confirm("Annullare questa proposta?")) return;
    await update(ref(db, `leagues/${_leagueId}/trades/${tradeId}`), {
      status: "cancelled", updatedAt: Date.now(),
    });
  }

  if (action === "reject") {
    if (!confirm("Rifiutare questa proposta?")) return;
    await update(ref(db, `leagues/${_leagueId}/trades/${tradeId}`), {
      status: "rejected", updatedAt: Date.now(),
    });
  }

  if (action === "accept") {
    if (!confirm(`Accettare lo scambio con ${trade.teamA.name}? Lo scambio diventerà ufficiale.`)) return;

    try {
      // Esegui lo scambio: sposta giocatori e scelte tra le rose
      const updates = {};

      // Giocatori teamA → teamB
      for (const p of (trade.teamA.players || [])) {
        updates[`leagues/${_leagueId}/teams/${trade.teamA.id}/players/${p.id}`] = null;
        updates[`leagues/${_leagueId}/teams/${trade.teamB.id}/players/${p.id}`] = {
          ...p, addedBy: "trade", addedAt: Date.now(),
        };
      }
      // Giocatori teamB → teamA
      for (const p of (trade.teamB.players || [])) {
        updates[`leagues/${_leagueId}/teams/${trade.teamB.id}/players/${p.id}`] = null;
        updates[`leagues/${_leagueId}/teams/${trade.teamA.id}/players/${p.id}`] = {
          ...p, addedBy: "trade", addedAt: Date.now(),
        };
      }

      // Scelte draft teamA → teamB
      for (const pk of (trade.teamA.picks || [])) {
        const key = `${pk.year}_round${pk.round}`;
        const pickData = {
          year: pk.year, round: pk.round,
          fromTeamId: trade.teamA.id, fromTeamName: trade.teamA.name,
          ownerTeamId: trade.teamB.id, ownerTeamName: trade.teamB.name,
          transferredAt: Date.now(),
        };
        updates[`leagues/${_leagueId}/teams/${trade.teamB.id}/draftPicks/${key}`] = pickData;
        updates[`leagues/${_leagueId}/teams/${trade.teamA.id}/draftPicks/${key}`] = { ...pickData, traded: true };
      }
      // Scelte draft teamB → teamA
      for (const pk of (trade.teamB.picks || [])) {
        const key = `${pk.year}_round${pk.round}`;
        const pickData = {
          year: pk.year, round: pk.round,
          fromTeamId: trade.teamB.id, fromTeamName: trade.teamB.name,
          ownerTeamId: trade.teamA.id, ownerTeamName: trade.teamA.name,
          transferredAt: Date.now(),
        };
        updates[`leagues/${_leagueId}/teams/${trade.teamA.id}/draftPicks/${key}`] = pickData;
        updates[`leagues/${_leagueId}/teams/${trade.teamB.id}/draftPicks/${key}`] = { ...pickData, traded: true };
      }

      // Ricalcola cap per entrambe le squadre
      const [snapA, snapB] = await Promise.all([
        get(ref(db, `leagues/${_leagueId}/teams/${trade.teamA.id}/players`)),
        get(ref(db, `leagues/${_leagueId}/teams/${trade.teamB.id}/players`)),
      ]);
      // Applica prima gli updates poi ricalcola (semplificato: ricalcola dopo)
      await update(ref(db), updates);

      // Ricalcola cap
      const [snapA2, snapB2] = await Promise.all([
        get(ref(db, `leagues/${_leagueId}/teams/${trade.teamA.id}/players`)),
        get(ref(db, `leagues/${_leagueId}/teams/${trade.teamB.id}/players`)),
      ]);
      const capA = Object.values(snapA2.val() || {}).reduce((s,p) => s+(p.currentCost||0), 0);
      const capB = Object.values(snapB2.val() || {}).reduce((s,p) => s+(p.currentCost||0), 0);
      await update(ref(db, `leagues/${_leagueId}/teams/${trade.teamA.id}`), {
        currentCap: capA, capLevel: getCapLevel(capA, _league.settings),
      });
      await update(ref(db, `leagues/${_leagueId}/teams/${trade.teamB.id}`), {
        currentCap: capB, capLevel: getCapLevel(capB, _league.settings),
      });

      // Segna come accettato
      await update(ref(db, `leagues/${_leagueId}/trades/${tradeId}`), {
        status: "accepted", updatedAt: Date.now(),
      });
    } catch(e) {
      alert("Errore nell'esecuzione dello scambio: " + e.message);
      return;
    }
  }

  // Refresh
  await renderProposteRicevute();
  await renderProposteInviate();
  await renderStorico();
}

// ── EVENTS ────────────────────────────────────────
async function bindScambiEvents() {
  // Selezione manager B
  document.getElementById("trade-team-b-select")?.addEventListener("change", async e => {
    const teamId = e.target.value;
    _proposalB   = { teamId, players: [], picks: [] };
    const team   = _teams.find(t => t.id === teamId);

    // Aggiorna header block B
    const capEl = document.getElementById("trade-cap-b");
    if (capEl && team) capEl.innerHTML = buildCapInfo(team);

    // Abilita bottoni
    document.getElementById("trade-add-player-b-btn")?.removeAttribute("disabled");
    document.getElementById("trade-add-pick-b-btn")?.removeAttribute("disabled");

    refreshTradeBlock("b");
  });

  bindTradeBlockEvents();

  // Invia
  document.getElementById("trade-send-btn")?.addEventListener("click", sendTrade);

  // Refresh
  document.getElementById("refresh-ricevute-btn")?.addEventListener("click", renderProposteRicevute);
  document.getElementById("refresh-inviate-btn")?.addEventListener("click", renderProposteInviate);
}

function bindTradeBlockEvents() {
  ["a","b"].forEach(side => {
    document.getElementById(`trade-add-player-${side}-btn`)?.addEventListener("click", () => showPlayerModal(side));
    document.getElementById(`trade-add-pick-${side}-btn`)?.  addEventListener("click", () => showPickModal(side));
  });
}
