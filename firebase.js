// ============================================================
// FANTADRAFT — firebase.js
// Firebase SDK via CDN — config e helpers globali
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  onValue,
  off,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── CONFIG ─────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyB9nQ4wrcAimzgm2SdbPi6zVg5wqR3FlR4",
  authDomain: "fantapolemica-cc7ae.firebaseapp.com",
  databaseURL: "https://fantapolemica-cc7ae-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fantapolemica-cc7ae",
  storageBucket: "fantapolemica-cc7ae.firebasestorage.app",
  messagingSenderId: "671113446569",
  appId: "1:671113446569:web:feb480bda98b8963d595b8",
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getDatabase(app);

// ── RE-EXPORT Firebase helpers ──────────────────
export {
  ref, set, get, push, update, onValue, off,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
};

// ── AUTH HELPERS ────────────────────────────────

export async function registerUser(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  const profile = {
    uid: cred.user.uid,
    displayName,
    email,
    createdAt: Date.now(),
    leagues: {},
  };
  await set(ref(db, `users/${cred.user.uid}`), profile);
  return cred.user;
}

export async function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logoutUser() {
  return signOut(auth);
}

export async function getUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  return snap.val();
}

// ── LEAGUE HELPERS ──────────────────────────────

export async function createLeague(user, settings) {
  const leagueRef = push(ref(db, "leagues"));
  const leagueId  = leagueRef.key;

  const cap = Number(settings.salaryCap) || 320;
  const league = {
    id: leagueId,
    name: settings.name,
    commissionerUid: user.uid,
    createdAt: Date.now(),
    settings: {
      maxManagers:          Number(settings.maxManagers) || 10,
      minRosterSize:        23,
      maxRosterSize:        30,
      minGoalkeepers:       2,
      salaryCap:            cap,
      softCapMax:           cap + 20,
      hardCapMax:           cap + 40,
      luxuryTaxThreshold:   cap + 40,
      gwStart:              Number(settings.gwStart) || 1,
      gwEnd:                34,
      gwPlayoffStart:       35,
      gwFinal:              38,
      homefieldBonus:       2,
      scoringSystem:        "mantra",
      voteSource:           "sofascore",
    },
    teams: {},
    status: "setup",
  };

  await set(leagueRef, league);
  const teamId = await addTeamToLeague(leagueId, user, settings.teamName || "My Team", true);
  return { leagueId, teamId };
}

export async function addTeamToLeague(leagueId, user, teamName, isCommissioner = false) {
  const teamRef = push(ref(db, `leagues/${leagueId}/teams`));
  const teamId  = teamRef.key;

  const team = {
    id:         teamId,
    name:       teamName,
    ownerUid:   user.uid,
    ownerName:  user.displayName || user.email,
    joinedAt:   Date.now(),
    currentCap: 0,
    capLevel:   "under",
    capPenalty: 0,
    wins: 0, losses: 0, draws: 0,
    goalsFor: 0, goalsAgainst: 0,
    fantaPoints: 0, points: 0,
    draftPicks: {},
    players: {},
  };

  await set(teamRef, team);
  await update(ref(db, `users/${user.uid}/leagues`), {
    [leagueId]: {
      teamId,
      role: isCommissioner ? "commissioner" : "manager",
    },
  });

  return teamId;
}

export async function joinLeague(leagueId, user, teamName) {
  const snap = await get(ref(db, `leagues/${leagueId}`));
  if (!snap.exists()) throw new Error("Codice lega non trovato");

  const league = snap.val();
  const teams  = Object.values(league.teams || {});

  if (teams.length >= league.settings.maxManagers)
    throw new Error("Lega al completo");
  if (teams.some(t => t.ownerUid === user.uid))
    throw new Error("Sei già in questa lega");

  return addTeamToLeague(leagueId, user, teamName);
}

export async function getLeague(leagueId) {
  const snap = await get(ref(db, `leagues/${leagueId}`));
  return snap.val();
}

// ── UTILS ───────────────────────────────────────

export function translateAuthError(code) {
  const map = {
    "auth/invalid-credential":   "Email o password errata",
    "auth/email-already-in-use": "Email già registrata",
    "auth/weak-password":        "Password troppo corta (min 6 caratteri)",
    "auth/invalid-email":        "Email non valida",
    "auth/too-many-requests":    "Troppi tentativi. Riprova tra poco.",
  };
  return map[code] || "Errore: " + code;
}

export function getCapLevel(currentCap, settings) {
  const { salaryCap, softCapMax, hardCapMax, luxuryTaxThreshold } = settings;
  if (currentCap <= salaryCap)          return "under";
  if (currentCap <= softCapMax)         return "soft";
  if (currentCap <= luxuryTaxThreshold) return "hard";
  return "luxury";
}

export function capLevelLabel(level) {
  return {
    under:   "✓ Cap",
    soft:    "Soft Cap",
    hard:    "Hard Cap",
    luxury:  "Luxury Tax",
  }[level] || level;
}

export function capLevelBadgeClass(level) {
  return {
    under:   "badge-cap",
    soft:    "badge-soft",
    hard:    "badge-hard",
    luxury:  "badge-luxury",
  }[level] || "";
}
