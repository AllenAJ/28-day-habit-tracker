const STORAGE_KEY = "zerogpu_habits_v1";
const SDK_PREF_KEY = "zerogpu_sdk_enabled_v1";
const OPTIONAL_ORIGINS = ["https://*.zerogpu.ai/*", "https://*.workers.dev/*"];
let debugModeEnabled = false;

function getTodayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatTodayLabel() {
  const d = new Date();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

async function loadState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      resolve(result[STORAGE_KEY] || { habits: [] });
    });
  });
}

async function saveState(state) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: state }, () => resolve());
  });
}

async function getSdkEnabledPreference() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SDK_PREF_KEY, (result) => resolve(result[SDK_PREF_KEY] === true));
  });
}

async function setSdkEnabledPreference(enabled) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [SDK_PREF_KEY]: enabled }, () => resolve());
  });
}

async function hasSdkHostPermissions() {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: OPTIONAL_ORIGINS }, (granted) => resolve(granted));
  });
}

async function requestSdkHostPermissions() {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: OPTIONAL_ORIGINS }, (granted) => resolve(granted));
  });
}

async function removeSdkHostPermissions() {
  return new Promise((resolve) => {
    chrome.permissions.remove({ origins: OPTIONAL_ORIGINS }, (removed) => resolve(removed));
  });
}

async function notifyBackgroundDisableSdk() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "zerogpu:disable" }, () => resolve());
  });
}

function setSdkControlsState(enabled, permissionsGranted) {
  const btn = document.getElementById("sdkToggleBtn");
  const status = document.getElementById("sdkStatusText");

  if (enabled && permissionsGranted) {
    btn.textContent = "Disable";
    status.textContent = "Enabled (host access granted)";
    return;
  }

  btn.textContent = "Enable";
  status.textContent = "Disabled";
}

async function refreshSdkControls() {
  const [enabled, permissionsGranted] = await Promise.all([
    getSdkEnabledPreference(),
    hasSdkHostPermissions(),
  ]);

  setSdkControlsState(enabled, permissionsGranted);

  if (!enabled || !permissionsGranted) {
    return;
  }

  const response = await requestBackgroundDebugStatus(false);
  const status = document.getElementById("sdkStatusText");
  if (response.ok && response.state?.initialized) {
    status.textContent = "Enabled (running)";
  } else if (response.ok) {
    status.textContent = "Enabled (initializing)";
  } else {
    status.textContent = "Enabled (status unavailable)";
  }
}

async function setupSdkControls() {
  const btn = document.getElementById("sdkToggleBtn");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const enabled = await getSdkEnabledPreference();

    if (!enabled) {
      const granted = await requestSdkHostPermissions();
      if (!granted) {
        await refreshSdkControls();
        btn.disabled = false;
        return;
      }

      await setSdkEnabledPreference(true);
      await requestBackgroundDebugStatus(true);
      await refreshSdkControls();
      btn.disabled = false;
      return;
    }

    await setSdkEnabledPreference(false);
    await notifyBackgroundDisableSdk();
    await removeSdkHostPermissions();
    await refreshSdkControls();
    btn.disabled = false;
  });

  await refreshSdkControls();
}

function computeStreak(habit) {
  const todayKey = getTodayKey();
  const days = Object.keys(habit.days || {}).sort().reverse();
  let streak = 0;
  let expected = todayKey;

  for (const day of days) {
    if (habit.days[day] !== true) continue;
    if (day === expected) {
      streak += 1;
      const d = new Date(expected);
      d.setDate(d.getDate() - 1);
      expected = d.toISOString().slice(0, 10);
    } else if (day < expected) {
      break;
    }
  }
  return streak;
}

function renderEmptyState(container) {
  container.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `
    No habits yet.
    <span>Add one like "Drink water" or "Read 10 minutes".</span>
  `;
  container.appendChild(div);
}

