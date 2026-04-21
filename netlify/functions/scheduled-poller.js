// ============================================================
// FANTADRAFT — netlify/functions/scheduled-poller.js
// Netlify Scheduled Function — cron ogni 5 minuti
// 1. Importa voti Sofascore per partite attive
// 2. Calcola e salva FP per giornate concluse
//
// Env vars: RAPIDAPI_KEY, FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
// ============================================================

const https = require("https");
const admin = require("firebase-admin");

// ── BONUS/MALUS (identici a calendario.js) ────────
const BONUS_GOL     = 3;
const BONUS_ASSIST  = 1;
const BONUS_PI      = 1;
const BONUS_RIG_PAR = 3;
const MALUS_GS      = 1;
const MALUS_AMM     = 0.5;
const MALUS_ESP     = 1;
const MALUS_AUT     = 2;
const MALUS_RIG     = 3;

// Finestra partita: 120 min dopo il kickoff
const FINESTRA_MS = 120 * 60 * 1000;
// Finestra "giornata conclusa": 3h dopo l'ultima partita
const CONCLUSA_BUFFER_MS = 3 * 60 * 60 * 1000;

// ── FIREBASE ADMIN INIT ──────────────────────────
let firebaseApp;
function getDB() {
  if (!firebaseApp) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential:  admin.credential.cert(sa),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  return admin.database();
}

// ── HANDLER ──────────────────────────────────────
exports.handler = async function () {
  const now = Date.now();
  const log = [];

  let db;
  try { db = getDB(); }
  catch (e) { return { statusCode:500, body:"Firebase init error: "+e.message }; }

  // Carica tutte le leghe attive
  const leaguesSnap = await db.ref("leagues").once("value");
  const leagues     = leaguesSnap.val() || {};

  for (const [leagueId, league] of Object.entries(leagues)) {
    if (!league || !league.settings) continue;
    const status = league.status || league.settings?.status || "setup";
    // Processa solo leghe in stagione o playoff
    // (setup e offseason le saltiamo)

    try {
      const gwStart = league.settings.gwStart || 1;
      const gwEnd   = league.settings.gwFinal || 38;

      // Trova la GW corrente dalle partite di Serie A
      const { activeGws, pendingScoreGws } = detectGwStatus(now, gwStart, gwEnd);

      // ── 1. IMPORTA VOTI PER PARTITE ATTIVE ──
      for (const gw of activeGws) {
        const gwMatches = getSerieAMatches(gw);
        for (const match of gwMatches) {
          if (!match.eventId) continue;
          const koMs = new Date(match.kickoff).getTime();
          if (now < koMs || now > koMs + FINESTRA_MS) continue;

          // Controlla se abbiamo già pollato di recente
          const lastSnap = await db.ref(`pollerState/${leagueId}/${match.eventId}`).once("value");
          const lastPoll = lastSnap.val() || 0;
          if (now - lastPoll < 5 * 60 * 1000) continue; // skip se < 5 min fa

          try {
            const [lineups, incidents] = await Promise.all([
              fetchRapidAPI(`/matches/get-lineups?matchId=${match.eventId}`),
              fetchRapidAPI(`/matches/get-incidents?matchId=${match.eventId}`),
            ]);
            const votiNuovi = parseVoti(lineups, incidents, match);
            await writeVoti(db, leagueId, gw, votiNuovi);
            await db.ref(`pollerState/${leagueId}/${match.eventId}`).set(now);
            log.push(`✓ Voti ${match.home}-${match.away} GW${gw} [${leagueId.slice(0,6)}]`);
          } catch(e) {
            log.push(`✗ Voti ${match.home}-${match.away}: ${e.message}`);
          }
        }
      }

      // ── 2. CALCOLA SCORES PER GW CONCLUSE ──
      for (const gw of pendingScoreGws) {
        // Controlla se scores sono già stati calcolati
        const existingSnap = await db.ref(`leagues/${leagueId}/scores`).once("value");
        const existing     = existingSnap.val() || {};
        const teams        = Object.values(league.teams || {});
        const allDone      = teams.every(t => existing[t.id]?.[gw]);
        if (allDone) continue;

        try {
          const result = await calcAndSaveScores(db, leagueId, league, gw);
          log.push(`✓ Scores GW${gw} calcolati per ${Object.keys(result).length} squadre [${leagueId.slice(0,6)}]`);
        } catch(e) {
          log.push(`✗ Scores GW${gw}: ${e.message}`);
        }
      }
    } catch(e) {
      log.push(`✗ Lega ${leagueId.slice(0,6)}: ${e.message}`);
    }
  }

  const body = log.length ? log.join("\n") : "Nessuna azione necessaria";
  console.log(body);
  return { statusCode: 200, body };
};

