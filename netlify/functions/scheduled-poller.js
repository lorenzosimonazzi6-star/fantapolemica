// ============================================================
// FANTADRAFT — netlify/functions/scheduled-poller.js
// Netlify Scheduled Function — ogni 5 minuti
// Sintassi: schedule esportato direttamente nel file
// ============================================================

const https = require("https");

// Path globali
const PATH_VOTI = "voti";

// Bonus/malus (identici a calendario.js)
const BONUS_GOL     = 3;
const BONUS_ASSIST  = 1;
const BONUS_PI      = 1;
const BONUS_RIG_PAR = 3;
const MALUS_GS      = 1;
const MALUS_AMM     = 0.5;
const MALUS_ESP     = 1;
const MALUS_AUT     = 2;
const MALUS_RIG     = 3;

const FINESTRA_MS       = 120 * 60 * 1000; // 120 min dopo kickoff
const CONCLUSA_BUFFER_MS = 3 * 60 * 60 * 1000; // 3h dopo fine

// ── FIREBASE ADMIN ────────────────────────────────
let _db = null;
function getDB() {
  if (_db) return _db;
  // Lazy require per evitare crash se non installato
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential:  admin.credential.cert(sa),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  _db = admin.database();
  return _db;
}

// ── SCHEDULED HANDLER ────────────────────────────
// Sintassi corretta per Netlify Scheduled Functions
const schedule = "*/5 * * * *";

const handler = async function () {
  // Verifica env vars
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.error("Missing env vars: FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL");
    return { statusCode: 500, body: "Missing env vars" };
  }

  let db;
  try { db = getDB(); }
  catch (e) {
    console.error("Firebase init error:", e.message);
    return { statusCode: 500, body: "Firebase init error: " + e.message };
  }

  const now = Date.now();
  const log = [];

  try {
    const leaguesSnap = await db.ref("leagues").once("value");
    const leagues     = leaguesSnap.val() || {};

    for (const [leagueId, league] of Object.entries(leagues)) {
      if (!league?.settings) continue;
      try {
        await processLeague(db, leagueId, league, now, log);
      } catch (e) {
        log.push(`✗ Lega ${leagueId.slice(0,6)}: ${e.message}`);
        console.error(`Lega ${leagueId}:`, e);
      }
    }
  } catch (e) {
    console.error("Top-level error:", e.message);
    return { statusCode: 500, body: e.message };
  }

  const body = log.length ? log.join("\n") : "Nessuna azione necessaria";
  console.log(body);
  return { statusCode: 200, body };
};

module.exports = { handler, schedule };

// ── PROCESSA UNA LEGA ────────────────────────────
async function processLeague(db, leagueId, league, now, log) {
  const settings = league.settings || {};
  const gwStart  = settings.gwStart || 1;
  const gwEnd    = settings.gwEnd   || 38;

  const { activeGws, pendingScoreGws } = detectGwStatus(now, gwStart, gwEnd);

  // 1. Importa voti per partite attive
  for (const gw of activeGws) {
    for (const match of getSerieAMatches(gw)) {
      if (!match.eventId) continue;
      const koMs = new Date(match.kickoff).getTime();
      if (now < koMs || now > koMs + FINESTRA_MS) continue;

      const lastSnap = await db.ref(`pollerState/${leagueId}/${match.eventId}`).once("value");
      const lastPoll = lastSnap.val() || 0;
      if (now - lastPoll < 4 * 60 * 1000) continue; // min 4 min tra poll

      try {
        const [lineups, incidents] = await Promise.all([
          fetchRapidAPI(`/matches/get-lineups?matchId=${match.eventId}`),
          fetchRapidAPI(`/matches/get-incidents?matchId=${match.eventId}`),
        ]);
        const votiNuovi = parseVoti(lineups, incidents, match);
        await writeVoti(db, gw, votiNuovi);
        await db.ref(`pollerState/${leagueId}/${match.eventId}`).set(now);
        log.push(`✓ Voti ${match.home}-${match.away} GW${gw}`);
      } catch (e) {
        log.push(`✗ ${match.home}-${match.away}: ${e.message}`);
      }
    }
  }

  // 2. Calcola scores per GW concluse
  for (const gw of pendingScoreGws) {
    const scoresSnap = await db.ref(`leagues/${leagueId}/scores`).once("value");
    const existing   = scoresSnap.val() || {};
    const teams      = Object.values(league.teams || {});
    if (teams.every(t => existing[t.id]?.[gw])) continue; // già calcolata

    try {
      const result = await calcAndSaveScores(db, leagueId, league, gw);
      log.push(`✓ Scores GW${gw} [${leagueId.slice(0,6)}] — ${Object.keys(result).length} squadre`);
    } catch (e) {
      log.push(`✗ Scores GW${gw}: ${e.message}`);
    }
  }
}

