// ============================================================
// FANTADRAFT — draft.js
// Draft con presenza online, timer 3 min, skip automatico,
// vincolo FM. Contratti assegnati in Rose dopo il draft.
// ============================================================

import { db, ref, get, set, push, update, onValue, off } from "./firebase.js";
import { roleColor, macroRole, normalizeName, calcAge } from "./utils.js";

const TURN_SECONDS = 180; // 3 minuti

// ── STATE ────────────────────────────────────────
let _leagueId      = null;
let _league        = null;
let _user          = null;
let _myTeam        = null;
let _teams         = [];
let _isAdmin       = false;
let _draftType     = "estivo";
let _draftListener = null;
let _presenceInt   = null;
let _timerInt      = null;
let _dbPlayers     = {};
let _searchFilter  = "";
let _roleFilter    = "all";

// ── INIT ─────────────────────────────────────────
export async function renderDraft(leagueId, league, user) {
  _leagueId = leagueId;
  _league   = league;
  _user     = user;
  _teams    = Object.values(league.teams || {});
  _myTeam   = _teams.find(t => t.ownerUid === user.uid);
  _isAdmin  = league.commissionerUid === user.uid;

  const el = document.getElementById("tab-draft");

  const [dbSnap, draftSnap, lotterySnap, scoresSnap, scheduleSnap] = await Promise.all([
    get(ref(db, `db_giocatori/${leagueId}`)),
    get(ref(db, `leagues/${leagueId}/draftState`)),
    get(ref(db, `leagues/${leagueId}/lottery`)),
    get(ref(db, `leagues/${leagueId}/scores`)),
    get(ref(db, `leagues/${leagueId}/schedule`)),
  ]);

  _dbPlayers        = dbSnap.val()    || {};
  const draftState  = draftSnap.val();
  const lotteryData = lotterySnap.val()  || {};
  const scores      = scoresSnap.val()   || {};
  const schedule    = scheduleSnap.val() || {};
  const standings   = calcStandings(_teams, scores, schedule);
  const draftOrder  = buildDraftOrder(standings, lotteryData, draftState);

  el.innerHTML = buildDraftHTML(draftState, draftOrder, standings, lotteryData);
  bindDraftEvents(leagueId, draftState, draftOrder, standings);
  _startPresence(leagueId);
  _startDraftListener(leagueId, standings, lotteryData);
}

export function destroyDraft() {
  if (_draftListener) { off(ref(db, `leagues/${_leagueId}/draftState`)); _draftListener = null; }
  if (_presenceInt)   { clearInterval(_presenceInt); _presenceInt = null; }
  if (_timerInt)      { clearInterval(_timerInt);    _timerInt    = null; }
  if (_leagueId && _myTeam) {
    set(ref(db, `leagues/${_leagueId}/draftPresence/${_myTeam.id}`), null).catch(() => {});
  }
}

// ── PRESENZA ──────────────────────────────────────
function _startPresence(leagueId) {
  if (!_myTeam) return;
  const presRef = ref(db, `leagues/${leagueId}/draftPresence/${_myTeam.id}`);
  const beat = () => set(presRef, {
    uid: _user.uid, name: _myTeam.ownerName,
    ts: Date.now(), ready: false,
  });
  beat();
  _presenceInt = setInterval(beat, 15000);
  window.addEventListener("beforeunload", () => set(presRef, null));
}

async function setReady(leagueId, ready) {
  if (!_myTeam) return;
  const snap = await get(ref(db, `leagues/${leagueId}/draftPresence/${_myTeam.id}`));
  await set(ref(db, `leagues/${leagueId}/draftPresence/${_myTeam.id}`), {
    ...(snap.val()||{}), ready, ts: Date.now(),
  });
}

// ── STANDINGS ─────────────────────────────────────
function calcStandings(teams, scores, schedule) {
  const map = {};
  for (const t of teams) map[t.id] = { team:t, pt:0, v:0, fp:0 };
  for (const [gw, matches] of Object.entries(schedule)) {
    if (parseInt(gw) > 34) continue;
    for (const m of (matches||[])) {
      const h = scores[m.homeId]?.[gw]; const a = scores[m.awayId]?.[gw];
      if (!h||!a||!map[m.homeId]||!map[m.awayId]) continue;
      map[m.homeId].fp += h.fp||0; map[m.awayId].fp += a.fp||0;
      if ((h.fp||0)>(a.fp||0))      { map[m.homeId].v++; map[m.homeId].pt+=3; }
      else if ((a.fp||0)>(h.fp||0)) { map[m.awayId].v++; map[m.awayId].pt+=3; }
      else { map[m.homeId].pt++; map[m.awayId].pt++; }
    }
  }
  return Object.values(map).sort((a,b)=>(b.pt-a.pt)||(b.v-a.v)||(b.fp-a.fp));
}

