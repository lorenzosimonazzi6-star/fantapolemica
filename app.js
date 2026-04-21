// ============================================================
// FANTADRAFT — app.js
// Controller principale — routing tab, auth state, UI
// ============================================================

import {
  auth, db,
  registerUser, loginUser, logoutUser,
  getUserProfile, createLeague, joinLeague,
  getLeague,
  ref, get, onValue, off,
  onAuthStateChanged,
  translateAuthError,
  capLevelLabel, capLevelBadgeClass,
} from "./firebase.js";

import { renderRose       as _renderRose       } from "./rose.js";
import { renderCap        as _renderCap        } from "./cap.js";
import { renderCalendario as _renderCalendario, destroyCalendario } from "./calendario.js";
import { renderFormazioni as _renderFormazioni } from "./formazioni.js";
import { renderClassifica as _renderClassifica } from "./classifica.js";
import { renderScambi     as _renderScambi     } from "./scambi.js";
import { renderPlayoff    as _renderPlayoff    } from "./playoff.js";
import { renderLottery    as _renderLottery    } from "./lottery.js";
import { renderDraft      as _renderDraft, destroyDraft } from "./draft.js";
import { renderRegolamento as _renderRegolamento } from "./regolamento.js";
import { renderAdmin       as _renderAdmin       } from "./admin.js";
import { renderSuperAdmin  as _renderSuperAdmin  } from "./superadmin.js";
import { isSuperAdmin } from "./firebase.js";

// ── STATE ───────────────────────────────────────
let currentUser      = null;
let currentProfile   = null;
let currentLeagueId  = localStorage.getItem("fd_leagueId") || null;
let currentLeague    = null;
let leagueListener   = null;

// ── DOM REFS ────────────────────────────────────
const loginPage   = document.getElementById("login-page");
const appShell    = document.getElementById("app");
const navbarEl    = document.getElementById("navbar");
const pageContent = document.getElementById("page-content");

// ── BOOTSTRAP ───────────────────────────────────
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    currentUser    = firebaseUser;
    currentProfile = await getUserProfile(firebaseUser.uid);
    showApp();
    await loadLeague();
  } else {
    currentUser    = null;
    currentProfile = null;
    currentLeague  = null;
    stopLeagueListener();
    showLogin();
  }
});

// ── AUTH UI ─────────────────────────────────────
function showLogin() {
  loginPage.classList.remove("hidden");
  appShell.classList.add("hidden");
}

function showApp() {
  loginPage.classList.add("hidden");
  appShell.classList.remove("hidden");
  renderNavbarUser();
}

// Login / Register tabs
document.querySelectorAll(".login-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    document.querySelectorAll(".login-tab").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    document.getElementById("field-displayname").classList.toggle("hidden", mode !== "register");
    document.getElementById("auth-submit-btn").textContent = mode === "login" ? "Accedi" : "Crea account";
    document.getElementById("auth-error").textContent = "";
  });
});

document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode        = document.querySelector(".login-tab.active").dataset.mode;
  const email       = document.getElementById("auth-email").value.trim();
  const password    = document.getElementById("auth-password").value;
  const displayName = document.getElementById("auth-displayname").value.trim();
  const errEl       = document.getElementById("auth-error");
  const btn         = document.getElementById("auth-submit-btn");

  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "...";

  try {
    if (mode === "login") {
      await loginUser(email, password);
    } else {
      if (!displayName) throw new Error("Inserisci il tuo nome");
      await registerUser(email, password, displayName);
    }
  } catch (err) {
    errEl.textContent = translateAuthError(err.code || err.message);
    btn.disabled = false;
    btn.textContent = mode === "login" ? "Accedi" : "Crea account";
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  stopLeagueListener();
  await logoutUser();
});

// ── NAVBAR ──────────────────────────────────────
function renderNavbarUser() {
  document.getElementById("navbar-username").textContent =
    currentProfile?.displayName || currentUser?.email || "";
  renderLeagueSwitcher();
}

function renderNavbarLeague() {
  const label = document.getElementById("navbar-league-label");
  if (currentLeague) {
    label.textContent = `MANTRA · ${currentLeague.name}`;
    label.classList.remove("hidden");
    document.getElementById("navbar-tabs").classList.remove("hidden");
    const isComm  = currentLeague.commissionerUid === currentUser?.uid;
    const isSA    = isSuperAdmin(currentUser?.uid);
    document.querySelector(".nav-tab-admin")?.classList.toggle("hidden", !isComm && !isSA);
    document.querySelector(".nav-tab-superadmin")?.classList.toggle("hidden", !isSA);
  } else {
    label.textContent = "";
    label.classList.add("hidden");
    document.getElementById("navbar-tabs").classList.add("hidden");
  }
}

