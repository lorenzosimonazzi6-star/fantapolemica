// ============================================================
// FANTADRAFT — lottery.js
// Tab Lottery: probabilità anti-tanking, simulazione estrazione,
// ordine draft finale (giri 2+)
// ============================================================

import { db, ref, get } from "./firebase.js";
import { fpToGoals } from "./utils.js";

// Probabilità base per posizione (4°–10°)
// I top 3 non partecipano
const BASE_PROBS = { 4:10, 5:10, 6:10, 7:15, 8:15, 9:20, 10:20 };

// ── INIT ─────────────────────────────────────────
export async function renderLottery(leagueId, league, user) {
  const el      = document.getElementById("tab-lottery");
  const teams   = Object.values(league.teams || {});
  const settings = league.settings || {};

  // Carica standings regular season e dati lottery
  const [scoresSnap, scheduleSnap, lotterySnap] = await Promise.all([
    get(ref(db, `leagues/${leagueId}/scores`)),
    get(ref(db, `leagues/${leagueId}/schedule`)),
    get(ref(db, `leagues/${leagueId}/lottery`)),
  ]);

  const scores   = scoresSnap.val()   || {};
  const schedule = scheduleSnap.val() || {};
  const lotteryData = lotterySnap.val() || {};

  // Calcola standings
  const standings = calcStandings(teams, scores, schedule);

  // Calcola probabilità anti-tanking
  const lotteryTeams = calcLotteryProbabilities(standings);

  // Ordine giri 2+ (inverso classifica RS)
  const draftOrder = calcDraftOrder(standings, lotteryData);

  el.innerHTML = buildLotteryHTML(standings, lotteryTeams, draftOrder, lotteryData);
  bindLotteryEvents();
}

// ── STANDINGS ─────────────────────────────────────
function calcStandings(teams, scores, schedule) {
  const map = {};
  for (const t of teams) map[t.id] = { team: t, pt:0, v:0, fp:0 };
  for (const [gw, matches] of Object.entries(schedule)) {
    if (parseInt(gw) > 34) continue;
    for (const match of (matches || [])) {
      const hSc = scores[match.homeId]?.[gw];
      const aSc = scores[match.awayId]?.[gw];
      if (!hSc || !aSc || !map[match.homeId] || !map[match.awayId]) continue;
      const hG = fpToGoals(hSc.fp || 0);
      const aG = fpToGoals(aSc.fp || 0);
      map[match.homeId].fp += hSc.fp || 0;
      map[match.awayId].fp += aSc.fp || 0;
      if (hG > aG) { map[match.homeId].v++; map[match.homeId].pt += 3; }
      else if (aG > hG) { map[match.awayId].v++; map[match.awayId].pt += 3; }
      else { map[match.homeId].pt++; map[match.awayId].pt++; }
    }
  }
  return Object.values(map).sort((a,b) => (b.pt-a.pt) || (b.v-a.v) || (b.fp-a.fp));
}

// ── LOTTERY PROBABILITY CALC ──────────────────────
export function calcLotteryProbabilities(standings) {
  const n = standings.length;
  // Squadre che partecipano: dal 4° in giù (esclusi top 3)
  const participants = standings.slice(3); // posizione 4,5,6,...
  if (!participants.length) return [];

  // FP range per anti-tanking
  const fps    = participants.map(s => s.fp);
  const fpMax  = Math.max(...fps);
  const fpMin  = Math.min(...fps);
  const fpRange = fpMax - fpMin;

  // Calcola IT (Indice Tank) e FC (Fattore Correzione)
  const withIT = participants.map((s, i) => {
    const pos    = i + 4; // posizione in classifica (4,5,6,...)
    const basePct = BASE_PROBS[pos] || BASE_PROBS[10] || 10;
    const it     = fpRange > 0 ? (s.fp - fpMin) / fpRange : 1;
    const fc     = 0.75 + 0.25 * it;
    const raw    = basePct * fc;
    return { ...s, pos, basePct, it, fc, raw };
  });

  // Clausola anti-scostamento estremo (>100 FP diff dalla squadra sopra)
  const withPenalty = withIT.map((s, i) => {
    let rawFinal = s.raw;
    if (i > 0) {
      const above = withIT[i - 1];
      if (above.fp - s.fp > 100) rawFinal *= 0.90; // -10%
    }
    return { ...s, rawFinal };
  });

  // Normalizza al 100%
  const totalRaw = withPenalty.reduce((sum, s) => sum + s.rawFinal, 0);
  return withPenalty.map(s => ({
    ...s,
    finalPct: Math.round((s.rawFinal / totalRaw) * 1000) / 10, // 1 decimale
  }));
}