// ── DRAFT ORDER ───────────────────────────────────
function buildDraftOrder(standings, lotteryData, draftState) {
  if (draftState?.order) return draftState.order;
  const reverse     = [...standings].reverse();
  const r1Results   = lotteryData?.results || [];
  const lotteryDone = r1Results.length >= 3;
  let round1 = [];
  if (lotteryDone) {
    const picked = new Set(r1Results.map(r => r.teamId));
    const rest   = reverse.filter(s => !picked.has(s.team.id));
    round1 = [
      ...r1Results.map(r => standings.find(s=>s.team.id===r.teamId)?.team).filter(Boolean),
      ...rest.map(s=>s.team),
    ];
  } else {
    round1 = reverse.map(s=>s.team);
  }
  return { round1, rest: reverse.map(s=>s.team), n: standings.length };
}

// ── CURRENT PICK ──────────────────────────────────
function getCurrentPick(draftState, draftOrder) {
  const picks = Object.values(draftState?.picks||{}).length;
  const n     = draftOrder.n || _teams.length;
  if (!n) return null;
  const round      = Math.floor(picks/n);
  const posInRound = picks%n;
  const order      = round===0 ? draftOrder.round1 : draftOrder.rest;
  const team       = order?.[posInRound];
  return { team, round:round+1, posInRound:posInRound+1, totalPicks:picks };
}

// ── FREE AGENTS ───────────────────────────────────
function getFreeAgents(draftState) {
  const rostered = new Set();
  for (const t of _teams)
    for (const p of Object.values(t.players||{}))
      rostered.add(normalizeName(p.name));
  for (const pick of Object.values(draftState?.picks||{}))
    if (pick.playerName && !pick.skipped) rostered.add(normalizeName(pick.playerName));

  return Object.values(_dbPlayers).filter(p => {
    const free   = !rostered.has(normalizeName(p.name));
    const roleOk = _roleFilter==="all" || macroRole(p.roles?.[0])===_roleFilter;
    const srchOk = !_searchFilter || p.name.toLowerCase().includes(_searchFilter.toLowerCase());
    return free && roleOk && srchOk;
  }).sort((a,b) => (b.costo||b.quotazione||0)-(a.costo||a.quotazione||0));
}

// ── TIMER UI ──────────────────────────────────────
function startTimer(turnStartedAt) {
  if (_timerInt) clearInterval(_timerInt);
  _timerInt = setInterval(async () => {
    const elapsed   = Math.floor((Date.now()-turnStartedAt)/1000);
    const remaining = Math.max(0, TURN_SECONDS-elapsed);
    const el = document.getElementById("draft-timer");
    if (!el) { clearInterval(_timerInt); return; }
    const m = String(Math.floor(remaining/60)).padStart(2,"0");
    const s = String(remaining%60).padStart(2,"0");
    el.textContent = `${m}:${s}`;
    el.className   = `draft-timer ${remaining<=30?"timer-urgent":remaining<=60?"timer-warn":""}`;
    if (remaining===0 && _isAdmin) { clearInterval(_timerInt); await autoSkip(); }
  }, 1000);
}

async function autoSkip() {
  const snap = await get(ref(db, `leagues/${_leagueId}/draftState`));
  const ds   = snap.val();
  if (ds?.status!=="active") return;
  const order = ds.order || buildDraftOrder([],{},ds);
  const cp    = getCurrentPick(ds, order);
  if (!cp?.team) return;
  await push(ref(db, `leagues/${_leagueId}/draftState/picks`), {
    teamId: cp.team.id, playerName:"SKIP", skipped:true,
    round:cp.round, posInRound:cp.posInRound, pickedAt:Date.now(),
  });
  await update(ref(db, `leagues/${_leagueId}/draftState`), { turnStartedAt:Date.now() });
}

