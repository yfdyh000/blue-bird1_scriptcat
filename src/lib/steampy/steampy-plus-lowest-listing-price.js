const LOWEST_LISTING_BUTTON_ID = "steamPyPlusLowestListingPriceButton";
const LOWEST_LISTING_PANEL_ID = "steamPyPlusLowestListingPricePanel";
const LOWEST_LISTING_MARKER_ATTR = "data-steam-py-plus-lowest-price";
const FILTER_ANCHOR_SELECTOR = ".tag.flex-row.align-items-center";
const GAME_BLOCK_SELECTOR = ".gameblock";
const SUPPORTED_REGIONS = new Set(["cn", "ru", "us", "tl"]);
const QUERY_CONCURRENCY = 2;
const QUERY_INTERVAL_MIN_MS = 300;
const QUERY_INTERVAL_MAX_MS = 600;

export function normalizeSteamPyRegion(value) {
  const region = String(value ?? "").trim().toLowerCase();
  return SUPPORTED_REGIONS.has(region) ? region : "cn";
}

function positivePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseLowestInStockListing(content) {
  if (!Array.isArray(content)) return null;
  const available = content
    .filter((item) => positivePrice(item?.keyPrice) !== null && Number(item?.stock ?? 1) > 0)
    .sort((first, second) => Number(first.keyPrice) - Number(second.keyPrice));
  const lowest = available[0];
  if (!lowest) return null;
  return {
    lowestPrice: Number(lowest.keyPrice),
    stock: Number(lowest.stock ?? 1),
    sold: Number(lowest.sold ?? 0),
  };
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `￥${number.toFixed(2)}` : "--";
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createSteamPyLowestListingPriceController({ client } = {}) {
  let vm = null;
  let button = null;
  let panel = null;
  let querying = false;
  let queryGeneration = 0;

  function gameList() {
    return Array.isArray(vm?.gameList) ? vm.gameList : [];
  }

  function gameBlocks() {
    return document.querySelectorAll(GAME_BLOCK_SELECTOR);
  }

  function gameIdOf(game) {
    return game?.id ?? game?.gameId ?? null;
  }

  function gameNameOf(game) {
    return game?.gameName || game?.name || `gameId ${gameIdOf(game) ?? "未知"}`;
  }

  function resolveRegion() {
    return normalizeSteamPyRegion(vm?.areas);
  }

  function clearMarkers() {
    queryGeneration += 1;
    querying = false;
    document.querySelectorAll(`[${LOWEST_LISTING_MARKER_ATTR}]`).forEach((marker) => marker.remove());
    panel?.remove();
    panel = null;
  }

  function renderMarker(index, text, failed = false) {
    const block = gameBlocks()[index];
    if (!block) return;
    const existing = block.querySelector(`[${LOWEST_LISTING_MARKER_ATTR}]`);
    existing?.remove();
    const marker = document.createElement("div");
    marker.setAttribute(LOWEST_LISTING_MARKER_ATTR, "true");
    marker.textContent = text;
    marker.style.cssText = failed
      ? "font-size:.12rem;line-height:.16rem;color:#f59e0b;padding:0 .04rem;"
      : "font-size:.12rem;line-height:.16rem;color:#16a34a;padding:0 .04rem;";
    const priceContainer = block.querySelector(".gameFoot");
    (priceContainer || block).append(marker);
  }

  function createPanel() {
    const overlay = document.createElement("div");
    overlay.id = LOWEST_LISTING_PANEL_ID;
    overlay.style.cssText = "position:fixed;z-index:10000;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.38);";
    const dialog = document.createElement("section");
    dialog.style.cssText = "width:min(8rem,94vw);max-height:82vh;display:flex;flex-direction:column;gap:.12rem;padding:.2rem;border-radius:.08rem;background:#fff;color:#17233d;box-sizing:border-box;";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0;font-size:.18rem;";
    title.textContent = "最低有库存挂单价";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    close.textContent = "×";
    close.style.cssText = "min-width:.3rem;padding:0;font-size:.2rem;line-height:.3rem;cursor:pointer;";
    close.addEventListener("click", clearMarkers);
    header.append(title, close);

    const progress = document.createElement("div");
    progress.dataset.steamPyPlusLowestProgress = "true";
    progress.style.cssText = "font-size:.13rem;color:#666;";

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = "flex:1;overflow:auto;";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:.13rem;";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.style.cssText = "background:#f5f7fa;";
    [["游戏", "1"], ["最低挂单价", "0.8"], ["状态", "1"]].forEach(([text]) => {
      const th = document.createElement("th");
      th.textContent = text;
      th.style.cssText = "padding:.08rem .1rem;border:1px solid #e8eaec;text-align:left;";
      headRow.append(th);
    });
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    tableWrap.append(table);

    dialog.append(header, progress, tableWrap);
    overlay.append(dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) clearMarkers();
    });
    document.body.append(overlay);
    return overlay;
  }

  function renderProgress(completed, total) {
    const element = panel?.querySelector("[data-steam-py-plus-lowest-progress]");
    if (element) element.textContent = `已查询 ${completed}/${total}`;
  }

  function renderRow(index, game, result) {
    if (!panel) return;
    const tbody = panel.querySelector("tbody");
    let row = tbody.children[index];
    if (!row) {
      row = document.createElement("tr");
      tbody.append(row);
    }
    row.replaceChildren();
    const name = document.createElement("td");
    name.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    name.textContent = gameNameOf(game);
    const price = document.createElement("td");
    price.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;font-weight:bold;";
    const status = document.createElement("td");
    status.style.cssText = "padding:.06rem .1rem;border:1px solid #e8eaec;";
    if (result.ok) {
      price.textContent = formatPrice(result.lowestPrice);
      status.textContent = result.stock > 0 ? `有 ${result.stock}` : "无库存";
    } else {
      price.textContent = "--";
      status.textContent = result.error || "查询失败";
    }
    row.append(name, price, status);
  }

  async function queryGame(game, region) {
    const gameId = gameIdOf(game);
    if (gameId === null || gameId === undefined || gameId === "") {
      return { ok: false, error: "缺少 gameId" };
    }
    const response = await client.fetchKeySaleList({ region, gameId });
    const content = response?.content ?? response?.result?.content ?? response?.result ?? response;
    const parsed = parseLowestInStockListing(Array.isArray(content) ? content : []);
    if (!parsed) return { ok: false, error: "无在售挂单" };
    return { ok: true, ...parsed };
  }

  async function runQuery() {
    if (querying) return;
    const games = gameList();
    const region = resolveRegion();
    const generation = ++queryGeneration;
    const total = games.length;
    renderProgress(0, total);
    if (!total) return;
    querying = true;
    const tbody = panel?.querySelector("tbody");
    for (let index = 0; index < total; index += 1) {
      const row = document.createElement("tr");
      tbody.append(row);
    }
    let completed = 0;
    let nextIndex = 0;

    async function worker() {
      while (querying && generation === queryGeneration) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) return;
        const game = games[index];
        let result;
        if (client?.isTokenInvalid?.()) {
          result = { ok: false, error: "AccessToken 已失效" };
          querying = false;
        } else {
          try {
            result = await queryGame(game, region);
          } catch (error) {
            result = { ok: false, error: error?.message || String(error) };
          }
        }
        completed += 1;
        renderProgress(completed, total);
        renderRow(index, game, result);
        if (result.ok) {
          renderMarker(index, `最低挂单 ${formatPrice(result.lowestPrice)}`);
        } else {
          renderMarker(index, result.error === "无在售挂单" ? "无在售挂单" : "查询失败", true);
        }
        if (generation !== queryGeneration) return;
        if (client?.isTokenInvalid?.()) querying = false;
        if (querying) {
          const delay = QUERY_INTERVAL_MIN_MS
            + Math.random() * (QUERY_INTERVAL_MAX_MS - QUERY_INTERVAL_MIN_MS);
          await waitFor(delay);
        }
      }
    }

    await Promise.all(Array.from({ length: QUERY_CONCURRENCY }, () => worker()));
    querying = false;
    if (generation !== queryGeneration) return;
    renderProgress(total, total);
    if (client?.isTokenInvalid?.()) {
      const element = panel?.querySelector("[data-steam-py-plus-lowest-progress]");
      if (element) element.textContent = "已停止：AccessToken 已失效，请重新登录后刷新页面";
    }
  }

  function startQuery() {
    if (querying) return;
    clearMarkers();
    panel = createPanel();
    runQuery();
  }

  function mountButton() {
    if (button?.isConnected) return true;
    const anchor = document.querySelector(FILTER_ANCHOR_SELECTOR);
    if (!anchor) return false;
    document.getElementById(LOWEST_LISTING_BUTTON_ID)?.remove();
    button = document.createElement("button");
    button.id = LOWEST_LISTING_BUTTON_ID;
    button.type = "button";
    button.className = "ivu-btn ivu-btn-default ivu-btn-sm";
    button.textContent = "查询最低挂单价";
    button.style.cssText = "margin-left:.08rem;";
    button.addEventListener("click", startQuery);
    anchor.append(button);
    return true;
  }

  function start(nextVm) {
    if (vm && vm !== nextVm) cleanup();
    vm = nextVm;
    if (!vm) return;
    mountButton();
  }

  function cleanup() {
    queryGeneration += 1;
    querying = false;
    clearMarkers();
    button?.remove();
    button = null;
    vm = null;
  }

  return { cleanup, clearMarkers, start };
}