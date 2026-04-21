// ============================================================
// FANTADRAFT — calendario.js
// Tab Calendario: giornate fantadraft, sfide, voti live
// ============================================================

import { db, ref, get, set, update, onValue, off } from "./firebase.js";
import { SERIE_A_MATCHES } from "./matches.js";
import { fpToGoals, normalizeName } from "./utils.js";

// ── BONUS/MALUS (uguali per tutti i ruoli) ────────
const BONUS_GOL     = 3;    // +3 per ogni gol (tutti i ruoli, anche su rigore)
const BONUS_ASSIST  = 1;    // +1 per assist
const BONUS_PI      = 1;    // +1 porta inviolata (solo portiere)
const BONUS_RIG_PAR = 3;    // +3 rigore parato (solo portiere)
const MALUS_GS      = 1;    // -1 per ogni gol subito (solo portiere)
const MALUS_AMM     = 0.5;  // -0.5 ammonizione
const MALUS_ESP     = 1;    // -1 espulsione
const MALUS_AUT     = 2;    // -2 autogol
const MALUS_RIG     = 3;    // -3 rigore sbagliato

// ── STATE ────────────────────────────────────────
let _leagueId    = null;
let _league      = null;
let _user        = null;
let _currentGw   = null;
let _votiListener = null;
let _votiCache    = {};

// ── INIT ─────────────────────────────────────────
export async function renderCalendario(leagueId, league, user) {
  _leagueId = leagueId;
  _league   = league;
  _user     = user;

  const settings = league.settings || {};
  const gwStart  = settings.gwStart || 1;
  const gwEnd    = settings.gwEnd   || 34;

  // Determina giornata corrente (più vicina a oggi)
  _currentGw = _currentGw || detectCurrentGw(gwStart, gwEnd);

  const el = document.getElementById("tab-calendario");
  el.innerHTML = buildCalendarioHTML(gwStart, gwEnd);

  // Ascolta voti in tempo reale
  _startVotiListener();

  bindCalendarioEvents(gwStart, gwEnd);
  renderGiornata(_currentGw);
}

export function destroyCalendario() {
  if (_votiListener) {
    off(ref(db, `leagues/${_leagueId}/voti`));
    _votiListener = null;
  }
}

// ── DETECT CURRENT GW ─────────────────────────────
function detectCurrentGw(gwStart, gwEnd) {
  const now = Date.now();
  let bestGw = gwStart;
  let bestDiff = Infinity;

  for (let gw = gwStart; gw <= gwEnd; gw++) {
    const matches = SERIE_A_MATCHES[String(gw)] || [];
    if (!matches.length) continue;
    const kickoffs = matches.map(m => new Date(m.kickoff).getTime()).filter(Boolean);
    if (!kickoffs.length) continue;
    const firstKo = Math.min(...kickoffs);
    const diff = Math.abs(now - firstKo);
    if (diff < bestDiff) { bestDiff = diff; bestGw = gw; }
  }
  return bestGw;
}

// ── HTML STRUCTURE ────────────────────────────────
function buildCalendarioHTML(gwStart, gwEnd) {
  const gws = [];
  for (let g = gwStart; g <= gwEnd; g++) gws.push(g);

  return `
    <div class="page-header">
      <span class="ph-icon">📅</span>
      <h1>Calendario</h1>
    </div>

    <!-- GW SELECTOR -->
    <div class="gw-selector-wrap">
      <button class="btn btn-ghost btn-sm" id="gw-prev">◀</button>
      <div class="gw-pills" id="gw-pills">
        ${gws.map(g => `
          <button class="gw-pill ${g === _currentGw ? "active" : ""}" data-gw="${g}">
            GW${g}
          </button>`).join("")}
      </div>
      <button class="btn btn-ghost btn-sm" id="gw-next">▶</button>
    </div>

    <!-- GW CONTENT -->
    <div id="gw-content">
      <div class="spinner"></div>
    </div>

    <!-- MATCH DETAIL MODAL -->
    <div id="match-modal" class="modal-overlay hidden">
      <div class="modal" style="max-width:700px">
        <div class="modal-header">
          <div class="modal-title" id="match-modal-title">Dettaglio sfida</div>
          <button class="modal-close" id="match-modal-close">✕</button>
        </div>
        <div id="match-modal-body"></div>
      </div>
    </div>
  `;
}

