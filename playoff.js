// ============================================================
// FANTADRAFT — playoff.js
// Tab Playoff: play-in GW35, quarti GW36, semis GW37, finale GW38
// Fattore campo +2 solo nel turno preliminare
// ============================================================

import { db, ref, get } from "./firebase.js";
import { fpToGoals } from "./utils.js";

// ── INIT ─────────────────────────────────────────
export async function renderPlayoff(leagueId, league, user) {
  const el       = document.getElementById("tab-playoff");
  const teams    = Object.values(league.teams || {});
  const settings = league.settings || {};

  // Carica dati playoff e classifica regular season
  const [playoffSnap, scoresSnap, scheduleSnap] = await Promise.all([
    get(ref(db, `leagues/${leagueId}/playoff`)),
    get(ref(db, `leagues/${leagueId}/scores`)),
    get(ref(db, `leagues/${leagueId}/schedule`)),
  ]);

  const playoff  = playoffSnap.val()  || {};
  const scores   = scoresSnap.val()   || {};
  const schedule = scheduleSnap.val() || {};

  // Calcola standings regular season (GW1-34)
  const standings = calcStandings(teams, scores, schedule, settings);

  el.innerHTML = buildPlayoffHTML(playoff, standings, teams, scores, settings);
  bindPlayoffEvents();
}

// ── STANDINGS (dalla classifica) ──────────────────
function calcStandings(teams, scores, schedule, settings) {
  const map = {};
  for (const t of teams) {
    map[t.id] = { team: t, pt:0, v:0, p:0, s:0, gf:0, gs:0, fp:0 };
  }
  for (const [gw, matches] of Object.entries(schedule)) {
    if (parseInt(gw) > 34) continue; // solo regular season
    for (const match of (matches || [])) {
      const hSc = scores[match.homeId]?.[gw];
      const aSc = scores[match.awayId]?.[gw];
      if (!hSc || !aSc || !map[match.homeId] || !map[match.awayId]) continue;
      const hG = fpToGoals(hSc.fp || 0);
      const aG = fpToGoals(aSc.fp || 0);
      map[match.homeId].fp += hSc.fp || 0;
      map[match.awayId].fp += aSc.fp || 0;
      map[match.homeId].gf += hG; map[match.homeId].gs += aG;
      map[match.awayId].gf += aG; map[match.awayId].gs += hG;
      if (hG > aG) { map[match.homeId].v++; map[match.homeId].pt += 3; map[match.awayId].s++; }
      else if (aG > hG) { map[match.awayId].v++; map[match.awayId].pt += 3; map[match.homeId].s++; }
      else { map[match.homeId].p++; map[match.homeId].pt++; map[match.awayId].p++; map[match.awayId].pt++; }
    }
  }
  return Object.values(map).sort((a,b) =>
    (b.pt-a.pt) || (b.v-a.v) || ((b.gf-b.gs)-(a.gf-a.gs)) || (b.fp-a.fp)
  );
}

// ── MAIN HTML ─────────────────────────────────────
function buildPlayoffHTML(playoff, standings, teams, scores, settings) {
  const hfBonus = settings.homefieldBonus || 2;
  const n       = standings.length;

  // Struttura: top 6 diretti ai QF, 7°-10° al play-in
  // Se meno di 8 squadre, adatta
  const hasPlayin = n >= 8;
  const playin    = playoff.playin   || {};
  const bracket   = playoff.bracket  || {};

  // Risultati play-in GW35
  const playin1 = getPlayinMatch(playin, "match1", standings, 6, 9, scores, hfBonus); // 7° vs 10°
  const playin2 = getPlayinMatch(playin, "match2", standings, 7, 8, scores, hfBonus); // 8° vs 9°

  return `
    <div class="page-header">
      <span class="ph-icon">🥊</span>
      <h1>Playoff</h1>
    </div>

    <!-- INFO BOX -->
    <div class="playoff-info-box">
      <div>
        <strong>Formato:</strong> Turno preliminare secco tra 7°–10°, poi tabellone principale da 8 squadre.
      </div>
      <div>
        <strong>Fattore campo:</strong> +${hfBonus} punti nel turno preliminare per la squadra meglio classificata.
        <em>Non valido per il resto dei playoff.</em>
      </div>
      <div>
        <strong>Inizio:</strong> GW35 (play-in) → GW36 (quarti) → GW37 (semis) → GW38 (finale).
      </div>
    </div>

    <!-- PLAY-IN -->
    ${hasPlayin ? `
    <div class="playoff-section">
      <div class="playoff-section-title">
        <span class="ps-dot ps-live"></span>
        Turno Preliminare
        <span style="font-size:12px;color:var(--text2);font-weight:400">GW35 · Gara secca</span>
      </div>
      <div class="playin-grid">
        ${buildPlayinCard(playin1, "Sfida 1", hfBonus)}
        ${buildPlayinCard(playin2, "Sfida 2", hfBonus)}
      </div>
      <div style="font-size:12px;color:var(--text2);margin-top:8px">
        ⚠ Fattore campo (+${hfBonus}) per la squadra meglio classificata. Non valido nei turni successivi.
      </div>
    </div>` : ""}

    <!-- TABELLONE PRINCIPALE -->
    <div class="playoff-section">
      <div class="playoff-section-title">
        🏆 Tabellone Principale (8 squadre)
      </div>
      <div class="bracket-wrap">
        ${buildBracket(bracket, standings, playin1, playin2, scores, n)}
      </div>
    </div>

    <!-- LEGENDA -->
    <div style="font-size:12px;color:var(--text2);margin-top:16px">
      <strong>Legenda:</strong>
      W(P1) = vincitore sfida 7°/10° (affronta 2°) ·
      W(P2) = vincitore sfida 8°/9° (affronta 1°)
    </div>
  `;
}

