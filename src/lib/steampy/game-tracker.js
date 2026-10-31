/* global GM_getValue, GM_setValue, GM_registerMenuCommand, GM_notification */

const TRACKER_STORAGE_KEY = "steampyGameTracker";
const TRACKER_PANEL_ID = "steampyGameTrackerPanel";
const TRACKER_STYLE_ID = "steampyGameTrackerStyle";
const TRACKER_BAR_CLASS = "steamPyPlusTrackerBar";
const TRACKER_BADGE_CLASS = "steamPyPlusTrackerBadge";
const TRACKER_BTN_CLASS = "steamPyPlusTrackerButton";
const GAME_BLOCK_SELECTOR = ".gameblock";
const NAME_RESOLVE_INTERVAL_MS = 300;
const STATUS_ORDER = ["wanted", "ignored", "owned"];

const STATUS_LABELS = Object.freeze({
  wanted: "想买",
  ignored: "忽略",
  owned: "已有",
});

const SOURCE_LABELS = Object.freeze({
  "steam-wishlist": "Steam愿望单",
  "steam-owned": "Steam已拥有",
  "steam-ignored": "Steam已忽略",
  manual: "手动",
});

const STATUS_STYLES = Object.freeze({
  wanted: { background: "#2d8cf0", color: "#fff" },
  ignored: { background: "#808695", color: "#fff" },
  owned: { background: "#19be6b", color: "#fff" },
});

function isRecord(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value.status === "wanted" || value.status === "ignored" || value.status === "owned")
    && (value.appId !== undefined || value.gameId !== undefined),
  );
}

function normalizeRecords(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function loadRecords() {
  const raw = GM_getValue(TRACKER_STORAGE_KEY, "");
  if (!raw) return [];
  try {
    return normalizeRecords(JSON.parse(raw));
  } catch (error) {
    console.warn("[SteamPy Plus] 游戏清单数据格式不正确，已忽略", error);
    return [];
  }
}

function saveRecords(records) {
  GM_setValue(TRACKER_STORAGE_KEY, JSON.stringify(records));
}

function numericAppId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringGameId(value) {
  return value === undefined || value === null ? "" : String(value);
}

function findRecord(records, { appId, gameId }) {
  const targetAppId = numericAppId(appId);
  const targetGameId = stringGameId(gameId);
  return records.find((record) => {
    if (targetAppId && numericAppId(record.appId) === targetAppId) return true;
    return Boolean(targetGameId) && stringGameId(record.gameId) === targetGameId;
  }) || null;
}

function statusOf(records, { appId, gameId }) {
  return findRecord(records, { appId, gameId })?.status || null;
}

function setRecordStatus(records, { appId, gameId, name }, status) {
  const existing = findRecord(records, { appId, gameId });
  const now = Date.now();
  if (!status) {
    if (!existing) return records;
    return records.filter((record) => record !== existing);
  }
  const normalizedAppId = numericAppId(appId);
  const normalizedGameId = stringGameId(gameId);
  if (existing) {
    return records.map((record) => (
      record === existing
        ? {
            ...record,
            appId: normalizedAppId ?? record.appId,
            gameId: normalizedGameId || record.gameId,
            name: name || record.name || "",
            status,
            source: "manual",
            updatedAt: now,
          }
        : record
    ));
  }
  return [
    ...records,
    {
      appId: normalizedAppId,
      gameId: normalizedGameId || undefined,
      name: name || "",
      status,
      source: "manual",
      note: "",
      addedAt: now,
      updatedAt: now,
    },
  ];
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(records) {
  const header = ["status", "name", "appId", "gameId", "source", "note", "addedAt", "updatedAt"];
  const lines = [header.join(",")];
  records.forEach((record) => {
    lines.push([
      record.status,
      csvEscape(record.name),
      record.appId ?? "",
      record.gameId ?? "",
      record.source || "manual",
      csvEscape(record.note || ""),
      record.addedAt ?? "",
      record.updatedAt ?? "",
    ].join(","));
  });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadFile(`steampy-game-list-${timestamp}.csv`, `\uFEFF${lines.join("\r\n")}`, "text/csv;charset=utf-8");
}

function exportJson(records) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadFile(`steampy-game-list-${timestamp}.json`, JSON.stringify(records, null, 2), "application/json;charset=utf-8");
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.title) element.title = options.title;
  if (options.style) element.style.cssText = options.style;
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([name, value]) => element.setAttribute(name, value));
  }
  return element;
}