// ── SCRIVE VOTI GLOBALI ───────────────────────────
async function writeVoti(db, gw, votiNuovi) {
  const updates = {};
  for (const [squadra, giocatori] of Object.entries(votiNuovi)) {
    for (const [nome, dati] of Object.entries(giocatori)) {
      const key = nome.replace(/[.#$[\]]/g, "_");
      // Controlla se già esiste un voto manuale (source !== "sofascore")
      const existing = (await db.ref(`${PATH_VOTI}/${squadra}/${gw}/${key}`).once("value")).val();
      if (existing && existing.source !== "sofascore") continue; // preserva manuale
      updates[`${PATH_VOTI}/${squadra}/${gw}/${key}`] = dati;
    }
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
}

// ── CALCOLA E SALVA SCORES ────────────────────────
async function calcAndSaveScores(db, leagueId, league, gw) {
  const teams    = Object.values(league.teams || {});
  const settings = league.settings || {};
  const gwMatchesSnap = await db.ref(`leagues/${leagueId}/schedule/${gw}`).once("value");
  const gwMatches     = Object.values(gwMatchesSnap.val() || {});
  const votiSnap      = await db.ref(PATH_VOTI).once("value");
  const voti          = votiSnap.val() || {};
  const fpByTeam      = {};

  // Step 1: FP per ogni team
  for (const team of teams) {
    let fmSnap = await db.ref(`leagues/${leagueId}/formations/${team.id}/${gw}`).once("value");
    let fm     = fmSnap.val();
    if (!fm?.titolari) {
      for (let prev = gw - 1; prev >= (settings.gwStart || 1); prev--) {
        const ps = await db.ref(`leagues/${leagueId}/formations/${team.id}/${prev}`).once("value");
        if (ps.val()?.titolari) { fm = ps.val(); break; }
      }
    }
    const titolari = Object.values(fm?.titolari || {});
    const panchina = Object.values(fm?.panchina  || {});
    if (!titolari.length) continue;

    let totalFP = 0, hasAny = false, subsMade = 0;
    const titolariConFP = titolari.map(p => {
      const gwV  = (voti[p.team] || {})[String(gw)] || {};
      const entry = lookupVoto(gwV, p.name);
      if (!entry || entry.sv) return { p, fp: null, sv: entry?.sv || false };
      return { p, fp: calcFP(entry.v, p.roles || [], entry.flags || {}), sv: false };
    });

    for (const { p, fp, sv } of titolariConFP) {
      if (sv || fp === null) {
        if (subsMade < 5) {
          for (const sub of panchina) {
            if (sub._used) continue;
            const gwV   = (voti[sub.team] || {})[String(gw)] || {};
            const se    = lookupVoto(gwV, sub.name);
            if (!se || se.sv) continue;
            const sfp   = calcFP(se.v, sub.roles || [], se.flags || {});
            if (sfp !== null) { totalFP += sfp; hasAny = true; subsMade++; sub._used = true; break; }
          }
        }
      } else { totalFP += fp; hasAny = true; }
    }

    if (hasAny) {
      const finalFP = Math.round(totalFP * 10) / 10;
      fpByTeam[team.id] = finalFP;
      await db.ref(`leagues/${leagueId}/scores/${team.id}/${gw}`).set({
        fp: finalFP, calculatedAt: Date.now(), subsMade,
      });
    }
  }

  // Step 2: risultati scontri
  const matchRes = {};
  for (const t of teams) matchRes[t.id] = { pts:0, gf:0, gs:0, v:0, p:0, s:0 };

  for (const match of gwMatches) {
    const fpH = fpByTeam[match.homeId];
    const fpA = fpByTeam[match.awayId];
    if (fpH == null || fpA == null) continue;
    const gH = fpToGoals(fpH), gA = fpToGoals(fpA);
    matchRes[match.homeId].gf += gH; matchRes[match.homeId].gs += gA;
    matchRes[match.awayId].gf += gA; matchRes[match.awayId].gs += gH;
    if (gH > gA)      { matchRes[match.homeId].v++; matchRes[match.homeId].pts += 3; matchRes[match.awayId].s++; }
    else if (gA > gH) { matchRes[match.awayId].v++; matchRes[match.awayId].pts += 3; matchRes[match.homeId].s++; }
    else              { matchRes[match.homeId].p++; matchRes[match.homeId].pts++; matchRes[match.awayId].p++; matchRes[match.awayId].pts++; }

    await db.ref(`leagues/${leagueId}/matchResults/${gw}/${match.id || match.homeId+"_"+match.awayId}`).set({
      homeId: match.homeId, awayId: match.awayId,
      fpHome: fpH, fpAway: fpA, golHome: gH, golAway: gA,
      calculatedAt: Date.now(),
    });
  }

  // Step 3: classifica cumulativa
  const standSnap = await db.ref(`leagues/${leagueId}/standings`).once("value");
  const standings = standSnap.val() || {};
  const updates   = {};

  for (const team of teams) {
    const logSnap = await db.ref(`leagues/${leagueId}/standingsLog/${team.id}/${gw}`).once("value");
    if (logSnap.exists()) continue;
    const r    = matchRes[team.id];
    const curr = standings[team.id] || { pts:0, v:0, p:0, s:0, gf:0, gs:0, fp:0 };
    updates[`leagues/${leagueId}/standings/${team.id}`] = {
      pts: (curr.pts||0)+r.pts, v: (curr.v||0)+r.v,
      p:   (curr.p||0)+r.p,    s: (curr.s||0)+r.s,
      gf:  (curr.gf||0)+r.gf,  gs: (curr.gs||0)+r.gs,
      fp:  Math.round(((curr.fp||0)+(fpByTeam[team.id]||0))*10)/10,
    };
    updates[`leagues/${leagueId}/standingsLog/${team.id}/${gw}`] = {
      pts: r.pts, v: r.v, p: r.p, s: r.s,
      gf: r.gf, gs: r.gs, fp: fpByTeam[team.id]||0,
      calculatedAt: Date.now(),
    };
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return fpByTeam;
}

// ── DETECT GW STATUS ─────────────────────────────
function detectGwStatus(now, gwStart, gwEnd) {
  const activeGws = [], pendingScoreGws = [];
  for (let gw = gwStart; gw <= gwEnd; gw++) {
    const matches  = getSerieAMatches(gw).filter(m => m.kickoff);
    if (!matches.length) continue;
    const kickoffs = matches.map(m => new Date(m.kickoff).getTime());
    const first    = Math.min(...kickoffs);
    const last     = Math.max(...kickoffs);
    if (now >= first && now <= last + FINESTRA_MS) activeGws.push(gw);
    const endTime = last + FINESTRA_MS;
    if (now > endTime + 30*60*1000 && now < endTime + CONCLUSA_BUFFER_MS) pendingScoreGws.push(gw);
  }
  return { activeGws, pendingScoreGws };
}

// ── PARSE VOTI SOFASCORE ──────────────────────────
function parseVoti(lineups, incidents, match) {
  const result = {};
  const { cards, penaltyScored } = parseIncidents(incidents);
  const goalsHome = sumGoals(lineups.home?.players, lineups.away?.players);
  const goalsAway = sumGoals(lineups.away?.players, lineups.home?.players);

  for (const [side, squadra] of [["home", match.home], ["away", match.away]]) {
    result[squadra] = {};
    const goalsAgainst = side === "home" ? goalsAway : goalsHome;
    const penAgainst   = countPenAgainst(penaltyScored, lineups[side === "home" ? "away" : "home"]?.players);

    for (const entry of (lineups[side]?.players || [])) {
      const p     = entry.player;
      const stats = entry.statistics;
      const role  = mapPosition(entry.position || p.position);
      const rating = stats?.rating ? Math.round(parseFloat(stats.rating)*10)/10 : null;
      const sv    = entry.substitute === true && !(stats?.minutesPlayed > 0);
      const flags = extractFlags(stats, role, goalsAgainst, penAgainst, cards[p.name]);
      result[squadra][p.name] = sv
        ? { sv: true, flags, source: "sofascore" }
        : rating !== null ? { v: rating, sv: false, flags, source: "sofascore" } : null;
      if (!result[squadra][p.name]) delete result[squadra][p.name];
    }
  }
  return result;
}

function parseIncidents(incidents) {
  const cards = {}, penaltyScored = {};
  for (const inc of (incidents?.incidents || [])) {
    if (inc.incidentType === "card" && inc.player) {
      const n = inc.player.name;
      if (!cards[n]) cards[n] = { amm: false, esp: false };
      if (inc.incidentClass === "yellow") cards[n].amm = true;
      else if (["red","yellowRed"].includes(inc.incidentClass)) { cards[n].esp = true; cards[n].amm = false; }
    }
    if (inc.incidentType === "goal" && inc.incidentClass === "penalty" && inc.player)
      penaltyScored[inc.player.name] = (penaltyScored[inc.player.name]||0)+1;
  }
  return { cards, penaltyScored };
}

function sumGoals(scorers, ownGoalPlayers) {
  return (scorers||[]).reduce((s,e)=>s+(e.statistics?.goals||0),0)
       + (ownGoalPlayers||[]).reduce((s,e)=>s+(e.statistics?.ownGoals||0),0);
}

function countPenAgainst(penaltyScored, players) {
  return Object.entries(penaltyScored)
    .filter(([n]) => (players||[]).some(e=>e.player.name===n))
    .reduce((s,[,v])=>s+v,0);
}

function extractFlags(stats, role, goalsAgainst, penAgainst, cardInfo) {
  const flags = {};
  const gol = (stats?.goals||0)+(stats?.goalNormal||0);
  if (gol > 0)                    flags.gol    = gol;
  if ((stats?.goalAssist||0) > 0) flags.assist = stats.goalAssist;
  if ((stats?.ownGoals||0) > 0)   flags.aut    = stats.ownGoals;
  if ((stats?.penaltyMiss||0) > 0) flags.rig   = true;
  if (cardInfo?.amm) flags.amm = true;
  if (cardInfo?.esp) flags.esp = true;
  if (role === "Por" || role === "P") {
    const rigPar = Math.max(0,(stats?.penaltyFaced||0)-penAgainst);
    if (rigPar > 0) flags.rigpar = rigPar;
    if (goalsAgainst === 0 && (stats?.minutesPlayed||0) > 0) flags.pi = 1;
    if (goalsAgainst > 0)  flags.gs = goalsAgainst;
  }
  return flags;
}

function mapPosition(pos) {
  if (!pos) return "M";
  const p = pos.toUpperCase();
  if (["G","GK","GOALKEEPER"].includes(p)) return "Por";
  if (["D","DEFENDER","DC","DL","DR","WB"].includes(p)) return "Dc";
  if (["F","FORWARD","ATTACKER","ST","SS","LW","RW"].includes(p)) return "Att";
  return "M";
}

// ── CALC FP ───────────────────────────────────────
function calcFP(voto, roles, flags) {
  if (voto == null) return null;
  const isPor = ["Por","P"].includes((roles||[])[0]);
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
    if (flags.gs)     fp -= flags.gs * MALUS_GS;
  }
  return Math.round(fp * 10) / 10;
}

function fpToGoals(fp) {
  if (!fp || fp < 66) return 0;
  if (fp < 72) return 1;
  if (fp < 77) return 2;
  if (fp < 81) return 3;
  if (fp < 85) return 4;
  return Math.floor((fp - 85) / 4) + 5;
}

// ── LOOKUP VOTO ───────────────────────────────────
function lookupVoto(gwVoti, nome) {
  if (!gwVoti || !nome) return undefined;
  if (gwVoti[nome]) return gwVoti[nome];
  const norm = normalizeStr(nome);
  for (const [k,v] of Object.entries(gwVoti))
    if (normalizeStr(k) === norm) return v;
  const tokens = norm.split(/\s+/).filter(t=>t.length>2);
  for (const [k,v] of Object.entries(gwVoti)) {
    const kTok = normalizeStr(k).split(/\s+/);
    if (tokens.some(t=>kTok.includes(t))) return v;
  }
  return undefined;
}

function normalizeStr(s) {
  return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[ØÆøæłŁß]/g, c => ({Ø:"O",ø:"o",Æ:"AE",æ:"ae",ł:"l",Ł:"L",ß:"ss"}[c]||c))
    .toLowerCase().trim();
}

// ── RAPIDAPI ──────────────────────────────────────
function fetchRapidAPI(path) {
  return new Promise((resolve, reject) => {
    if (!process.env.RAPIDAPI_KEY) { reject(new Error("RAPIDAPI_KEY mancante")); return; }
    const req = https.request({
      hostname: "sofascore.p.rapidapi.com", path, method: "GET",
      headers: {
        "x-rapidapi-host": "sofascore.p.rapidapi.com",
        "x-rapidapi-key":  process.env.RAPIDAPI_KEY,
      },
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) { reject(new Error(`RapidAPI ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error("JSON non valido")); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── SERIE A MATCHES ───────────────────────────────
function getSerieAMatches(gw) {
  // Aggiungi qui le partite con eventId Sofascore man mano che le conosci
  // Formato: { eventId, home, away, kickoff: "ISO string" }
  const MATCHES = {
    "34": [
      { eventId:"13980105", home:"Napoli",     away:"Cremonese",  kickoff:"2026-04-24T18:45:00Z" },
      { eventId:"13980107", home:"Parma",      away:"Pisa",       kickoff:"2026-04-25T13:00:00Z" },
      { eventId:"13980113", home:"Bologna",    away:"Roma",       kickoff:"2026-04-25T16:00:00Z" },
      { eventId:"13980114", home:"Verona",     away:"Lecce",      kickoff:"2026-04-25T18:45:00Z" },
      { eventId:"13980110", home:"Fiorentina", away:"Sassuolo",   kickoff:"2026-04-26T10:30:00Z" },
      { eventId:"13980109", home:"Genoa",      away:"Como",       kickoff:"2026-04-26T13:00:00Z" },
      { eventId:"13980104", home:"Torino",     away:"Inter",      kickoff:"2026-04-26T16:00:00Z" },
      { eventId:"13980106", home:"Milan",      away:"Juventus",   kickoff:"2026-04-26T18:45:00Z" },
      { eventId:"13980111", home:"Cagliari",   away:"Atalanta",   kickoff:"2026-04-27T16:30:00Z" },
      { eventId:"13980112", home:"Lazio",      away:"Udinese",    kickoff:"2026-04-27T18:45:00Z" },
    ],
  };
  return (MATCHES[String(gw)] || []);
}