// ── PLAY-IN MATCH ─────────────────────────────────
function getPlayinMatch(playin, key, standings, posA, posB, scores, hfBonus) {
  const teamA  = standings[posA]?.team;
  const teamB  = standings[posB]?.team;
  if (!teamA || !teamB) return null;

  const gw     = "35";
  const fpA    = playin[key]?.fpA ?? scores[teamA.id]?.[gw]?.fp ?? null;
  const fpB    = playin[key]?.fpB ?? scores[teamB.id]?.[gw]?.fp ?? null;
  const golA   = fpA !== null ? fpToGoals(fpA) + hfBonus : null; // +hfBonus per squadra meglio classificata
  const golB   = fpB !== null ? fpToGoals(fpB) : null;
  const winner = golA !== null && golB !== null
    ? (golA > golB ? teamA : golB > golA ? teamB : null)
    : null;

  return { teamA, teamB, fpA, fpB, golA, golB, winner, posA: posA+1, posB: posB+1 };
}

function buildPlayinCard(match, label, hfBonus) {
  if (!match) return "";
  const { teamA, teamB, fpA, fpB, golA, golB, winner, posA, posB } = match;
  const hasResult = golA !== null && golB !== null;

  return `
    <div class="playin-card">
      <div class="playin-label">${label}</div>

      <div class="playin-match">
        <div class="playin-team ${winner?.id === teamA.id ? "playin-winner" : hasResult ? "playin-loser" : ""}">
          <span class="playin-pos">${posA}°</span>
          <span class="playin-name">${teamA.name}</span>
          <span class="playin-fc" title="Fattore campo">FC +${hfBonus}</span>
        </div>

        <div class="playin-score">
          ${hasResult
            ? `<span class="${winner?.id === teamA.id ? "score-win" : "score-loss"}">${golA}</span>
               <span class="score-sep">–</span>
               <span class="${winner?.id === teamB.id ? "score-win" : "score-loss"}">${golB}</span>`
            : `<span style="color:var(--text3)">vs</span>`}
          ${hasResult
            ? `<div style="font-size:10px;color:var(--text2);margin-top:2px">${fpA?.toFixed(1)} – ${fpB?.toFixed(1)} FP</div>`
            : ""}
        </div>

        <div class="playin-team playin-team-right ${winner?.id === teamB.id ? "playin-winner" : hasResult ? "playin-loser" : ""}">
          <span class="playin-name">${teamB.name}</span>
          <span class="playin-pos">${posB}°</span>
        </div>
      </div>

      ${winner
        ? `<div style="font-size:12px;color:var(--green);text-align:center;margin-top:8px;font-weight:600">
             ✓ ${winner.name} avanza ai quarti
           </div>`
        : `<div style="font-size:11px;color:var(--text3);text-align:center;margin-top:6px">
             In attesa dei risultati GW35
           </div>`}
    </div>`;
}

