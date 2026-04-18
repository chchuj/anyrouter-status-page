const DASHBOARD_URL = "./data/dashboard.json";
const WINDOW_HOURS = 24 * 7;

const statusLabels = {
  operational: "正常",
  degraded: "部分失败",
  major_outage: "故障",
  no_data: "无数据",
};

const bannerText = {
  operational: "All Systems Operational",
  degraded: "Partial Service Degradation",
  major_outage: "Major Service Outage",
  no_data: "No Probe Data Yet",
};

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

function fmtHourRange(value) {
  if (!value) return "-";
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return value;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const datePart = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "short",
  }).format(start);
  const startTime = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(start);
  const endTime = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(end);
  return `${datePart} ${startTime} - ${endTime}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setBanner(status) {
  const banner = document.getElementById("overallBanner");
  if (!banner) return;
  banner.className = `banner banner-${status}`;
  banner.textContent = bannerText[status] || bannerText.no_data;
}

function deriveOverallStatus(summary) {
  if (!summary || !summary.total) return "no_data";
  if ((summary.major_outage || 0) > 0) return "major_outage";
  if ((summary.degraded || 0) > 0) return "degraded";
  if ((summary.operational || 0) > 0) return "operational";
  return "no_data";
}

function fillSummary(summary, generatedAt) {
  const overall = deriveOverallStatus(summary);
  setBanner(overall);
  setText("lastUpdated", `Last checked: ${fmtDate(generatedAt)}`);
  setText("summaryTotal", summary?.total ?? 0);
  setText("summaryOperational", summary?.operational ?? 0);
  setText("summaryDegraded", summary?.degraded ?? 0);
  setText("summaryOutage", summary?.major_outage ?? 0);
}

function bucketTooltip(accountName, bucket) {
  const httpStatus = bucket.last_http_status == null ? "-" : bucket.last_http_status;
  const failures = Math.max(0, (bucket.checks || 0) - (bucket.successes || 0));
  return [
    `账号: ${accountName}`,
    `时间: ${fmtHourRange(bucket.hour)}`,
    `状态: ${statusLabels[bucket.status] || statusLabels.no_data}`,
    `请求次数: ${bucket.checks || 0}`,
    `成功次数: ${bucket.successes || 0}`,
    `失败次数: ${failures}`,
    `HTTP: ${httpStatus}`,
    `平均耗时: ${bucket.avg_latency_ms == null ? "-" : `${bucket.avg_latency_ms} ms`}`,
    `错误: ${bucket.last_error_message || "-"}`,
  ].join("\n");
}

function positionTooltip(tooltip, x, y) {
  const offset = 14;
  const maxLeft = window.innerWidth - tooltip.offsetWidth - 12;
  const maxTop = window.innerHeight - tooltip.offsetHeight - 12;
  const left = Math.min(Math.max(12, x + offset), Math.max(12, maxLeft));
  const top = Math.min(Math.max(12, y + offset), Math.max(12, maxTop));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showGridTooltip(text, event) {
  const tooltip = document.getElementById("gridTooltip");
  if (!tooltip) return;
  tooltip.textContent = text;
  tooltip.hidden = false;
  positionTooltip(tooltip, event.clientX, event.clientY);
}

function moveGridTooltip(event) {
  const tooltip = document.getElementById("gridTooltip");
  if (!tooltip || tooltip.hidden) return;
  positionTooltip(tooltip, event.clientX, event.clientY);
}

function hideGridTooltip() {
  const tooltip = document.getElementById("gridTooltip");
  if (!tooltip) return;
  tooltip.hidden = true;
}

function calculateUptime(buckets) {
  let totalChecks = 0;
  let totalSuccesses = 0;
  for (const bucket of buckets || []) {
    totalChecks += bucket.checks || 0;
    totalSuccesses += bucket.successes || 0;
  }
  if (totalChecks <= 0) return "0.00";
  return ((totalSuccesses / totalChecks) * 100).toFixed(2);
}

function createMetric(label, value) {
  const metric = document.createElement("div");
  metric.className = "metric";
  metric.innerHTML = `
    <span class="metric-label">${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  `;
  return metric;
}

function buildHistoryGrid(accountName, buckets, generatedAt) {
  const wrapper = document.createElement("div");
  wrapper.className = "uptime-grid";

  const map = new Map();
  for (const bucket of buckets || []) {
    map.set(bucket.hour, bucket);
  }

  const generated = generatedAt ? new Date(generatedAt) : new Date();
  const aligned = new Date(generated);
  aligned.setUTCMinutes(0, 0, 0);

  for (let offset = WINDOW_HOURS - 1; offset >= 0; offset -= 1) {
    const dt = new Date(aligned.getTime() - offset * 60 * 60 * 1000);
    const key = dt.toISOString().replace(".000Z", "Z");
    const bucket = map.get(key) || {
      hour: key,
      checks: 0,
      successes: 0,
      last_http_status: null,
      avg_latency_ms: null,
      last_error_message: "",
      status: "no_data",
    };

    const cell = document.createElement("div");
    cell.className = `uptime-cell cell-${bucket.status || "no_data"}`;
    const tooltip = bucketTooltip(accountName, bucket);
    cell.title = tooltip;
    cell.setAttribute("tabindex", "0");
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", tooltip.replace(/\n/g, ", "));
    cell.addEventListener("mouseenter", (event) => showGridTooltip(tooltip, event));
    cell.addEventListener("mousemove", moveGridTooltip);
    cell.addEventListener("mouseleave", hideGridTooltip);
    cell.addEventListener("focus", () => {
      const rect = cell.getBoundingClientRect();
      showGridTooltip(tooltip, {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      });
    });
    cell.addEventListener("blur", hideGridTooltip);
    wrapper.appendChild(cell);
  }

  return wrapper;
}

function renderAccountCard(account, generatedAt) {
  const article = document.createElement("article");
  article.className = "card account-card";

  const uptime = calculateUptime(account.buckets || []);
  const status = account.overall_status || "no_data";
  const httpStatus = account.http_status ?? "-";
  const tokenOk = account.token_ok ? "Yes" : "No";
  const latency = account.latency_ms == null ? "-" : `${account.latency_ms} ms`;
  const targetModel = account.target_model || "-";
  const lastToken = account.last_token || "-";
  const errorMessage = account.error_message || "-";

  article.innerHTML = `
    <div class="card-header">
      <div>
        <h2>${escapeHtml(account.name || account.id || "Unknown")}</h2>
        <p class="muted">${escapeHtml(statusLabels[status] || statusLabels.no_data)}</p>
      </div>
      <span class="pill pill-${escapeHtml(status)}">${escapeHtml(statusLabels[status] || statusLabels.no_data)}</span>
    </div>
  `;

  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.appendChild(createMetric("HTTP Status", httpStatus));
  metrics.appendChild(createMetric("吐出 token", tokenOk));
  metrics.appendChild(createMetric("响应耗时", latency));
  metrics.appendChild(createMetric("目标模型", targetModel));
  article.appendChild(metrics);

  const detailList = document.createElement("div");
  detailList.className = "detail-list";
  detailList.innerHTML = `
    <div>
      <span class="detail-label">最近 token</span>
      <code>${escapeHtml(lastToken)}</code>
    </div>
    <div>
      <span class="detail-label">错误信息</span>
      <code>${escapeHtml(errorMessage)}</code>
    </div>
    <div>
      <span class="detail-label">最近检查时间</span>
      <code>${escapeHtml(fmtDate(account.checked_at))}</code>
    </div>
  `;
  article.appendChild(detailList);

  const historyHeader = document.createElement("div");
  historyHeader.className = "card-header account-history-header";
  historyHeader.innerHTML = `
    <div>
      <h2>最近 7 天</h2>
      <p class="muted">按小时聚合，共 168 格</p>
    </div>
    <span class="uptime-value">${escapeHtml(`${uptime}% uptime`)}</span>
  `;
  article.appendChild(historyHeader);

  article.appendChild(buildHistoryGrid(account.name || account.id || "Unknown", account.buckets || [], generatedAt));

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `
    <span><i class="dot dot-green"></i> 正常</span>
    <span><i class="dot dot-yellow"></i> 部分失败</span>
    <span><i class="dot dot-red"></i> 故障</span>
    <span><i class="dot dot-gray"></i> 无数据</span>
  `;
  article.appendChild(legend);

  return article;
}

function renderAccounts(accounts, generatedAt) {
  const grid = document.getElementById("accountsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!accounts || accounts.length === 0) {
    const empty = document.createElement("article");
    empty.className = "card";
    empty.innerHTML = `
      <div class="card-header">
        <div>
          <h2>暂无账号数据</h2>
          <p class="muted">请检查 workflow 是否已配置多账号 secrets，并等待下一次探测。</p>
        </div>
      </div>
    `;
    grid.appendChild(empty);
    return;
  }

  for (const account of accounts) {
    grid.appendChild(renderAccountCard(account, generatedAt));
  }
}

async function fetchJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function loadPage() {
  try {
    const dashboard = await fetchJson(DASHBOARD_URL);
    fillSummary(dashboard.summary || {}, dashboard.generated_at);
    renderAccounts(dashboard.accounts || [], dashboard.generated_at);
  } catch (error) {
    setBanner("major_outage");
    setText("lastUpdated", "Failed to load status data");
    const grid = document.getElementById("accountsGrid");
    if (grid) {
      grid.innerHTML = `
        <article class="card">
          <div class="card-header">
            <div>
              <h2>加载失败</h2>
              <p class="muted">${escapeHtml(String(error))}</p>
            </div>
          </div>
        </article>
      `;
    }
  }
}

loadPage();
window.setInterval(loadPage, 60 * 1000);
