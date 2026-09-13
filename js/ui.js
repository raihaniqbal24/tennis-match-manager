let toastTimer;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(v) {
  return String(v).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}

function toast(m) {
  $("toast").textContent = m;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2500);
}

function renderCourtNames() {
  ensureCourtNames();
  $("courtNames").innerHTML = state.courtNames
    .map(
      (n, i) =>
        `<label class="court-name-field">
          <span>
            Court ${i + 1}
          </span>
          <input class="court-name-input" data-index="${i}" value="${escapeHtml(n)}" maxlength="40">
        </label>`,
    )
    .join("");
}

function statusBadge(p) {
  if (!p.arrived) return '<span class="status off">Away</span>';
  if (p.currentlyPlaying) return '<span class="status playing">Playing</span>';
  if ((p.waitStreak || 0) >= 4)
    return '<span class="status alert">🔶 Waiting 4+</span>';
  if ((p.waitStreak || 0) >= 2)
    return '<span class="status warning">⚠ Waiting 2+</span>';
  return '<span class="status ready">Ready</span>';
}

function renderPlayers() {
  const list = $("playerList");
  list.innerHTML = "";
  $("playersEmpty").style.display = state.players.length ? "none" : "block";
  [...state.players]
    .sort(
      (a, b) =>
        Number(b.arrived) - Number(a.arrived) ||
        a.matchCount - b.matchCount ||
        b.waitStreak - a.waitStreak ||
        a.name.localeCompare(b.name),
    )
    .forEach((p) => {
      const hasPlayed = state.history.some((round) =>
        round.matches?.some((match) => match.players?.includes(p.id)),
      );
      const actionLabel = hasPlayed ? "Gone Home" : "Remove";
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML = `<div class="player-name">${escapeHtml(p.name)}</div>
        <span>
        <label class="arrival-toggle">
          <input type="checkbox" data-arrival="${p.id}" ${p.arrived ? "checked" : ""}>
          Arrived
        </label>
        </span>
        <span>
          <label class="early-toggle no-wrap">
            <input type="checkbox" data-away="${p.id}" ${p.available === false ? "checked" : ""}>
            Sitting out
          </label>
        </span>
        <span>
          ${statusBadge(p)}
        </span>
        <span class="matches-pill">
          ${p.matchCount} matches
        </span>
        <span class="wait-pill">
          wait ${p.waitStreak || 0}
        </span>
        <button class="icon-button" data-delete="${p.id}">
          ${actionLabel}
        </button>`;
      list.appendChild(row);
    });
}

function renderStats() {
  const arrived = state.players.filter((p) => p.arrived).length,
    playing = state.players.filter((p) => p.currentlyPlaying).length;
  const avg = state.players.length
    ? state.players.reduce((s, p) => s + p.matchCount, 0) / state.players.length
    : 0;
  $("arrivedStat").textContent = arrived;
  $("playingStat").textContent = playing;
  $("waitingStat").textContent = Math.max(0, arrived - playing);
  $("avgStat").textContent = avg.toFixed(1);
}

function renderTeamsBlock(c, names) {
  return `<div class="teams">
            <div class="team">
              <div class="team-title">
                ${state.format === "singles" ? "Player A" : "Team A"}
              </div>
              <span class="player-chip">
                ${escapeHtml(names[0] || "")}
              </span>
              ${state.format === "doubles"
                ? `<span class="player-chip">${escapeHtml(names[1] || "")}</span>`
                : ""}
            </div>
            <div class="vs">
              VS
            </div>
            <div class="team">
              <div class="team-title">
                ${state.format === "singles" ? "Player B" : "Team B"}
              </div>
              <span class="player-chip">
                ${escapeHtml(names[state.format === "singles" ? 1 : 2] || "")}
              </span>
              ${state.format === "doubles"
                ? `<span class="player-chip">${escapeHtml(names[3] || "")}</span>`
                : ""}
            </div>
          </div>`;
}