// ── RENDER GIORNATA ──────────────────────────────
async function renderGiornata(gw) {
  _currentGw = gw;
  const el = document.getElementById("gw-content");
  if (!el) return;

  // Aggiorna pills
  document.querySelectorAll(".gw-pill").forEach(p =>
    p.classList.toggle("active", parseInt(p.dataset.gw) === gw)
  );

  const teams     = Object.values(_league.teams || {});
  const schedule  = _league.schedule || {};
  const gwMatches = schedule[String(gw)] || [];
  const serieAGw  = SERIE_A_MATCHES[String(gw)] || [];
  const settings  = _league.settings || {};

  // Calcola FP per ogni team in questa giornata
  const teamFP = {};
  for (const team of teams) {
    const formation = await getFormation(team.id, gw);
    const fp = calcTeamFP(team, formation, gw);
    teamFP[team.id] = fp;
  }

  // Info Serie A giornata
  const now = Date.now();
  const gwStatus = getGwStatus(serieAGw, now);

  el.innerHTML = `
    <div class="gw-header">
      <div>
        <div class="gw-title">Giornata ${gw}</div>
        <div class="gw-subtitle">${gwStatus.label}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${gwStatus.live ? `<span class="live-badge">🔴 LIVE</span>` : ""}
        ${serieAGw.length ? `<span style="color:var(--text2);font-size:12px">${serieAGw.length} partite Serie A</span>` : ""}
      </div>
    </div>

    <!-- SFIDE FANTADRAFT -->
    <div class="sfide-grid">
      ${gwMatches.length === 0
        ? `<div class="empty-state" style="padding:40px">
             <div class="es-icon">📅</div>
             <h3>Calendario non ancora generato</h3>
             <p>Il commissioner deve generare il calendario nella sezione Admin.</p>
           </div>`
        : gwMatches.map(match => buildMatchCard(match, teams, teamFP, gw)).join("")}
    </div>

    <!-- PARTITE SERIE A DELLA GIORNATA -->
    ${serieAGw.length ? `
    <div class="card" style="margin-top:20px">
      <h3 style="font-size:14px;margin-bottom:14px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">
        ⚽ Partite Serie A — GW${gw}
      </h3>
      <div class="seriea-grid">
        ${serieAGw.map(m => buildSerieACard(m, now)).join("")}
      </div>
    </div>` : ""}
  `;

  bindMatchCardEvents(gw, teams, teamFP);
}

function buildMatchCard(match, teams, teamFP, gw) {
  const home = teams.find(t => t.id === match.homeId);
  const away = teams.find(t => t.id === match.awayId);
  if (!home || !away) return "";

  const homeFP = teamFP[match.homeId] ?? null;
  const awayFP = teamFP[match.awayId] ?? null;
  const homeGoals = homeFP !== null ? fpToGoals(homeFP) : null;
  const awayGoals = awayFP !== null ? fpToGoals(awayFP) : null;

  const hasResult = homeGoals !== null && awayGoals !== null;
  const homeWin   = hasResult && homeGoals > awayGoals;
  const awayWin   = hasResult && awayGoals > homeGoals;
  const draw      = hasResult && homeGoals === awayGoals;

  return `
    <div class="match-card" data-match-id="${match.id}" data-gw="${gw}">
      <div class="match-team ${homeWin ? "team-winner" : ""}">
        <div class="match-team-name">${home.name}</div>
        <div class="match-team-manager">${home.ownerName}</div>
      </div>

      <div class="match-score">
        ${hasResult
          ? `<div class="score-goals">
               <span class="${homeWin ? "score-win" : draw ? "score-draw" : "score-loss"}">${homeGoals}</span>
               <span class="score-sep">–</span>
               <span class="${awayWin ? "score-win" : draw ? "score-draw" : "score-loss"}">${awayGoals}</span>
             </div>
             <div class="score-fp">
               <span>${homeFP !== null ? homeFP.toFixed(1) : "—"}</span>
               <span style="color:var(--text3)">FP</span>
               <span>${awayFP !== null ? awayFP.toFixed(1) : "—"}</span>
             </div>`
          : `<div class="score-vs">VS</div>`}
        <div class="score-detail-btn">👁 Dettaglio</div>
      </div>

      <div class="match-team ${awayWin ? "team-winner" : ""}" style="text-align:right">
        <div class="match-team-name">${away.name}</div>
        <div class="match-team-manager">${away.ownerName}</div>
      </div>
    </div>`;
}