// Tab navigation
document.querySelectorAll(".nav-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  document.querySelectorAll(".nav-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  document.querySelectorAll(".tab-section").forEach(s =>
    s.classList.toggle("active", s.id === `tab-${tab}`)
  );
  // Trigger tab-specific render
  renderTab(tab);
}

function renderTab(tab) {
  switch(tab) {
    case "home":        renderHome();        break;
    case "calendario":  renderCalendario();  break;
    case "classifica":  renderClassifica();  break;
    case "formazioni":  renderFormazioni();  break;
    case "rose":        renderRose();        break;
    case "cap":         renderCap();         break;
    case "scambi":      renderScambi();      break;
    case "playoff":     renderPlayoff();     break;
    case "lottery":     renderLottery();     break;
    case "draft":       renderDraft();       break;
    case "regolamento": renderRegolamento(); break;
    case "admin":       renderAdmin();       break;
    case "superadmin":  renderSuperAdmin();  break;
  }
}

// ── LEAGUE LOADING ──────────────────────────────
async function loadLeague() {
  if (!currentLeagueId) {
    currentLeague = null;
    renderNavbarLeague();
    switchTab("home");
    return;
  }

  stopLeagueListener();

  // Prima lettura completa per avere dati subito
  const snap = await get(ref(db, `leagues/${currentLeagueId}`));
  currentLeague = snap.val();
  renderNavbarLeague();
  renderTab(getCurrentTab());

  // Poi ascolta aggiornamenti in tempo reale
  leagueListener = onValue(ref(db, `leagues/${currentLeagueId}`), (snap) => {
    currentLeague = snap.val();
    renderNavbarLeague();
    // Re-render solo se la tab è già visibile (evita doppio render all'avvio)
    const activeTab = getCurrentTab();
    if (activeTab !== "home") renderTab(activeTab);
  });
}

function stopLeagueListener() {
  if (leagueListener) {
    off(ref(db, `leagues/${currentLeagueId}`));
    leagueListener = null;
  }
}

function selectLeague(leagueId) {
  currentLeagueId = leagueId;
  localStorage.setItem("fd_leagueId", leagueId);
  stopLeagueListener();
  loadLeague();
}

function getCurrentTab() {
  const active = document.querySelector(".nav-tab.active");
  return active ? active.dataset.tab : "home";
}

// ── LEAGUE SWITCHER ──────────────────────────────
function renderLeagueSwitcher() {
  const container = document.getElementById("league-switcher-wrap");
  const leagues   = currentProfile?.leagues || {};
  const ids       = Object.keys(leagues);

  if (ids.length <= 1) { container.innerHTML = ""; return; }

  Promise.all(ids.map(id =>
    get(ref(db, `leagues/${id}/name`)).then(s => ({ id, name: s.val() || id }))
  )).then(list => {
    container.innerHTML = `
      <select class="league-switcher" id="league-switcher">
        ${list.map(l => `<option value="${l.id}" ${l.id === currentLeagueId ? "selected" : ""}>${l.name}</option>`).join("")}
      </select>`;
    document.getElementById("league-switcher")
      .addEventListener("change", e => selectLeague(e.target.value));
  });
}

