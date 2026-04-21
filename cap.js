// ============================================================
// FANTADRAFT — cap.js
// Tab CAP: Salary Cap, proiezioni, penalità, scelte draft
// ============================================================

import { db, ref, get, set, push, update } from "./firebase.js";
import { contractYearCost } from "./utils.js";

// ── INIT ─────────────────────────────────────────
export async function renderCap(leagueId, league, user) {
  const el      = document.getElementById("tab-cap");
  const isAdmin = league.commissionerUid === user.uid;
  const teams   = Object.values(league.teams || {});
  const myTeam  = teams.find(t => t.ownerUid === user.uid);
  const settings = league.settings || {};

  el.innerHTML = `
    <div class="page-header">
      <span class="ph-icon">💰</span>
      <h1>CAP</h1>
    </div>

    <!-- SELETTORE SQUADRA -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <label class="form-label" style="margin:0">Squadra:</label>
      <select class="form-input" id="cap-team-select" style="max-width:240px">
        ${myTeam ? `<option value="${myTeam.id}" selected>🏠 ${myTeam.name} (la mia)</option>` : ""}
        ${teams.filter(t => !myTeam || t.id !== myTeam.id).map(t =>
          `<option value="${t.id}">${t.name} (${t.ownerName})</option>`
        ).join("")}
      </select>
    </div>

    <div id="cap-content">
      <div class="spinner"></div>
    </div>

    ${isAdmin ? buildAdminCapPanel(teams, settings, leagueId) : ""}
  `;

  // Carica dati della prima squadra
  const firstTeamId = myTeam?.id || teams[0]?.id;
  if (firstTeamId) await renderCapTeam(leagueId, league, firstTeamId, isAdmin);

  document.getElementById("cap-team-select")?.addEventListener("change", async e => {
    await renderCapTeam(leagueId, league, e.target.value, isAdmin);
  });

  if (isAdmin) bindAdminCapEvents(leagueId, league, teams, settings);
}

