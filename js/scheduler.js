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

function getPartnerId(id) {
  const p = state.players.find((x) => x.id === id);
  return p?.partnerId || null;
}

function arePartners(idA, idB) {
  if (!idA || !idB) return false;
  return getPartnerId(idA) === idB && getPartnerId(idB) === idA;
}

// Drops partner links that point at a deleted player or are one-sided.
// Without this a corrupt or half-written link leaves a player permanently
// unschedulable, because buildUnits skips anyone whose partner is missing.
function normalizePartners() {
  state.players.forEach((p) => {
    if (!p.partnerId) return;
    const other = state.players.find((x) => x.id === p.partnerId);
    if (!other || other.partnerId !== p.id) p.partnerId = null;
  });
}

function setFixedPartner(idA, idB) {
  const a = state.players.find((p) => p.id === idA);
  const b = state.players.find((p) => p.id === idB);
  if (!a || !b || a.id === b.id) return false;
  if (a.reserved || a.currentlyPlaying || b.reserved || b.currentlyPlaying)
    return false;
  clearFixedPartner(a.id, true);
  clearFixedPartner(b.id, true);
  a.partnerId = b.id;
  b.partnerId = a.id;
  saveState();
  return true;
}

function clearFixedPartner(id, silent = false) {
  const p = state.players.find((x) => x.id === id);
  if (!p || !p.partnerId) return false;
  const other = state.players.find((x) => x.id === p.partnerId);
  if (other) other.partnerId = null;
  p.partnerId = null;
  if (!silent) saveState();
  return true;
}