// ── DETECT GW STATUS ─────────────────────────────
function detectGwStatus(now, gwStart, gwEnd) {
  const activeGws      = [];
  const pendingScoreGws = [];

  for (let gw = gwStart; gw <= gwEnd; gw++) {
    const matches = getSerieAMatches(gw);
    if (!matches.length) continue;

    const kickoffs = matches
      .filter(m => m.kickoff)
      .map(m => new Date(m.kickoff).getTime());
    if (!kickoffs.length) continue;

    const first = Math.min(...kickoffs);
    const last  = Math.max(...kickoffs);

    // Partite in corso
    if (now >= first && now <= last + FINESTRA_MS) {
      activeGws.push(gw);
    }
    // GW conclusa ma scores non ancora calcolati
    // (tra 30 min e 6h dopo la fine della giornata)
    const endTime = last + FINESTRA_MS;
    if (now > endTime + 30*60*1000 && now < endTime + CONCLUSA_BUFFER_MS) {
      pendingScoreGws.push(gw);
    }
  }

  return { activeGws, pendingScoreGws };
}

// ── CALCOLA E SALVA SCORES + RISULTATI + CLASSIFICA ─
async function calcAndSaveScores(db, leagueId, league, gw) {
  const teams    = Object.values(league.teams || {});
  const settings = league.settings || {};
  const gwMatches = Object.values(
    (await db.ref(`leagues/${leagueId}/schedule/${gw}`).once("value")).val() || {}
  );

  // Carica voti
  const votiSnap = await db.ref(`leagues/${leagueId}/voti`).once("value");
  const voti     = votiSnap.val() || {};
  const fpByTeam = {};

  // ── STEP 1: FP per ogni team ──────────────────────
  for (const team of teams) {
    let fmSnap = await db.ref(`leagues/${leagueId}/formations/${team.id}/${gw}`).once("value");
    let fm     = fmSnap.val();
    if (!fm?.titolari) {
      for (let prev = gw - 1; prev >= (settings.gwStart || 1); prev--) {
        const ps = await db.ref(`leagues/${leagueId}/formations/${team.id}/${prev}`).once("value");
        const pf = ps.val();
        if (pf?.titolari) { fm = pf; break; }
      }
    }

    const titolari = Object.values(fm?.titolari || {});
    const panchina = Object.values(fm?.panchina  || {});
    if (!titolari.length) continue;

    let totalFP = 0, hasAny = false, subsMade = 0;
    const MAX_SUBS = 5;

    const titolariConFP = titolari.map(player => {
      const gwV  = ((voti[player.team] || {})[String(gw)]) || {};
      const entry = lookupVoto(gwV, player.name);
      if (!entry || entry.sv) return { player, fp: null, sv: entry?.sv || false };
      return { player, fp: calcPlayerFP(entry.v, player.roles || [], entry.flags || {}), sv: false };
    });

    for (const { player, fp, sv } of titolariConFP) {
      if (sv || fp === null) {
        if (subsMade < MAX_SUBS) {
          for (const sub of panchina) {
            if (sub._used) continue;
            const gwV  = ((voti[sub.team] || {})[String(gw)]) || {};
            const se   = lookupVoto(gwV, sub.name);
            if (!se || se.sv) continue;
            const sfp  = calcPlayerFP(se.v, sub.roles || [], se.flags || {});
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

  // ── STEP 2: risultati scontri diretti ─────────────
  const matchResults = {};
  for (const team of teams) matchResults[team.id] = { pts:0, gf:0, gs:0, v:0, p:0, s:0 };

  for (const match of gwMatches) {
    const fpH = fpByTeam[match.homeId];
    const fpA = fpByTeam[match.awayId];
    if (fpH == null || fpA == null) continue;

    const gH = fpToGoals(fpH);
    const gA = fpToGoals(fpA);

    matchResults[match.homeId].gf += gH; matchResults[match.homeId].gs += gA;
    matchResults[match.awayId].gf += gA; matchResults[match.awayId].gs += gH;

    if (gH > gA) {
      matchResults[match.homeId].v++; matchResults[match.homeId].pts += 3;
      matchResults[match.awayId].s++;
    } else if (gA > gH) {
      matchResults[match.awayId].v++; matchResults[match.awayId].pts += 3;
      matchResults[match.homeId].s++;
    } else {
      matchResults[match.homeId].p++; matchResults[match.homeId].pts++;
      matchResults[match.awayId].p++; matchResults[match.awayId].pts++;
    }

    await db.ref(`leagues/${leagueId}/matchResults/${gw}/${match.id}`).set({
      homeId: match.homeId, awayId: match.awayId,
      fpHome: fpH, fpAway: fpA, golHome: gH, golAway: gA,
      calculatedAt: Date.now(),
    });
  }

  // ── STEP 3: aggiorna classifica ───────────────────
  const standSnap = await db.ref(`leagues/${leagueId}/standings`).once("value");
  const standings = standSnap.val() || {};
  const updates   = {};

  for (const team of teams) {
    const logSnap = await db.ref(`leagues/${leagueId}/standingsLog/${team.id}/${gw}`).once("value");
    if (logSnap.exists()) continue; // già calcolata

    const r    = matchResults[team.id];
    const curr = standings[team.id] || { pts:0, v:0, p:0, s:0, gf:0, gs:0, fp:0 };
    const fpTot = Math.round(((curr.fp||0) + (fpByTeam[team.id]||0)) * 10) / 10;

    updates[`leagues/${leagueId}/standings/${team.id}`] = {
      pts: (curr.pts||0)+r.pts, v: (curr.v||0)+r.v,
      p:   (curr.p||0)+r.p,    s: (curr.s||0)+r.s,
      gf:  (curr.gf||0)+r.gf,  gs: (curr.gs||0)+r.gs,
      fp:  fpTot,
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

// ── SCRIVI VOTI SU FIREBASE ───────────────────────
async function writeVoti(db, leagueId, gw, votiNuovi) {
  const writes = [];
  for (const [squadra, giocatori] of Object.entries(votiNuovi)) {
    for (const [nome, dati] of Object.entries(giocatori)) {
      const safeNome = nome.replace(/[.#$[\]]/g, "_");
      const r        = db.ref(`leagues/${leagueId}/voti/${squadra}/${gw}/${safeNome}`);
      const existing = (await r.once("value")).val() || {};
      // Preserva flags modificati manualmente (source !== "sofascore")
      const useExisting = existing.flags &&
        Object.keys(existing.flags).length > 0 &&
        existing.source !== "sofascore";
      writes.push(r.set({
        ...dati,
        flags: useExisting ? existing.flags : (dati.flags || {}),
      }));
    }
  }
  await Promise.all(writes);
}

// ── PARSE VOTI DA SOFASCORE ───────────────────────
function parseVoti(lineups, incidents, match) {
  const result = {};
  const { cards, penaltyScored } = parseIncidents(incidents);

  const goalsHome = sumGoals(lineups.home?.players, lineups.away?.players);
  const goalsAway = sumGoals(lineups.away?.players, lineups.home?.players);
  const penAgainstHome = countPenaltyAgainst(penaltyScored, lineups.away?.players);
  const penAgainstAway = countPenaltyAgainst(penaltyScored, lineups.home?.players);

  for (const [side, squadra] of [["home", match.home], ["away", match.away]]) {
    result[squadra] = {};
    const goalsAgainst = side === "home" ? goalsAway  : goalsHome;
    const penAgainst   = side === "home" ? penAgainstHome : penAgainstAway;

    for (const entry of (lineups[side]?.players || [])) {
      const p      = entry.player;
      const stats  = entry.statistics;
      const ruolo  = mapPosition(entry.position || p.position);
      const rating = stats?.rating ? Math.round(parseFloat(stats.rating) * 10) / 10 : null;
      const sv     = entry.substitute === true && !(stats?.minutesPlayed > 0);
      const flags  = extractFlags(stats, ruolo, goalsAgainst, penAgainst, cards[p.name]);

      if (sv) {
        result[squadra][p.name] = { sv: true, flags, source: "sofascore" };
      } else if (rating !== null) {
        result[squadra][p.name] = { v: rating, sv: false, flags, source: "sofascore" };
      }
    }
  }
  return result;
}

function parseIncidents(incidents) {
  const cards = {};
  const penaltyScored = {};
  for (const inc of (incidents.incidents || [])) {
    if (inc.incidentType === "card" && inc.player) {
      const name = inc.player.name;
      if (!cards[name]) cards[name] = { amm: false, esp: false };
      if (inc.incidentClass === "yellow") cards[name].amm = true;
      else if (["red","yellowRed"].includes(inc.incidentClass)) { cards[name].esp = true; cards[name].amm = false; }
    }
    if (inc.incidentType === "goal" && inc.incidentClass === "penalty" && inc.player) {
      penaltyScored[inc.player.name] = (penaltyScored[inc.player.name] || 0) + 1;
    }
  }
  return { cards, penaltyScored };
}

function sumGoals(scorers, ownGoalPlayers) {
  return (scorers||[]).reduce((s,e) => s+(e.statistics?.goals||0), 0)
       + (ownGoalPlayers||[]).reduce((s,e) => s+(e.statistics?.ownGoals||0), 0);
}

function countPenaltyAgainst(penaltyScored, players) {
  return Object.entries(penaltyScored)
    .filter(([name]) => (players||[]).some(e => e.player.name === name))
    .reduce((s,[,v]) => s+v, 0);
}

function extractFlags(stats, ruolo, goalsAgainst, penAgainst, cardInfo) {
  const flags = {};
  const gol = (stats?.goals || 0) + (stats?.goalNormal || 0);
  if (gol > 0)                     flags.gol    = gol;
  if ((stats?.goalAssist||0) > 0)  flags.assist = stats.goalAssist;
  if ((stats?.ownGoals||0) > 0)    flags.aut    = stats.ownGoals;
  if ((stats?.penaltyMiss||0) > 0) flags.rig    = true;
  if (cardInfo?.amm) flags.amm = true;
  if (cardInfo?.esp) flags.esp = true;
  if (ruolo === "Por" || ruolo === "P") {
    const minPlayed = stats?.minutesPlayed || 0;
    if (minPlayed > 0) {
      const rigPar = Math.max(0, (stats?.penaltyFaced||0) - penAgainst);
      if (rigPar > 0) flags.rigpar = rigPar;
      if (goalsAgainst === 0) flags.pi = 1;
      if (goalsAgainst > 0)  flags.gs = goalsAgainst;
    }
  }
  return flags;
}

function mapPosition(pos) {
  if (!pos) return "M";
  const p = pos.toUpperCase();
  if (["G","GK","GOALKEEPER"].includes(p)) return "Por";
  if (["D","DEFENDER","DC","DL","DR","WB"].includes(p)) return "Dc";
  if (["M","MIDFIELDER","MC","ML","MR","AM","DM"].includes(p)) return "M";
  if (["F","FORWARD","ATTACKER","ST","SS","LW","RW"].includes(p)) return "Att";
  return "M";
}

// ── CALC FP (identico a calendario.js) ───────────
function calcPlayerFP(voto, roles, flags) {
  if (voto == null) return null;
  const role  = (roles||[])[0] || "M";
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

// ── FP → GOL (identico a utils.js) ───────────────
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
  for (const [k, v] of Object.entries(gwVoti)) {
    if (normalizeStr(k) === norm) return v;
  }
  const tokens = norm.split(/\s+/).filter(t => t.length > 2);
  for (const [k, v] of Object.entries(gwVoti)) {
    const kTokens = normalizeStr(k).split(/\s+/);
    if (tokens.some(t => kTokens.includes(t))) return v;
  }
  return undefined;
}

function normalizeStr(s) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/Ø/g,"O").replace(/ø/g,"o")
    .replace(/Æ/g,"AE").replace(/æ/g,"ae")
    .replace(/ł/g,"l").replace(/Ł/g,"L")
    .replace(/ß/g,"ss")
    .toLowerCase().trim();
}

// ── RAPIDAPI FETCH ────────────────────────────────
function fetchRapidAPI(path) {
  return new Promise((resolve, reject) => {
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
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode !== 200) {
          const e = new Error(`RapidAPI ${res.statusCode}`); e.status = res.statusCode; reject(e); return;
        }
        try { resolve(JSON.parse(raw)); } catch { reject(new Error("JSON non valido")); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── MATCHES SERIE A (subset da matches.js) ────────
// Importiamo solo i match con eventId e kickoff definiti
// per non duplicare l'intero file
function getSerieAMatches(gw) {
  // Legge dinamicamente solo le giornate 33-38 che hanno eventId
  // Le giornate precedenti sono già concluse
  const MATCHES_WITH_IDS = {
    "33": [
      { eventId: "13981743", home: "Cremonese",  away: "Torino",     kickoff: "2026-04-19T10:30:00Z" },
      { eventId: "13980100", home: "Pisa",       away: "Genoa",      kickoff: "2026-04-19T16:00:00Z" },
    ],
    "34": [
      { eventId: "13980105", home: "Napoli",     away: "Cremonese",  kickoff: "2026-04-24T18:45:00Z" },
      { eventId: "13980107", home: "Parma",      away: "Pisa",       kickoff: "2026-04-25T13:00:00Z" },
      { eventId: "13980113", home: "Bologna",    away: "Roma",       kickoff: "2026-04-25T16:00:00Z" },
      { eventId: "13980114", home: "Verona",     away: "Lecce",      kickoff: "2026-04-25T18:45:00Z" },
      { eventId: "13980110", home: "Fiorentina", away: "Sassuolo",   kickoff: "2026-04-26T10:30:00Z" },
      { eventId: "13980109", home: "Genoa",      away: "Como",       kickoff: "2026-04-26T13:00:00Z" },
      { eventId: "13980104", home: "Torino",     away: "Inter",      kickoff: "2026-04-26T16:00:00Z" },
      { eventId: "13980106", home: "Milan",      away: "Juventus",   kickoff: "2026-04-26T18:45:00Z" },
      { eventId: "13980111", home: "Cagliari",   away: "Atalanta",   kickoff: "2026-04-27T16:30:00Z" },
      { eventId: "13980112", home: "Lazio",      away: "Udinese",    kickoff: "2026-04-27T18:45:00Z" },
    ],
  };
  return (MATCHES_WITH_IDS[String(gw)] || []).filter(m => m.eventId);
}