export function createSteamPyGameTrackerController({
  client = null,
  libraryManager = null,
  onStatusChange = null,
} = {}) {
  let panel = null;
  let panelQuery = "";
  let panelStatusFilter = "all";
  let menusRegistered = false;

  function notify(text) {
    try {
      GM_notification({ title: "SteamPy Plus · 游戏清单", text, timeout: 3000 });
    } catch (error) {
      console.log(`[SteamPy Plus] 游戏清单：${text}`, error);
    }
  }

  function getRecords() {
    return loadRecords();
  }

  function saveStatus(gameInfo, status) {
    const records = setRecordStatus(loadRecords(), gameInfo, status);
    saveRecords(records);
    if (typeof onStatusChange === "function") onStatusChange();
    return statusOf(records, gameInfo);
  }

  async function importFromSteamLibrary() {
    if (!libraryManager) return 0;
    let state = libraryManager.getState();
    if (typeof libraryManager.sync === "function") {
      const synced = await libraryManager.sync();
      if (synced) state = synced;
    }
    const records = loadRecords();
    let added = 0;
    const addMissing = (appIds, status, source) => {
      appIds.forEach((appId) => {
        const normalized = numericAppId(appId);
        if (!normalized) return;
        const existing = findRecord(records, { appId: normalized, gameId: "" });
        if (existing) return;
        records.push({
          appId: normalized,
          name: "",
          status,
          source,
          note: "",
          addedAt: Date.now(),
          updatedAt: Date.now(),
        });
        added += 1;
      });
    };
    addMissing(state.wish || [], "wanted", "steam-wishlist");
    addMissing(state.own || [], "owned", "steam-owned");
    addMissing(state.ignored || [], "ignored", "steam-ignored");
    if (added > 0) {
      saveRecords(records);
      notify(`已从 Steam 导入 ${added} 个游戏`);
    } else {
      notify("没有新增的游戏记录");
    }
    return added;
  }

  async function resolveMissingNames(records) {
    if (!client?.fetchSteamGameByAppId) return records;
    const next = records.slice();
    let changed = false;
    for (let index = 0; index < next.length; index += 1) {
      const record = next[index];
      if (record.name || !record.appId) continue;
      try {
        const result = await client.fetchSteamGameByAppId(record.appId);
        const item = result?.content?.[0];
        if (item) {
          next[index] = {
            ...record,
            name: item.gameName || item.name || record.name,
            gameId: stringGameId(item.id) || record.gameId,
          };
          changed = true;
        }
      } catch (error) {
        console.warn("[SteamPy Plus] 解析游戏名称失败", record?.appId, error);
      }
      await waitFor(NAME_RESOLVE_INTERVAL_MS);
    }
    if (changed) saveRecords(next);
    return next;
  }

  function filteredRecords(records) {
    const query = panelQuery.trim().toLowerCase();
    return records
      .filter((record) => (
        panelStatusFilter === "all" || record.status === panelStatusFilter
      ))
      .filter((record) => {
        if (!query) return true;
        return String(record.name || "").toLowerCase().includes(query)
          || String(record.appId ?? "").includes(query)
          || String(record.gameId ?? "").includes(query);
      })
      .sort((first, second) => (second.addedAt || 0) - (first.addedAt || 0));
  }

  function ensureStyle() {
    if (document.getElementById(TRACKER_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = TRACKER_STYLE_ID;
    style.textContent = `
      .${TRACKER_BAR_CLASS} {
        position: absolute;
        top: .04rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 15;
        display: flex;
        align-items: center;
        gap: .02rem;
        max-width: 90%;
      }
      .${TRACKER_BADGE_CLASS} {
        padding: 0 .05rem;
        height: .16rem;
        line-height: .16rem;
        border-radius: .03rem;
        font-size: .1rem;
        font-weight: bold;
        white-space: nowrap;
      }
      .${TRACKER_BTN_CLASS} {
        padding: 0 .04rem;
        height: .16rem;
        line-height: .16rem;
        border: none;
        border-radius: .03rem;
        font-size: .1rem;
        background: rgba(0, 0, 0, .35);
        color: #fff;
        cursor: pointer;
      }
      .${TRACKER_BTN_CLASS}:hover { background: rgba(0, 0, 0, .6); }
      .${TRACKER_BTN_CLASS}[data-active="true"] { font-weight: bold; box-shadow: 0 0 0 1px #fff inset; }
    `;
    document.head.append(style);
  }

  function trackerBarFor(block) {
    return block.querySelector(`.${TRACKER_BAR_CLASS}`);
  }

  function updateTrackerBar(block, gameInfo, status) {
    const bar = trackerBarFor(block);
    if (!bar) return;
    bar.replaceChildren();
    if (status) {
      const badge = createElement("span", {
        className: TRACKER_BADGE_CLASS,
        text: STATUS_LABELS[status],
        style: Object.entries(STATUS_STYLES[status])
          .map(([key, value]) => `${key}:${value}`)
          .join(";"),
      });
      bar.append(badge);
    }
    STATUS_ORDER.forEach((candidate) => {
      const active = candidate === status;
      const button = createElement("button", {
        className: TRACKER_BTN_CLASS,
        type: "button",
        text: STATUS_LABELS[candidate],
        title: active ? `取消“${STATUS_LABELS[candidate]}”标记` : `标记为${STATUS_LABELS[candidate]}`,
        attributes: { "data-active": active ? "true" : "false" },
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const nextStatus = active ? null : candidate;
        const current = saveStatus(gameInfo, nextStatus);
        updateTrackerBar(block, gameInfo, current);
      });
      bar.append(button);
    });
  }

  function renderTrackerBar(block, gameInfo) {
    if (!block || block.dataset.steamPyPlusTrackerBound) return;
    block.dataset.steamPyPlusTrackerBound = "true";
    ensureStyle();
    const bar = createElement("div", { className: TRACKER_BAR_CLASS });
    block.append(bar);
    const status = statusOf(getRecords(), gameInfo);
    updateTrackerBar(block, gameInfo, status);
  }

  function processCards(gameBlocks, games) {
    gameBlocks.forEach((block, index) => {
      const game = games?.[index];
      const appId = numericAppId(game?.appId);
      const gameId = game?.id ?? game?.gameId;
      if (!appId && !gameId) return;
      renderTrackerBar(block, {
        appId,
        gameId: stringGameId(gameId),
        name: game?.gameName || game?.name || "",
      });
    });
  }

  function statusButton(label, status, active, onClick) {
    const button = createElement("button", {
      type: "button",
      text: label,
      title: active ? `取消“${label}”标记` : `标记为${label}`,
      attributes: { "data-active": active ? "true" : "false" },
    });
    button.style.cssText = "min-height:.26rem;padding:0 .1rem;border:1px solid #c9cdd4;border-radius:.04rem;background:#fff;cursor:pointer;font-size:.12rem;";
    if (active) button.style.cssText += "border-color:#165dff;color:#165dff;font-weight:bold;";
    button.addEventListener("click", onClick);
    return button;
  }

  function renderPanelBody() {
    if (!panel) return;
    const body = panel.querySelector("[data-steam-py-plus-tracker-body]");
    body.replaceChildren();
    const records = filteredRecords(getRecords());
    const tableWrap = createElement("div", {
      style: "flex:1;overflow:auto;min-height:0;",
    });
    const table = createElement("table", {
      style: "width:100%;border-collapse:collapse;font-size:.13rem;",
    });
    const thead = createElement("thead");
    const headRow = createElement("tr", { style: "background:#f5f7fa;" });
    [["状态", ""], ["游戏", ""], ["AppID", ""], ["来源", ""], ["添加时间", ""], ["操作", ""]].forEach(([text]) => {
      const th = createElement("th", { text, style: "padding:.08rem .1rem;border:1px solid #e8eaec;text-align:left;white-space:nowrap;" });
      headRow.append(th);
    });
    thead.append(headRow);
    const tbody = createElement("tbody");
    records.forEach((record) => {
      const row = createElement("tr");
      const statusCell = createElement("td", {
        text: STATUS_LABELS[record.status] || record.status,
        style: `padding:.06rem .1rem;border:1px solid #e8eaec;color:${STATUS_STYLES[record.status]?.background || "#333"};font-weight:bold;white-space:nowrap;`,
      });
      const nameCell = createElement("td", {
        style: "padding:.06rem .1rem;border:1px solid #e8eaec;",
      });
      const nameText = record.name || (record.appId ? `AppID ${record.appId}` : `gameId ${record.gameId || "未知"}`);
      if (record.appId) {
        const link = createElement("a", {
          text: nameText,
          title: "打开 Steam 商店页",
        });
        link.href = `https://store.steampowered.com/app/${record.appId}/`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.cssText = "color:#2d8cf0;text-decoration:none;";
        nameCell.append(link);
      } else {
        nameCell.textContent = nameText;
      }
      const appIdCell = createElement("td", {
        text: record.appId ? String(record.appId) : "--",
        style: "padding:.06rem .1rem;border:1px solid #e8eaec;",
      });
      const sourceCell = createElement("td", {
        text: SOURCE_LABELS[record.source] || record.source || "--",
        style: "padding:.06rem .1rem;border:1px solid #e8eaec;white-space:nowrap;",
      });
      const timeCell = createElement("td", {
        text: record.addedAt ? new Date(record.addedAt).toLocaleString() : "--",
        style: "padding:.06rem .1rem;border:1px solid #e8eaec;white-space:nowrap;",
      });
      const actionCell = createElement("td", {
        style: "padding:.06rem .1rem;border:1px solid #e8eaec;white-space:nowrap;",
      });
      const gameInfo = { appId: record.appId, gameId: record.gameId, name: record.name };
      STATUS_ORDER.forEach((candidate) => {
        const active = record.status === candidate;
        actionCell.append(statusButton(STATUS_LABELS[candidate], candidate, active, () => {
          const next = active ? null : candidate;
          saveStatus(gameInfo, next);
          renderPanelBody();
        }));
      });
      const removeButton = createElement("button", {
        type: "button",
        text: "删除",
        title: "从清单删除该记录",
      });
      removeButton.style.cssText = "min-height:.26rem;padding:0 .1rem;border:1px solid #c9cdd4;border-radius:.04rem;background:#fff;cursor:pointer;font-size:.12rem;color:#cb2634;margin-left:.04rem;";
      removeButton.addEventListener("click", () => {
        saveStatus(gameInfo, null);
        renderPanelBody();
      });
      actionCell.append(removeButton);
      row.append(statusCell, nameCell, appIdCell, sourceCell, timeCell, actionCell);
      tbody.append(row);
    });
    if (!records.length) {
      const emptyRow = createElement("tr");
      const emptyCell = createElement("td", {
        text: "没有匹配的游戏记录。可在游戏卡片上点击“想买/忽略/已有”标记，或先同步 Steam 数据。",
        style: "padding:.2rem .1rem;border:1px solid #e8eaec;text-align:center;color:#999;",
      });
      emptyCell.colSpan = 6;
      emptyRow.append(emptyCell);
      tbody.append(emptyRow);
    }
    table.append(thead, tbody);
    tableWrap.append(table);
    body.append(tableWrap);
  }

  function closePanel() {
    panel?.remove();
    panel = null;
  }

  async function openPanel() {
    if (panel) return;
    ensureStyle();
    await resolveMissingNames(getRecords());
    const overlay = createElement("div", {
      attributes: { [TRACKER_PANEL_ID]: "true", role: "dialog", "aria-modal": "true" },
    });
    overlay.id = TRACKER_PANEL_ID;
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.55);box-sizing:border-box;";
    const dialog = createElement("section", {
      style: "width:min(960px,100%);max-height:min(840px,calc(100vh - 48px));display:flex;flex-direction:column;gap:12px;padding:20px;overflow:hidden;border-radius:10px;background:#fff;color:#1f2329;box-sizing:border-box;",
    });
    const header = createElement("div", {
      style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap;",
    });
    const title = createElement("h2", { text: "游戏清单", style: "margin:0;font-size:18px;" });
    const searchInput = createElement("input", {
      type: "search",
      title: "按名称或 AppID 搜索",
      attributes: { placeholder: "搜索名称 / AppID", "aria-label": "搜索游戏" },
    });
    searchInput.style.cssText = "flex:1;min-width:160px;height:32px;padding:0 10px;border:1px solid #c9cdd4;border-radius:5px;font-size:13px;box-sizing:border-box;";
    searchInput.addEventListener("input", () => {
      panelQuery = searchInput.value;
      renderPanelBody();
    });
    const statusSelect = createElement("select", { title: "按状态筛选" });
    statusSelect.style.cssText = "height:32px;padding:0 8px;border:1px solid #c9cdd4;border-radius:5px;font-size:13px;background:#fff;";
    [["all", "全部"], ["wanted", "想买"], ["ignored", "忽略"], ["owned", "已有"]].forEach(([value, label]) => {
      const option = createElement("option", { text: label });
      option.value = value;
      statusSelect.append(option);
    });
    statusSelect.addEventListener("change", () => {
      panelStatusFilter = statusSelect.value;
      renderPanelBody();
    });
    const closeButton = createElement("button", {
      type: "button",
      text: "×",
      title: "关闭",
      style: "min-width:34px;height:32px;padding:0;border:1px solid #c9cdd4;border-radius:5px;background:#fff;font-size:20px;cursor:pointer;",
    });
    closeButton.addEventListener("click", closePanel);
    header.append(title, searchInput, statusSelect, closeButton);

    const actions = createElement("div", {
      style: "display:flex;align-items:center;gap:8px;",
    });
    const syncButton = createElement("button", {
      type: "button",
      text: "同步 Steam",
      title: "从 Steam 愿望单/已拥有/已忽略导入到游戏清单",
      style: "min-height:32px;padding:0 14px;border:1px solid #c9cdd4;border-radius:5px;background:#fff;cursor:pointer;font-size:13px;",
    });
    syncButton.addEventListener("click", async () => {
      syncButton.disabled = true;
      try {
        await importFromSteamLibrary();
      } finally {
        syncButton.disabled = false;
      }
      renderPanelBody();
    });
    const csvButton = createElement("button", {
      type: "button",
      text: "导出 CSV",
      style: "min-height:32px;padding:0 14px;border:1px solid #c9cdd4;border-radius:5px;background:#fff;cursor:pointer;font-size:13px;",
    });
    csvButton.addEventListener("click", () => exportCsv(getRecords()));
    const jsonButton = createElement("button", {
      type: "button",
      text: "导出 JSON",
      style: "min-height:32px;padding:0 14px;border:1px solid #c9cdd4;border-radius:5px;background:#fff;cursor:pointer;font-size:13px;",
    });
    jsonButton.addEventListener("click", () => exportJson(getRecords()));
    actions.append(syncButton, csvButton, jsonButton);

    const body = createElement("div", {
      attributes: { "data-steam-py-plus-tracker-body": "true" },
      style: "flex:1;display:flex;flex-direction:column;min-height:0;",
    });
    dialog.append(header, actions, body);
    overlay.append(dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePanel();
    });
    document.addEventListener("keydown", function onKeydown(event) {
      if (event.key === "Escape") {
        closePanel();
        document.removeEventListener("keydown", onKeydown);
      }
    });
    document.body.append(overlay);
    panel = overlay;
    searchInput.focus();
    renderPanelBody();
  }

  function registerMenus() {
    if (menusRegistered || typeof GM_registerMenuCommand !== "function") return;
    menusRegistered = true;
    GM_registerMenuCommand("打开游戏清单", openPanel);
    GM_registerMenuCommand("从 Steam 同步游戏清单", importFromSteamLibrary);
    GM_registerMenuCommand("导出游戏清单 CSV", () => exportCsv(getRecords()));
    GM_registerMenuCommand("导出游戏清单 JSON", () => exportJson(getRecords()));
  }

  function cleanup() {
    closePanel();
  }

  return {
    cleanup,
    importFromSteamLibrary,
    openPanel,
    processCards,
    registerMenus,
  };
}