async function renderCapTeam(leagueId, league, teamId, isAdmin) {
  const el       = document.getElementById("cap-content");
  const settings = league.settings || {};
  const team     = Object.values(league.teams || {}).find(t => t.id === teamId);
  if (!team) { el.innerHTML = `<p style="color:var(--text2)">Squadra non trovata</p>`; return; }

  const players  = Object.values(team.players || {});
  const cap      = players.reduce((s, p) => s + (p.currentCost || 0), 0);
  const capLevel = getCapLevel(cap, settings);
  const capMax   = settings.salaryCap || 320;
  const softMax  = settings.softCapMax || 340;
  const hardMax  = settings.hardCapMax || 360;
  const luxThres = settings.luxuryTaxThreshold || 360;
  const penalty  = team.capPenalty || 0;

  // Proiezioni anni successivi
  const proj = buildProjections(players, settings);

  // Scelte draft
  const draftPicks = buildDraftPicksView(team, league);

  el.innerHTML = `
    <!-- KPI CARDS -->
    <div class="card-grid" style="margin-bottom:24px">
      ${capKpiCard("💰", "Cap Attuale", `${cap} FM`, capLevelBadgeHTML(capLevel))}
      ${capKpiCard("📊", "Cap Disponibile", `${Math.max(0, capMax - cap + (penalty < 0 ? penalty : 0))} FM`, `<span style="color:var(--text2);font-size:12px">su ${capMax} FM base</span>`)}
      ${capKpiCard("⚠️", "Penalità", penalty !== 0 ? `${penalty} FM` : "Nessuna", penalty !== 0 ? `<span style="color:var(--red);font-size:12px">dalla stagione precedente</span>` : "")}
      ${capKpiCard("👥", "Giocatori", `${players.length}`, `<span style="color:var(--text2);font-size:12px">Min ${settings.minRosterSize||23} · Max ${settings.maxRosterSize||30}</span>`)}
    </div>

    <!-- CAP BAR -->
    <div class="card" style="margin-bottom:20px">
      <h3 style="font-size:15px;margin-bottom:16px">📊 Livello Salary Cap</h3>
      ${buildCapBar(cap, capMax, softMax, hardMax, luxThres)}
      <div style="display:flex;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${capLegendItem("var(--green)",  `Cap (≤${capMax})`)}
          ${capLegendItem("var(--orange)", `Soft (${capMax+1}–${softMax})`)}
          ${capLegendItem("var(--red)",    `Hard (${softMax+1}–${hardMax})`)}
          ${capLegendItem("var(--purple)", `Luxury (${hardMax+1}+)`)}
        </div>
        <div style="font-family:'Outfit',sans-serif;font-weight:800;font-size:20px;color:var(--accent)">${cap} FM</div>
      </div>

      <!-- Regole cap correnti -->
      <div class="cap-rules-box" style="margin-top:16px">
        ${buildCapRulesBox(capLevel, settings)}
      </div>
    </div>

    <!-- PROIEZIONI -->
    <div class="card" style="margin-bottom:20px">
      <h3 style="font-size:15px;margin-bottom:16px">📈 Proiezione Cap Futura</h3>
      <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
        Stima basata sui contratti pluriennali in corso. Esclude giocatori in scadenza e free agent.
      </p>
      <div class="proj-grid">
        ${proj.map(y => `
          <div class="proj-card ${getCapLevel(y.cap, settings)}">
            <div class="proj-year">Stagione ${y.year}</div>
            <div class="proj-cap">${y.cap} FM</div>
            <div class="proj-badge">${capLevelBadgeHTML(getCapLevel(y.cap, settings))}</div>
            <div class="proj-detail">${y.count} gioc. sotto contratto</div>
          </div>`).join("")}
      </div>

      <!-- Tabella contratti scadenza -->
      <div style="margin-top:20px">
        <h4 style="font-size:13px;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Scadenze contratti</h4>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Giocatore</th><th>Ruolo</th><th>Costo attuale</th>
                <th>Anno 2</th><th>Anno 3</th><th>Scadenza</th>
              </tr>
            </thead>
            <tbody>
              ${players
                .filter(p => !p.bandiera)
                .sort((a,b) => (a.contractYears - a.contractYearsDone) - (b.contractYears - b.contractYearsDone))
                .map(p => {
                  const rem = (p.contractYears || 1) - (p.contractYearsDone || 0);
                  const cost2 = rem >= 2 ? contractYearCost(p.draftCost || p.currentCost, 2, p.under21) : "—";
                  const cost3 = rem >= 3 ? contractYearCost(p.draftCost || p.currentCost, 3, p.under21) : "—";
                  const scad  = rem <= 0 ? `<span style="color:var(--red)">Scaduto</span>`
                              : rem === 1 ? `<span style="color:var(--orange)">Fine stagione</span>`
                              : `<span style="color:var(--green)">${rem} anni</span>`;
                  return `<tr>
                    <td style="font-weight:600">${p.name}</td>
                    <td><span style="font-size:11px;color:var(--text2)">${(p.roles||[]).join("/")}</span></td>
                    <td style="color:var(--accent);font-weight:700">${p.currentCost} FM</td>
                    <td style="color:var(--text2)">${cost2 !== "—" ? cost2 + " FM" : "—"}</td>
                    <td style="color:var(--text2)">${cost3 !== "—" ? cost3 + " FM" : "—"}</td>
                    <td>${scad}</td>
                  </tr>`;
                }).join("")}
              ${players.filter(p => p.bandiera).map(p => `
                <tr>
                  <td style="font-weight:600">${p.name} <span style="color:var(--accent)">⭐</span></td>
                  <td><span style="font-size:11px;color:var(--text2)">${(p.roles||[]).join("/")}</span></td>
                  <td style="color:var(--accent);font-weight:700">${p.currentCost} FM</td>
                  <td style="color:var(--text2)">∞</td><td style="color:var(--text2)">∞</td>
                  <td><span style="color:var(--accent)">Bandiera</span></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- SCELTE DRAFT -->
    <div class="card" style="margin-bottom:20px">
      <h3 style="font-size:15px;margin-bottom:16px">📝 Scelte Draft</h3>
      ${draftPicks}
    </div>
  `;
}

// ── CAP BAR ──────────────────────────────────────
function buildCapBar(cap, capMax, softMax, hardMax, luxThres) {
  const total = luxThres + 20;
  const pct   = v => Math.min(100, (v / total) * 100).toFixed(1);
  const fillPct = Math.min(100, (cap / total) * 100);

  const color = cap <= capMax ? "var(--green)"
              : cap <= softMax ? "var(--orange)"
              : cap <= hardMax ? "var(--red)"
              : "var(--purple)";

  return `
    <div style="position:relative;height:28px;background:var(--bg3);border-radius:14px;overflow:hidden;border:1px solid var(--border)">
      <!-- Zone markers -->
      <div style="position:absolute;left:${pct(capMax)}%;top:0;bottom:0;width:2px;background:rgba(255,255,255,.15)"></div>
      <div style="position:absolute;left:${pct(softMax)}%;top:0;bottom:0;width:2px;background:rgba(255,255,255,.15)"></div>
      <div style="position:absolute;left:${pct(hardMax)}%;top:0;bottom:0;width:2px;background:rgba(255,255,255,.15)"></div>
      <!-- Fill -->
      <div style="height:100%;width:${fillPct}%;background:${color};border-radius:14px;transition:width .5s;box-shadow:0 0 12px ${color}44"></div>
    </div>
    <!-- Labels under bar -->
    <div style="position:relative;height:18px;margin-top:4px;font-size:10px;color:var(--text3)">
      <span style="position:absolute;left:${pct(capMax)}%;transform:translateX(-50%)">${capMax}</span>
      <span style="position:absolute;left:${pct(softMax)}%;transform:translateX(-50%)">${softMax}</span>
      <span style="position:absolute;left:${pct(hardMax)}%;transform:translateX(-50%)">${hardMax}</span>
    </div>`;
}

function buildCapRulesBox(level, settings) {
  const rules = {
    under: [
      "✓ Scambi liberi senza vincoli di costo",
      "✓ Puoi arrivare fino al Soft Cap tramite scambi",
    ],
    soft: [
      "✓ Nessuna penalità di mercato",
      "✓ Scambi liberi senza vincoli di costo",
      `✓ Cap massimo al prossimo Draft: ${settings.softCapMax} FM`,
    ],
    hard: [
      "⚠ Scambi con differenza massima di 10 FM tra giocatori coinvolti",
      `⚠ Cap massimo al prossimo Draft: stessa cifra attuale (max 2 stagioni)`,
      "✓ Puoi tornare nel Soft Cap tramite scambi o svincoli",
    ],
    luxury: [
      "✗ Nessuno scambio consentito",
      "✗ Perdita scelte Draft (1 scelta ogni 2 FM sopra il limite)",
      `✗ Cap al prossimo Draft: ${settings.softCapMax} FM (obbligatorio)`,
      "✗ Penalità di classifica applicabili a fine stagione",
    ],
  };
  const color = { under:"var(--green)", soft:"var(--orange)", hard:"var(--red)", luxury:"var(--purple)" }[level];
  return `<div style="background:rgba(0,0,0,.2);border:1px solid ${color}33;border-radius:8px;padding:14px 16px">
    <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">
      Regole ${capLevelLabel(level)}
    </div>
    ${(rules[level]||[]).map(r => `<div style="font-size:13px;color:var(--text2);margin-bottom:4px">${r}</div>`).join("")}
  </div>`;
}

// ── PROIEZIONI ────────────────────────────────────
function buildProjections(players, settings) {
  const currentYear = new Date().getFullYear();
  const years = [1, 2, 3];
  return years.map(offset => {
    let cap = 0; let count = 0;
    for (const p of players) {
      if (p.bandiera) { cap += p.currentCost || 0; count++; continue; }
      const rem = (p.contractYears || 1) - (p.contractYearsDone || 0);
      if (rem > offset) {
        cap += contractYearCost(p.draftCost || p.currentCost || 0, offset + 1, p.under21);
        count++;
      }
    }
    return { year: currentYear + offset, cap, count };
  });
}

// ── SCELTE DRAFT ──────────────────────────────────
function buildDraftPicksView(team, league) {
  const picks = team.draftPicks || {};
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2];
  const rounds = [1, 2, 3]; // Solo primi 3 giri scambiabili

  // Costruisci griglia
  let html = `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
      Mostrate le prime 3 scelte (scambiabili) per le prossime 3 stagioni.
    </p>
    <div class="picks-grid">
      <div class="picks-header"></div>
      ${years.map(y => `<div class="picks-header">${y}</div>`).join("")}
  `;

  for (const round of rounds) {
    html += `<div class="picks-round-label">${round}° Giro</div>`;
    for (const year of years) {
      const key   = `${year}_round${round}`;
      const pick  = picks[key];
      const owned = !pick || pick.ownerTeamId === team.id; // di default la scelta è propria
      const fromTeam = pick?.fromTeamName || team.name;
      html += `
        <div class="pick-cell ${owned ? "pick-own" : "pick-traded"}">
          ${owned
            ? `<span style="color:var(--green);font-size:11px;font-weight:700">✓ Propria</span>`
            : `<span style="color:var(--orange);font-size:10px">Da ${fromTeam}</span>`}
        </div>`;
    }
  }
  html += `</div>`;

  // Picks ricevute da altri (round 1-3)
  const receivedPicks = Object.entries(picks).filter(([k, v]) => v && v.fromTeamId !== team.id);
  if (receivedPicks.length) {
    html += `<div style="margin-top:16px">
      <h4 style="font-size:13px;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Scelte ricevute da altri manager</h4>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${receivedPicks.map(([k,v]) => `
          <div style="background:rgba(245,197,24,.1);border:1px solid rgba(245,197,24,.3);border-radius:8px;padding:6px 12px;font-size:12px">
            <span style="color:var(--accent);font-weight:700">${v.year} · ${v.round}° Giro</span>
            <span style="color:var(--text2);margin-left:6px">da ${v.fromTeamName}</span>
          </div>`).join("")}
      </div>
    </div>`;
  }

  return html;
}