// ── CONFIRM PICK ──────────────────────────────────
async function confirmPick(player, teamId, round, posInRound) {
  const cost     = player.costo || player.quotazione || 1;
  const team     = _teams.find(t=>t.id===teamId);
  const capUsed  = Object.values(team?.players||{}).reduce((s,p)=>s+(p.currentCost||0),0);
  const maxSpend = (_league.settings?.salaryCap||320) - capUsed;

  if (cost > maxSpend) {
    alert(`FM insufficienti! Puoi spendere al massimo ${maxSpend} FM, questo giocatore costa ${cost} FM.`);
    return;
  }
  if (!confirm(`Scegliere ${player.name} (${cost} FM)?`)) return;

  try {
    const playerRef = push(ref(db, `leagues/${_leagueId}/teams/${teamId}/players`));
    const pid       = playerRef.key;
    const age       = player.dataNascita ? calcAge(player.dataNascita) : null;

    await set(playerRef, {
      id: pid, name: player.name, team: player.team,
      roles: player.roles||[], draftCost: cost, currentCost: cost,
      contractYears: null,       // assegnato in Rose
      contractYearsDone: 0,
      under21: age!==null && age<=21,
      dataNascita: player.dataNascita||null,
      bandiera: false,
      addedBy:"draft", addedAt:Date.now(),
      draftRound:round, draftPosInRound:posInRound,
    });

    const newCap = capUsed + cost;
    await update(ref(db, `leagues/${_leagueId}/teams/${teamId}`), {
      currentCap: newCap,
      capLevel: getCapLevel(newCap, _league.settings),
    });

    await push(ref(db, `leagues/${_leagueId}/draftState/picks`), {
      teamId, playerName:player.name, playerTeam:player.team,
      roles:player.roles||[], cost, round, posInRound, pickedAt:Date.now(),
    });
    await update(ref(db, `leagues/${_leagueId}/draftState`), { turnStartedAt:Date.now() });

    // Check completamento
    const snaps = await Promise.all(_teams.map(t=>get(ref(db,`leagues/${_leagueId}/teams/${t.id}/players`))));
    const min   = _league.settings?.minRosterSize||23;
    if (snaps.every(s=>Object.keys(s.val()||{}).length>=min)) {
      await update(ref(db, `leagues/${_leagueId}/draftState`), { status:"done" });
    }
  } catch(e) { alert("Errore: "+e.message); }
}

// ── HTML ──────────────────────────────────────────
function buildDraftHTML(draftState, draftOrder, standings, lotteryData) {
  const status     = draftState?.status||"idle";
  const picks      = Object.values(draftState?.picks||{});
  const cp         = status==="active" ? getCurrentPick(draftState,draftOrder) : null;
  const isMyTurn   = cp?.team?.id===_myTeam?.id;
  const lotteryDone = (lotteryData?.results||[]).length>=3;
  const capUsed    = _myTeam ? Object.values(_myTeam.players||{}).reduce((s,p)=>s+(p.currentCost||0),0) : 0;
  const maxSpend   = (_league.settings?.salaryCap||320) - capUsed;

  return `
    <div class="page-header"><span class="ph-icon">📝</span><h1>Draft</h1></div>

    <div class="draft-type-tabs" style="margin-bottom:16px">
      <button class="draft-type-tab ${_draftType==="estivo"?"active":""}" data-type="estivo">🌞 Draft Estivo</button>
      <button class="draft-type-tab ${_draftType==="riparazione"?"active":""}" data-type="riparazione">🔧 Draft di Riparazione</button>
    </div>

    <!-- SALA D'ATTESA -->
    ${status==="idle"||status==="paused"||!status ? buildLobbyHTML(draftState, lotteryDone) : ""}

    <!-- DRAFT ATTIVO / DONE -->
    ${status==="active"||status==="paused"||status==="done" ? `
    <div id="draft-active-panel">
      <div class="draft-status-bar" id="draft-status-bar">${buildStatusBar(draftState,cp,isMyTurn)}</div>

      ${isMyTurn&&status==="active" ? `
      <div class="draft-my-turn-banner">
        🎯 È IL TUO TURNO! Hai <span id="draft-timer" class="draft-timer">03:00</span> per scegliere
      </div>` : ""}

      <div class="draft-main">
        <div class="draft-left">
          <div class="card card-sm" style="margin-bottom:12px">
            <div class="draft-col-label">Ordine — Giro ${cp?.round||1}</div>
            <div id="draft-order-list">${buildOrderList(draftOrder,draftState,cp)}</div>
          </div>
          <div class="card card-sm">
            <div class="draft-col-label">Pick (${picks.filter(p=>!p.skipped).length})</div>
            <div class="draft-picks-log" id="draft-picks-log">${buildPicksLog(picks)}</div>
          </div>
        </div>

        <div class="draft-right">
          ${status!=="done" ? `
          <div class="draft-budget-bar">
            💰 Il tuo budget disponibile: <strong style="color:var(--accent)">${maxSpend} FM</strong>
            <span style="color:var(--text2);font-size:12px">(${capUsed}/${_league.settings?.salaryCap||320} FM usati)</span>
          </div>
          <div class="draft-search-bar">
            <input class="form-input" id="draft-search" placeholder="🔍 Cerca giocatore..." value="${_searchFilter}">
            <div class="role-filter-btns" style="margin-top:8px">
              ${["all","P","D","C","A"].map(r=>`<button class="role-btn ${r===_roleFilter?"active":""}" data-role="${r}">${r==="all"?"Tutti":r}</button>`).join("")}
            </div>
          </div>
          <div class="draft-players-list" id="draft-players-list">
            ${buildPlayersList(draftState,draftOrder,status==="active",isMyTurn,maxSpend)}
          </div>` : `
          <div class="empty-state" style="padding:40px">
            <div class="es-icon">🎉</div>
            <h3>Draft completato!</h3>
            <p>${picks.filter(p=>!p.skipped).length} giocatori selezionati.</p>
            <p style="margin-top:8px;color:var(--orange)">
              ⚠ Vai nella tab <strong>Rose</strong> per assegnare i contratti entro il termine.
            </p>
          </div>`}
          ${_isAdmin ? buildAdminControls(draftState,lotteryDone) : ""}
        </div>
      </div>
    </div>` : ""}
  `;
}

