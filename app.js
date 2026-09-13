function setTab(tab) {
  document
    .querySelectorAll(".tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.toggle("active", p.id === `${tab}Tab`));
}

$("addPlayerBtn").onclick = () => {
  const input = $("playerName"),
    name = input.value.trim();
  if (!name) return;
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    return toast("That player is already listed.");
  state.players.push({
    id: makeId(),
    name,
    arrived: false,
    available: true,
    matchCount: 0,
    waitStreak: 0,
    currentlyPlaying: false,
    reserved: false,
  });
  input.value = "";
  saveState();
  render();
  input.focus();
};

$("playerName").onkeydown = (e) => {
  if (e.key === "Enter") $("addPlayerBtn").click();
};

$("courtCount").onchange = () => {
  if (state.currentCourts.some((c) => c.status === "playing")) {
    $("courtCount").value = state.courts;
    return toast("Finish active courts before changing court count.");
  }
  state.courts = Math.max(1, Math.min(20, Number($("courtCount").value) || 2));
  ensureCourtNames();
  state.currentCourts = Array.from(
    { length: state.courts },
    (_, i) =>
      state.currentCourts.find((c) => c.court === i + 1) || {
        court: i + 1,
        status: "idle",
        players: [],
      },
  );
  saveState();
  render();
};

$("formatSelect").onchange = () => {
  if (
    state.history.length ||
    state.currentCourts.some((c) => c.status === "playing")
  ) {
    $("formatSelect").value = state.format;
    return toast("Format is locked after matches start.");
  }
  state.format = $("formatSelect").value;
  saveState();
  render();
};

$("saveCourtNamesBtn").onclick = () => {
  document
    .querySelectorAll(".court-name-input")
    .forEach(
      (i) =>
        (state.courtNames[Number(i.dataset.index)] =
          i.value.trim() || `Court ${Number(i.dataset.index) + 1}`),
    );
  saveState();
  render();
};

$("playerList").onchange = (e) => {
  const arrivalId = e.target.dataset.arrival;
  const awayId = e.target.dataset.away;

  if (awayId) {
    const p = state.players.find((x) => x.id === awayId);
    if (!p) return;
    if (p.currentlyPlaying) {
      e.target.checked = !e.target.checked;
      return toast("That player is currently playing.");
    }
    p.available = !e.target.checked; // checked = sitting out
    saveState();
    render();
    return;
  }

  const p = state.players.find((x) => x.id === arrivalId);
  if (!p) return;
  if (p.currentlyPlaying || p.reserved) {
    e.target.checked = true;
    return toast(
      p.reserved ? "That player is in a pending match — reroll or cancel it first." : "That player is currently playing.",
    );
  }

  if (e.target.checked) {
    p.arrived = true;
    p.available = true;

    if (!p.arrivalOrder) {
      const maxOrder = Math.max(
        0,
        ...state.players.map((x) => x.arrivalOrder || 0),
      );
      p.arrivalOrder = maxOrder + 1;
      p.arrivalTime = Date.now();
    }
  } else {
    p.arrived = false;
  }

  saveState();
  render();
};

$("playerList").onclick = (e) => {
  const id = e.target.dataset.delete;
  if (!id) return;

  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  if (player.currentlyPlaying || player.reserved) {
    return toast(
      player.reserved ? "Cannot remove a player in a pending match." : "Cannot remove a player currently playing.",
    );
  }

  const hasPlayed = state.history.some((round) =>
    round.matches?.some((match) => match.players?.includes(id)),
  );

  if (hasPlayed) {
    player.available = false;
    player.arrived = false;
    saveState();
    render();
    return toast(`${player.name} has been marked as gone home.`);
  }
  state.players = state.players.filter((p) => p.id !== id);

  saveState();
  render();
};

$("arriveAllBtn").onclick = () => {
  state.players.forEach((p) => {
    if (!p.arrived && !p.arrivalOrder) {
      const maxOrder = Math.max(
        0,
        ...state.players.map((x) => x.arrivalOrder || 0),
      );
      p.arrivalOrder = maxOrder + 1;
      p.arrivalTime = Date.now();
    }
    p.arrived = true;
    p.available = true;
  });
  saveState();
  render();
};

$("clearAllBtn").onclick = () => {
  state.players.forEach((p) => {
    if (!p.currentlyPlaying) p.arrived = false;
  });
  saveState();
  render();
};

$("generateBtn").onclick = () => {
  let made = 0;
  for (let i = 1; i <= state.courts; i++) if (proposeMatchForCourt(i)) made++;
  if (made) render();
  else toast(`Not enough available players to fill an idle court.`);
};

$("scheduleList").onclick = (e) => {
  const complete = e.target.dataset.completeCourt,
    gen = e.target.dataset.generateCourt,
    rearrange = e.target.dataset.rearrangeCourt,
    reroll = e.target.dataset.rerollCourt,
    confirm = e.target.dataset.confirmCourt,
    cancel = e.target.dataset.cancelCourt;

  if (complete) {
    completeCourt(Number(complete));
    render();
    setTab("matches");
    return;
  }
  if (gen) {
    if (proposeMatchForCourt(Number(gen))) render();
    else toast("Not enough available players for this court.");
    return;
  }
  if (rearrange) {
    if (cycleDoublesArrangement(Number(rearrange))) render();
    return;
  }
  if (reroll) {
    if (rerollCourt(Number(reroll))) render();
    else toast("Couldn't re-roll this match.");
    return;
  }
  if (confirm) {
    if (confirmCourt(Number(confirm))) render();
    return;
  }
  if (cancel) {
    if (cancelPendingCourt(Number(cancel))) render();
    return;
  }
};

$("completeAllBtn").onclick = () => {
  completeAllPlaying();
  render();
};

$("resetBtn").onclick = () => {
  if (!confirm("Reset the entire session?")) return;
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, defaultState());
  ensureCourtNames();
  saveState();
  render();
  toast("Session reset.");
};

document
  .querySelectorAll(".tab")
  .forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
ensureCourtNames();

state.currentCourts = Array.from(
  { length: state.courts },
  (_, i) =>
    state.currentCourts.find((c) => c.court === i + 1) || {
      court: i + 1,
      status: "idle",
      players: [],
    },
);

render();