function renderCourts() {
  const list = $("scheduleList");
  list.innerHTML = "";
  $("scheduleEmpty").style.display = state.currentCourts.length
    ? "none"
    : "block";
  state.currentCourts.forEach((c) => {
    const card = document.createElement("div");
    card.className = "match-card";
    const names = c.players.map((id) => getPlayerName(id));
    const label =
      c.status === "playing" ? `Round ${c.roundNumber}` :
      c.status === "pending" ? "Reviewing" : "Idle";
    const footer =
    c.status === "playing"
      ? `<div class="match-footer">
           <button class="button secondary small" data-complete-court="${c.court}">
             Complete ${escapeHtml(getCourtName(c.court))}
           </button>
         </div>`
      : c.status === "pending"
      ? `<div class="match-footer">
          <button class="button secondary small" data-reroll-court="${c.court}">
            Re-roll
          </button>
          ${state.format === "doubles"
            ? `<button class="button secondary small" data-rearrange-court="${c.court}">
                Swap Pairing
              </button>`
            : ""}
          <button class="button secondary small" data-cancel-court="${c.court}">
            Cancel
          </button>
          <button class="button primary small" data-confirm-court="${c.court}">
            Confirm &amp; Start
          </button>
        </div>`
      : `<div class="idle-court">
           <span>
            No match currently playing
           </span>
           <button class="button primary small" data-generate-court="${c.court}">
            Generate next match
           </button>
         </div>`;

    card.innerHTML = `<div class="match-head">
                        <span class="court">
                          ${escapeHtml(getCourtName(c.court))}
                        </span>
                        <span class="match-number">
                          ${label}
                        </span>
                      </div>
                      ${c.status !== "idle" ? renderTeamsBlock(c, names) : ""}
                      ${footer}`;
    list.appendChild(card);
  });
}

function renderHistory() {
  const list = $("historyList");
  if (!state.history.length) {
    list.innerHTML = '<div class="empty-state">No completed matches yet.</div>';
    return;
  }
  const grouped = {};
  state.history.forEach((h) =>
    h.matches.forEach((m) => (grouped[m.court] ??= []).push(m)),
  );
  list.innerHTML = Object.entries(grouped)
    .sort((a, b) => a[0] - b[0])
    .map(
      ([court, matches]) =>
        `<div class="history-court"><h3>${escapeHtml(getCourtName(Number(court)))}</h3>${matches
          .slice()
          .reverse()
          .map((m) => {
            const names = m.players.map((id) => getPlayerName(id));
            const sides =
              state.format === "doubles"
                ? `<span class="player-name-court">
                    ${escapeHtml(names[0])} + ${escapeHtml(names[1])}
                  </span>
                  &nbsp;&nbsp;&nbsp;VS&nbsp;&nbsp;&nbsp;
                  <span class="player-name-court">
                    ${escapeHtml(names[2])} + ${escapeHtml(names[3])}
                  </span>`
                : `<span class="player-name-court">
                    ${escapeHtml(names[0])}
                  </span>
                  &nbsp;&nbsp;&nbsp;VS&nbsp;&nbsp;&nbsp;
                  <span class="player-name-court">
                    ${escapeHtml(names[1])}
                  </span>`;
            return `<div class="history-row">
              <span>
                Round ${m.roundNumber}
              </span>
              <strong>
                ${sides}
              </strong>
              <time>
                ${new Date(m.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>`;
          })
          .join("")}</div>`,
    )
    .join("");
}

function renderBalance() {
  const list = $("balanceList");
  list.innerHTML = "";
  if (!state.players.length) return;
  const sorted = [...state.players].sort(
    (a, b) =>
      a.matchCount - b.matchCount ||
      b.waitStreak - a.waitStreak ||
      a.name.localeCompare(b.name),
  );
  const min = Math.min(...sorted.map((p) => p.matchCount)),
    max = Math.max(...sorted.map((p) => p.matchCount)),
    spread = max - min;
  $("balanceBadge").textContent =
    spread === 0
      ? "Perfectly even"
      : spread === 1
        ? "Within 1 match"
        : `${spread} match spread`;
  sorted.forEach((p) => {
    const row = document.createElement("div");
    row.className = `balance-row ${(p.waitStreak || 0) >= 4 ? "row-alert" : (p.waitStreak || 0) >= 2 ? "row-warning" : ""}`;
    row.innerHTML = `<span class="rank">
        ${statusBadge(p)}
      </span>
      <strong>
        ${escapeHtml(p.name)}
      </strong>
      <span class="matches-pill">
        ${p.matchCount}
      </span>
      <span class="wait-pill">
        waiting ${p.waitStreak || 0}
      </span>
      <span class="muted">
        ${p.arrived ? (p.currentlyPlaying ? "Playing" : "Available") : "Not Available"}
      </span>`;
    list.appendChild(row);
  });
}

function render() {
  ensureCourtNames();
  $("sessionBadge").textContent = `${state.players.length} players`;
  $("courtCount").value = state.courts;
  $("formatSelect").value = state.format;
  renderCourtNames();
  renderPlayers();
  renderStats();
  renderCourts();
  renderHistory();
  renderBalance();
  $("completeAllBtn").disabled = !state.currentCourts.some(
    (c) => c.status === "playing",
  );
  $("roundHint").textContent = state.currentCourts.some(
    (c) => c.status === "playing",
  )
    ? "Courts are independent — complete and refill each court as it finishes."
    : "Generate matches for available courts.";
  if (state.lastSaved)
    $("lastSaved").textContent = `Last saved ${state.lastSaved}`;
}