function buildLobbyHTML(draftState, lotteryDone) {
  return `
    <div class="card" style="margin-bottom:16px">
      <h3 style="font-size:15px;margin-bottom:14px">👥 Sala d'attesa</h3>
      <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
        Clicca "Sono pronto" quando sei connesso e pronto a draftare.
        Il commissioner potrà avviare il draft solo quando tutti i manager sono pronti.
      </p>
      <div id="presence-list" class="presence-grid">
        ${_teams.map(t=>`
          <div class="presence-item" id="presence-${t.id}">
            <span class="presence-dot presence-offline"></span>
            <span class="presence-name">${t.ownerName}</span>
            <span class="presence-team" style="color:var(--text2);font-size:11px">${t.name}</span>
            <span class="presence-status">Offline</span>
          </div>`).join("")}
      </div>
      ${_myTeam ? `
      <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="ready-btn">✋ Sono pronto</button>
        <button class="btn btn-ghost btn-sm" id="not-ready-btn">✗ Non sono pronto</button>
        <span id="ready-status" style="font-size:13px"></span>
      </div>` : ""}
      ${_isAdmin && !lotteryDone ? `
      <div style="margin-top:12px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2);border-radius:8px;padding:10px;font-size:12px;color:var(--orange)">
        ⚠ Lottery non eseguita — ordine giro 1 sarà inverso classifica.
      </div>` : ""}
      ${_isAdmin ? `
      <div style="margin-top:12px">
        <button class="btn btn-primary" id="draft-start-btn" disabled title="Attendi che tutti siano pronti">
          ▶ Avvia Draft
        </button>
        <span style="font-size:12px;color:var(--text2);margin-left:8px" id="start-hint">
          In attesa che tutti i manager siano pronti…
        </span>
      </div>` : ""}
    </div>`;
}

function buildStatusBar(draftState, cp, isMyTurn) {
  const status = draftState?.status;
  if (status==="done")   return `<span style="color:var(--green)">✓ Draft completato</span>`;
  if (status==="paused") return `<span style="color:var(--orange)">⏸ Draft in pausa</span>`;
  if (!cp?.team)         return `<span style="color:var(--text2)">🔄 Calcolo turno...</span>`;
  const elapsed   = Math.floor((Date.now()-(draftState?.turnStartedAt||Date.now()))/1000);
  const remaining = Math.max(0, TURN_SECONDS-elapsed);
  const m = String(Math.floor(remaining/60)).padStart(2,"0");
  const s = String(remaining%60).padStart(2,"0");
  return `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <span style="color:var(--text2);font-size:12px">Giro ${cp.round} · Pick ${cp.totalPicks+1}</span>
        <div style="font-weight:700;font-size:14px;margin-top:2px">
          ${isMyTurn ? "🎯 Il tuo turno!" : `🕐 Turno di ${cp.team.ownerName||cp.team.name}`}
        </div>
      </div>
      <div class="draft-timer-wrap">
        <span style="font-size:11px;color:var(--text2)">Tempo</span>
        <span id="draft-timer" class="draft-timer ${remaining<=30?"timer-urgent":remaining<=60?"timer-warn":""}">${m}:${s}</span>
      </div>
    </div>`;
}

