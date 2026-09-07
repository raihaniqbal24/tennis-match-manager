const STORAGE_KEY = "tennis-match-manager-v5";

const state = loadState();

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultState() {
  return {
    courts: 2,
    courtNames: ["Court 1", "Court 2"],
    format: "doubles",
    players: [],
    history: [],
    currentCourts: [],
    nextRoundNumber: 1,
    lastSaved: null,
  };
}

function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw);
    return {
      ...defaultState(),
      ...p,
      players: Array.isArray(p.players) ? p.players : [],
      history: Array.isArray(p.history) ? p.history : [],
      currentCourts: Array.isArray(p.currentCourts) ? p.currentCourts : [],
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  state.lastSaved = new Date().toLocaleString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const el = document.getElementById("lastSaved");
  if (el) el.textContent = `Saved ${state.lastSaved}`;
}

function ensureCourtNames() {
  while (state.courtNames.length < state.courts)
    state.courtNames.push(`Court ${state.courtNames.length + 1}`);
  state.courtNames = state.courtNames.slice(0, state.courts);
}

function getCourtName(n) {
  ensureCourtNames();
  return state.courtNames[n - 1] || `Court ${n}`;
}

function playerLookup() {
  return new Map(state.players.map((p) => [p.id, p]));
}