// ── ADMIN CAP PANEL ───────────────────────────────
function buildAdminCapPanel(teams, settings, leagueId) {
  return `
    <div class="card" style="margin-top:24px;border-color:rgba(245,197,24,.2)">
      <h3 style="font-size:15px;margin-bottom:20px">⚙️ Admin — Gestione CAP & Penalità</h3>

      <!-- Penalità stagione corrente -->
      <div class="admin-section">
        <h4 class="admin-section-title">🏆 Applica penalità fine stagione</h4>
        <p style="color:var(--text2);font-size:13px;margin-bottom:14px">
          Le penalità si applicano automaticamente alla fine della Regular Season in base alla classifica finale.
          Usa questo pannello solo per correzioni manuali.
        </p>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">Squadra</label>
            <select class="form-input" id="admin-penalty-team">
              <option value="">Seleziona squadra</option>
              ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Penalità FM (negativo = riduce cap)</label>
            <input class="form-input" id="admin-penalty-val" type="number" placeholder="Es. -2">
          </div>
          <div class="form-group">
            <label class="form-label">Motivo</label>
            <select class="form-input" id="admin-penalty-reason">
              <option value="ranking_6">6° in classifica (-1 FM)</option>
              <option value="ranking_7">7° in classifica (-2 FM)</option>
              <option value="ranking_8">8° in classifica (-3 FM)</option>
              <option value="ranking_9">9° in classifica (-4 FM)</option>
              <option value="ranking_10">10° in classifica (-6 FM)</option>
              <option value="luxury_tax">Luxury Tax (perdita scelte)</option>
              <option value="manual">Correzione manuale</option>
            </select>
          </div>
        </div>
        <div id="admin-penalty-error" class="form-error"></div>
        <button class="btn btn-primary btn-sm" id="admin-penalty-btn">Applica penalità</button>
      </div>

      <!-- Assegna scelte draft -->
      <div class="admin-section" style="margin-top:24px">
        <h4 class="admin-section-title">📝 Assegna / trasferisci scelta Draft</h4>
        <p style="color:var(--text2);font-size:13px;margin-bottom:14px">
          Registra uno scambio di scelte draft tra due manager. Solo giri 1–3, max 3 stagioni avanti.
        </p>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">Da squadra</label>
            <select class="form-input" id="admin-pick-from">
              <option value="">Seleziona</option>
              ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">A squadra</label>
            <select class="form-input" id="admin-pick-to">
              <option value="">Seleziona</option>
              ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Anno Draft</label>
            <select class="form-input" id="admin-pick-year">
              ${[0,1,2].map(i => { const y = new Date().getFullYear()+i; return `<option value="${y}">${y}</option>`; }).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Giro (1–3)</label>
            <select class="form-input" id="admin-pick-round">
              <option value="1">1° Giro</option>
              <option value="2">2° Giro</option>
              <option value="3">3° Giro</option>
            </select>
          </div>
        </div>
        <div id="admin-pick-error" class="form-error"></div>
        <button class="btn btn-primary btn-sm" id="admin-pick-btn">Trasferisci scelta</button>
      </div>

    </div>`;
}

