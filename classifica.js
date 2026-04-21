// ============================================================
// FANTADRAFT — classifica.js
// Tab Classifica Regular Season + generazione calendario
// ============================================================

import { db, ref, get, set, update } from "./firebase.js";
import { fpToGoals, capLevelLabel, capLevelBadge } from "./utils.js";
import { SERIE_A_MATCHES } from "./matches.js";

// ── INIT ─────────────────────────────────────────
export async function renderClassifica(leagueId, league, user) {
  const el      = document.getElementById("tab-classifica");
  const isAdmin = league.commissionerUid === user.uid;
  const teams   = Object.values(league.teams || {});
  const settings = league.settings || {};

  // Legge standings salvati (calcolati dal poller/admin)
  // con fallback al calcolo live da scores
  const [standSnap, scoresSnap, scheduleSnap] = await Promise.all([
    get(ref(db, `leagues/${leagueId}/standings`)),
    get(ref(db, `leagues/${leagueId}/scores`)),
    get(ref(db, `leagues/${leagueId}/schedule`)),
  ]);

  const savedStandings = standSnap.val()   || {};
  const scores         = scoresSnap.val()  || {};
  const schedule       = scheduleSnap.val()|| {};

  // Se esistono standings salvati usa quelli, altrimenti calcola live
  const standings = Object.keys(savedStandings).length > 0
    ? buildStandingsFromSaved(teams, savedStandings)
    : calcStandings(teams, scores, schedule, settings);

  el.innerHTML = `
    <div class="page-header">
      <span class="ph-icon">🏆</span>
      <h1>Classifica <span style="color:var(--accent)">Regular Season</span></h1>
    </div>

    <!-- STANDINGS TABLE -->
    <div class="card" style="margin-bottom:20px">
      <div class="table-wrap">
        <table class="table classifica-table">
          <thead>
            <tr>
              <th style="width:40px">#</th>
              <th>Squadra</th>
              <th>Manager</th>
              <th class="tc">PT</th>
              <th class="tc">V</th>
              <th class="tc">P</th>
              <th class="tc">S</th>
              <th class="tc">GF</th>
              <th class="tc">GS</th>
              <th class="tc">FP</th>
              <th>CAP</th>
              <th>Penalità</th>
            </tr>
          </thead>
          <tbody>
            ${standings.map((s, i) => buildStandingRow(s, i, teams, settings, user.uid, leagueId)).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <!-- LEGENDA PLAYOFF -->
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px;font-size:12px;color:var(--text2)">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:10px;height:10px;border-radius:2px;background:rgba(34,197,94,.3)"></div>
        Playoff diretti (top 6)
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:10px;height:10px;border-radius:2px;background:rgba(249,115,22,.3)"></div>
        Play-in (7°–10°)
      </div>
    </div>

    <!-- RISULTATI PER GIORNATA -->
    <div class="card" style="margin-bottom:20px">
      <h3 style="font-size:15px;margin-bottom:16px">📅 Risultati per giornata</h3>
      <div id="results-accordion">
        ${buildResultsAccordion(schedule, scores, teams, settings)}
      </div>
    </div>

    <!-- ADMIN: GENERA CALENDARIO -->
    ${isAdmin ? buildAdminCalendarioPanel(teams, settings, schedule, leagueId) : ""}
  `;

  bindClassificaEvents(leagueId, league, teams, settings, scores, schedule, isAdmin);
}

// ── STANDINGS DA FIREBASE (calcolati dal poller) ──
function buildStandingsFromSaved(teams, savedStandings) {
  return teams.map(team => {
    const s = savedStandings[team.id] || {};
    return {
      team,
      pt: s.pts || 0,
      v:  s.v   || 0,
      p:  s.p   || 0,
      s:  s.s   || 0,
      gf: s.gf  || 0,
      gs: s.gs  || 0,
      fp: s.fp  || 0,
      capLevel:   team.capLevel   || "under",
      capPenalty: team.capPenalty || 0,
    };
  }).sort((a,b) =>
    (b.pt - a.pt) || (b.v - a.v) ||
    ((b.gf - b.gs) - (a.gf - a.gs)) || (b.fp - a.fp)
  );
}

