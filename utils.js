// ============================================================
// FANTADRAFT — utils.js
// Funzioni condivise tra rose.js, cap.js, draft.js ecc.
// ============================================================

// ── CONTRATTI ────────────────────────────────────
/**
 * Calcola il costo di un giocatore all'anno N del contratto.
 * Anno 1: costo invariato
 * Anno 2: +30% (under21: +10%), min +1
 * Anno 3: +20%, min +1
 * Rinnovo scadenza: +40%
 */
export function contractYearCost(baseCost, year, under21 = false, isRenewal = false) {
  if (!baseCost) return 0;
  if (isRenewal) return Math.max(baseCost + 1, Math.round(baseCost * 1.4));
  if (year === 1) return baseCost;
  if (year === 2) {
    const pct  = under21 ? 0.10 : 0.30;
    const raw  = baseCost * (1 + pct);
    return Math.max(baseCost + 1, under21 ? Math.round(raw) : Math.round(raw));
  }
  if (year === 3) {
    const base2 = contractYearCost(baseCost, 2, under21);
    const raw   = base2 * 1.20;
    return Math.max(base2 + 1, Math.round(raw));
  }
  return baseCost;
}

// ── RUOLI ────────────────────────────────────────
const ROLE_COLORS = {
  P:   "#f59e0b",
  Por: "#f59e0b",
  D:   "#3b82f6",
  Dc:  "#3b82f6",
  Dd:  "#3b82f6",
  Ds:  "#3b82f6",
  E:   "#8b5cf6",
  M:   "#10b981",
  Mf:  "#10b981",
  C:   "#10b981",
  W:   "#06b6d4",
  T:   "#06b6d4",
  B:   "#6366f1",
  Att: "#ef4444",
  A:   "#ef4444",
  Pc:  "#ef4444",
  Tr:  "#f97316",
};

export function roleColor(roleStr) {
  if (!roleStr) return "#555e7a";
  const firstRole = roleStr.split(/[/;,]/)[0].trim();
  return ROLE_COLORS[firstRole] || "#555e7a";
}

export function roleBadge(roles) {
  const arr = Array.isArray(roles) ? roles : (roles || "").split(/[/;,]/);
  return arr.join("/");
}

/**
 * Mappa le categorie macro da ruolo Mantra
 * Usato per i filtri P/D/C/A
 */
export function macroRole(roleStr) {
  const r = (roleStr || "").split(/[/;,]/)[0].trim().toUpperCase();
  if (["P","POR"].includes(r)) return "P";
  if (["D","DC","DD","DS"].includes(r)) return "D";
  if (["E","M","MF","C","W","T","B"].includes(r)) return "C";
  if (["ATT","A","PC","TR"].includes(r)) return "A";
  return "C";
}

// ── CAP LEVEL ────────────────────────────────────
export function getCapLevel(cap, settings) {
  if (!settings) return "under";
  const { salaryCap, softCapMax, luxuryTaxThreshold } = settings;
  if (cap <= salaryCap)          return "under";
  if (cap <= softCapMax)         return "soft";
  if (cap <= luxuryTaxThreshold) return "hard";
  return "luxury";
}

export function capLevelLabel(level) {
  return { under:"✓ Cap", soft:"Soft Cap", hard:"Hard Cap", luxury:"Luxury Tax" }[level] || level;
}

export function capLevelBadge(level) {
  return { under:"badge-cap", soft:"badge-soft", hard:"badge-hard", luxury:"badge-luxury" }[level] || "";
}

// ── CSV PARSER (Fantacalcio.it Mantra) ───────────
/**
 * Parsa un CSV esportato da Fantacalcio.it con colonne aggiuntive
 * Formato: Ruolo;Ruolo Mantra;Nome;Squadra;Quotazione;DataNascita
 * - Quotazione: costo FM di acquisto al draft
 * - DataNascita: gg/mm/aaaa
 * Separatore: ; (punto e virgola)
 */
export function parseCSVRose(text) {
  const lines  = text.split(/\r?\n/).filter(l => l.trim());
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i === 0 && (line.toLowerCase().includes("ruolo") || line.toLowerCase().includes("nome"))) continue;

    const cols = line.split(";");
    if (cols.length < 4) continue;

    const ruoloClassico = (cols[0] || "").trim();
    const ruoloMantra   = (cols[1] || "").trim();
    const nome          = normalizeName((cols[2] || "").trim());
    const squadra       = (cols[3] || "").trim();
    const quotazione    = parseInt((cols[4] || "1").trim()) || 1;
    const dataNascita   = (cols[5] || "").trim() || null;  // gg/mm/aaaa

    if (!nome || !squadra) continue;

    const roles = ruoloMantra
      ? ruoloMantra.split(/[;,]/).map(r => r.trim()).filter(Boolean)
      : [ruoloClassico || "C"];

    const age     = dataNascita ? calcAge(dataNascita) : null;
    const under21 = age !== null && age <= 21;
    const key     = nome.replace(/[.#$[\]]/g, "_");

    result.push({
      id: key, name: nome, team: squadra,
      roles, ruoloClassico,
      quotazione, costo: quotazione,  // alias per compatibilità
      dataNascita, under21, bandiera: false,
    });
  }

  return result;
}

// ── CALCOLA ETÀ ──────────────────────────────────
/**
 * Calcola età in anni interi da data di nascita "gg/mm/aaaa"
 */
export function calcAge(dataNascita) {
  if (!dataNascita) return null;
  const parts = dataNascita.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map(Number);
  if (isNaN(dd) || isNaN(mm) || isNaN(yyyy)) return null;
  const today = new Date();
  const bday  = new Date(yyyy, mm - 1, dd);
  let age = today.getFullYear() - bday.getFullYear();
  const mDiff = today.getMonth() - bday.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < bday.getDate())) age--;
  return age;
}

/**
 * Normalizzazione nome: rimuove accenti, standardizza apostrofi
 * Stesso approccio di fanta-seriea.it useDb.js
 */
export function normalizeName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // rimuove diacritici
    .replace(/'/g, "'")               // apostrofo tipografico → standard
    .trim();
}

// ── DATE/GW HELPERS ──────────────────────────────
export function gwLabel(gw) {
  return `Giornata ${gw}`;
}

export function currentSeason() {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  return m >= 7 ? `${y}/${y+1}` : `${y-1}/${y}`;
}

// ── FANTAPUNTI → GOL ─────────────────────────────
/**
 * Conversione FP in gol secondo le soglie Mantra standard
 */
export function fpToGoals(fp) {
  if (fp < 66)    return 0;
  if (fp < 72)    return 1;
  if (fp < 77)    return 2;
  if (fp < 81)    return 3;
  if (fp < 85)    return 4;
  return Math.floor((fp - 85) / 4) + 5;
}

// ── FORMAT HELPERS ───────────────────────────────
export function fmt(n, decimals = 1) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toFixed(decimals);
}

export function fmtFM(n) {
  return `${n ?? 0} FM`;
}