function buildOrderList(draftOrder, draftState, cp) {
  const totalPicks = Object.values(draftState?.picks||{}).length;
  const n          = draftOrder.n||_teams.length;
  const round      = cp ? cp.round-1 : 0;
  const order      = (round===0 ? draftOrder.round1 : draftOrder.rest)||[];
  const doneCount  = totalPicks%n;
  return order.slice(0,10).map((team,i) => `
    <div class="draft-order-item ${i===doneCount?"order-current":""} ${i<doneCount?"order-done":""}">
      <span class="order-pos">${i+1}</span>
      <span class="order-name ${team?.id===_myTeam?.id?"order-me":""}">${team?.ownerName||"—"}</span>
      ${i===doneCount ? `<span class="live-badge" style="font-size:9px;padding:1px 6px">NOW</span>` : ""}
      ${i<doneCount   ? `<span style="color:var(--text3);font-size:11px">✓</span>` : ""}
    </div>`).join("");
}

function buildPicksLog(picks) {
  const real = picks.filter(p=>!p.skipped).reverse().slice(0,25);
  if (!real.length) return `<div style="color:var(--text3);font-size:12px;padding:8px 0">Nessun pick</div>`;
  return real.map(p => {
    const team = _teams.find(t=>t.id===p.teamId);
    return `<div class="pick-log-item">
      <span class="pick-log-round">G${p.round}.${p.posInRound}</span>
      <span class="pick-log-player">
        <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:8px">${(p.roles||[]).join("/")}</span>
        ${p.playerName}
      </span>
      <span class="pick-log-team">${team?.ownerName||"—"}</span>
      <span class="pick-log-cost">${p.cost}FM</span>
    </div>`;
  }).join("");
}

function buildPlayersList(draftState, draftOrder, isActive, isMyTurn, maxSpend) {
  const agents = getFreeAgents(draftState);
  if (!agents.length) return `<div class="empty-state" style="padding:24px"><div class="es-icon">🎉</div><h3>Nessun giocatore libero</h3></div>`;
  const cp = getCurrentPick(draftState, draftOrder);
  return agents.map(p => {
    const cost       = p.costo||p.quotazione||1;
    const age        = p.dataNascita ? calcAge(p.dataNascita) : null;
    const isU21      = age!==null && age<=21;
    const cantAfford = cost > maxSpend;
    const canPick    = isActive && isMyTurn && !cantAfford;
    const adminPick  = _isAdmin && isActive && !cantAfford && !isMyTurn;
    return `
      <div class="draft-player-row ${cantAfford?"draft-cant-afford":""}">
        <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:10px;flex-shrink:0">${(p.roles||[]).join("/")}</span>
        <div class="draft-player-info">
          <span class="draft-player-name">${p.name}</span>
          <span class="draft-player-sub">${p.team}${age!==null?` · ${age} anni`:""}${isU21?" 🔵":""}</span>
        </div>
        <span class="draft-player-cost ${cantAfford?"cost-red":""}">${cost} FM</span>
        ${canPick    ? `<button class="btn btn-primary  btn-sm draft-pick-btn"       data-pid="${p.id||p.name}">Scegli</button>` : ""}
        ${adminPick  ? `<button class="btn btn-secondary btn-sm draft-pick-btn-admin" data-pid="${p.id||p.name}">Pick</button>`  : ""}
        ${cantAfford ? `<span style="font-size:10px;color:var(--red);flex-shrink:0">FM insuff.</span>` : ""}
      </div>`;
  }).join("");
}