function bindAdminCapEvents(leagueId, league, teams, settings) {
  // Penalità
  document.getElementById("admin-penalty-btn")?.addEventListener("click", async () => {
    const teamId = document.getElementById("admin-penalty-team").value;
    const val    = parseInt(document.getElementById("admin-penalty-val").value) || 0;
    const reason = document.getElementById("admin-penalty-reason").value;
    const errEl  = document.getElementById("admin-penalty-error");
    if (!teamId) { errEl.textContent = "Seleziona una squadra"; return; }
    try {
      await update(ref(db, `leagues/${leagueId}/teams/${teamId}`), { capPenalty: val });
      // Log
      await push(ref(db, `leagues/${leagueId}/capLog`), {
        teamId, type: "penalty", val, reason, at: Date.now(),
      });
      errEl.style.color = "var(--green)";
      errEl.textContent = "✓ Penalità applicata";
      setTimeout(() => errEl.textContent = "", 3000);
    } catch(e) { errEl.textContent = e.message; }
  });

  // Trasferisci scelta
  document.getElementById("admin-pick-btn")?.addEventListener("click", async () => {
    const fromId = document.getElementById("admin-pick-from").value;
    const toId   = document.getElementById("admin-pick-to").value;
    const year   = document.getElementById("admin-pick-year").value;
    const round  = document.getElementById("admin-pick-round").value;
    const errEl  = document.getElementById("admin-pick-error");
    if (!fromId || !toId)     { errEl.textContent = "Seleziona entrambe le squadre"; return; }
    if (fromId === toId)      { errEl.textContent = "Le squadre devono essere diverse"; return; }
    const fromTeam = teams.find(t => t.id === fromId);
    const toTeam   = teams.find(t => t.id === toId);
    const pickKey  = `${year}_round${round}`;
    try {
      const pickData = {
        year: parseInt(year), round: parseInt(round),
        fromTeamId: fromId, fromTeamName: fromTeam.name,
        toTeamId: toId, toTeamName: toTeam.name,
        ownerTeamId: toId, transferredAt: Date.now(),
      };
      // Aggiorna picks della squadra destinataria
      await update(ref(db, `leagues/${leagueId}/teams/${toId}/draftPicks`), { [pickKey]: pickData });
      // Marca la scelta come ceduta per la squadra cedente
      await update(ref(db, `leagues/${leagueId}/teams/${fromId}/draftPicks`), {
        [pickKey]: { ...pickData, ownerTeamId: toId, traded: true },
      });
      errEl.style.color = "var(--green)";
      errEl.textContent = `✓ Scelta ${year} giro ${round} trasferita da ${fromTeam.name} a ${toTeam.name}`;
      setTimeout(() => errEl.textContent = "", 4000);
    } catch(e) { errEl.textContent = e.message; }
  });
}