function buildSerieACard(match, now) {
  const ko     = new Date(match.kickoff).getTime();
  const isLive = now >= ko && now <= ko + 120 * 60 * 1000;
  const isDone = now > ko + 120 * 60 * 1000;
  const koStr  = new Date(match.kickoff).toLocaleString("it-IT", {
    weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"
  });

  return `
    <div class="seriea-card ${isLive ? "seriea-live" : isDone ? "seriea-done" : ""}">
      <div class="seriea-teams">${match.home} – ${match.away}</div>
      <div class="seriea-info">
        ${isLive ? `<span class="live-badge" style="font-size:10px">🔴 LIVE</span>` : ""}
        <span style="color:var(--text2);font-size:11px">${koStr}</span>
        ${match.eventId ? `<button class="btn btn-ghost btn-sm" data-event="${match.eventId}" data-home="${match.home}" data-away="${match.away}" onclick="void(0)" style="font-size:11px;padding:3px 8px">📊 Voti</button>` : ""}
      </div>
    </div>`;
}

// ── MATCH DETAIL MODAL ────────────────────────────
async function showMatchDetail(matchId, gw, teams, teamFP) {
  const schedule  = _league.schedule || {};
  const gwMatches = schedule[String(gw)] || [];
  const match     = gwMatches.find(m => m.id === matchId);
  if (!match) return;

  const home = teams.find(t => t.id === match.homeId);
  const away = teams.find(t => t.id === match.awayId);

  const [homeFm, awayFm] = await Promise.all([
    getFormation(match.homeId, gw),
    getFormation(match.awayId, gw),
  ]);

  const modal = document.getElementById("match-modal");
  const title = document.getElementById("match-modal-title");
  const body  = document.getElementById("match-modal-body");

  title.textContent = `${home.name} vs ${away.name} — GW${gw}`;
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      ${buildFormationDetail(home, homeFm, teamFP[match.homeId], gw)}
      ${buildFormationDetail(away, awayFm, teamFP[match.awayId], gw, true)}
    </div>`;
  modal.classList.remove("hidden");
}

function buildFormationDetail(team, formation, fp, gw, isAway = false) {
  const players = Object.values(formation?.titolari || {});
  const sub     = Object.values(formation?.panchina || {});

  return `
    <div style="${isAway ? "text-align:right" : ""}">
      <div style="font-family:'Outfit',sans-serif;font-weight:700;font-size:15px;margin-bottom:4px">${team.name}</div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:12px">${team.ownerName} · ${formation?.modulo || "—"}</div>
      <div style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:900;color:var(--accent);margin-bottom:14px">
        ${fp != null ? fp.toFixed(1) : "—"} FP
        ${fp != null ? `<span style="font-size:14px;color:var(--text2)">→ ${fpToGoals(fp)} gol</span>` : ""}
      </div>

      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Titolari</div>
      ${players.map(p => buildPlayerVoteRow(p, gw, isAway)).join("") || `<div style="color:var(--text2);font-size:13px">Nessuna formazione inserita</div>`}

      ${sub.length ? `
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px">Panchina</div>
      ${sub.map(p => buildPlayerVoteRow(p, gw, isAway, true)).join("")}` : ""}
    </div>`;
}

function buildPlayerVoteRow(player, gw, isAway, isSub = false) {
  const v     = _votiCache[player.team]?.[gw]?.[player.name];
  const voto  = v?.v != null ? v.v : null;
  const sv    = v?.sv || false;
  const flags = v?.flags || {};

  const fp    = voto != null ? calcPlayerFP(voto, player.roles || [], flags) : null;
  const vColor = voto == null ? "var(--text3)"
               : voto >= 7   ? "var(--green)"
               : voto >= 6   ? "var(--text)"
               : "var(--red)";

  const flagStr = buildFlagsStr(flags);

  return `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);${isAway ? "flex-direction:row-reverse" : ""}">
      <span style="font-size:10px;background:rgba(255,255,255,.08);padding:2px 5px;border-radius:4px;color:var(--text2)">${(player.roles||[]).join("/")}</span>
      <span style="flex:1;font-size:13px;${isSub ? "color:var(--text2)" : ""}">${player.name}</span>
      ${flagStr ? `<span style="font-size:11px">${flagStr}</span>` : ""}
      <span style="font-weight:700;font-size:13px;color:${vColor}">
        ${sv ? "SV" : voto != null ? voto.toFixed(1) : "—"}
      </span>
      ${fp != null ? `<span style="font-size:11px;color:var(--accent)">(${fp.toFixed(1)})</span>` : ""}
    </div>`;
}

function buildFlagsStr(flags) {
  const parts = [];
  if (flags.gol)    parts.push(`⚽×${flags.gol}`);
  if (flags.assist) parts.push(`🅰×${flags.assist}`);
  if (flags.aut)    parts.push(`🙈×${flags.aut}`);
  if (flags.amm)    parts.push("🟨");
  if (flags.esp)    parts.push("🟥");
  if (flags.rig)    parts.push("❌");
  if (flags.pi)     parts.push("🧤");
  if (flags.rigpar) parts.push(`🧤×${flags.rigpar}`);
  if (flags.gs)     parts.push(`⬅×${flags.gs}`);
  return parts.join(" ");
}

// ── FP CALCULATION ────────────────────────────────
function calcPlayerFP(voto, roles, flags) {
  if (voto == null) return null;
  const role = (roles || [])[0] || "C";
  const isPor = role === "Por" || role === "P";
  let fp = voto;

  if (flags.gol)    fp += flags.gol    * BONUS_GOL;
  if (flags.assist) fp += flags.assist * BONUS_ASSIST;
  if (flags.aut)    fp -= flags.aut    * MALUS_AUT;
  if (flags.amm)    fp -= MALUS_AMM;
  if (flags.esp)    fp -= MALUS_ESP;
  if (flags.rig)    fp -= MALUS_RIG;

  if (isPor) {
    if (flags.pi)     fp += BONUS_PI;
    if (flags.rigpar) fp += flags.rigpar * BONUS_RIG_PAR;
    if (flags.gs)     fp -= flags.gs     * MALUS_GS;
  }

  return Math.round(fp * 10) / 10;
}

async function calcTeamFP(team, formation, gw) {
  if (!formation?.titolari) return null;
  const titolari = Object.values(formation.titolari);
  const panchina = Object.values(formation.panchina || {});
  let totalFP = 0;
  let hasAny  = false;

  for (const player of titolari) {
    const votiSquadra = _votiCache[player.team]?.[gw] || {};
    const entry = lookupVoto(votiSquadra, player.name);
    if (!entry) continue;
    if (entry.sv) continue; // SV = non giocato, non conta
    const fp = calcPlayerFP(entry.v, player.roles || [], entry.flags || {});
    if (fp != null) { totalFP += fp; hasAny = true; }
  }

  // Sostituzioni Master (5 sub dalla panchina)
  // Per ora conta i titolari senza voto e prende il primo della panchina con voto
  // Logica completa nella tab Formazioni

  return hasAny ? Math.round(totalFP * 10) / 10 : null;
}

// ── FORMATIONS ───────────────────────────────────
async function getFormation(teamId, gw) {
  const snap = await get(ref(db, `leagues/${_leagueId}/formations/${teamId}/${gw}`));
  return snap.val();
}

// ── VOTI LISTENER ─────────────────────────────────
function _startVotiListener() {
  if (_votiListener) return;
  const r = ref(db, `leagues/${_leagueId}/voti`);
  _votiListener = onValue(r, snap => {
    _votiCache = snap.val() || {};
    // Re-render giornata corrente se visibile
    if (document.getElementById("gw-content")) renderGiornata(_currentGw);
  });
}

// ── VOTI DA SOFASCORE (proxy) ─────────────────────
export async function fetchVotiSofascore(eventId, home, away, gw) {
  try {
    const res  = await fetch(`/.netlify/functions/sofascore-proxy?eventId=${eventId}`);
    const data = await res.json();
    if (data.unavailable) return { ok: false, msg: "Partita non ancora disponibile su Sofascore" };

    const updates = {};
    for (const side of ["home", "away"]) {
      const squadra = side === "home" ? home : away;
      for (const p of (data[side] || [])) {
        const key = `leagues/${_leagueId}/voti/${squadra}/${gw}/${p.name.replace(/[.#$[\]]/g,"_")}`;
        updates[key] = {
          v:      p.rating,
          sv:     p.didNotPlay,
          flags:  p.flags || {},
          source: "sofascore",
        };
      }
    }
    await update(ref(db), updates);
    return { ok: true, msg: `Voti importati per ${home} - ${away}` };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

// ── GW STATUS ─────────────────────────────────────
function getGwStatus(matches, now) {
  if (!matches.length) return { label: "Nessuna partita", live: false };
  const kickoffs = matches.map(m => new Date(m.kickoff).getTime()).filter(Boolean);
  if (!kickoffs.length) return { label: "Date da definire", live: false };

  const first = Math.min(...kickoffs);
  const last  = Math.max(...kickoffs) + 120 * 60 * 1000;

  if (now < first) {
    const d = new Date(first);
    return { label: `Inizia ${d.toLocaleString("it-IT",{weekday:"short",day:"2-digit",month:"short"})}`, live: false };
  }
  if (now <= last) return { label: "In corso", live: true };
  return { label: "Conclusa", live: false };
}

// ── LOOKUP VOTO (stesso approccio fanta-seriea.it) ─
function lookupVoto(votiSquadra, nome) {
  if (!votiSquadra || !nome) return undefined;
  if (votiSquadra[nome]) return votiSquadra[nome];
  const normNome = normalizeName(nome);
  for (const [k, v] of Object.entries(votiSquadra)) {
    if (normalizeName(k) === normNome) return v;
  }
  // Fallback: match per token
  const tokens = normNome.split(/\s+/).filter(t => t.length > 2);
  for (const [k, v] of Object.entries(votiSquadra)) {
    const kTokens = normalizeName(k).split(/\s+/);
    if (tokens.some(t => kTokens.includes(t))) return v;
  }
  return undefined;
}

// ── EVENTS ────────────────────────────────────────
function bindCalendarioEvents(gwStart, gwEnd) {
  document.getElementById("gw-prev")?.addEventListener("click", () => {
    if (_currentGw > gwStart) renderGiornata(_currentGw - 1);
  });
  document.getElementById("gw-next")?.addEventListener("click", () => {
    if (_currentGw < gwEnd) renderGiornata(_currentGw + 1);
  });
  document.getElementById("gw-pills")?.addEventListener("click", e => {
    const pill = e.target.closest(".gw-pill");
    if (pill) renderGiornata(parseInt(pill.dataset.gw));
  });
  document.getElementById("match-modal-close")?.addEventListener("click", () => {
    document.getElementById("match-modal")?.classList.add("hidden");
  });
  document.getElementById("match-modal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("match-modal")) {
      document.getElementById("match-modal").classList.add("hidden");
    }
  });
}

