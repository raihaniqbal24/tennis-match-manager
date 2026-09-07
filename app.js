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
  const maxOrder = Math.max(
    0,
    ...state.players.map((p) => p.arrivalOrder || 0),
  );
  state.players.push({
    id: makeId(),
    name,
    arrived: false,
    available: true,
    matchCount: 0,
    waitStreak: 0,
    arrivalOrder: maxOrder + 1,
    currentlyPlaying: false,
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
  const id = e.target.dataset.arrival;
  if (!id) return;

  const p = state.players.find((x) => x.id === id);
  if (!p) return;
  if (p.currentlyPlaying) {
    e.target.checked = true;
    return toast("That player is currently playing.");
  }

  if (e.target.checked) {
    p.arrived = true;
    p.available = true;

    if (!p.arrivalTime) {
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
  if (player.currentlyPlaying) {
    return toast("Cannot remove a player currently playing.");
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
    if (!p.arrived && !p.arrivalTime) p.arrivalTime = Date.now();
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
  state.currentCourts = Array.from(
    { length: state.courts },
    (_, i) =>
      state.currentCourts.find((c) => c.court === i + 1) || {
        court: i + 1,
        status: "idle",
        players: [],
      },
  );
  let made = 0;
  for (let i = 1; i <= state.courts; i++) if (generateForCourt(i)) made++;
  if (made) render();
  else toast(`Not enough available players to fill an idle court.`);
};

$("scheduleList").onclick = (e) => {
  const complete = e.target.dataset.completeCourt,
    gen = e.target.dataset.generateCourt;
  if (complete) {
    completeCourt(Number(complete));
    render();
    setTab("matches");
    return;
  }
  if (gen) {
    if (generateForCourt(Number(gen))) render();
    else toast("Not enough available players for this court.");
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
