// ---------------------------------------------------------------------------
// FIXED-PARTNER SEAMS (not implemented yet)
//
// A fixed partnership means two players always play on the same team. Adding it
// later means treating the eligible pool as "units" (a solo player, or a locked
// pair) instead of individuals. The four hook points are marked with
// [PARTNER HOOK] comments below:
//
//   1. buildRerollMatch  - pick units, not individuals, so a pair is never split
//   2. findBestSchedule  - same, for the priority-based first generation
//   3. getSwapCandidates - a partnered player can only be swapped for another
//                          partnered player (two slots move together)
//   4. cycleDoublesArrangement - skip arrangements that separate a fixed pair
//
// The player field would be `partnerId` (null when unpartnered, symmetric on
// both players). state.js already spreads unknown player fields through
// loadState, so adding it needs no migration.
// ---------------------------------------------------------------------------

function playersPerMatch() {
  return state.format === "singles" ? 2 : 4;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function pairCount(map, a, b) {
  return map.get(pairKey(a, b)) || 0;
}

function addPair(map, a, b) {
  if (a && b && a !== b)
    map.set(pairKey(a, b), (map.get(pairKey(a, b)) || 0) + 1);
}

function relationshipMaps() {
  const teammate = new Map(),
    opponent = new Map(),
    lastPlayed = new Set();
  for (const r of state.history) {
    for (const m of r.matches) {
      const ids = m.players;
      if (state.format === "doubles" && ids.length === 4) {
        addPair(teammate, ids[0], ids[1]);
        addPair(teammate, ids[2], ids[3]);
        [
          [ids[0], ids[2]],
          [ids[0], ids[3]],
          [ids[1], ids[2]],
          [ids[1], ids[3]],
        ].forEach((x) => addPair(opponent, x[0], x[1]));
      } else if (ids.length === 2) addPair(opponent, ids[0], ids[1]);
    }
  }
  state.currentCourts.forEach((c) => {
    if (c.status === "playing") c.players.forEach((id) => lastPlayed.add(id));
  });
  return { teammate, opponent, lastPlayed };
}

function shuffle(a) {
  return [...a].sort(() => Math.random() - 0.5);
}

function scheduleScore(ids, maps) {
  const selected = new Set(ids);
  const after = state.players.map(
    (p) => p.matchCount + (selected.has(p.id) ? 1 : 0),
  );
  const max = Math.max(...after),
    min = Math.min(...after),
    spread = max - min;
  const avg = after.reduce((a, b) => a + b, 0) / after.length;
  const variance = after.reduce((s, c) => s + (c - avg) ** 2, 0);
  let score = spread * 100000 + variance * 3000;
  ids.forEach((id) => {
    const p = state.players.find((x) => x.id === id);
    if (!p) return;
    score -= Math.min(p.waitStreak || 0, 10) * 120;
    // Early arrival is only a small tie-breaker and fades as the player gets matches.
    const earlyCredit = Math.max(
      0,
      3 - (p.matchCount || 0) - (p.matchCountPending || 0),
    );
    score -= Math.min(p.arrivalOrder || 0, 100) * 0.02 * earlyCredit;
  });
  return score;
}

function arrangementScore(matches, maps) {
  let score = scheduleScore(
    matches.flatMap((m) => m.players),
    maps,
  );
  for (const m of matches) {
    if (state.format === "doubles") {
      const [a, b, c, d] = m.players;
      score +=
        pairCount(maps.teammate, a, b) * 30000 +
        pairCount(maps.teammate, c, d) * 30000;
      [
        [a, c],
        [a, d],
        [b, c],
        [b, d],
      ].forEach((x) => (score += pairCount(maps.opponent, x[0], x[1]) * 250));
    } else score += pairCount(maps.opponent, m.players[0], m.players[1]) * 250;
  }
  return score;
}

function bestDoubles(group, maps) {
  const [a, b, c, d] = group;
  const opts = [
    [a, b, c, d],
    [a, c, b, d],
    [a, d, b, c],
  ];
  return opts.sort((x, y) => {
    const s = (q) =>
      pairCount(maps.teammate, q[0], q[1]) * 30000 +
      pairCount(maps.teammate, q[2], q[3]) * 30000 +
      [
        [q[0], q[2]],
        [q[0], q[3]],
        [q[1], q[2]],
        [q[1], q[3]],
      ].reduce((n, z) => n + pairCount(maps.opponent, z[0], z[1]) * 250, 0);
    return s(x) - s(y);
  })[0];
}

function findBestSchedule(eligible, courtNumber, maps) {
  // [PARTNER HOOK 2] group `eligible` into units before slicing the pool.
  const need = playersPerMatch(),
    max = Math.min(eligible.length, need);
  let best = null,
    bestScore = Infinity;
  const iterations = Math.min(2200, Math.max(500, eligible.length * 120));
  for (let i = 0; i < iterations; i++) {
    const ordered = shuffle(eligible).sort(
      (a, b) =>
        a.matchCount - b.matchCount ||
        b.waitStreak - a.waitStreak ||
        a.arrivalOrder - b.arrivalOrder,
    );
    const pool = ordered.slice(0, max);
    if (pool.length < need) continue;
    let players = pool.map((p) => p.id);
    if (state.format === "doubles") players = bestDoubles(players, maps);
    const m = { court: courtNumber, players };
    const score = arrangementScore([m], maps);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

function updateWaitingAfterSelection(selectedIds) {
  const selected = new Set(selectedIds);
  state.players.forEach((p) => {
    if (!p.arrived || selected.has(p.id) || p.currentlyPlaying)
      p.waitStreak = 0;
    else p.waitStreak = (p.waitStreak || 0) + 1;
  });
}

function getEligiblePlayers() {
  return state.players.filter(
    (p) =>
      p.arrived && p.available !== false && !p.currentlyPlaying && !p.reserved,
  );
}

function applyPendingMatch(courtNumber, match) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (court) {
    court.players = match.players;
    court.status = "pending";
    court.matchId = null;
    court.startedAt = null;
    court.roundNumber = null;
  } else {
    state.currentCourts.push({
      court: courtNumber,
      players: match.players,
      status: "pending",
      matchId: null,
      startedAt: null,
      roundNumber: null,
    });
  }
  state.players.forEach((p) => {
    if (match.players.includes(p.id)) p.reserved = true;
  });
  saveState();
}

function proposeMatchForCourt(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (court && court.status !== "idle") return false;

  const eligible = getEligiblePlayers();
  if (eligible.length < playersPerMatch()) return false;

  const maps = relationshipMaps();
  const match = findBestSchedule(eligible, courtNumber, maps);
  if (!match) return false;

  applyPendingMatch(courtNumber, match);
  return true;
}

function buildRerollMatch(eligible, courtNumber, maps, previousIds) {
  // [PARTNER HOOK 1] shuffle units, not players, so pairs stay together.
  const need = playersPerMatch();
  const previousSet = new Set(previousIds);

  const originals = eligible.filter((p) => previousSet.has(p.id));
  const bench = eligible.filter((p) => !previousSet.has(p.id));

  if (!bench.length) return null;

  // keepCount may be 0 (a completely fresh line-up) whenever the bench is deep
  // enough to fill the match on its own. It is capped at need - 1 so the result
  // is always a different set from the one just rejected.
  const minKeep = Math.max(0, need - bench.length);
  const maxKeep = Math.min(originals.length, need - 1);
  if (minKeep > maxKeep) return null;

  const keepCount =
    minKeep + Math.floor(Math.random() * (maxKeep - minKeep + 1));

  const kept = shuffle(originals).slice(0, keepCount);
  const incoming = shuffle(bench).slice(0, need - keepCount);
  const picked = [...kept, ...incoming];
  if (picked.length < need) return null;

  let players = shuffle(picked).map((p) => p.id);
  if (state.format === "doubles") players = bestDoubles(players, maps);
  return { court: courtNumber, players };
}

function confirmCourt(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "pending") return false;

  court.status = "playing";
  court.matchId = makeId();
  court.startedAt = new Date().toISOString();
  court.roundNumber = state.nextRoundNumber++;

  state.players.forEach((p) => {
    if (court.players.includes(p.id)) {
      p.matchCountPending = (p.matchCountPending || 0) + 1;
      p.currentlyPlaying = true;
      p.reserved = false;
      p.waitStreak = 0;
    }
  });
  updateWaitingAfterSelection(court.players);
  saveState();
  return true;
}

function rerollCourt(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "pending") return false;

  const previousIds = [...court.players];

  state.players.forEach((p) => {
    if (previousIds.includes(p.id)) p.reserved = false;
  });
  court.status = "idle";
  court.players = [];

  const eligible = getEligiblePlayers();
  const maps = relationshipMaps();
  const match = buildRerollMatch(eligible, courtNumber, maps, previousIds);

  if (!match) {
    court.status = "pending";
    court.players = previousIds;
    state.players.forEach((p) => {
      if (previousIds.includes(p.id)) p.reserved = true;
    });
    saveState();
    return false;
  }

  applyPendingMatch(courtNumber, match);
  return true;
}