// ── DRAFT ORDER (giri 2+) ─────────────────────────
function calcDraftOrder(standings, lotteryData) {
  // Giro 1: determinato dalla lottery (estrazione)
  // Giri 2+: inverso classifica RS
  const reverseOrder = [...standings].reverse().map(s => s.team);

  // Se la lottery è già stata eseguita, integra l'ordine del giro 1
  const round1 = lotteryData.results || []; // [{ teamId, pick: 1|2|3 }]

  return { reverseOrder, round1 };
}

// ── DRAFT ORDER TABLE (tutti i giri) ─────────────
function buildDraftOrderTable(standings, lotteryData, lotteryTeams) {
  const n = standings.length;
  if (!n) return "";

  // Ordine inverso classifica per giri 2+
  const reverseStandings = [...standings].reverse();

  // Giro 1: se lottery eseguita usa quell'ordine, altrimenti placeholder
  const round1Results = lotteryData.results || [];
  const lotteryDone   = round1Results.length === 3;

  // Costruisci ordine giro 1
  let round1Order = [];
  if (lotteryDone) {
    // Le prime 3 slot sono i vincitori della lottery nell'ordine di estrazione
    const picked = new Set(round1Results.map(r => r.teamId));
    // Dal 4° in poi: ordine inverso classifica, saltando i già estratti
    const rest = reverseStandings.filter(s => !picked.has(s.team.id));
    round1Order = [
      ...round1Results.map(r => ({
        team: standings.find(s => s.team.id === r.teamId)?.team,
        fromLottery: true, pick: r.pick,
      })),
      ...rest.map(s => ({ team: s.team, fromLottery: false })),
    ];
  } else {
    round1Order = reverseStandings.map(s => ({ team: s.team, fromLottery: false }));
  }

  // Scelte cedute (da draftPicks di ogni team)
  // Per ora mostra solo l'ordine base (le cedute si vedono nel CAP)

  const year = new Date().getFullYear();
  const MAX_ROUNDS = 12; // mostra max 12 giri

  return `
    <div class="table-wrap">
      <table class="table" style="font-size:11px">
        <thead>
          <tr>
            <th>Slot</th>
            ${Array.from({length: MAX_ROUNDS}, (_,i) => `
              <th class="tc" style="${i===0 ? "color:var(--accent)" : ""}">
                ${i+1}° Giro ${i===0 ? "<br><small>Lottery</small>" : ""}
              </th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${round1Order.map((entry, slotIdx) => {
            const team = entry.team;
            if (!team) return "";
            return `<tr>
              <td style="color:var(--text2);font-weight:600">${slotIdx+1}°
                <span style="color:var(--text3);font-size:10px;display:block">${team.name.split(" ").slice(-1)}</span>
              </td>
              ${Array.from({length: MAX_ROUNDS}, (_, roundIdx) => {
                if (roundIdx === 0) {
                  // Giro 1: lottery
                  return `<td class="tc">
                    <span style="background:${entry.fromLottery ? "rgba(245,197,24,.2)" : "var(--bg3)"};color:${entry.fromLottery ? "var(--accent)" : "var(--text2)"};border-radius:4px;padding:2px 6px;font-weight:700;font-size:10px">
                      ${team.ownerName || team.name}
                      ${entry.fromLottery ? `<br><span style="font-size:9px">Lottery</span>` : ""}
                    </span>
                  </td>`;
                } else {
                  // Giri 2+: ordine inverso classifica
                  const orderIdx = slotIdx % n;
                  const teamForSlot = reverseStandings[orderIdx]?.team;
                  return `<td class="tc" style="color:var(--text2)">
                    <span style="font-size:10px">${teamForSlot?.ownerName || "—"}</span>
                  </td>`;
                }
              }).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

// ── HTML ──────────────────────────────────────────
function buildLotteryHTML(standings, lotteryTeams, draftOrder, lotteryData) {
  const lotteryDone   = (lotteryData.results || []).length === 3;
  const currentYear   = new Date().getFullYear();

  return `
    <div class="page-header">
      <span class="ph-icon">🎰</span>
      <h1>Lottery Draft</h1>
    </div>

    <!-- INFO -->
    <div class="playoff-info-box" style="margin-bottom:20px">
      <strong>Come funziona:</strong> 3 estrazioni determinano i primi 3 slot al Draft.
      Le squadre 4°–10° partecipano con probabilità corrette per anti-tanking.
      I primi 3 classificati non partecipano alla Lottery.
    </div>

    <!-- RISULTATO ESTRAZIONE -->
    ${lotteryDone ? buildExtractionResult(lotteryData.results, standings) : ""}

    <!-- PROBABILITÀ TABLE -->
    <div class="card" style="margin-bottom:20px">
      <h3 style="font-size:15px;margin-bottom:16px">📊 Probabilità Lottery</h3>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Manager</th>
              <th>Squadra</th>
              <th class="tc">FantaPunti</th>
              <th class="tc">Prob. Base</th>
              <th class="tc">FC</th>
              <th class="tc">Prob. Finale</th>
            </tr>
          </thead>
          <tbody>
            <!-- Top 3: non partecipano -->
            ${standings.slice(0,3).map((s,i) => `
              <tr style="opacity:.5">
                <td style="color:var(--accent);font-weight:700">${i+1}°</td>
                <td>${s.team.ownerName}</td>
                <td style="font-size:12px;color:var(--text2)">${s.team.name}</td>
                <td class="tc" style="color:var(--blue)">${s.fp.toFixed(1)}</td>
                <td class="tc">—</td>
                <td class="tc">—</td>
                <td class="tc" style="color:var(--text3);font-size:11px">Top 3 – non partecipa</td>
              </tr>`).join("")}
            <!-- Partecipanti lottery -->
            ${lotteryTeams.map(s => `
              <tr>
                <td style="font-weight:700">${s.pos}°</td>
                <td style="font-weight:600">${s.team.ownerName}</td>
                <td style="font-size:12px;color:var(--text2)">${s.team.name}</td>
                <td class="tc" style="color:var(--blue)">${s.fp.toFixed(1)}</td>
                <td class="tc" style="color:var(--text2)">${s.basePct}%</td>
                <td class="tc" style="color:var(--text2)">${(s.fc*100).toFixed(0)}%</td>
                <td class="tc">
                  <span style="font-weight:800;color:var(--green);font-size:14px">${s.finalPct}%</span>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ORDINE DRAFT -->
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:4px">📋 Ordine di Scelta Draft ${currentYear}</h3>
      <p style="color:var(--text2);font-size:12px;margin-bottom:16px">
        Giro 1: determinato dalla Lottery. Giri 2+: ordine inverso classifica Regular Season.
      </p>
      ${buildDraftOrderTable(standings, lotteryData, lotteryTeams)}
    </div>
  `;
}

function buildExtractionResult(results, standings) {
  return `
    <div class="card" style="margin-bottom:20px;border-color:rgba(245,197,24,.3);background:rgba(245,197,24,.03)">
      <h3 style="font-size:15px;margin-bottom:14px;color:var(--accent)">🎰 Risultato Estrazione</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${results.map(r => {
          const s = standings.find(st => st.team.id === r.teamId);
          return `
            <div style="background:var(--bg3);border:1px solid rgba(245,197,24,.3);border-radius:10px;padding:16px 20px;text-align:center;min-width:140px">
              <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Pick ${r.pick}</div>
              <div style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:900;color:var(--accent)">${r.pick}°</div>
              <div style="font-weight:700;font-size:14px;margin-top:4px">${s?.team?.ownerName || "—"}</div>
              <div style="font-size:11px;color:var(--text2)">${s?.team?.name || "—"}</div>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── EVENTS ────────────────────────────────────────
function bindLotteryEvents() {
  // No admin actions available for regular users
}