function bindMatchCardEvents(gw, teams, teamFP) {
  document.querySelectorAll(".match-card").forEach(card => {
    card.addEventListener("click", () => {
      showMatchDetail(card.dataset.matchId, gw, teams, teamFP);
    });
  });
  // Bottoni voti Sofascore
  document.querySelectorAll("[data-event]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const eventId = btn.dataset.event;
      const home    = btn.dataset.home;
      const away    = btn.dataset.away;
      btn.disabled  = true;
      btn.textContent = "⏳";
      const result = await fetchVotiSofascore(eventId, home, away, _currentGw);
      btn.textContent = result.ok ? "✓" : "✗";
      setTimeout(() => { btn.textContent = "📊 Voti"; btn.disabled = false; }, 2000);
    });
  });
}

// ── CALCOLA E SALVA SCORES DI UNA GIORNATA ────────
/**
 * Calcola i FP finali di ogni team per una giornata,
 * li salva in scores/{teamId}/{gw}, poi calcola il
 * risultato di ogni scontro diretto (FP → gol → W/D/L)
 * e aggiorna la classifica dei team.
 */
export async function calcAndSaveGwScores(leagueId, league, gw) {
  const teams    = Object.values(league.teams || {});
  const settings = league.settings || {};
  const schedule = league.schedule || {};
  const gwMatches = (schedule[String(gw)] || []);

  // Carica voti e formazioni in parallelo
  const [votiSnap, ...formSnaps] = await Promise.all([
    get(ref(db, `leagues/${leagueId}/voti`)),
    ...teams.map(t => get(ref(db, `leagues/${leagueId}/formations/${t.id}/${gw}`))),
  ]);

  const voti = votiSnap.val() || {};

  // ── STEP 1: calcola FP per ogni team ──────────────
  const fpByTeam = {};

  for (let i = 0; i < teams.length; i++) {
    const team      = teams[i];
    const formation = formSnaps[i].val();

    let titolari = Object.values(formation?.titolari || {});
    let panchina = Object.values(formation?.panchina  || {});

    // Usa ultima formazione salvata se mancante
    if (!titolari.length) {
      for (let prevGw = gw - 1; prevGw >= (settings.gwStart || 1); prevGw--) {
        const prevSnap = await get(ref(db, `leagues/${leagueId}/formations/${team.id}/${prevGw}`));
        const prevFm   = prevSnap.val();
        if (prevFm?.titolari && Object.keys(prevFm.titolari).length > 0) {
          titolari = Object.values(prevFm.titolari);
          panchina = Object.values(prevFm.panchina || {});
          break;
        }
      }
    }

    let totalFP  = 0;
    let hasAny   = false;
    let subsMade = 0;
    const MAX_SUBS = 5;

    const titolariConFP = titolari.map(player => {
      const gwVoti = ((voti[player.team] || {})[String(gw)]) || {};
      const entry  = lookupVotoGw(gwVoti, player.name);
      if (!entry || entry.sv) return { player, fp: null, sv: entry?.sv || false };
      return { player, fp: calcPlayerFP(entry.v, player.roles || [], entry.flags || {}), sv: false };
    });

    for (const { player, fp, sv } of titolariConFP) {
      if (sv || fp === null) {
        if (subsMade < MAX_SUBS) {
          for (const sub of panchina) {
            if (sub._used) continue;
            const gwVoti  = ((voti[sub.team] || {})[String(gw)]) || {};
            const subEntry = lookupVotoGw(gwVoti, sub.name);
            if (!subEntry || subEntry.sv) continue;
            const subFP = calcPlayerFP(subEntry.v, sub.roles || [], subEntry.flags || {});
            if (subFP !== null) {
              totalFP += subFP; hasAny = true; subsMade++; sub._used = true; break;
            }
          }
        }
      } else {
        totalFP += fp; hasAny = true;
      }
    }

    const finalFP = hasAny ? Math.round(totalFP * 10) / 10 : null;
    fpByTeam[team.id] = finalFP;

    if (finalFP !== null) {
      await set(ref(db, `leagues/${leagueId}/scores/${team.id}/${gw}`), {
        fp: finalFP, calculatedAt: Date.now(), subsMade,
      });
    }
  }

  // ── STEP 2: calcola risultati scontri diretti ──────
  const matchResults = {}; // { teamId: { pts, gf, gs, v, p, s } }
  for (const team of teams) {
    matchResults[team.id] = { pts: 0, gf: 0, gs: 0, v: 0, p: 0, s: 0 };
  }

  for (const match of gwMatches) {
    const fpHome = fpByTeam[match.homeId];
    const fpAway = fpByTeam[match.awayId];
    if (fpHome === null || fpHome === undefined) continue;
    if (fpAway === null || fpAway === undefined) continue;

    const golHome = fpToGoals(fpHome);
    const golAway = fpToGoals(fpAway);

    // Aggiorna gol fatti/subiti
    matchResults[match.homeId].gf += golHome;
    matchResults[match.homeId].gs += golAway;
    matchResults[match.awayId].gf += golAway;
    matchResults[match.awayId].gs += golHome;

    // Risultato
    if (golHome > golAway) {
      matchResults[match.homeId].v++;
      matchResults[match.homeId].pts += 3;
      matchResults[match.awayId].s++;
    } else if (golAway > golHome) {
      matchResults[match.awayId].v++;
      matchResults[match.awayId].pts += 3;
      matchResults[match.homeId].s++;
    } else {
      matchResults[match.homeId].p++;
      matchResults[match.homeId].pts++;
      matchResults[match.awayId].p++;
      matchResults[match.awayId].pts++;
    }

    // Salva anche il risultato della singola sfida
    await set(ref(db, `leagues/${leagueId}/matchResults/${gw}/${match.id}`), {
      homeId: match.homeId, awayId: match.awayId,
      fpHome, fpAway, golHome, golAway,
      calculatedAt: Date.now(),
    });
  }

  // ── STEP 3: aggiorna classifica cumulativa ─────────
  // Legge la classifica esistente e aggiunge i punti di questa GW
  // (evita di ricalcolare tutto da zero — somma incrementale)
  const standingsSnap = await get(ref(db, `leagues/${leagueId}/standings`));
  const standings     = standingsSnap.val() || {};

  const updates = {};
  for (const team of teams) {
    const r    = matchResults[team.id];
    const curr = standings[team.id] || { pts:0, v:0, p:0, s:0, gf:0, gs:0, fp:0 };

    // Controlla se questa GW è già stata conteggiata
    const gwLogSnap = await get(ref(db, `leagues/${leagueId}/standingsLog/${team.id}/${gw}`));
    if (gwLogSnap.exists()) continue; // già calcolata, skip

    const fpTotal = (curr.fp || 0) + (fpByTeam[team.id] || 0);
    updates[`leagues/${leagueId}/standings/${team.id}`] = {
      pts: (curr.pts || 0) + r.pts,
      v:   (curr.v   || 0) + r.v,
      p:   (curr.p   || 0) + r.p,
      s:   (curr.s   || 0) + r.s,
      gf:  (curr.gf  || 0) + r.gf,
      gs:  (curr.gs  || 0) + r.gs,
      fp:  Math.round(fpTotal * 10) / 10,
    };
    // Log per evitare doppio conteggio
    updates[`leagues/${leagueId}/standingsLog/${team.id}/${gw}`] = {
      pts: r.pts, v: r.v, p: r.p, s: r.s,
      gf: r.gf, gs: r.gs, fp: fpByTeam[team.id] || 0,
      calculatedAt: Date.now(),
    };
  }

  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }

  return fpByTeam;
}

// Lookup voto nella struttura {gw: {nome: entry}}
function lookupVotoGw(gwVoti, nome) {
  if (!gwVoti || !nome) return undefined;
  if (gwVoti[nome]) return gwVoti[nome];
  const norm = normalizeName(nome);
  for (const [k, v] of Object.entries(gwVoti)) {
    if (normalizeName(k) === norm) return v;
  }
  const tokens = norm.split(/\s+/).filter(t => t.length > 2);
  for (const [k, v] of Object.entries(gwVoti)) {
    const kTok = normalizeName(k).split(/\s+/);
    if (tokens.some(t => kTok.includes(t))) return v;
  }
  return undefined;
}