function getSwapCandidates() {
  // [PARTNER HOOK 3] filter to partner-compatible candidates.
  return getEligiblePlayers().sort((a, b) => a.name.localeCompare(b.name));
}

function swapPlayerInCourt(courtNumber, slotIndex, newPlayerId) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "pending") return false;
  if (slotIndex < 0 || slotIndex >= court.players.length) return false;

  const outgoingId = court.players[slotIndex];
  if (!newPlayerId || outgoingId === newPlayerId) return false;
  if (court.players.includes(newPlayerId)) return false;

  const incoming = state.players.find((p) => p.id === newPlayerId);
  if (!incoming) return false;
  if (
    !incoming.arrived ||
    incoming.available === false ||
    incoming.currentlyPlaying ||
    incoming.reserved
  )
    return false;

  const outgoing = state.players.find((p) => p.id === outgoingId);
  if (outgoing) outgoing.reserved = false;
  incoming.reserved = true;

  court.players[slotIndex] = newPlayerId;
  saveState();
  return true;
}

function cancelPendingCourt(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "pending") return false;

  state.players.forEach((p) => {
    if (court.players.includes(p.id)) p.reserved = false;
  });
  court.status = "idle";
  court.players = [];
  court.matchId = null;
  court.startedAt = null;
  court.roundNumber = null;
  saveState();
  return true;
}

