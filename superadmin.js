// ============================================================
// FANTADRAFT — superadmin.js
// Pannello Superadmin: gestione DB giocatori globale e voti
// Accessibile solo agli UID in SUPERADMIN_UIDS
// ============================================================

import { db, ref, get, set, push, update, isSuperAdmin, PATH_DB_GIOCATORI, PATH_VOTI } from "./firebase.js";
import { parseCSVRose, roleColor, calcAge } from "./utils.js";
import { SERIE_A_CLUBS } from "./matches.js";

// ── INIT ─────────────────────────────────────────
export async function renderSuperAdmin(user) {
  const el = document.getElementById("tab-superadmin");

  if (!isSuperAdmin(user.uid)) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🔒</div>
        <h3>Accesso negato</h3>
        <p>Questa sezione è riservata al Superadmin.</p>
      </div>`;
    return;
  }

  // Carica stats DB globale
  const dbSnap = await get(ref(db, PATH_DB_GIOCATORI));
  const dbPlayers = dbSnap.val() || {};
  const dbCount   = Object.keys(dbPlayers).length;

  // Conta per squadra
  const byTeam = {};
  Object.values(dbPlayers).forEach(p => { byTeam[p.team] = (byTeam[p.team]||0)+1; });

  el.innerHTML = buildSuperAdminHTML(dbPlayers, dbCount, byTeam);
  bindSuperAdminEvents(dbPlayers);
}

// ── HTML ──────────────────────────────────────────
function buildSuperAdminHTML(dbPlayers, dbCount, byTeam) {
  const missingTeams = SERIE_A_CLUBS.filter(t => !byTeam[t]);

  return `
    <div class="page-header">
      <span class="ph-icon">🔑</span>
      <h1>Superadmin <span style="color:var(--accent)">Globale</span></h1>
    </div>

    <!-- KPI -->
    <div class="card-grid" style="margin-bottom:24px">
      <div class="stat-card">
        <span class="sc-icon">🗄️</span>
        <div>
          <div class="sc-label">Giocatori nel DB</div>
          <div class="sc-value" style="color:${dbCount>0?"var(--green)":"var(--red)"}">${dbCount}</div>
        </div>
      </div>
      <div class="stat-card">
        <span class="sc-icon">⚽</span>
        <div>
          <div class="sc-label">Squadre caricate</div>
          <div class="sc-value" style="color:${Object.keys(byTeam).length===20?"var(--green)":"var(--orange)"}">
            ${Object.keys(byTeam).length} / 20
          </div>
        </div>
      </div>
    </div>

    <div class="admin-sections">

      <!-- DB GIOCATORI -->
      ${saSection("sa-db", "🗄️", "Database Giocatori Globale", `
        <p style="color:var(--text2);font-size:13px;margin-bottom:12px">
          Il database è condiviso tra tutte le leghe della piattaforma.<br>
          Formato CSV: <code style="color:var(--accent)">Ruolo;Ruolo Mantra;Nome;Squadra;Quotazione;DataNascita</code>
        </p>

        ${missingTeams.length > 0 ? `
        <div style="background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--orange);margin-bottom:14px">
          ⚠ Squadre mancanti: ${missingTeams.join(", ")}
        </div>` : dbCount > 0 ? `
        <div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--green);margin-bottom:14px">
          ✓ Tutte le 20 squadre presenti · ${dbCount} giocatori totali
        </div>` : ""}

        ${dbCount > 0 ? `
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text2);margin-bottom:14px;max-height:80px;overflow-y:auto">
          ${Object.entries(byTeam).sort((a,b)=>a[0].localeCompare(b[0])).map(([t,n])=>`<span style="margin-right:12px">${t}: ${n}</span>`).join("")}
        </div>` : ""}

        <div class="upload-zone" id="sa-csv-zone">
          <span style="font-size:36px">📂</span>
          <p>Trascina il CSV qui oppure</p>
          <label class="btn btn-primary btn-sm" style="cursor:pointer">
            Carica CSV giocatori
            <input type="file" id="sa-csv-input" accept=".csv" style="display:none">
          </label>
        </div>
        <div id="sa-csv-status" style="margin-top:12px;font-size:13px"></div>

        ${dbCount > 0 ? `
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" id="sa-clear-db-btn" style="color:var(--red)">
            🗑️ Svuota DB globale
          </button>
          <button class="btn btn-secondary btn-sm" id="sa-search-btn">
            🔍 Cerca giocatore
          </button>
        </div>
        <div id="sa-search-wrap" class="hidden" style="margin-top:12px">
          <input class="form-input" id="sa-search-input" placeholder="Nome giocatore..." style="max-width:300px">
          <div id="sa-search-results" style="margin-top:8px"></div>
        </div>` : ""}
      `)}

      <!-- VOTI GLOBALI -->
      ${saSection("sa-voti", "⚽", "Voti Globali Sofascore", `
        <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
          I voti sono condivisi tra tutte le leghe. Il poller li aggiorna automaticamente ogni 5 minuti durante le partite.
          Usa questo pannello per correzioni manuali o per importare una giornata specifica.
        </p>

        <div class="form-grid" style="margin-bottom:14px">
          <div class="form-group">
            <label class="form-label">Squadra di Serie A</label>
            <select class="form-input" id="sa-voti-team">
              <option value="">Seleziona squadra...</option>
              ${SERIE_A_CLUBS.map(t => `<option value="${t}">${t}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Giornata</label>
            <input class="form-input" id="sa-voti-gw" type="number" min="1" max="38" placeholder="Es. 33" style="max-width:100px">
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn btn-secondary btn-sm" id="sa-voti-load-btn">📂 Carica voti</button>
          <button class="btn btn-ghost btn-sm" id="sa-voti-clear-btn" style="color:var(--red)">🗑️ Cancella voti squadra+GW</button>
        </div>

        <div id="sa-voti-form" style="margin-bottom:14px"></div>
        <div id="sa-voti-error" class="form-error" style="margin-bottom:8px"></div>
        <button class="btn btn-primary btn-sm hidden" id="sa-voti-save-btn">💾 Salva voti</button>
      `)}

      <!-- IMPORT SOFASCORE MANUALE -->
      ${saSection("sa-sofa", "📊", "Import Sofascore manuale", `
        <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
          Importa i voti di una partita specifica da Sofascore usando l'eventId.
          L'eventId si trova nell'URL di Sofascore: <code style="color:var(--accent)">sofascore.com/...partita.../EVENTID</code>
        </p>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">Event ID Sofascore</label>
            <input class="form-input" id="sa-sofa-eventid" placeholder="Es. 13981743">
          </div>
          <div class="form-group">
            <label class="form-label">Squadra Casa</label>
            <select class="form-input" id="sa-sofa-home">
              <option value="">Seleziona...</option>
              ${SERIE_A_CLUBS.map(t => `<option value="${t}">${t}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Squadra Trasferta</label>
            <select class="form-input" id="sa-sofa-away">
              <option value="">Seleziona...</option>
              ${SERIE_A_CLUBS.map(t => `<option value="${t}">${t}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Giornata</label>
            <input class="form-input" id="sa-sofa-gw" type="number" min="1" max="38" placeholder="Es. 33">
          </div>
        </div>
        <div id="sa-sofa-error" class="form-error" style="margin-bottom:8px"></div>
        <button class="btn btn-primary btn-sm" id="sa-sofa-import-btn">📊 Importa da Sofascore</button>
        <div id="sa-sofa-result" style="font-size:13px;margin-top:8px"></div>
      `)}

      <!-- OVERVIEW LEGHE -->
      ${saSection("sa-leagues", "🏆", "Overview Leghe", `
        <div id="sa-leagues-list">
          <div class="spinner" style="margin:20px auto"></div>
        </div>
        <button class="btn btn-secondary btn-sm" id="sa-leagues-load-btn" style="margin-top:12px">
          🔄 Carica leghe
        </button>
      `)}

    </div>
  `;
}

function saSection(id, icon, title, content) {
  return `
    <div class="admin-acc-item" id="${id}">
      <div class="admin-acc-header" data-section="${id}">
        <span>${icon} ${title}</span>
        <span class="admin-acc-chevron">▼</span>
      </div>
      <div class="admin-acc-body hidden">${content}</div>
    </div>`;
}

// ── EVENTS ────────────────────────────────────────
function bindSuperAdminEvents(dbPlayers) {

  // Accordion
  document.getElementById("tab-superadmin")?.addEventListener("click", e => {
    const hdr = e.target.closest(".admin-acc-header");
    if (!hdr) return;
    const body = hdr.nextElementSibling;
    body?.classList.toggle("hidden");
    hdr.querySelector(".admin-acc-chevron").textContent =
      body?.classList.contains("hidden") ? "▼" : "▲";
  });

  // ── CSV UPLOAD ──
  const csvInput = document.getElementById("sa-csv-input");
  csvInput?.addEventListener("change", () => handleCSVUpload());

  const zone = document.getElementById("sa-csv-zone");
  zone?.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone?.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone?.addEventListener("drop", e => {
    e.preventDefault(); zone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) {
      csvInput.files = e.dataTransfer.files;
      handleCSVUpload();
    }
  });

  // ── SVUOTA DB ──
  document.getElementById("sa-clear-db-btn")?.addEventListener("click", async () => {
    if (!confirm("Svuotare il DB globale? Tutte le leghe perderanno i riferimenti ai giocatori.")) return;
    await set(ref(db, PATH_DB_GIOCATORI), null);
    saStatus("sa-csv-status", "✓ DB globale svuotato", "green");
    setTimeout(() => location.reload(), 1000);
  });

  // ── CERCA GIOCATORE ──
  document.getElementById("sa-search-btn")?.addEventListener("click", () => {
    document.getElementById("sa-search-wrap")?.classList.toggle("hidden");
  });
  document.getElementById("sa-search-input")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase().trim();
    const results = document.getElementById("sa-search-results");
    if (!results) return;
    if (q.length < 2) { results.innerHTML = ""; return; }
    const matches = Object.values(dbPlayers)
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 10);
    if (!matches.length) { results.innerHTML = `<p style="color:var(--text2);font-size:13px">Nessun risultato</p>`; return; }
    results.innerHTML = `<div class="player-search-results">
      ${matches.map(p => {
        const age = p.dataNascita ? calcAge(p.dataNascita) : null;
        return `<div class="player-result-item" style="pointer-events:none">
          <span class="rose-role-badge" style="background:${roleColor(p.roles?.[0])};font-size:9px">${(p.roles||[]).join("/")}</span>
          <span style="flex:1;font-size:12px">${p.name}</span>
          <span style="color:var(--text2);font-size:11px">${p.team}</span>
          <span style="color:var(--accent);font-size:11px">${p.quotazione} FM</span>
          ${age!==null?`<span style="color:var(--text2);font-size:11px">${age}a</span>`:""}
        </div>`;
      }).join("")}
    </div>`;
  });

  // ── VOTI: CARICA ──
  document.getElementById("sa-voti-load-btn")?.addEventListener("click", async () => {
    const team = document.getElementById("sa-voti-team").value;
    const gw   = document.getElementById("sa-voti-gw").value;
    const errEl = document.getElementById("sa-voti-error");
    if (!team || !gw) { errEl.textContent = "Seleziona squadra e giornata"; return; }

    const snap  = await get(ref(db, `${PATH_VOTI}/${team}/${gw}`));
    const voti  = snap.val() || {};
    const form  = document.getElementById("sa-voti-form");

    form.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">
        Voti ${team} — GW${gw} (${Object.keys(voti).length} giocatori)
      </div>
      <div style="max-height:320px;overflow-y:auto">
        <table class="table" style="font-size:12px">
          <thead><tr><th>Giocatore</th><th class="tc">Voto</th><th class="tc">SV</th><th>Flags</th></tr></thead>
          <tbody>
            ${Object.entries(voti).map(([nome, entry]) => `
              <tr>
                <td>${nome}</td>
                <td class="tc"><input type="number" step="0.1" min="1" max="10"
                  class="form-input sa-voto-input" data-nome="${nome}" data-field="v"
                  value="${entry.v ?? ""}" style="width:65px;padding:4px 6px;font-size:12px"
                  ${entry.sv ? "disabled" : ""}></td>
                <td class="tc"><input type="checkbox" class="sa-sv-input" data-nome="${nome}"
                  ${entry.sv ? "checked" : ""}></td>
                <td style="font-size:11px;color:var(--text2)">${buildFlagsStr(entry.flags||{})}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    document.getElementById("sa-voti-save-btn")?.classList.remove("hidden");

    // Toggle SV disabilita il campo voto
    form.querySelectorAll(".sa-sv-input").forEach(chk => {
      chk.addEventListener("change", () => {
        const inp = form.querySelector(`.sa-voto-input[data-nome="${chk.dataset.nome}"]`);
        if (inp) inp.disabled = chk.checked;
      });
    });
  });

  // ── VOTI: SALVA ──
  document.getElementById("sa-voti-save-btn")?.addEventListener("click", async () => {
    const team  = document.getElementById("sa-voti-team").value;
    const gw    = document.getElementById("sa-voti-gw").value;
    const btn   = document.getElementById("sa-voti-save-btn");
    const errEl = document.getElementById("sa-voti-error");
    btn.disabled = true; btn.textContent = "⏳"; errEl.textContent = "";
    try {
      const updates = {};
      document.querySelectorAll(".sa-voto-input").forEach(inp => {
        const nome = inp.dataset.nome;
        const sv   = document.querySelector(`.sa-sv-input[data-nome="${nome}"]`)?.checked;
        const v    = parseFloat(inp.value);
        const key  = `${PATH_VOTI}/${team}/${gw}/${nome.replace(/[.#$[\]]/g,"_")}`;
        if (sv) {
          updates[key] = { sv: true, flags: {}, source: "manual" };
        } else if (!isNaN(v)) {
          updates[key] = { v, sv: false, flags: {}, source: "manual" };
        }
      });
      await update(ref(db), updates);
      saStatus("sa-voti-error", `✓ Voti ${team} GW${gw} salvati`, "green");
    } catch(e) { errEl.style.color="var(--red)"; errEl.textContent = e.message; }
    finally { btn.disabled=false; btn.textContent="💾 Salva voti"; }
  });

  // ── VOTI: CANCELLA ──
  document.getElementById("sa-voti-clear-btn")?.addEventListener("click", async () => {
    const team = document.getElementById("sa-voti-team").value;
    const gw   = document.getElementById("sa-voti-gw").value;
    if (!team || !gw) { document.getElementById("sa-voti-error").textContent = "Seleziona squadra e giornata"; return; }
    if (!confirm(`Cancellare tutti i voti di ${team} GW${gw}?`)) return;
    await set(ref(db, `${PATH_VOTI}/${team}/${gw}`), null);
    saStatus("sa-voti-error", "✓ Voti cancellati", "green");
    document.getElementById("sa-voti-form").innerHTML = "";
    document.getElementById("sa-voti-save-btn")?.classList.add("hidden");
  });

  // ── IMPORT SOFASCORE MANUALE ──
  document.getElementById("sa-sofa-import-btn")?.addEventListener("click", async () => {
    const eventId = document.getElementById("sa-sofa-eventid").value.trim();
    const home    = document.getElementById("sa-sofa-home").value;
    const away    = document.getElementById("sa-sofa-away").value;
    const gw      = document.getElementById("sa-sofa-gw").value;
    const errEl   = document.getElementById("sa-sofa-error");
    const resEl   = document.getElementById("sa-sofa-result");
    const btn     = document.getElementById("sa-sofa-import-btn");

    if (!eventId || !home || !away || !gw) { errEl.textContent = "Compila tutti i campi"; return; }
    btn.disabled = true; btn.textContent = "⏳ Importando..."; errEl.textContent = ""; resEl.textContent = "";

    try {
      const res  = await fetch(`/.netlify/functions/sofascore-proxy?eventId=${eventId}`);
      const data = await res.json();
      if (data.unavailable) throw new Error("Partita non disponibile su Sofascore");

      const updates = {};
      for (const side of ["home", "away"]) {
        const squadra = side === "home" ? home : away;
        for (const p of (data[side] || [])) {
          const key = `${PATH_VOTI}/${squadra}/${gw}/${p.name.replace(/[.#$[\]]/g,"_")}`;
          updates[key] = p.didNotPlay
            ? { sv: true, flags: p.flags||{}, source: "sofascore" }
            : { v: p.rating, sv: false, flags: p.flags||{}, source: "sofascore" };
        }
      }
      await update(ref(db), updates);
      const nHome = data.home?.length || 0;
      const nAway = data.away?.length || 0;
      resEl.style.color = "var(--green)";
      resEl.textContent = `✓ ${home} (${nHome}) - ${away} (${nAway}) · GW${gw} importata`;
    } catch(e) {
      errEl.style.color = "var(--red)"; errEl.textContent = "✗ " + e.message;
    } finally {
      btn.disabled = false; btn.textContent = "📊 Importa da Sofascore";
    }
  });

  // ── OVERVIEW LEGHE ──
  document.getElementById("sa-leagues-load-btn")?.addEventListener("click", async () => {
    const el   = document.getElementById("sa-leagues-list");
    el.innerHTML = `<div class="spinner" style="margin:20px auto"></div>`;
    const snap = await get(ref(db, "leagues"));
    const leagues = snap.val() || {};
    const list = Object.values(leagues);
    if (!list.length) { el.innerHTML = `<p style="color:var(--text2);font-size:13px">Nessuna lega trovata</p>`; return; }
    el.innerHTML = list.map(l => `
      <div class="team-row" style="margin-bottom:8px">
        <div>
          <div class="team-row-name">${l.name}</div>
          <div class="team-row-owner" style="font-size:11px">
            ${Object.keys(l.teams||{}).length} manager ·
            GW${l.settings?.gwStart||1}–GW${l.settings?.gwEnd||34} ·
            Stato: ${l.status||"setup"}
          </div>
        </div>
        <span class="badge badge-accent" style="font-size:10px">${l.settings?.salaryCap||320} FM</span>
      </div>`).join("");
  });
}

// ── CSV UPLOAD ────────────────────────────────────
async function handleCSVUpload() {
  const input  = document.getElementById("sa-csv-input");
  const status = document.getElementById("sa-csv-status");
  const file   = input?.files?.[0];
  if (!file) return;

  status.style.color = "var(--text2)";
  status.textContent = "⏳ Caricamento in corso...";

  try {
    const text    = await file.text();
    const players = parseCSVRose(text);
    if (!players.length) throw new Error("Nessun giocatore trovato nel CSV");

    // Carica a chunks da 200
    let count = 0;
    for (let i = 0; i < players.length; i += 200) {
      const chunk   = players.slice(i, i+200);
      const updates = {};
      for (const p of chunk) {
        updates[p.name.replace(/[.#$[\]]/g,"_")] = p;
        count++;
      }
      await update(ref(db, PATH_DB_GIOCATORI), updates);
    }

    status.style.color = "var(--green)";
    status.textContent = `✓ ${count} giocatori caricati nel DB globale da ${file.name}`;
    setTimeout(() => location.reload(), 1500);
  } catch(e) {
    status.style.color = "var(--red)";
    status.textContent = `✗ Errore: ${e.message}`;
  }
}

// ── HELPERS ──────────────────────────────────────
function buildFlagsStr(flags) {
  const parts = [];
  if (flags.gol)    parts.push(`⚽×${flags.gol}`);
  if (flags.assist) parts.push(`🅰×${flags.assist}`);
  if (flags.aut)    parts.push(`🙈×${flags.aut}`);
  if (flags.amm)    parts.push("🟨");
  if (flags.esp)    parts.push("🟥");
  if (flags.rig)    parts.push("❌");
  if (flags.pi)     parts.push("🧤");
  if (flags.rigpar) parts.push(`🛡×${flags.rigpar}`);
  if (flags.gs)     parts.push(`⬅×${flags.gs}`);
  return parts.join(" ") || "—";
}

function saStatus(elId, msg, color) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.style.color = color === "green" ? "var(--green)" : "var(--red)";
  el.textContent = msg;
  setTimeout(() => el.textContent = "", 3000);
}