function calcStandings(teams, scores, schedule, settings) {
  const map = {};
  for (const t of teams) {
    map[t.id] = {
      team: t,
      pt: 0, v: 0, p: 0, s: 0,
      gf: 0, gs: 0, fp: 0,
      capLevel: t.capLevel || "under",
      capPenalty: t.capPenalty || 0,
    };
  }

  // Calcola da schedule + scores
  for (const [gw, matches] of Object.entries(schedule)) {
    for (const match of (matches || [])) {
      const homeSc = scores[match.homeId]?.[gw];
      const awaySc = scores[match.awayId]?.[gw];
      if (!homeSc || !awaySc) continue;
      if (!map[match.homeId] || !map[match.awayId]) continue;

      const homeGol = fpToGoals(homeSc.fp || 0);
      const awayGol = fpToGoals(awaySc.fp || 0);

      map[match.homeId].fp += homeSc.fp || 0;
      map[match.awayId].fp += awaySc.fp || 0;
      map[match.homeId].gf += homeGol;
      map[match.homeId].gs += awayGol;
      map[match.awayId].gf += awayGol;
      map[match.awayId].gs += homeGol;

      if (homeGol > awayGol) {
        map[match.homeId].v++; map[match.homeId].pt += 3;
        map[match.awayId].s++;
      } else if (awayGol > homeGol) {
        map[match.awayId].v++; map[match.awayId].pt += 3;
        map[match.homeId].s++;
      } else {
        map[match.homeId].p++; map[match.homeId].pt++;
        map[match.awayId].p++; map[match.awayId].pt++;
      }
    }
  }

  return Object.values(map)
    .sort((a, b) =>
      (b.pt - a.pt) ||
      (b.v  - a.v)  ||
      (b.gf - b.gs - (a.gf - a.gs)) ||
      (b.fp - a.fp)
    );
}

function buildStandingRow(s, i, teams, settings, myUid, leagueId) {
  const pos    = i + 1;
  const isMe   = s.team.ownerUid === myUid;
  const cap    = s.team.currentCap || 0;
  const penalty = s.capPenalty;

  // Colore riga playoff
  const rowBg = pos <= 6
    ? "background:rgba(34,197,94,.04)"
    : pos <= 10
    ? "background:rgba(249,115,22,.04)"
    : "";

  // Badge posizione
  const posBadge = pos === 1 ? "🥇"
    : pos === 2 ? "🥈"
    : pos === 3 ? "🥉"
    : `<span style="font-weight:700;color:var(--text2)">${pos}</span>`;

  return `
    <tr style="${rowBg}${isMe ? ";border-left:3px solid var(--accent)" : ""}">
      <td style="text-align:center">${posBadge}</td>
      <td>
        <span style="font-family:'Outfit',sans-serif;font-weight:700;font-size:14px">
          ${s.team.name}
        </span>
        ${isMe ? `<span style="color:var(--accent);font-size:10px;margin-left:4px">★ TU</span>` : ""}
      </td>
      <td style="color:var(--text2);font-size:12px">${s.team.ownerName}</td>
      <td class="tc" style="font-family:'Outfit',sans-serif;font-weight:800;font-size:16px;color:var(--accent)">${s.pt}</td>
      <td class="tc">${s.v}</td>
      <td class="tc">${s.p}</td>
      <td class="tc">${s.s}</td>
      <td class="tc">${s.gf}</td>
      <td class="tc">${s.gs}</td>
      <td class="tc" style="color:var(--blue);font-weight:600">${s.fp.toFixed(1)}</td>
      <td>
        <span class="badge ${capLevelBadge(s.capLevel)}" style="font-size:10px">
          ${capLevelLabel(s.capLevel)}
        </span>
      </td>
      <td>
        ${penalty !== 0
          ? `<span class="badge badge-penalty">-${Math.abs(penalty)} FM</span>`
          : `<span style="color:var(--text3);font-size:12px">—</span>`}
      </td>
    </tr>`;
}

// ── RESULTS ACCORDION ─────────────────────────────
function buildResultsAccordion(schedule, scores, teams, settings) {
  const gwStart = settings.gwStart || 1;
  const gwEnd   = settings.gwEnd   || 34;
  const gws     = Object.keys(schedule).map(Number).filter(g => g >= gwStart && g <= gwEnd).sort((a,b) => b - a);

  if (!gws.length) return `<p style="color:var(--text2);font-size:13px">Nessun risultato ancora disponibile.</p>`;

  return gws.map(gw => {
    const matches = schedule[String(gw)] || [];
    const hasResults = matches.some(m => scores[m.homeId]?.[gw] || scores[m.awayId]?.[gw]);

    return `
      <div class="acc-item">
        <div class="acc-header" data-gw="${gw}">
          <span>Giornata ${gw}</span>
          <span style="color:var(--text2);font-size:12px">${matches.length} sfide ${hasResults ? "· Risultati disponibili" : ""}</span>
          <span class="acc-chevron">▼</span>
        </div>
        <div class="acc-body hidden" id="acc-gw-${gw}">
          ${matches.map(m => buildResultRow(m, scores, teams, gw)).join("")}
        </div>
      </div>`;
  }).join("");
}