function buildAdminControls(draftState, lotteryDone) {
  const status = draftState?.status||"idle";
  return `
    <div class="card card-sm" style="margin-top:12px;border-color:rgba(245,197,24,.2)">
      <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">⚙️ Admin</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${status==="active" ? `
          <button class="btn btn-secondary btn-sm" id="draft-pause-btn">⏸ Pausa</button>
          <button class="btn btn-ghost    btn-sm" id="draft-skip-btn">⏭ Salta turno</button>
          <button class="btn btn-danger   btn-sm" id="draft-end-btn">⏹ Termina</button>` : ""}
        ${status==="paused" ? `
          <button class="btn btn-primary btn-sm" id="draft-resume-btn">▶ Riprendi</button>
          <button class="btn btn-danger  btn-sm" id="draft-end-btn">⏹ Termina</button>` : ""}
        ${status==="done" ? `
          <button class="btn btn-ghost btn-sm" id="draft-reset-btn">↺ Reset</button>` : ""}
      </div>
      <div id="draft-admin-error" class="form-error" style="margin-top:6px"></div>
    </div>`;
}

// ── LISTENER REAL-TIME ────────────────────────────
function _startDraftListener(leagueId, standings, lotteryData) {
  if (_draftListener) off(ref(db, `leagues/${leagueId}/draftState`));

  // Presenza
  onValue(ref(db, `leagues/${leagueId}/draftPresence`), snap => {
    const presence = snap.val()||{};
    const now = Date.now();
    _teams.forEach(t => {
      const p    = presence[t.id];
      const item = document.getElementById(`presence-${t.id}`);
      if (!item) return;
      const online = p && (now-p.ts)<30000;
      const ready  = online && p.ready;
      item.querySelector(".presence-dot").className =
        `presence-dot ${ready?"presence-ready":online?"presence-online":"presence-offline"}`;
      item.querySelector(".presence-status").textContent =
        ready ? "✓ Pronto" : online ? "Online" : "Offline";
    });
    // Abilita start solo se tutti pronti
    const startBtn = document.getElementById("draft-start-btn");
    if (startBtn && _isAdmin) {
      const allReady = _teams.every(t => {
        const p = presence[t.id];
        return p && (now-p.ts)<30000 && p.ready;
      });
      startBtn.disabled = !allReady;
      const hint = document.getElementById("start-hint");
      if (hint) hint.textContent = allReady
        ? "✓ Tutti pronti — puoi avviare!"
        : `In attesa… (${_teams.filter(t=>{const p=presence[t.id];return p&&(now-p.ts)<30000&&p.ready;}).length}/${_teams.length} pronti)`;
    }
  });

  // Draft state
  _draftListener = onValue(ref(db, `leagues/${leagueId}/draftState`), snap => {
    const ds     = snap.val();
    if (!ds) return;
    const order  = ds.order || buildDraftOrder(standings, lotteryData, ds);
    const cp     = ds.status==="active" ? getCurrentPick(ds, order) : null;
    const isMe   = cp?.team?.id===_myTeam?.id;
    const capUsed = Object.values(_myTeam?.players||{}).reduce((s,p)=>s+(p.currentCost||0),0);
    const maxSpend = (_league.settings?.salaryCap||320)-capUsed;

    const statusBar = document.getElementById("draft-status-bar");
    if (statusBar) statusBar.innerHTML = buildStatusBar(ds,cp,isMe);

    const logEl = document.getElementById("draft-picks-log");
    if (logEl) logEl.innerHTML = buildPicksLog(Object.values(ds.picks||{}));

    const listEl = document.getElementById("draft-players-list");
    if (listEl) listEl.innerHTML = buildPlayersList(ds,order,ds.status==="active",isMe,maxSpend);

    const orderEl = document.getElementById("draft-order-list");
    if (orderEl) orderEl.innerHTML = buildOrderList(order,ds,cp);

    if (ds.status==="active" && ds.turnStartedAt) startTimer(ds.turnStartedAt);
    else { if (_timerInt) { clearInterval(_timerInt); _timerInt=null; } }

    // Banner mio turno
    const banner = document.querySelector(".draft-my-turn-banner");
    if (isMe && ds.status==="active" && !banner) {
      const searchBar = document.querySelector(".draft-search-bar");
      if (searchBar) {
        const b = document.createElement("div");
        b.className = "draft-my-turn-banner";
        b.innerHTML = `🎯 È IL TUO TURNO! Hai <span id="draft-timer" class="draft-timer">03:00</span> per scegliere`;
        searchBar.parentNode.insertBefore(b, searchBar);
      }
    } else if (!isMe && banner) banner.remove();

    bindDynamicEvents(ds, order, isMe, cp);
  });
}

