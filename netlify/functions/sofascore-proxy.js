// ============================================================
// FANTADRAFT — netlify/functions/sofascore-proxy.js
// Proxy RapidAPI Sofascore — identico a fanta-seriea.it
// Env vars: RAPIDAPI_KEY
// ============================================================

const https = require("https");

exports.handler = async function (event) {
  const eventId = event.queryStringParameters?.eventId;
  if (!eventId) {
    return { statusCode: 400, body: JSON.stringify({ error: "eventId mancante" }) };
  }

  try {
    const [lineups, incidents] = await Promise.all([
      fetchRapidAPI(`/matches/get-lineups?matchId=${eventId}`),
      fetchRapidAPI(`/matches/get-incidents?matchId=${eventId}`),
    ]);

    const result = parseLineupsWithIncidents(lineups, incidents);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    if (err.status === 404) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ home: [], away: [], unavailable: true }),
      };
    }
    return {
      statusCode: err.status || 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function fetchRapidAPI(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "sofascore.p.rapidapi.com",
      path,
      method: "GET",
      headers: {
        "x-rapidapi-host": "sofascore.p.rapidapi.com",
        "x-rapidapi-key":  process.env.RAPIDAPI_KEY,
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode !== 200) {
          const err = new Error(`RapidAPI ${res.statusCode} on ${path}`);
          err.status = res.statusCode;
          reject(err); return;
        }
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error("Risposta non JSON")); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function mapPosition(pos) {
  if (!pos) return "C";
  const p = pos.toUpperCase();
  if (["G","GK","GOALKEEPER"].includes(p)) return "Por";
  if (["D","DEFENDER","DC","DL","DR","WB"].includes(p)) return "Dc";
  if (["M","MIDFIELDER","MC","ML","MR","AM","DM"].includes(p)) return "M";
  if (["F","FORWARD","ATTACKER","ST","SS","LW","RW"].includes(p)) return "Att";
  return "M";
}

function parseCardsFromIncidents(incidents) {
  const cards = {};
  const penaltyScored = {};
  for (const inc of (incidents.incidents || [])) {
    if (inc.incidentType === "card" && inc.player) {
      const name = inc.player.name;
      if (!cards[name]) cards[name] = { amm: false, esp: false };
      if (inc.incidentClass === "yellow") {
        cards[name].amm = true;
      } else if (inc.incidentClass === "red" || inc.incidentClass === "yellowRed") {
        cards[name].esp = true; cards[name].amm = false;
      }
    }
    if (inc.incidentType === "goal" && inc.incidentClass === "penalty" && inc.player) {
      penaltyScored[inc.player.name] = (penaltyScored[inc.player.name] || 0) + 1;
    }
  }
  return { cards, penaltyScored };
}

function extractFlags(stats, ruolo, goalsAgainst, goalsAgainstPenalty, cardInfo) {
  const flags = {};
  const gol = (stats?.goals || 0) + (stats?.goalNormal || 0);
  if (gol > 0)                  flags.gol = gol;
  if ((stats?.goalAssist || 0) > 0) flags.assist = stats.goalAssist;
  if ((stats?.ownGoals  || 0) > 0)  flags.aut    = stats.ownGoals;
  if ((stats?.penaltyMiss || 0) > 0) flags.rig   = true;
  if (cardInfo?.amm) flags.amm = true;
  if (cardInfo?.esp) flags.esp = true;
  if (ruolo === "Por" || ruolo === "P") {
    const minPlayed = stats?.minutesPlayed || 0;
    if (minPlayed > 0) {
      const faced  = stats?.penaltyFaced || 0;
      const rigPar = Math.max(0, faced - (goalsAgainstPenalty || 0));
      if (rigPar > 0) flags.rigpar = rigPar;
      if (goalsAgainst === 0) flags.pi = 1;
      if (goalsAgainst > 0)  flags.gs = goalsAgainst;
    }
  }
  return flags;
}

function parseLineupsWithIncidents(lineups, incidents) {
  const result = { home: [], away: [] };
  const { cards, penaltyScored } = parseCardsFromIncidents(incidents);

  const goalsHome = (lineups.home?.players || []).reduce((s,e) => s+(e.statistics?.goals||0),0)
    + (lineups.away?.players || []).reduce((s,e) => s+(e.statistics?.ownGoals||0),0);
  const goalsAway = (lineups.away?.players || []).reduce((s,e) => s+(e.statistics?.goals||0),0)
    + (lineups.home?.players || []).reduce((s,e) => s+(e.statistics?.ownGoals||0),0);

  const penaltyAgainstHome = Object.entries(penaltyScored)
    .filter(([name]) => (lineups.away?.players||[]).some(e => e.player.name === name))
    .reduce((s,[,v]) => s+v, 0);
  const penaltyAgainstAway = Object.entries(penaltyScored)
    .filter(([name]) => (lineups.home?.players||[]).some(e => e.player.name === name))
    .reduce((s,[,v]) => s+v, 0);

  for (const side of ["home","away"]) {
    const goalsAgainst   = side === "home" ? goalsAway  : goalsHome;
    const penaltyAgainst = side === "home" ? penaltyAgainstHome : penaltyAgainstAway;

    for (const entry of (lineups[side]?.players || [])) {
      const p      = entry.player;
      const stats  = entry.statistics;
      const ruolo  = mapPosition(entry.position || p.position);
      const rating = stats?.rating ? Math.round(parseFloat(stats.rating)*10)/10 : null;
      const sv     = entry.substitute === true && !(stats?.minutesPlayed > 0);
      const flags  = extractFlags(stats, ruolo, goalsAgainst, penaltyAgainst, cards[p.name]);

      result[side].push({
        id: p.id, name: p.name, shortName: p.shortName,
        position: ruolo, rating, flags,
        didNotPlay: sv,
        minutesPlayed: stats?.minutesPlayed || 0,
      });
    }
  }
  return result;
}