function buildResultRow(match, scores, teams, gw) {
  const home    = teams.find(t => t.id === match.homeId);
  const away    = teams.find(t => t.id === match.awayId);
  if (!home || !away) return "";

  const homeSc  = scores[match.homeId]?.[gw];
  const awaySc  = scores[match.awayId]?.[gw];
  const homeFP  = homeSc?.fp ?? null;
  const awayFP  = awaySc?.fp ?? null;
  const homeGol = homeFP !== null ? fpToGoals(homeFP) : null;
  const awayGol = awayFP !== null ? fpToGoals(awayFP) : null;
  const hasRes  = homeGol !== null && awayGol !== null;

  return `
    <div class="result-row">
      <span class="result-team ${hasRes && homeGol > awayGol ? "result-winner" : ""}">${home.name}</span>
      <div class="result-score">
        ${hasRes
          ? `<span>${homeGol}</span><span style="color:var(--text3)">–</span><span>${awayGol}</span>`
          : `<span style="color:var(--text3)">vs</span>`}
        ${hasRes ? `<div class="result-fp">${homeFP.toFixed(1)} – ${awayFP.toFixed(1)} FP</div>` : ""}
      </div>
      <span class="result-team result-team-away ${hasRes && awayGol > homeGol ? "result-winner" : ""}">${away.name}</span>
    </div>`;
}

// ── ADMIN: CALENDARIO ─────────────────────────────
function buildAdminCalendarioPanel(teams, settings, schedule, leagueId) {
  const hasSchedule = Object.keys(schedule).length > 0;
  return `
    <div class="card" style="border-color:rgba(245,197,24,.2)">
      <h3 style="font-size:15px;margin-bottom:16px">⚙️ Admin — Genera Calendario</h3>

      <div style="color:var(--text2);font-size:13px;margin-bottom:16px;line-height:1.6">
        Il calendario viene generato con sistema <strong style="color:var(--text)">round-robin bilanciato</strong>.
        Ogni squadra affronta tutte le altre in modo equo.
        Con numero dispari di squadre, una squadra riposa (BYE) ogni giornata, ruotando.<br>
        <strong style="color:var(--orange)">⚠ La rigenerazione sovrascrive il calendario esistente.</strong>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <div class="form-group">
          <label class="form-label">GW Inizio</label>
          <input class="form-input" id="cal-gw-start" type="number"
            min="1" max="10" value="${settings.gwStart || 1}" style="width:80px">
        </div>
        <div class="form-group">
          <label class="form-label">GW Fine</label>
          <input class="form-input" value="34" disabled style="width:80px">
        </div>
        <div class="form-group">
          <label class="form-label">Squadre</label>
          <input class="form-input" value="${teams.length}" disabled style="width:80px">
        </div>
      </div>

      ${hasSchedule ? `
        <div style="background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--orange)">
          ⚠ Calendario già generato con ${Object.keys(schedule).length} giornate. La rigenerazione lo sovrascriverà.
        </div>` : ""}

      <div id="cal-gen-error" class="form-error" style="margin-bottom:8px"></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" id="cal-generate-btn">
          🗓 ${hasSchedule ? "Rigenera" : "Genera"} Calendario
        </button>
        ${hasSchedule ? `<button class="btn btn-ghost btn-sm" id="cal-preview-btn">👁 Anteprima</button>` : ""}
      </div>

      <div id="cal-preview-wrap" class="hidden" style="margin-top:20px"></div>
    </div>`;
}

// ── ROUND-ROBIN GENERATOR ─────────────────────────
export function generateRoundRobin(teamIds, gwStart, gwEnd) {
  const n    = teamIds.length;
  const hasBye = n % 2 !== 0;
  const ids  = [...teamIds];
  if (hasBye) ids.push("BYE"); // squadra fittizia per il riposo
  const numTeams = ids.length; // pari
  const roundsPerCycle = numTeams - 1;
  const matchesPerRound = numTeams / 2;

  const totalGws = gwEnd - gwStart + 1;
  const schedule = {};

  // Genera tutti i turni del round-robin (un ciclo completo)
  // Poi ripeti finché non si riempiono tutte le GW
  const allRounds = [];
  for (let r = 0; r < roundsPerCycle; r++) {
    const round = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const home = ids[m];
      const away = ids[numTeams - 1 - m];
      if (home !== "BYE" && away !== "BYE") {
        round.push({ homeId: home, awayId: away });
      }
      // Se uno dei due è BYE, quella squadra ha il riposo
    }
    // Ruota tutti tranne il primo (fixed)
    const last = ids.pop();
    ids.splice(1, 0, last);
    allRounds.push(round);
  }

  // Riempi le GW disponibili con i turni (ripeti i cicli se necessario)
  let gwCurrent = gwStart;
  let roundIdx  = 0;
  while (gwCurrent <= gwEnd) {
    const round = allRounds[roundIdx % allRounds.length];
    schedule[String(gwCurrent)] = round.map((m, i) => ({
      id:     `${gwCurrent}_${i}`,
      homeId: m.homeId,
      awayId: m.awayId,
    }));
    gwCurrent++;
    roundIdx++;
  }

  return schedule;
}