function renderHabits(state) {
  const list = document.getElementById("habitsList");
  const todayKey = getTodayKey();

  if (!state.habits.length) {
    renderEmptyState(list);
    document.getElementById("statsText").textContent = "";
    return;
  }

  list.innerHTML = "";
  let doneCount = 0;

  state.habits.forEach((habit, index) => {
    const doneToday = !!habit.days?.[todayKey];
    if (doneToday) doneCount += 1;

    const wrapper = document.createElement("div");
    wrapper.className = "habit";

    const checkbox = document.createElement("button");
    checkbox.className = "checkbox" + (doneToday ? " checked" : "");
    checkbox.setAttribute("aria-label", "Toggle completion");
    checkbox.innerHTML = `<div class="checkbox-icon"></div>`;

    const main = document.createElement("div");
    main.className = "habit-main";

    const row = document.createElement("div");
    row.className = "habit-row";

    const title = document.createElement("div");
    title.className = "habit-title" + (doneToday ? " done" : "");
    title.textContent = habit.title;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Delete habit";

    row.appendChild(title);
    row.appendChild(deleteBtn);

    const streakLabel = document.createElement("div");
    streakLabel.className = "habit-meta";
    const streak = computeStreak(habit);
    streakLabel.textContent =
      streak > 0 ? `Current streak: ${streak} day${streak === 1 ? "" : "s"}` : "No streak yet";

    main.appendChild(row);
    main.appendChild(streakLabel);

    wrapper.appendChild(checkbox);
    wrapper.appendChild(main);

    // Handlers
    checkbox.addEventListener("click", async () => {
      const newState = await loadState();
      const h = newState.habits[index];
      if (!h.days) h.days = {};
      if (h.days[todayKey]) {
        delete h.days[todayKey];
      } else {
        h.days[todayKey] = true;
      }
      await saveState(newState);
      renderHabits(newState);
      updateStats(newState);
    });

    deleteBtn.addEventListener("click", async () => {
      const newState = await loadState();
      newState.habits.splice(index, 1);
      await saveState(newState);
      renderHabits(newState);
      updateStats(newState);
    });

    list.appendChild(wrapper);
  });

  updateStats(state);
}

function updateStats(state) {
  const todayKey = getTodayKey();
  const total = state.habits.length;
  const done = state.habits.filter((h) => h.days?.[todayKey]).length;

  const el = document.getElementById("statsText");
  if (!total) {
    el.textContent = "";
    return;
  }
  el.textContent = `${done}/${total} done today`;
}

async function handleAddHabit() {
  const input = document.getElementById("newHabitInput");
  const title = input.value.trim();
  if (!title) return;

  const state = await loadState();
  state.habits.push({
    id: Date.now().toString(),
    title,
    days: {},
  });
  await saveState(state);
  input.value = "";
  renderHabits(state);
  updateStats(state);
}

async function handleResetToday() {
  const state = await loadState();
  const todayKey = getTodayKey();
  state.habits.forEach((h) => {
    if (h.days && h.days[todayKey]) {
      delete h.days[todayKey];
    }
  });
  await saveState(state);
  renderHabits(state);
  updateStats(state);
}

function formatDebugStatus(state) {
  if (!state) {
    return "No status data from background service worker.";
  }

  return [
    `status: ${state.status}`,
    `initialized: ${state.initialized}`,
    `env: ${state.env || "unknown"}`,
    `lastAttemptAt: ${state.lastAttemptAt || "never"}`,
    `lastSuccessAt: ${state.lastSuccessAt || "never"}`,
    `lastErrorAt: ${state.lastErrorAt || "never"}`,
    `lastError: ${state.lastErrorMessage || "none"}`,
  ].join("\n");
}

async function requestBackgroundDebugStatus(forceInit = false) {
  if (forceInit) {
    const [enabled, permissionsGranted] = await Promise.all([
      getSdkEnabledPreference(),
      hasSdkHostPermissions(),
    ]);
    if (!enabled || !permissionsGranted) {
      return {
        ok: false,
        error: "Enable Optional ZeroGPU features first.",
      };
    }
  }

  const type = forceInit ? "zerogpu:forceInit" : "zerogpu:getStatus";
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      resolve(response || { ok: false, error: "No response from background." });
    });
  });
}

async function renderDebugPanelStatus(forceInit = false) {
  const debugStatusEl = document.getElementById("debugStatusText");
  debugStatusEl.textContent = "Loading SDK status...";

  const response = await requestBackgroundDebugStatus(forceInit);
  if (!response.ok) {
    debugStatusEl.textContent = `Failed to load SDK status.\n${response.error || "Unknown error"}`;
    return;
  }

  debugStatusEl.textContent = formatDebugStatus(response.state);
}

function setDebugMode(enabled) {
  debugModeEnabled = enabled;
  const panel = document.getElementById("debugPanel");
  panel.classList.toggle("hidden", !enabled);
  if (enabled) {
    void renderDebugPanelStatus(false);
  }
}

function setupDebugMode() {
  const refreshBtn = document.getElementById("debugRefreshBtn");
  refreshBtn.addEventListener("click", () => {
    void renderDebugPanelStatus(true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      setDebugMode(!debugModeEnabled);
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("todayLabel").textContent = formatTodayLabel();

  const addBtn = document.getElementById("addHabitBtn");
  const input = document.getElementById("newHabitInput");
  const resetBtn = document.getElementById("resetTodayBtn");

  addBtn.addEventListener("click", handleAddHabit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleAddHabit();
    }
  });
  resetBtn.addEventListener("click", handleResetToday);
  await setupSdkControls();
  setupDebugMode();

  const state = await loadState();
  renderHabits(state);
  updateStats(state);
});