function partitionKey(players) {
  const teamA = [players[0], players[1]].sort().join(",");
  const teamB = [players[2], players[3]].sort().join(",");
  return [teamA, teamB].sort().join("|");
}

function cycleDoublesArrangement(courtNumber) {
  // [PARTNER HOOK 4] drop arrangements that split a fixed pair.
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (
    !court ||
    !["pending", "playing"].includes(court.status) ||
    state.format !== "doubles"
  )
    return false;
  if (!court.players || court.players.length !== 4) return false;

  const [w, x, y, z] = [...court.players].sort();
  const arrangements = [
    [w, x, y, z], // w+x vs y+z
    [x, z, w, y], // x+z vs w+y
    [y, x, z, w], // y+x vs z+w
  ];
  const currentIndex = arrangements.findIndex(
    (a) => partitionKey(a) === partitionKey(court.players),
  );
  court.players = arrangements[(currentIndex + 1) % arrangements.length];
  saveState();
  return true;
}

function completeCourt(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "playing") return false;
  const completedAt = new Date().toISOString();
  const record = {
    court: court.court,
    courtName: getCourtName(court.court),
    roundNumber: court.roundNumber,
    players: [...court.players],
    startedAt: court.startedAt,
    completedAt,
  };
  state.history.push({ matches: [record] });
  const ids = new Set(court.players);
  state.players.forEach((p) => {
    if (ids.has(p.id)) {
      p.matchCount += p.matchCountPending || 1;
      p.matchCountPending = 0;
      p.currentlyPlaying = false;
      p.waitStreak = 0;
    }
  });
  court.status = "idle";
  court.players = [];
  court.matchId = null;
  court.startedAt = null;
  saveState();
  return true;
}

function completeAllPlaying() {
  state.currentCourts
    .filter((c) => c.status === "playing")
    .forEach((c) => completeCourt(c.court));
}