// ── HOME TAB ─────────────────────────────────────
function renderHome() {
  const el = document.getElementById("tab-home");

  if (currentLeague) {
    const teams    = Object.values(currentLeague.teams || {});
    const settings = currentLeague.settings || {};
    const isComm   = currentLeague.commissionerUid === currentUser.uid;

    el.innerHTML = `
      <div class="page-header">
        <span class="ph-icon">🏠</span>
        <h1>${currentLeague.name}</h1>
      </div>

      <div class="card-grid">
        ${statCard("👥", "Manager",    `${teams.length} / ${settings.maxManagers}`)}
        ${statCard("📅", "Giornate",   `GW${settings.gwStart} – GW${settings.gwEnd}`)}
        ${statCard("💰", "Salary Cap", `${settings.salaryCap} FM`)}
        ${statCard("⚙️", "Stato",       settings.status || "setup")}
      </div>

      <div class="card">
        <h3 style="margin-bottom:16px;font-size:16px">👥 Manager nella lega</h3>
        ${teams.length === 0
          ? `<p style="color:var(--text2);font-size:14px">Nessun manager ancora.</p>`
          : teams.map(t => `
            <div class="team-row">
              <div>
                <div class="team-row-name">${t.name}</div>
                <div class="team-row-owner">${t.ownerName}</div>
              </div>
              ${t.ownerUid === currentLeague.commissionerUid
                ? `<span class="badge badge-accent" style="font-size:10px">COMMISSIONER</span>`
                : ""}
            </div>`).join("")}

        <div class="league-code-box">
          Codice invito: <span class="league-code">${currentLeagueId}</span>
          <span style="margin-left:8px;font-size:12px">(condividilo con gli altri manager)</span>
        </div>
      </div>

      ${isComm ? `
      <div class="card" style="margin-top:16px">
        <h3 style="margin-bottom:16px;font-size:16px">⚙️ Impostazioni Lega</h3>
        <p style="color:var(--text2);font-size:13px">Gestione avanzata in arrivo nelle prossime fasi.</p>
      </div>` : ""}
    `;
    return;
  }

  // Nessuna lega — schermata onboarding
  el.innerHTML = `
    <div style="min-height:70vh;display:flex;align-items:center;justify-content:center;padding:20px">
      <div style="width:100%;max-width:560px;text-align:center">
        <div style="font-size:64px;margin-bottom:16px">⚽</div>
        <h1 style="font-size:32px;font-weight:900;color:var(--accent);margin-bottom:8px">
          Benvenuto, ${currentProfile?.displayName || ""}!
        </h1>
        <p style="color:var(--text2);margin-bottom:36px">
          Crea una nuova lega oppure unisciti a una esistente.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">
          <button class="btn btn-primary btn-lg" style="justify-content:center;width:100%" id="show-create-btn">
            ➕ Crea lega
          </button>
          <button class="btn btn-secondary btn-lg" style="justify-content:center;width:100%" id="show-join-btn">
            🔗 Unisciti
          </button>
        </div>

        <div id="create-form-wrap" class="hidden">
          <div class="card" style="text-align:left">
            <h3 style="margin-bottom:20px">➕ Nuova Lega</h3>
            <form id="create-league-form">
              <div class="form-grid" style="margin-bottom:14px">
                <div class="form-group">
                  <label class="form-label">Nome Lega</label>
                  <input class="form-input" id="cl-name" placeholder="Es. Fantapolemica" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Nome Squadra</label>
                  <input class="form-input" id="cl-team" placeholder="Es. Dynamo FC" required>
                </div>
                <div class="form-group">
                  <label class="form-label">N. Manager</label>
                  <input class="form-input" id="cl-managers" type="number" min="2" max="20" value="10">
                </div>
                <div class="form-group">
                  <label class="form-label">GW Inizio (1–10)</label>
                  <input class="form-input" id="cl-gwstart" type="number" min="1" max="10" value="1">
                </div>
                <div class="form-group">
                  <label class="form-label">Salary Cap (FM)</label>
                  <input class="form-input" id="cl-cap" type="number" min="100" value="320">
                </div>
              </div>
              <div id="create-error" class="form-error"></div>
              <div style="display:flex;gap:8px;margin-top:4px">
                <button class="btn btn-primary" type="submit" id="create-submit-btn">Crea</button>
                <button class="btn btn-ghost" type="button" id="cancel-create-btn">Annulla</button>
              </div>
            </form>
          </div>
        </div>

        <div id="join-form-wrap" class="hidden">
          <div class="card" style="text-align:left">
            <h3 style="margin-bottom:20px">🔗 Unisciti a una lega</h3>
            <form id="join-league-form">
              <div class="form-group" style="margin-bottom:14px">
                <label class="form-label">Codice Lega</label>
                <input class="form-input" id="jl-code" placeholder="Incolla il codice" required style="font-family:monospace">
              </div>
              <div class="form-group" style="margin-bottom:14px">
                <label class="form-label">Nome Squadra</label>
                <input class="form-input" id="jl-team" placeholder="Es. Dynamo FC" required>
              </div>
              <div id="join-error" class="form-error"></div>
              <div style="display:flex;gap:8px;margin-top:4px">
                <button class="btn btn-primary" type="submit" id="join-submit-btn">Unisciti</button>
                <button class="btn btn-ghost" type="button" id="cancel-join-btn">Annulla</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind events
  document.getElementById("show-create-btn").onclick = () => {
    document.getElementById("create-form-wrap").classList.remove("hidden");
    document.getElementById("join-form-wrap").classList.add("hidden");
  };
  document.getElementById("show-join-btn").onclick = () => {
    document.getElementById("join-form-wrap").classList.remove("hidden");
    document.getElementById("create-form-wrap").classList.add("hidden");
  };
  document.getElementById("cancel-create-btn").onclick = () =>
    document.getElementById("create-form-wrap").classList.add("hidden");
  document.getElementById("cancel-join-btn").onclick = () =>
    document.getElementById("join-form-wrap").classList.add("hidden");

  document.getElementById("create-league-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("create-submit-btn");
    const err = document.getElementById("create-error");
    btn.disabled = true; btn.textContent = "..."; err.textContent = "";
    try {
      const { leagueId } = await createLeague(currentUser, {
        name:        document.getElementById("cl-name").value.trim(),
        teamName:    document.getElementById("cl-team").value.trim(),
        maxManagers: document.getElementById("cl-managers").value,
        gwStart:     document.getElementById("cl-gwstart").value,
        salaryCap:   document.getElementById("cl-cap").value,
      });
      // Ricarica profilo
      currentProfile = await getUserProfile(currentUser.uid);
      selectLeague(leagueId);
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = "Crea";
    }
  };

  document.getElementById("join-league-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("join-submit-btn");
    const err = document.getElementById("join-error");
    btn.disabled = true; btn.textContent = "..."; err.textContent = "";
    try {
      const leagueId = document.getElementById("jl-code").value.trim();
      const teamName = document.getElementById("jl-team").value.trim();
      await joinLeague(leagueId, currentUser, teamName);
      currentProfile = await getUserProfile(currentUser.uid);
      selectLeague(leagueId);
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = "Unisciti";
    }
  };
}

// ── PLACEHOLDER TAB RENDERS ──────────────────────
function renderCalendario()  { if (!currentLeague) return; destroyCalendario(); _renderCalendario(currentLeagueId, currentLeague, currentUser); }
function renderClassifica()  { if (!currentLeague) return; _renderClassifica(currentLeagueId, currentLeague, currentUser); }
function renderFormazioni()  { if (!currentLeague) return; _renderFormazioni(currentLeagueId, currentLeague, currentUser); }
function renderRose()        { if (!currentLeague) return; _renderRose(currentLeagueId, currentLeague, currentUser); }
function renderCap()         { if (!currentLeague) return; _renderCap(currentLeagueId, currentLeague, currentUser); }
function renderScambi()      { if (!currentLeague) return; _renderScambi(currentLeagueId, currentLeague, currentUser); }
function renderPlayoff()     { if (!currentLeague) return; _renderPlayoff(currentLeagueId, currentLeague, currentUser); }
function renderLottery()     { if (!currentLeague) return; _renderLottery(currentLeagueId, currentLeague, currentUser); }
function renderDraft()       { if (!currentLeague) return; destroyDraft(); _renderDraft(currentLeagueId, currentLeague, currentUser); }
function renderRegolamento() { if (!currentLeague) return; _renderRegolamento(currentLeagueId, currentLeague, currentUser); }
function renderAdmin()       { if (!currentLeague) return; _renderAdmin(currentLeagueId, currentLeague, currentUser); }
function renderSuperAdmin()  { _renderSuperAdmin(currentUser); }

function placeholderTab(id, icon, title, desc) {
  const el = document.getElementById(`tab-${id}`);
  if (!el) return;
  el.innerHTML = `
    <div class="page-header">
      <span class="ph-icon">${icon}</span>
      <h1>${title}</h1>
    </div>
    <div class="empty-state">
      <div class="es-icon">${icon}</div>
      <h3>In arrivo</h3>
      <p>${desc}</p>
    </div>`;
}

// ── HELPERS ──────────────────────────────────────
function statCard(icon, label, value) {
  return `
    <div class="stat-card">
      <span class="sc-icon">${icon}</span>
      <div>
        <div class="sc-label">${label}</div>
        <div class="sc-value">${value}</div>
      </div>
    </div>`;
}

// ── INIT ─────────────────────────────────────────
// Al caricamento mostra login finché auth non risponde
showLogin();
