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

function generateForCourt(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (court?.status === "playing") return false;
  const eligible = state.players.filter(
    (p) => p.arrived && p.available !== false && !p.currentlyPlaying,
  );
  const need = playersPerMatch();
  if (eligible.length < need) return false;
  const maps = relationshipMaps();
  const match = findBestSchedule(eligible, courtNumber, maps);
  if (!match) return false;
  match.createdAt = new Date().toISOString();
  match.roundNumber = state.nextRoundNumber++;
  const old = court || { court: courtNumber };
  if (court) {
    court.players = match.players;
    court.status = "playing";
    court.matchId = makeId();
    court.startedAt = match.createdAt;
    court.roundNumber = match.roundNumber;
  } else
    state.currentCourts.push({
      court: courtNumber,
      players: match.players,
      status: "playing",
      matchId: makeId(),
      startedAt: match.createdAt,
      roundNumber: match.roundNumber,
    });
  state.players.forEach((p) => {
    if (match.players.includes(p.id)) {
      p.matchCountPending = (p.matchCountPending || 0) + 1;
      p.currentlyPlaying = true;
      p.waitStreak = 0;
    }
  });
  updateWaitingAfterSelection(match.players);
  saveState();
  return true;
}

function partitionKey(players) {
  const teamA = [players[0], players[1]].sort().join(",");
  const teamB = [players[2], players[3]].sort().join(",");
  return [teamA, teamB].sort().join("|");
}

function cycleDoublesArrangement(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "playing" || state.format !== "doubles")
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