// ── EVENTS ────────────────────────────────────────
function bindClassificaEvents(leagueId, league, teams, settings, scores, schedule, isAdmin) {
  // Accordion risultati
  document.getElementById("tab-classifica")?.addEventListener("click", e => {
    const header = e.target.closest(".acc-header");
    if (!header) return;
    const gw   = header.dataset.gw;
    const body = document.getElementById(`acc-gw-${gw}`);
    if (body) {
      body.classList.toggle("hidden");
      header.querySelector(".acc-chevron").textContent =
        body.classList.contains("hidden") ? "▼" : "▲";
    }
  });

  if (!isAdmin) return;

  // Genera calendario
  document.getElementById("cal-generate-btn")?.addEventListener("click", async () => {
    const btn   = document.getElementById("cal-generate-btn");
    const errEl = document.getElementById("cal-gen-error");
    const gwStart = parseInt(document.getElementById("cal-gw-start").value) || settings.gwStart || 1;
    const gwEnd   = settings.gwEnd || 34;

    if (teams.length < 2) { errEl.textContent = "Servono almeno 2 squadre"; return; }
    if (!confirm(`Generare il calendario dalla GW${gwStart} alla GW${gwEnd} con ${teams.length} squadre?`)) return;

    btn.disabled = true; btn.textContent = "⏳ Generazione..."; errEl.textContent = "";

    try {
      const teamIds   = teams.map(t => t.id);
      const newSched  = generateRoundRobin(teamIds, gwStart, gwEnd);
      await set(ref(db, `leagues/${leagueId}/schedule`), newSched);

      // Aggiorna gwStart nelle settings
      await update(ref(db, `leagues/${leagueId}/settings`), { gwStart });

      errEl.style.color = "var(--green)";
      errEl.textContent = `✓ Calendario generato: ${Object.keys(newSched).length} giornate, ${teams.length} squadre`;

      // Rigenera la vista
      const { renderClassifica } = await import("./classifica.js");
      const snap = await get(ref(db, `leagues/${leagueId}`));
      renderClassifica(leagueId, snap.val(), { uid: league.commissionerUid, displayName: "" });
    } catch(e) {
      errEl.style.color = "var(--red)";
      errEl.textContent = `✗ ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "🗓 Rigenera Calendario";
    }
  });

  // Anteprima
  document.getElementById("cal-preview-btn")?.addEventListener("click", () => {
    const wrap = document.getElementById("cal-preview-wrap");
    if (!wrap) return;
    if (!wrap.classList.contains("hidden")) { wrap.classList.add("hidden"); return; }

    const gwStart = settings.gwStart || 1;
    const gwEnd   = settings.gwEnd   || 34;
    let html = `<div style="font-size:13px;color:var(--text2);margin-bottom:10px">Anteprima prime 5 giornate:</div>`;

    for (let gw = gwStart; gw <= Math.min(gwStart + 4, gwEnd); gw++) {
      const matches = schedule[String(gw)] || [];
      html += `<div style="margin-bottom:12px">
        <div style="font-weight:700;font-size:12px;color:var(--accent);margin-bottom:6px">GW${gw}</div>
        ${matches.map(m => {
          const h = teams.find(t => t.id === m.homeId);
          const a = teams.find(t => t.id === m.awayId);
          return `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:8px">
            <span style="flex:1;text-align:right">${h?.name || "?"}</span>
            <span style="color:var(--text3)">vs</span>
            <span style="flex:1">${a?.name || "?"}</span>
          </div>`;
        }).join("")}
        ${matches.length === 0 ? `<div style="color:var(--text3);font-size:12px">BYE</div>` : ""}
      </div>`;
    }

    wrap.innerHTML = html;
    wrap.classList.remove("hidden");
  });
}