// ── BRACKET ───────────────────────────────────────
function buildBracket(bracket, standings, playin1, playin2, scores, n) {
  // Seedings: 1°-6° diretti, W(P1)=win sfida1 vs 2°, W(P2)=win sfida2 vs 1°
  const s = (i) => standings[i]?.team;
  const seeds = [
    { seed: 1,  team: s(0),              label: `1° ${s(0)?.name || "—"}` },
    { seed: 2,  team: s(1),              label: `2° ${s(1)?.name || "—"}` },
    { seed: 3,  team: s(2),              label: `3° ${s(2)?.name || "—"}` },
    { seed: 4,  team: s(3),              label: `4° ${s(3)?.name || "—"}` },
    { seed: 5,  team: s(4),              label: `5° ${s(4)?.name || "—"}` },
    { seed: 6,  team: s(5),              label: `6° ${s(5)?.name || "—"}` },
    { seed: "P2", team: playin2?.winner, label: `W(P2) ${playin2?.winner?.name || "Da determinare"}` },
    { seed: "P1", team: playin1?.winner, label: `W(P1) ${playin1?.winner?.name || "Da determinare"}` },
  ];

  // QF pairings: 1 vs W(P2), 2 vs W(P1), 3 vs 6, 4 vs 5
  const qf = [
    { id:"qf1", top: seeds[0], bot: seeds[6], gw:"36" },
    { id:"qf2", top: seeds[1], bot: seeds[7], gw:"36" },
    { id:"qf3", top: seeds[2], bot: seeds[5], gw:"36" },
    { id:"qf4", top: seeds[3], bot: seeds[4], gw:"36" },
  ];

  // Semifinali
  const sf = [
    { id:"sf1", topLabel:"W QF1 vs W QF2", botLabel:"Da determinare", gw:"37",
      top: getWinner(bracket, "qf1", scores), bot: getWinner(bracket, "qf2", scores) },
    { id:"sf2", topLabel:"W QF3 vs W QF4", botLabel:"Da determinare", gw:"37",
      top: getWinner(bracket, "qf3", scores), bot: getWinner(bracket, "qf4", scores) },
  ];

  // Finale
  const finale = {
    id:"final", topLabel:"Grande Finale", botLabel:"Da determinare", gw:"38",
    top: getWinner(bracket, "sf1", scores), bot: getWinner(bracket, "sf2", scores),
  };

  return `
    <div class="bracket-grid">
      <!-- QUARTI -->
      <div class="bracket-col">
        <div class="bracket-col-label">Quarti di Finale <span>GW36</span></div>
        ${qf.map(m => buildBracketMatch(m, bracket, scores)).join("")}
      </div>

      <!-- SEMIFINALI -->
      <div class="bracket-col">
        <div class="bracket-col-label">Semifinali <span>GW37</span></div>
        <div style="height:60px"></div>
        ${buildBracketMatch(sf[0], bracket, scores)}
        <div style="height:80px"></div>
        ${buildBracketMatch(sf[1], bracket, scores)}
      </div>

      <!-- FINALE -->
      <div class="bracket-col">
        <div class="bracket-col-label">Finale <span>GW38</span></div>
        <div style="height:160px"></div>
        ${buildBracketMatch(finale, bracket, scores)}
      </div>
    </div>`;
}

function getWinner(bracket, matchId, scores) {
  const m = bracket[matchId];
  if (!m?.winnerId) return null;
  return { id: m.winnerId, name: m.winnerName };
}

function buildBracketMatch(match, bracket, scores) {
  const saved  = bracket[match.id] || {};
  const topTeam = match.top?.team || (match.top ? { id: match.top.id, name: match.top.name } : null);
  const botTeam = match.bot?.team || (match.bot ? { id: match.bot.id, name: match.bot.name } : null);
  const winner  = saved.winnerId ? { id: saved.winnerId, name: saved.winnerName } : null;

  const topName = topTeam?.name || match.top?.label || match.topLabel || "?";
  const botName = botTeam?.name || match.bot?.label || match.botLabel || "?";
  const topFP   = saved.fpTop ?? null;
  const botFP   = saved.fpBot ?? null;
  const topGol  = topFP !== null ? fpToGoals(topFP) : null;
  const botGol  = botFP !== null ? fpToGoals(botFP) : null;
  const hasRes  = topGol !== null && botGol !== null;

  return `
    <div class="bracket-match" data-match-id="${match.id}">
      <div class="bracket-team ${winner && winner.id === topTeam?.id ? "bracket-winner" : hasRes ? "bracket-loser" : ""}">
        <span class="bracket-team-name">${topName}</span>
        ${hasRes ? `<span class="bracket-team-score ${topGol > botGol ? "score-win" : "score-loss"}">${topGol}</span>` : ""}
      </div>
      <div class="bracket-team ${winner && winner.id === botTeam?.id ? "bracket-winner" : hasRes ? "bracket-loser" : ""}">
        <span class="bracket-team-name">${botName}</span>
        ${hasRes ? `<span class="bracket-team-score ${botGol > topGol ? "score-win" : "score-loss"}">${botGol}</span>` : ""}
      </div>
      ${hasRes ? `<div style="font-size:10px;color:var(--text2);padding:2px 8px">${topFP?.toFixed(1)} – ${botFP?.toFixed(1)} FP</div>` : ""}
    </div>`;
}

// ── EVENTS ────────────────────────────────────────
function bindPlayoffEvents() {
  // No admin actions available for regular users
}