// ── HELPERS ──────────────────────────────────────
function capKpiCard(icon, label, value, sub = "") {
  return `
    <div class="stat-card">
      <span class="sc-icon">${icon}</span>
      <div>
        <div class="sc-label">${label}</div>
        <div class="sc-value">${value}</div>
        ${sub ? `<div style="margin-top:2px">${sub}</div>` : ""}
      </div>
    </div>`;
}

function getCapLevel(cap, settings) {
  if (!settings) return "under";
  const { salaryCap, softCapMax, luxuryTaxThreshold } = settings;
  if (cap <= salaryCap)          return "under";
  if (cap <= softCapMax)         return "soft";
  if (cap <= luxuryTaxThreshold) return "hard";
  return "luxury";
}

function capLevelLabel(level) {
  return { under:"✓ Cap", soft:"Soft Cap", hard:"Hard Cap", luxury:"Luxury Tax" }[level] || level;
}

function capLevelBadgeHTML(level) {
  const cls = { under:"badge-cap", soft:"badge-soft", hard:"badge-hard", luxury:"badge-luxury" }[level] || "";
  return `<span class="badge ${cls}">${capLevelLabel(level)}</span>`;
}

function capLegendItem(color, label) {
  return `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)">
    <div style="width:10px;height:10px;border-radius:2px;background:${color}"></div>${label}
  </div>`;
}