// A fixed pair plays together every round, so the usual repeat-teammate
// penalty would make every line-up containing them progressively more
// expensive. Fixed pairs are exempt from it.
function teammatePenalty(maps, a, b) {
  return arePartners(a, b) ? 0 : pairCount(maps.teammate, a, b) * 30000;
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

function committedCount(p) {
  return p.matchCount + (p.matchCountPending || 0) + (p.reserved ? 1 : 0);
}

function scheduleScore(ids, maps) {
  const selected = new Set(ids);
  // Count matches already committed elsewhere: matchCountPending covers a
  // court that is playing, reserved covers one still under review. Without
  // these, generating court 2 cannot see who court 1 just took.
  const after = state.players.map(
    (p) => committedCount(p) + (selected.has(p.id) ? 1 : 0),
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
    // Credit must grow as arrivalOrder shrinks: lower score wins, so
    // subtracting the raw arrivalOrder would reward the LAST to arrive.
    const earliness = 100 - Math.min(p.arrivalOrder || 0, 100);
    score -= earliness * 0.02 * earlyCredit;
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
      score += teammatePenalty(maps, a, b) + teammatePenalty(maps, c, d);
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
  // Pairing is forced when a fixed pair is present; nothing left to optimise.
  if (group.some((id) => group.includes(getPartnerId(id)))) return group;
  const opts = [
    [a, b, c, d],
    [a, c, b, d],
    [a, d, b, c],
  ];
  return opts.sort((x, y) => {
    const s = (q) =>
      teammatePenalty(maps, q[0], q[1]) +
      teammatePenalty(maps, q[2], q[3]) +
      [
        [q[0], q[2]],
        [q[0], q[3]],
        [q[1], q[2]],
        [q[1], q[3]],
      ].reduce((n, z) => n + pairCount(maps.opponent, z[0], z[1]) * 250, 0);
    return s(x) - s(y);
  })[0];
}

function makeUnit(players) {
  return {
    ids: players.map((p) => p.id),
    size: players.length,
    matchCount: Math.max(...players.map((p) => p.matchCount || 0)),
    waitStreak: Math.max(...players.map((p) => p.waitStreak || 0)),
    arrivalOrder: Math.max(...players.map((p) => p.arrivalOrder || 0)),
  };
}

// Groups the eligible pool into schedulable units: a solo player, or a locked
// fixed pair. A partnered player whose partner is unavailable is left out
// entirely - they sit out until their partner is back.
function buildUnits(eligible) {
  if (state.format !== "doubles") return eligible.map((p) => makeUnit([p]));

  const eligibleIds = new Set(eligible.map((p) => p.id));
  const used = new Set();
  const units = [];

  eligible.forEach((p) => {
    if (used.has(p.id)) return;
    const partnerId = p.partnerId;
    if (partnerId && eligibleIds.has(partnerId) && !used.has(partnerId)) {
      const partner = eligible.find((x) => x.id === partnerId);
      used.add(p.id);
      used.add(partner.id);
      units.push(makeUnit([p, partner]));
    }
  });

  eligible.forEach((p) => {
    if (used.has(p.id)) return;
    if (p.partnerId) return; // partner unavailable - both sit out
    units.push(makeUnit([p]));
  });

  return units;
}

function sortUnits(units) {
  return [...units].sort(
    (a, b) =>
      a.matchCount - b.matchCount ||
      b.waitStreak - a.waitStreak ||
      a.arrivalOrder - b.arrivalOrder,
  );
}

// Exhaustive rather than greedy: walking units in priority order and skipping
// any that overflow can miss a valid line-up (e.g. solo+pair+pair with need 4
// stalls at 3, even though pair+pair fits).
function enumerateUnitCombos(units, need, limit = 3000) {
  const combos = [];
  const walk = (start, chosen, filled) => {
    if (combos.length >= limit) return;
    if (filled === need) {
      combos.push([...chosen]);
      return;
    }
    for (let i = start; i < units.length; i++) {
      if (filled + units[i].size > need) continue;
      chosen.push(units[i]);
      walk(i + 1, chosen, filled + units[i].size);
      chosen.pop();
      if (combos.length >= limit) return;
    }
  };
  walk(0, [], 0);
  return combos;
}

// Orders a combo into slots so a fixed pair always lands on the same team.
function comboPlayers(combo, maps) {
  if (state.format !== "doubles") return combo.flatMap((u) => u.ids);
  const pairs = combo.filter((u) => u.size === 2);
  const solos = combo.filter((u) => u.size === 1);
  if (pairs.length === 2) return [...pairs[0].ids, ...pairs[1].ids];
  if (pairs.length === 1)
    return [...pairs[0].ids, ...solos.flatMap((u) => u.ids)];
  return bestDoubles(
    solos.flatMap((u) => u.ids),
    maps,
  );
}

// Players that may be scheduled at all: units already drop anyone whose
// partner is away, since those sit out together by design.
function schedulablePlayers(eligible) {
  const ids = new Set(buildUnits(eligible).flatMap((u) => u.ids));
  return eligible.filter((p) => ids.has(p.id));
}

function enumeratePlayerCombos(players, need, limit = 3000) {
  const combos = [];
  const walk = (start, chosen) => {
    if (combos.length >= limit) return;
    if (chosen.length === need) {
      combos.push([...chosen]);
      return;
    }
    for (let i = start; i < players.length; i++) {
      chosen.push(players[i]);
      walk(i + 1, chosen);
      chosen.pop();
      if (combos.length >= limit) return;
    }
  };
  walk(0, []);
  return combos;
}

// The partners left out when only one half of a pair is in the line-up.
// Both-in is never broken: arrangePlayers always seats them together.
function brokenPartners(ids) {
  const out = [];
  ids.forEach((id) => {
    const partnerId = getPartnerId(id);
    if (!partnerId || ids.includes(partnerId)) return;
    const partner = state.players.find((x) => x.id === partnerId);
    if (partner) out.push(partner);
  });
  return out;
}

// Seats an intact fixed pair in slots 0-1 so they share a team; with two
// intact pairs the second lands in slots 2-3.
function arrangePlayers(ids, maps) {
  if (state.format !== "doubles") return ids;
  const anchor = ids.find((id) => ids.includes(getPartnerId(id)));
  if (!anchor) return bestDoubles(ids, maps);
  const partnerId = getPartnerId(anchor);
  const rest = ids.filter((id) => id !== anchor && id !== partnerId);
  return [anchor, partnerId, ...rest];
}

// Splitting a pair is a last resort: the best intact line-up wins unless the
// best split line-up is better by a full spread point (the 100000 weight in
// scheduleScore). So a pair only breaks when keeping it together would leave
// someone's match count genuinely out of line - never to merely tie on
// fairness. This is what keeps a pair balanced on a roster where only one
// player can sit out, since the pair can never rest together there.
// Tuned empirically: below this the pair splits when it did not need to,
// above it the one-spare case drifts badly out of balance.
const SPLIT_MARGIN = 100000;

function findBestSchedule(eligible, courtNumber, maps) {
  const need = playersPerMatch();
  const pool = sortUnits(buildUnits(eligible))
    .flatMap((u) => u.ids)
    .slice(0, 14)
    .map((id) => eligible.find((p) => p.id === id))
    .filter(Boolean);

  const combos = enumeratePlayerCombos(pool, need);
  if (!combos.length) return null;

  let bestIntact = null,
    bestIntactScore = Infinity,
    bestSplit = null,
    bestSplitScore = Infinity;

  for (const combo of combos) {
    const ids = combo.map((p) => p.id);
    const players = arrangePlayers(ids, maps);
    const score = arrangementScore([{ court: courtNumber, players }], maps);
    if (brokenPartners(ids).length === 0) {
      if (score < bestIntactScore) {
        bestIntactScore = score;
        bestIntact = { court: courtNumber, players };
      }
    } else if (score < bestSplitScore) {
      bestSplitScore = score;
      bestSplit = { court: courtNumber, players };
    }
  }

  if (!bestIntact) return bestSplit;
  if (bestSplit && bestSplitScore < bestIntactScore - SPLIT_MARGIN)
    return bestSplit;
  return bestIntact;
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
  const need = playersPerMatch();
  const units = sortUnits(buildUnits(eligible)).slice(0, 14);
  const combos = enumerateUnitCombos(units, need);
  if (!combos.length) return null;

  // Every combo except the one just rejected, so the result is always a
  // different set. Picking uniformly means the line-up may keep some, none or
  // all-but-one of the previous players.
  const previousKey = [...previousIds].sort().join(",");
  const distinct = combos.filter(
    (c) =>
      c
        .flatMap((u) => u.ids)
        .sort()
        .join(",") !== previousKey,
  );
  if (!distinct.length) return null;

  const combo = shuffle(distinct)[0];
  return { court: courtNumber, players: comboPlayers(combo, maps) };
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

// Only genuine solos: swapping in half of a bench pair would split that pair.
function getSwapCandidates() {
  const eligible = getEligiblePlayers();
  return buildUnits(eligible)
    .filter((u) => u.size === 1)
    .map((u) => eligible.find((p) => p.id === u.ids[0]))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Replaces a fixed pair on a pending court with two random bench players -
// either another fixed pair, or two genuine solos.
function replacePairOnCourt(courtNumber, slotIndex) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "pending") return false;
  if (state.format !== "doubles") return false;

  const id = court.players[slotIndex];
  const partnerId = getPartnerId(id);
  if (!partnerId || !court.players.includes(partnerId)) return false;

  const slots = [
    court.players.indexOf(id),
    court.players.indexOf(partnerId),
  ].sort((a, b) => a - b);

  const bench = getEligiblePlayers();
  const combos = enumerateUnitCombos(sortUnits(buildUnits(bench)), 2);
  if (!combos.length) return false;

  const incoming = shuffle(combos)[0].flatMap((u) => u.ids);
  if (incoming.length !== 2) return false;

  [id, partnerId].forEach((pid) => {
    const p = state.players.find((x) => x.id === pid);
    if (p) p.reserved = false;
  });
  incoming.forEach((pid) => {
    const p = state.players.find((x) => x.id === pid);
    if (p) p.reserved = true;
  });

  court.players[slots[0]] = incoming[0];
  court.players[slots[1]] = incoming[1];
  saveState();
  return true;
}

function swapPlayerInCourt(courtNumber, slotIndex, newPlayerId) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (!court || court.status !== "pending") return false;
  if (slotIndex < 0 || slotIndex >= court.players.length) return false;

  const outgoingId = court.players[slotIndex];
  if (!newPlayerId || outgoingId === newPlayerId) return false;
  // An intact pair moves only via replacePairOnCourt. A split half (partner
  // not on this court) behaves like any other player.
  if (
    state.format === "doubles" &&
    court.players.includes(getPartnerId(outgoingId))
  )
    return false;
  if (state.format === "doubles" && getPartnerId(newPlayerId)) return false;
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

function arrangementKeepsPairs(players) {
  const teamA = [players[0], players[1]];
  const teamB = [players[2], players[3]];
  return players.every((id) => {
    const partnerId = getPartnerId(id);
    if (!partnerId || !players.includes(partnerId)) return true;
    return (
      (teamA.includes(id) && teamA.includes(partnerId)) ||
      (teamB.includes(id) && teamB.includes(partnerId))
    );
  });
}

function legalArrangements(players) {
  const [w, x, y, z] = [...players].sort();
  return [
    [w, x, y, z], // w+x vs y+z
    [x, z, w, y], // x+z vs w+y
    [y, x, z, w], // y+x vs z+w
  ].filter(arrangementKeepsPairs);
}

// With any fixed pair on court only one split stays legal, so there is nothing
// to cycle through - the UI hides the button in that case.
function hasSwappableArrangement(court) {
  return (
    state.format === "doubles" &&
    court.players?.length === 4 &&
    legalArrangements(court.players).length > 1
  );
}

function cycleDoublesArrangement(courtNumber) {
  const court = state.currentCourts.find((c) => c.court === courtNumber);
  if (
    !court ||
    !["pending", "playing"].includes(court.status) ||
    state.format !== "doubles"
  )
    return false;
  if (!court.players || court.players.length !== 4) return false;

  const legal = legalArrangements(court.players);
  if (legal.length <= 1) return false;

  const currentIndex = legal.findIndex(
    (a) => partitionKey(a) === partitionKey(court.players),
  );
  court.players = legal[(currentIndex + 1) % legal.length];
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