// ── EVENTS ────────────────────────────────────────
function bindDraftEvents(leagueId, draftState, draftOrder, standings) {
  document.querySelectorAll(".draft-type-tab").forEach(btn =>
    btn.addEventListener("click", () => {
      _draftType = btn.dataset.type;
      document.querySelectorAll(".draft-type-tab").forEach(b => b.classList.toggle("active", b.dataset.type===_draftType));
    })
  );

  document.getElementById("ready-btn")?.addEventListener("click", async () => {
    await setReady(leagueId, true);
    const el = document.getElementById("ready-status");
    if (el) { el.textContent="✓ Sei pronto!"; el.style.color="var(--green)"; }
  });
  document.getElementById("not-ready-btn")?.addEventListener("click", async () => {
    await setReady(leagueId, false);
    const el = document.getElementById("ready-status");
    if (el) el.textContent="";
  });

  document.getElementById("draft-start-btn")?.addEventListener("click", async () => {
    if (!confirm("Avviare il Draft?")) return;
    await set(ref(db, `leagues/${leagueId}/draftState`), {
      status:"active", type:_draftType,
      startedAt:Date.now(), turnStartedAt:Date.now(),
      picks:{}, order:draftOrder,
    });
  });

  document.getElementById("draft-search")?.addEventListener("input", e => {
    _searchFilter = e.target.value;
    _refreshList(draftState, draftOrder);
  });

  document.getElementById("tab-draft")?.addEventListener("click", e => {
    const rb = e.target.closest(".role-btn");
    if (rb) {
      _roleFilter = rb.dataset.role;
      document.querySelectorAll("#tab-draft .role-btn").forEach(b => b.classList.toggle("active", b.dataset.role===_roleFilter));
      _refreshList(draftState, draftOrder);
    }
  });

  if (_isAdmin) bindAdminControlEvents(leagueId);
  const cp = getCurrentPick(draftState, draftOrder);
  bindDynamicEvents(draftState, draftOrder, cp?.team?.id===_myTeam?.id, cp);
}

function _refreshList(draftState, draftOrder) {
  const capUsed  = Object.values(_myTeam?.players||{}).reduce((s,p)=>s+(p.currentCost||0),0);
  const maxSpend = (_league.settings?.salaryCap||320)-capUsed;
  const cp       = getCurrentPick(draftState, draftOrder);
  const isMe     = cp?.team?.id===_myTeam?.id;
  const listEl   = document.getElementById("draft-players-list");
  if (listEl) listEl.innerHTML = buildPlayersList(draftState,draftOrder,draftState?.status==="active",isMe,maxSpend);
  bindDynamicEvents(draftState, draftOrder, isMe, cp);
}

function bindDynamicEvents(draftState, draftOrder, isMyTurn, cp) {
  document.querySelectorAll(".draft-pick-btn, .draft-pick-btn-admin").forEach(btn => {
    btn.onclick = () => {
      const pid    = btn.dataset.pid;
      const player = Object.values(_dbPlayers).find(p=>(p.id||p.name)===pid||p.name===pid);
      if (!player||!cp?.team) return;
      confirmPick(player, cp.team.id, cp.round, cp.posInRound);
    };
  });
}

function bindAdminControlEvents(leagueId) {
  document.getElementById("draft-pause-btn")?.addEventListener("click",  async ()=>{ await update(ref(db,`leagues/${leagueId}/draftState`),{status:"paused"}); });
  document.getElementById("draft-resume-btn")?.addEventListener("click", async ()=>{ await update(ref(db,`leagues/${leagueId}/draftState`),{status:"active",turnStartedAt:Date.now()}); });
  document.getElementById("draft-end-btn")?.addEventListener("click",    async ()=>{ if(confirm("Terminare?")) await update(ref(db,`leagues/${leagueId}/draftState`),{status:"done"}); });
  document.getElementById("draft-reset-btn")?.addEventListener("click",  async ()=>{ if(confirm("Reset draft?")) await set(ref(db,`leagues/${leagueId}/draftState`),{status:"idle"}); });
  document.getElementById("draft-skip-btn")?.addEventListener("click",   async ()=>{ if(confirm("Saltare turno?")) await autoSkip(); });
}

function getCapLevel(cap, settings) {
  if (!settings) return "under";
  const { salaryCap, softCapMax, luxuryTaxThreshold } = settings;
  if (cap <= salaryCap)          return "under";
  if (cap <= softCapMax)         return "soft";
  if (cap <= luxuryTaxThreshold) return "hard";
  return "luxury";
}
