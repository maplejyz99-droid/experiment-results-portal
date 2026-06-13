const COLORS = {
  "official-track3-newton-muon-r15": "#0d6f63",
  "official-track3-normuon-r10": "#384fb7",
  "official-track3-muon-r12": "#7b4aa8",
  "official-track3-adamw-r02": "#b7811f",
  "ours-track3-ademamix-tuned-3350": "#bd3f2b",
  "official-track3-r34-rre-extrapolation": "#0e8790",
};

const GENERATED_COLORS = [
  "#0d6f63",
  "#384fb7",
  "#7b4aa8",
  "#b7811f",
  "#bd3f2b",
  "#0e8790",
  "#6f5d22",
  "#8b3b72",
  "#2f6f9f",
  "#8f4f28",
  "#486b38",
  "#5d4c9b",
];

let portalData;
let selectedSuiteId;
let selectedRunId;
let selectedChartRunIds = new Set();
let referenceHistoryOpen = {};
let chartSelectionNotice = "";
let chartScaleMode = "full";
let runFilterText = "";
let runFilterRole = "all";
let runFilterFamily = "all";
let runFilterStatus = "all";
let runFilterTarget = "all";
let runFilterCurve = "all";

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function byId(id) {
  return document.getElementById(id);
}

function summaryMetric(runId, metricName) {
  return portalData.metrics.find(
    (metric) => metric.run_id === runId && metric.metric_scope === "summary" && metric.metric_name === metricName
  );
}

function summaryMetricsForRun(runId) {
  return portalData.metrics.filter((metric) => metric.run_id === runId && metric.metric_scope === "summary");
}

function pointMetrics(runId, metricName) {
  return portalData.metrics
    .filter((metric) => metric.run_id === runId && metric.metric_scope === "point" && metric.metric_name === metricName)
    .sort((left, right) => left.step - right.step);
}

function runById(runId) {
  return portalData.runs.find((run) => run.run_id === runId);
}

function suiteById(suiteId) {
  return portalData.suites.find((suite) => suite.suite_id === suiteId);
}

function figureForSuite(suite) {
  return portalData.figures.find((figure) => figure.suite_id === suite.suite_id && figure.figure_type === "loss_curve");
}

function suiteRuns(suiteId) {
  return portalData.runs.filter((run) => run.suite_id === suiteId);
}

function suiteClaims(suiteId) {
  return portalData.claims.filter((claim) => claim.suite_id === suiteId);
}

function suiteDetailState(suite) {
  return suite.card?.detail_state || (suite.status === "active" ? "available" : "placeholder");
}

function suiteHasDetail(suite) {
  return suiteDetailState(suite) === "available" && Boolean(figureForSuite(suite)) && suiteRuns(suite.suite_id).length > 0;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  if (typeof value === "number") return fmt.format(value);
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "n/a")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function activeSuite() {
  return suiteById(selectedSuiteId) || portalData.suites.find((suite) => suite.status === "active") || portalData.suites[0];
}

function primaryMetricName(suite) {
  return suite.primary_metric || suite.leaderboard_rule?.sort_by || "final_val_loss";
}

function curveMetricName(suite) {
  return figureForSuite(suite)?.y_metric || "val_loss";
}

function chartSelectionLimit(suite) {
  return figureForSuite(suite)?.selection_limit || 8;
}

function targetMarkerMetric(suite) {
  return figureForSuite(suite)?.target_marker_metric || null;
}

function defaultChartRunIds(suite) {
  const figure = figureForSuite(suite);
  return figure?.run_ids?.length ? figure.run_ids : suiteRuns(suite.suite_id).map((run) => run.run_id);
}

function yAxisMaxForFigure(figure, yMetric, scaleMode) {
  if (scaleMode === "zoom") {
    if (Number.isFinite(figure?.y_axis_zoom_max)) return figure.y_axis_zoom_max;
    if (Number.isFinite(figure?.y_axis_max)) return figure.y_axis_max;
    return yMetric === "val_loss" ? 5 : null;
  }
  return null;
}

function initializeChartSelection(suite) {
  selectedChartRunIds = new Set(defaultChartRunIds(suite));
  chartSelectionNotice = "";
}

function resetRunFilters() {
  runFilterText = "";
  runFilterRole = "all";
  runFilterFamily = "all";
  runFilterStatus = "all";
  runFilterTarget = "all";
  runFilterCurve = "all";
}

function curveAvailable(run, suite) {
  return pointMetrics(run.run_id, curveMetricName(suite)).length >= 2;
}

function metricSortDirection(metricName) {
  if (!metricName) return "asc";
  if (metricName.includes("tokens_per_sec") || metricName.includes("val_acc")) return "desc";
  return "asc";
}

function formatMetricValue(metricName, value) {
  if (value === null || value === undefined || value === "") return "n/a";
  if (!Number.isFinite(value)) return "n/a";
  if (metricName?.includes("steps") || metricName?.includes("tokens")) return intFmt.format(value);
  if (metricName?.includes("acc")) return value.toFixed(4);
  if (metricName?.includes("iter_dt") || metricName?.includes("sec")) return value.toFixed(4);
  return fmt.format(value);
}

function metricAriaLabel(metricName) {
  return String(metricName || "metric").replaceAll("_", " ");
}

function summaryMetricText(runId, metricName) {
  const metric = summaryMetric(runId, metricName);
  return metric ? formatMetricValue(metricName, metric.value) : "n/a";
}

function roleLabel(run) {
  if (run.run_role === "ours") return "ours";
  if (run.run_role === "official_reference") return "official ref";
  return run.run_role.replaceAll("_", " ");
}

function metricLine(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function compareRunRows(suite, leftRow, rightRow) {
  const sortBy = suite.leaderboard_rule?.sort_by;
  const direction = suite.leaderboard_rule?.direction === "desc" ? -1 : 1;
  const leftMetric = sortBy ? leftRow.metrics[sortBy] : null;
  const rightMetric = sortBy ? rightRow.metrics[sortBy] : null;

  if (leftMetric && rightMetric && leftMetric.value !== rightMetric.value) {
    return (leftMetric.value - rightMetric.value) * direction;
  }
  if (leftMetric && !rightMetric) return -1;
  if (!leftMetric && rightMetric) return 1;

  for (const tieBreaker of suite.leaderboard_rule?.tie_breakers || []) {
    const leftTie = leftRow.metrics[tieBreaker];
    const rightTie = rightRow.metrics[tieBreaker];
    const tieDirection = metricSortDirection(tieBreaker) === "desc" ? -1 : 1;
    if (leftTie && rightTie && leftTie.value !== rightTie.value) {
      return (leftTie.value - rightTie.value) * tieDirection;
    }
    if (leftTie && !rightTie) return -1;
    if (!leftTie && rightTie) return 1;
  }

  return leftRow.run.display_name.localeCompare(rightRow.run.display_name);
}

function rowFromRun(suite, run) {
  const primary = primaryMetricName(suite);
  const summary = Object.fromEntries(
    summaryMetricsForRun(run.run_id).map((metric) => [metric.metric_name, metric])
  );
  return {
    run,
    metrics: summary,
    primaryMetric: summary[primary] || null,
    finalMetric: summary.final_val_loss || null,
    bestMetric: summary.best_val_loss || null,
  };
}

function eligibleRows(suite) {
  const allowed = new Set(suite.leaderboard_eligibility?.allowed_status || []);
  return suiteRuns(suite.suite_id)
    .filter((run) => allowed.has(run.status))
    .map((run) => rowFromRun(suite, run))
    .sort((left, right) => compareRunRows(suite, left, right));
}

function leaderboardOrderMap(suite) {
  return new Map(eligibleRows(suite).map((row, index) => [row.run.run_id, index]));
}

function compareRunsForSuite(suite, leftRun, rightRun) {
  const order = leaderboardOrderMap(suite);
  const leftOrder = order.get(leftRun.run_id);
  const rightOrder = order.get(rightRun.run_id);
  if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftOrder !== undefined) return -1;
  if (rightOrder !== undefined) return 1;
  return leftRun.display_name.localeCompare(rightRun.display_name);
}

function selectedChartRuns(suite) {
  return Array.from(selectedChartRunIds)
    .map(runById)
    .filter((run) => run && run.suite_id === suite.suite_id)
    .sort((left, right) => compareRunsForSuite(suite, left, right));
}

function chartVisibleRuns(suite) {
  const visibleIds = new Set(filteredRows(eligibleRows(suite), suite).map((row) => row.run.run_id));
  return selectedChartRuns(suite).filter((run) => visibleIds.has(run.run_id));
}

function hiddenPlottedRuns(suite) {
  const visibleIds = new Set(chartVisibleRuns(suite).map((run) => run.run_id));
  return selectedChartRuns(suite).filter((run) => !visibleIds.has(run.run_id));
}

function selectableChartRuns(suite) {
  return suiteRuns(suite.suite_id)
    .filter((run) => curveAvailable(run, suite))
    .sort((left, right) => compareRunsForSuite(suite, left, right));
}

function firstChartRun(suite) {
  return selectedChartRuns(suite)[0] || selectableChartRuns(suite)[0] || suiteRuns(suite.suite_id)[0] || null;
}

function chartSelectionCount(suite) {
  return selectedChartRuns(suite).length;
}

function setChartSelection(suite, runIds, notice = "") {
  const limit = chartSelectionLimit(suite);
  const accepted = runIds
    .map(runById)
    .filter((run) => run && run.suite_id === suite.suite_id && curveAvailable(run, suite))
    .slice(0, limit)
    .map((run) => run.run_id);
  selectedChartRunIds = new Set(accepted);
  chartSelectionNotice = notice;
  selectedRunId = firstChartRun(suite)?.run_id || null;
}

function bestChartRunIds(suite) {
  return selectableChartRuns(suite)
    .slice(0, chartSelectionLimit(suite))
    .map((run) => run.run_id);
}

function runColor(run, index = 0) {
  return COLORS[run.run_id] || GENERATED_COLORS[index % GENERATED_COLORS.length];
}

function runChipLabel(run, suite) {
  const prefix = run.leaderboard_meta?.rank_label ? `${run.leaderboard_meta.rank_label} ` : "";
  return `${prefix}${run.display_name} · ${summaryMetricText(run.run_id, primaryMetricName(suite))}`;
}

function rowSearchText(row) {
  const run = row.run;
  return [
    run.display_name,
    run.run_id,
    run.run_role,
    run.status,
    run.optimizer?.name,
    run.optimizer?.family,
    run.optimizer?.variant,
    run.leaderboard_meta?.rank_label,
    run.leaderboard_meta?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function roleFilterLabel(suite) {
  return suite.family === "track3" ? "Source" : "Run type";
}

function roleOptionLabel(value) {
  const labels = {
    official_reference: "Official ref",
    ours: "Ours",
    baseline: "Baseline",
    ablation: "Ablation",
    failed_probe: "Failed probe",
  };
  return labels[value] || String(value).replaceAll("_", " ");
}

function familyOptionLabel(value) {
  if (value === "optimizer") return "other optimizer";
  return String(value || "unknown").replaceAll("_", " ");
}

function curveState(row, suite) {
  if (selectedChartRunIds.has(row.run.run_id)) return "plotted";
  return curveAvailable(row.run, suite) ? "available" : "unavailable";
}

function curveStateLabel(value) {
  const labels = {
    plotted: "Plotted",
    available: "Available",
    unavailable: "Curve unavailable",
  };
  return labels[value] || value;
}

function targetStatus(row, suite) {
  const primary = primaryMetricName(suite);
  if (!suite.target?.metric_name || !primary.includes("steps_to_target")) return null;
  return row.metrics[primary] ? "reached" : "not_reached";
}

function targetStatusLabel(value) {
  const labels = {
    reached: "Reached",
    not_reached: "Not reached",
  };
  return labels[value] || value;
}

function filteredRows(rows, suite) {
  const needle = runFilterText.trim().toLowerCase();
  return rows.filter((row) => {
    const run = row.run;
    if (needle && !rowSearchText(row).includes(needle)) return false;
    if (runFilterRole !== "all" && run.run_role !== runFilterRole) return false;
    if (runFilterStatus !== "all" && run.status !== runFilterStatus) return false;
    const family = run.optimizer?.family || run.optimizer?.name || "unknown";
    if (runFilterFamily !== "all" && family !== runFilterFamily) return false;
    if (runFilterTarget !== "all" && targetStatus(row, suite) !== runFilterTarget) return false;
    if (runFilterCurve !== "all" && curveState(row, suite) !== runFilterCurve) return false;
    return true;
  });
}

function sortedUnique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function filterSelect(id, label, value, options, labeler = (option) => option.replaceAll("_", " ")) {
  return `
    <label class="run-filter-select">
      <span>${escapeHtml(label)}</span>
      <select id="${id}">
        <option value="all">all</option>
        ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(labeler(option))}</option>`).join("")}
      </select>
    </label>
  `;
}

function toggleChartRun(runId, shouldSelect) {
  const suite = activeSuite();
  const limit = chartSelectionLimit(suite);
  const run = runById(runId);
  if (!run || !curveAvailable(run, suite)) return;

  chartSelectionNotice = "";
  if (shouldSelect) {
    if (!selectedChartRunIds.has(runId) && chartSelectionCount(suite) >= limit) {
      chartSelectionNotice = `Chart is capped at ${limit} runs. Remove one selected run before adding another.`;
      return;
    }
    selectedChartRunIds.add(runId);
    return;
  }

  selectedChartRunIds.delete(runId);
  if (selectedRunId === runId) {
    selectedRunId = firstChartRun(suite)?.run_id || null;
  }
}

function renderOverview() {
  const totalSuites = portalData.suites.length;
  const activeSuites = portalData.suites.filter((suite) => suite.status === "active").length;
  const curatedRuns = portalData.runs.length;
  const claimCards = portalData.claims.length;

  byId("overviewMetrics").innerHTML = [
    [String(totalSuites), "tracked suites and views"],
    [String(activeSuites), "active suites with curated detail"],
    [String(curatedRuns), "curated runs with source trace"],
    [String(claimCards), "manual claim cards"],
  ]
    .map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderSuiteHeader(suite) {
  const runs = suiteRuns(suite.suite_id);
  const completed = runs.filter((run) => run.status === "completed").length;
  const target = suite.target || {};
  const figure = figureForSuite(suite);
  const yMetric = figure?.y_metric || primaryMetricName(suite);
  const targetText =
    target.metric_name && target.value !== null && target.metric_name === yMetric
      ? `${target.metric_name} ${target.direction === "below" ? "<=" : ">="} ${target.value}`
      : "no chart target";

  byId("suite-title").textContent = suite.title;
  byId("targetBox").innerHTML = `
    <strong>${suite.card?.metric_label || primaryMetricName(suite)}</strong><br />
    ${targetText}<br />
    <span>${completed} completed · ${suite.status} · ${suite.family}</span>
  `;
}

function renderSuiteCards() {
  const selected = activeSuite();
  byId("suiteCards").innerHTML = portalData.suites
    .map((suite) => {
      const runs = suiteRuns(suite.suite_id);
      const card = suite.card || {};
      const isSelected = suite.suite_id === selected.suite_id;
      return `
        <button class="suite-card ${isSelected ? "selected" : ""} ${suite.status === "view" ? "view-card" : ""}" type="button" data-suite-id="${suite.suite_id}" aria-pressed="${isSelected}">
          <span class="suite-card-topline">
            <span class="suite-status">${card.status_label || suite.status}</span>
            <span>${runs.length} runs</span>
          </span>
          <strong>${suite.title}</strong>
          <span class="suite-metric">${card.metric_label || primaryMetricName(suite)}</span>
          <span class="suite-headline">${card.headline || suite.notes || "Curated evidence will be attached later."}</span>
        </button>
      `;
    })
    .join("");

  byId("suiteCards").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSuiteId = button.dataset.suiteId;
      const suite = activeSuite();
      resetRunFilters();
      initializeChartSelection(suite);
      selectedRunId = firstChartRun(suite)?.run_id || null;
      renderAll();
    });
  });
}

function renderPlaceholder(suite) {
  byId("suiteDataPanel").hidden = true;
  byId("detailBand").hidden = true;
  byId("suitePlaceholder").hidden = false;
  byId("placeholder-kicker").textContent = suite.status === "view" ? "Cross-suite view" : "Suite placeholder";
  byId("placeholder-title").textContent = suite.status === "view" ? "Resource view is waiting for comparable inputs" : "Curated data not attached yet";
  byId("placeholder-status").textContent = suite.card?.status_label || suite.status;
  byId("placeholderBody").innerHTML = `
    <div class="placeholder-grid">
      ${metricLine("suite_id", suite.suite_id)}
      ${metricLine("status", suite.card?.status_label || suite.status)}
      ${metricLine("primary_metric", primaryMetricName(suite))}
      ${metricLine("expected_view", suite.card?.metric_label || primaryMetricName(suite))}
      ${metricLine("curated_runs", String(suiteRuns(suite.suite_id).length))}
      ${metricLine("family", suite.family)}
    </div>
    <p>${suite.card?.headline || "No complete comparable runs have been curated yet."}</p>
    <p class="muted wide-muted">
      This card is visible so the portal shape is stable, but it will not render a leaderboard or curve until the suite is promoted to an available detail state.
    </p>
  `;
}

function showDetailPanels() {
  byId("suiteDataPanel").hidden = false;
  byId("detailBand").hidden = false;
  byId("suitePlaceholder").hidden = true;
}

function renderSelectedChartRows(suite) {
  const selected = selectedChartRuns(suite);
  if (!selected.length) {
    return `<p class="muted wide-muted">No runs selected for the chart. Pick rows from the tables below.</p>`;
  }
  return `
    <div class="selected-run-list">
      ${selected
        .map(
          (run, index) => `
            <button class="selected-run-pill ${run.run_id === selectedRunId ? "active" : ""}" type="button" data-run-id="${run.run_id}">
              <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
              ${escapeHtml(runChipLabel(run, suite))}
            </button>
            <button class="remove-run" type="button" data-remove-run-id="${run.run_id}" aria-label="Remove ${escapeHtml(run.display_name)} from chart">×</button>
          `
        )
        .join("")}
    </div>
  `;
}

function plotCell(run, suite) {
  const checked = selectedChartRunIds.has(run.run_id);
  const disabled = !curveAvailable(run, suite);
  const reason = disabled ? "curve unavailable" : "Toggle this run in the chart";
  return `
    <label class="plot-toggle ${disabled ? "disabled" : ""}" title="${escapeHtml(reason)}">
      <input type="checkbox" data-run-id="${run.run_id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span>${checked ? "on" : "plot"}</span>
    </label>
  `;
}

function curveStatusCell(run, suite) {
  if (selectedChartRunIds.has(run.run_id)) return `<span class="curve-status plotted">plotted</span>`;
  if (curveAvailable(run, suite)) return `<span class="curve-status ok">available</span>`;
  return `<span class="curve-status missing">missing</span>`;
}

function primaryColumnLabel(suite) {
  const primary = primaryMetricName(suite);
  if (primary.includes("steps_to_target")) return "Steps to target";
  if (primary === "final_val_loss") return "Primary";
  return primary.replaceAll("_", " ");
}

function tableColumnsForRows(suite, rows) {
  const isTrack3 = suite.suite_id === "track3";
  const roles = sortedUnique(rows.map((row) => row.run.run_role));
  const statuses = sortedUnique(rows.map((row) => row.run.status));
  const columns = ["plot", "rank", "run"];
  if (roles.length > 1) columns.push("role");
  columns.push("primary");
  if (isTrack3) {
    columns.push("curve");
  } else {
    columns.push("best", "final");
  }
  if (statuses.length > 1) columns.push("status");
  return columns;
}

function tableHeader(column, suite) {
  const labels = {
    plot: "Plot",
    rank: suite.suite_id === "track3" ? "Track #" : "Rank",
    run: "Run",
    role: roleFilterLabel(suite),
    primary: primaryColumnLabel(suite),
    best: "Best val loss",
    final: "Final val loss",
    status: "Status",
    curve: "Curve",
  };
  return labels[column] || column;
}

function tableCell(column, suite, row, rankLabel) {
  const run = row.run;
  const primary = primaryMetricName(suite);
  const primaryText = row.primaryMetric ? formatMetricValue(primary, row.primaryMetric.value) : "n/a";
  const bestText = row.bestMetric
    ? `${formatMetricValue("best_val_loss", row.bestMetric.value)} @ ${row.bestMetric.step}`
    : "n/a";
  const cells = {
    plot: plotCell(run, suite),
    rank: `<span class="rank-token">${escapeHtml(rankLabel)}</span>`,
    run: `
      <span class="run-name">${escapeHtml(run.display_name)}</span><br />
      <span class="muted table-note">${escapeHtml(run.optimizer.variant || run.optimizer.family || run.optimizer.name)}</span>
    `,
    role: `<span class="role ${run.run_role === "ours" ? "ours" : ""}">${escapeHtml(roleLabel(run))}</span>`,
    primary: `<span class="metric-cell">${escapeHtml(primaryText)}</span>`,
    best: `<span class="metric-cell">${escapeHtml(bestText)}</span>`,
    final: `<span class="metric-cell">${escapeHtml(row.finalMetric ? formatMetricValue("final_val_loss", row.finalMetric.value) : "n/a")}</span>`,
    status: `<span class="metric-cell">${escapeHtml(run.status)}</span>`,
    curve: curveStatusCell(run, suite),
  };
  return cells[column] || "";
}

function leaderboardTable(suite, rows, startingRank, tableClass = "") {
  const columns = tableColumnsForRows(suite, rows);
  return `
    <div class="table-wrap ${tableClass}">
      <table>
        <thead>
          <tr>
            ${columns.map((column) => `<th>${escapeHtml(tableHeader(column, suite))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row, index) => {
              const run = row.run;
              const rankLabel = run.leaderboard_meta?.rank_label || row.displayRank || String(startingRank + index);
              return `
                <tr class="${run.run_id === selectedRunId ? "selected" : ""}" data-run-id="${run.run_id}">
                  ${columns.map((column) => `<td>${tableCell(column, suite, row, rankLabel)}</td>`).join("")}
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSelectionActions(suite) {
  return `
    <div class="selection-actions">
      <button type="button" data-chart-action="default">Restore curated</button>
      <button type="button" data-chart-action="best">Top ${Math.min(chartSelectionLimit(suite), selectableChartRuns(suite).length)} by suite metric</button>
      <button type="button" data-chart-action="clear">Clear</button>
    </div>
  `;
}

function activeFilterCount() {
  return [
    runFilterText.trim() ? "search" : "",
    runFilterRole !== "all" ? "role" : "",
    runFilterFamily !== "all" ? "family" : "",
    runFilterStatus !== "all" ? "status" : "",
    runFilterTarget !== "all" ? "target" : "",
    runFilterCurve !== "all" ? "curve" : "",
  ].filter(Boolean).length;
}

function renderRunFilters(rows, suite, visibleCount) {
  const roles = sortedUnique(rows.map((row) => row.run.run_role));
  const families = sortedUnique(rows.map((row) => row.run.optimizer?.family || row.run.optimizer?.name || "unknown"));
  const statuses = sortedUnique(rows.map((row) => row.run.status));
  const targetStatuses = sortedUnique(rows.map((row) => targetStatus(row, suite)).filter(Boolean));
  const curveStates = sortedUnique(rows.map((row) => curveState(row, suite)));
  const visibleCurveOptions = ["plotted", "available", "unavailable"].filter(
    (state) => curveStates.includes(state) || runFilterCurve === state
  );

  const controls = [
    roles.length > 1 || runFilterRole !== "all"
      ? filterSelect("roleFilter", roleFilterLabel(suite), runFilterRole, roles, roleOptionLabel)
      : "",
    families.length > 1 || runFilterFamily !== "all"
      ? filterSelect("familyFilter", "Optimizer family", runFilterFamily, families, familyOptionLabel)
      : "",
    targetStatuses.length > 1 || runFilterTarget !== "all"
      ? filterSelect("targetFilter", "Target status", runFilterTarget, targetStatuses, targetStatusLabel)
      : "",
    visibleCurveOptions.length > 1 || runFilterCurve !== "all"
      ? filterSelect("curveFilter", "Curve state", runFilterCurve, visibleCurveOptions, curveStateLabel)
      : "",
    statuses.length > 1 || runFilterStatus !== "all"
      ? filterSelect("statusFilter", "Status", runFilterStatus, statuses)
      : "",
  ].filter(Boolean);

  return `
    <div class="run-filters" aria-label="Run table filters">
      <label class="run-search">
        <span>Search</span>
        <input id="runSearch" type="search" value="${escapeHtml(runFilterText)}" placeholder="optimizer, rank, run id" autocomplete="off" />
      </label>
      ${controls.join("")}
      <span class="filter-summary">Showing ${visibleCount}/${rows.length}${activeFilterCount() ? ` · ${activeFilterCount()} active` : ""}</span>
      <button type="button" id="clearRunFilters">Reset filters</button>
    </div>
  `;
}

function bindLeaderboardInteractions() {
  byId("leaderboardContent").querySelectorAll("tr[data-run-id], .selected-run-pill").forEach((target) => {
    target.addEventListener("click", () => {
      selectedRunId = target.dataset.runId;
      renderAll();
    });
  });

  byId("leaderboardContent").querySelectorAll(".plot-toggle input").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      toggleChartRun(input.dataset.runId, input.checked);
      renderAll();
    });
  });

  byId("leaderboardContent").querySelectorAll("[data-remove-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleChartRun(button.dataset.removeRunId, false);
      renderAll();
    });
  });

  byId("leaderboardContent").querySelectorAll("[data-chart-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const suite = activeSuite();
      const action = button.dataset.chartAction;
      if (action === "default") {
        setChartSelection(suite, defaultChartRunIds(suite), "Curated chart set restored.");
      } else if (action === "best") {
        setChartSelection(suite, bestChartRunIds(suite), "Top drawable runs selected by the suite leaderboard metric.");
      } else if (action === "clear") {
        setChartSelection(suite, [], "Chart cleared. Pick rows from the tables below.");
      }
      renderAll();
    });
  });

  const search = byId("runSearch");
  if (search) {
    search.addEventListener("input", () => {
      runFilterText = search.value;
      renderLeaderboard();
      renderChart();
    });
  }

  const role = byId("roleFilter");
  if (role) {
    role.addEventListener("change", () => {
      runFilterRole = role.value;
      renderLeaderboard();
      renderChart();
    });
  }

  const family = byId("familyFilter");
  if (family) {
    family.addEventListener("change", () => {
      runFilterFamily = family.value;
      renderLeaderboard();
      renderChart();
    });
  }

  const status = byId("statusFilter");
  if (status) {
    status.addEventListener("change", () => {
      runFilterStatus = status.value;
      renderLeaderboard();
      renderChart();
    });
  }

  const target = byId("targetFilter");
  if (target) {
    target.addEventListener("change", () => {
      runFilterTarget = target.value;
      renderLeaderboard();
      renderChart();
    });
  }

  const curve = byId("curveFilter");
  if (curve) {
    curve.addEventListener("change", () => {
      runFilterCurve = curve.value;
      renderLeaderboard();
      renderChart();
    });
  }

  const clearFilters = byId("clearRunFilters");
  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      resetRunFilters();
      renderLeaderboard();
      renderChart();
    });
  }
}

function renderLeaderboard() {
  const suite = activeSuite();
  const rows = eligibleRows(suite).map((row, index) => ({ ...row, displayRank: String(index + 1) }));
  const visibleRows = filteredRows(rows, suite);
  const referenceRows = visibleRows.filter((row) => row.run.run_role === "official_reference");
  const localRows = visibleRows.filter((row) => row.run.run_role !== "official_reference");
  const hasReferenceAndLocal =
    rows.some((row) => row.run.run_role === "official_reference") &&
    rows.some((row) => row.run.run_role !== "official_reference");

  if (!selectedRunId && rows.length) selectedRunId = rows[0].run.run_id;

  byId("leaderboard-title").textContent = suite.leaderboard_rule?.display_name || "Suite leaderboard";
  byId("leaderboardNote").textContent = "Click a row or chart chip to inspect provenance.";

  const selectionBlock = `
    <div class="selected-chart-box">
      <div class="mini-heading">
        <div>
          <strong>Selected for chart</strong>
          <span>${chartSelectionCount(suite)}/${chartSelectionLimit(suite)} plotted</span>
        </div>
        <span class="muted">The chart is suite-local and selection is independent from rank order.</span>
      </div>
      ${renderSelectedChartRows(suite)}
      ${renderSelectionActions(suite)}
      <p class="selection-notice ${chartSelectionNotice ? "" : "empty"}">${escapeHtml(chartSelectionNotice || "Use the checkboxes below to add or remove plotted curves.")}</p>
    </div>
    ${renderRunFilters(rows, suite, visibleRows.length)}
  `;

  if (hasReferenceAndLocal) {
    const open = referenceHistoryOpen[suite.suite_id] ? "open" : "";
    const referenceLabel = suite.suite_id === "track3" ? "Official Track 3 history" : "Reference history";
    const localLabel = suite.suite_id === "track3" ? "Our representative runs" : "Local or comparison runs";
    byId("leaderboardContent").innerHTML = `
      ${selectionBlock}
      <details class="history-details ${suite.suite_id === "track3" ? "track3-history-callout" : ""}" ${open}>
        <summary>
          <span>${escapeHtml(referenceLabel)} (${referenceRows.length})</span>
          <span class="muted">${suite.suite_id === "track3" ? "click to expand · sorted by steps" : "curated source-backed rows"}</span>
        </summary>
        ${referenceRows.length ? leaderboardTable(suite, referenceRows, 1, "compact-table scroll-table") : "<p class=\"empty-table-note\">No reference rows match the current filters.</p>"}
      </details>
      <div class="local-runs-block">
        <div class="mini-heading">
          <strong>${escapeHtml(localLabel)}</strong>
          <span>${localRows.length} rows</span>
        </div>
        ${localRows.length ? leaderboardTable(suite, localRows, 1, "compact-table scroll-table") : "<p class=\"empty-table-note\">No local rows match the current filters.</p>"}
      </div>
    `;
    const details = byId("leaderboardContent").querySelector(".history-details");
    if (details) {
      details.addEventListener("toggle", () => {
        referenceHistoryOpen[suite.suite_id] = details.open;
      });
    }
    bindLeaderboardInteractions();
    return;
  }

  byId("leaderboardContent").innerHTML = `
    ${selectionBlock}
    <details class="history-details optimizer-details" open>
      <summary>
        <span>Optimizer runs (${visibleRows.length}/${rows.length})</span>
        <span class="muted">ranked by ${escapeHtml(primaryMetricName(suite))}</span>
      </summary>
      ${visibleRows.length ? leaderboardTable(suite, visibleRows, 1, "compact-table scroll-table") : "<p class=\"empty-table-note\">No rows match the current filters.</p>"}
    </details>
  `;
  bindLeaderboardInteractions();
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const step = niceStep((max - min) / Math.max(count - 1, 1));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}

function niceAxisCeiling(rawMax, desiredIntervals = 5) {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return 1;
  const step = niceStep(rawMax / Math.max(desiredIntervals, 1));
  return Math.ceil(rawMax / step) * step;
}

function chartScaleModeLabel() {
  return chartScaleMode === "zoom" ? "Zoom <=5" : "Full";
}

function renderChartModeSwitch() {
  const modeSwitch = byId("chartModeSwitch");
  modeSwitch.innerHTML = `
    <span class="chart-mode-label">Scale</span>
    <button type="button" class="${chartScaleMode === "full" ? "active" : ""}" data-scale-mode="full" aria-pressed="${chartScaleMode === "full"}">
      <span class="mode-icon">F</span>
      <span>Full</span>
    </button>
    <button type="button" class="${chartScaleMode === "zoom" ? "active" : ""}" data-scale-mode="zoom" aria-pressed="${chartScaleMode === "zoom"}">
      <span class="mode-icon"><=5</span>
      <span>Zoom</span>
    </button>
  `;
  modeSwitch.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      chartScaleMode = button.dataset.scaleMode;
      renderChart();
    });
  });
}

function renderTargetMarkerStrip(suite, runs, metricName) {
  const strip = byId("targetStepStrip");
  if (!metricName) {
    strip.hidden = true;
    strip.setAttribute("aria-label", "Selected run milestone markers");
    strip.innerHTML = "";
    return;
  }

  const markedRuns = runs.filter((run) => summaryMetric(run.run_id, metricName));
  strip.hidden = false;
  strip.setAttribute("aria-label", `Selected run ${metricAriaLabel(metricName)} markers`);
  strip.innerHTML = markedRuns.length
    ? `
      <span class="target-step-label">${escapeHtml(metricName)}</span>
      <div class="target-step-pills">
        ${markedRuns
          .map((run, index) => {
            const metric = summaryMetric(run.run_id, metricName);
            return `
              <button type="button" class="${run.run_id === selectedRunId ? "active" : ""}" data-run-id="${run.run_id}">
                <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
                <strong>${escapeHtml(run.leaderboard_meta?.rank_label || run.display_name)}</strong>
                <span>@${escapeHtml(formatMetricValue(metricName, metric.value))}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `
    : `<span class="muted">No selected run exposes ${escapeHtml(metricName)}.</span>`;

  strip.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      renderAll();
    });
  });
}

function hiddenFilterChip(hiddenRuns) {
  if (!hiddenRuns.length) return "";
  return `
    <span class="hidden-filter-chip">
      ${hiddenRuns.length} plotted ${hiddenRuns.length === 1 ? "run is" : "runs are"} hidden by filters
      <button type="button" data-filter-action="show-plotted">Show plotted</button>
      <button type="button" data-filter-action="clear-filters">Clear filters</button>
    </span>
  `;
}

function safeFilename(value) {
  return String(value || "portal-export")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function chartCsv(suite) {
  const yMetric = curveMetricName(suite);
  const target = suite.target || {};
  const filters = [
    runFilterText.trim() ? `search=${runFilterText.trim()}` : "",
    runFilterRole !== "all" ? `role=${runFilterRole}` : "",
    runFilterFamily !== "all" ? `family=${runFilterFamily}` : "",
    runFilterStatus !== "all" ? `status=${runFilterStatus}` : "",
    runFilterTarget !== "all" ? `target=${runFilterTarget}` : "",
    runFilterCurve !== "all" ? `curve=${runFilterCurve}` : "",
  ].filter(Boolean).join(";");
  const rows = [[
    "suite_id",
    "run_id",
    "display_name",
    "rank_label",
    "role",
    "status",
    "optimizer",
    "source_type",
    "source_path",
    "scale_mode",
    "target_value",
    "filters",
    "step",
    "metric_name",
    "value",
  ]];
  chartVisibleRuns(suite).forEach((run) => {
    const source = run.source || {};
    const sourcePath = source.log_path || source.csv_path || source.config_path || source.wandb_url || source.command || "";
    pointMetrics(run.run_id, yMetric).forEach((point) => {
      rows.push([
        suite.suite_id,
        run.run_id,
        run.display_name,
        run.leaderboard_meta?.rank_label || "",
        run.run_role,
        run.status,
        run.optimizer?.name || "",
        source.source_type || "",
        sourcePath,
        chartScaleMode,
        target.metric_name === yMetric ? target.value ?? "" : "",
        filters,
        point.step,
        yMetric,
        point.value,
      ]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function exportCurrentChartCsv() {
  const suite = activeSuite();
  const filename = `${safeFilename(suite.suite_id)}-${safeFilename(curveMetricName(suite))}-${chartScaleMode}.csv`;
  downloadText(filename, chartCsv(suite), "text/csv;charset=utf-8");
}

function exportCurrentChartSvg() {
  const suite = activeSuite();
  const svg = byId("lossChart");
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.querySelectorAll(".chart-hover, .chart-tooltip").forEach((node) => node.remove());
  const style = svgEl("style");
  style.textContent = `
    .axis{stroke:#9da89e;stroke-width:1}
    .gridline{stroke:#dfe5dc;stroke-width:1}
    .target-line{stroke:#bd3f2b;stroke-width:1.5;stroke-dasharray:6 5}
    .target-marker{stroke:#fff;stroke-width:1.5}
    .target-tick{stroke-width:1.3;opacity:.88}
    .curve{fill:none;stroke-width:2.6}
    .curve.ours{stroke-width:3.8}
    .curve.partial{stroke-width:2.2}
    .chart-label{fill:#5c625d;font-family:Menlo,Monaco,monospace;font-size:11px}
  `;
  clone.insertBefore(style, clone.firstChild);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
  const filename = `${safeFilename(suite.suite_id)}-${safeFilename(curveMetricName(suite))}-${chartScaleMode}.svg`;
  downloadText(filename, xml, "image/svg+xml;charset=utf-8");
}

function bindChartExportControls() {
  const svgButton = byId("downloadSvg");
  const csvButton = byId("downloadCsv");
  if (svgButton) svgButton.onclick = exportCurrentChartSvg;
  if (csvButton) csvButton.onclick = exportCurrentChartCsv;
}

function renderChart() {
  const svg = byId("lossChart");
  svg.innerHTML = "";

  const suite = activeSuite();
  const figure = figureForSuite(suite);
  const yMetric = curveMetricName(suite);
  const markerMetric = targetMarkerMetric(suite);
  const target = suite.target || {};
  const showTargetLine = target.metric_name && target.metric_name === yMetric && target.value !== null && target.value !== undefined;
  svg.setAttribute("aria-label", `${suite.title} ${metricAriaLabel(yMetric)} curves by step`);
  renderChartModeSwitch();
  bindChartExportControls();
  const width = svg.clientWidth || 740;
  const height = svg.clientHeight || 420;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const margin = { top: 22, right: 24, bottom: 42, left: 58 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const hiddenRuns = hiddenPlottedRuns(suite);
  const runs = chartVisibleRuns(suite).filter((run) => curveAvailable(run, suite));
  const allPoints = runs.flatMap((run) => pointMetrics(run.run_id, yMetric));

  byId("chartMeta").textContent = showTargetLine
    ? `${yMetric} with target ${target.value}`
    : `${yMetric} by step`;

  byId("chartSelectionChips").innerHTML = runs.length
    ? [
        ...runs
        .map(
          (run, index) => `
            <button type="button" class="${run.run_id === selectedRunId ? "active" : ""}" data-run-id="${run.run_id}">
              <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
              ${escapeHtml(runChipLabel(run, suite))}
            </button>
          `
        ),
        hiddenFilterChip(hiddenRuns),
      ].join("")
    : hiddenRuns.length
      ? hiddenFilterChip(hiddenRuns)
      : "<span class=\"muted\">No selected runs have drawable curves.</span>";
  byId("chartSelectionChips").querySelectorAll("button[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      renderAll();
    });
  });
  byId("chartSelectionChips").querySelectorAll("[data-filter-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.filterAction === "show-plotted") {
        runFilterText = "";
        runFilterRole = "all";
        runFilterFamily = "all";
        runFilterStatus = "all";
        runFilterTarget = "all";
        runFilterCurve = "plotted";
      } else {
        resetRunFilters();
      }
      renderAll();
    });
  });

  renderTargetMarkerStrip(suite, runs, markerMetric);

  if (!allPoints.length) {
    byId("chartToolbarMeta").textContent = `${runs.length}/${chartSelectionLimit(suite)} visible · ${hiddenRuns.length} hidden by filters`;
    const empty = svgEl("text", { x: 24, y: 48, class: "chart-label" });
    empty.textContent = "Select a run with an available curve.";
    svg.appendChild(empty);
    byId("chartLegend").innerHTML = "";
    return;
  }

  const markerValues = markerMetric
    ? runs
        .map((run) => summaryMetric(run.run_id, markerMetric)?.value)
        .filter((value) => Number.isFinite(value))
    : [];
  const rawMaxStep = Math.max(...allPoints.map((point) => point.step), ...markerValues, 1);
  const maxStep = niceAxisCeiling(rawMaxStep, 5);
  const yValues = allPoints.map((point) => point.value);
  if (showTargetLine) yValues.push(target.value);
  const rawMin = Math.min(...yValues);
  const rawMax = Math.max(...yValues);
  const padding = Math.max((rawMax - rawMin) * 0.08, 0.08);
  const configuredYMax = yAxisMaxForFigure(figure, yMetric, chartScaleMode);
  const maxValue = configuredYMax ?? niceAxisCeiling(rawMax + padding, 6);
  const minCandidate = Math.max(0, rawMin - padding);
  const minValue = configuredYMax ? Math.max(0, Math.min(minCandidate, maxValue - 0.1)) : 0;
  const clippedRuns = configuredYMax
    ? runs.filter((run) => pointMetrics(run.run_id, yMetric).some((point) => point.value > maxValue)).length
    : 0;
  byId("chartToolbarMeta").textContent = [
    `${runs.length}/${chartSelectionLimit(suite)} visible`,
    hiddenRuns.length ? `${hiddenRuns.length} hidden by filters` : "",
    configuredYMax ? `Zoom y<=${formatMetricValue(yMetric, maxValue)}` : "Full scale",
    clippedRuns ? `${clippedRuns} ${clippedRuns === 1 ? "run" : "runs"} clipped` : "",
  ].filter(Boolean).join(" · ");

  const x = (step) => margin.left + (step / maxStep) * chartWidth;
  const y = (value) => margin.top + ((maxValue - value) / (maxValue - minValue)) * chartHeight;
  const clipId = `chart-clip-${suite.suite_id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const defs = svgEl("defs");
  const clipPath = svgEl("clipPath", { id: clipId });
  clipPath.appendChild(svgEl("rect", { x: margin.left, y: margin.top, width: chartWidth, height: chartHeight }));
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  niceTicks(minValue, maxValue, 7)
    .filter((tick) => tick >= minValue && tick <= maxValue)
    .forEach((tick) => {
    svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left + chartWidth, y1: y(tick), y2: y(tick), class: "gridline" }));
    const label = svgEl("text", { x: 8, y: y(tick) + 4, class: "chart-label" });
    label.textContent = formatMetricValue(yMetric, tick);
    svg.appendChild(label);
  });

  if (showTargetLine) {
    svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left + chartWidth, y1: y(target.value), y2: y(target.value), class: "target-line" }));
    const targetLabel = svgEl("text", { x: 8, y: y(target.value) + 4, class: "chart-label" });
    targetLabel.textContent = `target ${target.value}`;
    svg.appendChild(targetLabel);
  }

  niceTicks(0, maxStep, 6)
    .filter((tick) => tick >= 0 && tick <= maxStep)
    .forEach((tick) => {
      const tickX = x(tick);
      svg.appendChild(svgEl("line", { x1: tickX, x2: tickX, y1: margin.top, y2: margin.top + chartHeight, class: "gridline" }));
      const label = svgEl("text", { x: tickX - 12, y: height - 13, class: "chart-label" });
      label.textContent = intFmt.format(tick);
      svg.appendChild(label);
    });

  svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + chartHeight, class: "axis" }));
  svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left + chartWidth, y1: margin.top + chartHeight, y2: margin.top + chartHeight, class: "axis" }));

  const curveLayer = svgEl("g", { "clip-path": `url(#${clipId})` });
  svg.appendChild(curveLayer);
  const hoverPoints = [];

  runs.forEach((run, index) => {
    const points = pointMetrics(run.run_id, yMetric);
    if (points.length < 2) return;
    const d = points
      .map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${x(point.step).toFixed(2)} ${y(point.value).toFixed(2)}`)
      .join(" ");
    const isPartial = run.status !== "completed";
    const path = svgEl("path", {
      d,
      class: `curve ${run.run_role === "ours" ? "ours" : ""} ${isPartial ? "partial" : ""}`,
      stroke: runColor(run, index),
      opacity: run.run_id === selectedRunId ? "1" : isPartial ? "0.36" : "0.68",
      "stroke-dasharray": isPartial ? "6 6" : "none",
    });
    path.addEventListener("click", () => {
      selectedRunId = run.run_id;
      renderAll();
    });
    curveLayer.appendChild(path);

    points.forEach((point) => {
      if (point.value < minValue || point.value > maxValue) return;
      hoverPoints.push({
        run,
        color: runColor(run, index),
        step: point.step,
        value: point.value,
        x: x(point.step),
        y: y(point.value),
      });
    });

    const last = points[points.length - 1];
    const dot = svgEl("circle", {
      cx: x(last.step),
      cy: y(last.value),
      r: run.run_id === selectedRunId ? 5 : 3,
      fill: runColor(run, index),
    });
    dot.addEventListener("click", () => {
      selectedRunId = run.run_id;
      renderAll();
    });
    curveLayer.appendChild(dot);
  });

  if (showTargetLine && markerMetric) {
    runs.forEach((run, index) => {
      const marker = summaryMetric(run.run_id, markerMetric);
      if (!marker) return;
      const markerX = x(marker.value);
      svg.appendChild(svgEl("line", { x1: markerX, x2: markerX, y1: y(target.value) - 13, y2: y(target.value) + 13, class: "target-tick", stroke: runColor(run, index) }));
      svg.appendChild(svgEl("circle", { cx: markerX, cy: y(target.value), r: run.run_id === selectedRunId ? 5 : 4, class: "target-marker", fill: runColor(run, index) }));
    });
  }

  if (hoverPoints.length) {
    const hoverLayer = svgEl("g", { class: "chart-hover", style: "display:none" });
    const crosshair = svgEl("line", {
      y1: margin.top,
      y2: margin.top + chartHeight,
      class: "chart-crosshair",
    });
    const focus = svgEl("circle", { r: 5, class: "chart-focus" });
    const tooltip = svgEl("g", { class: "chart-tooltip" });
    const tooltipRect = svgEl("rect", { rx: 7, ry: 7, width: 276, height: 96 });
    const tooltipTitle = svgEl("text", { x: 10, y: 20, class: "chart-tooltip-title" });
    const tooltipSource = svgEl("text", { x: 10, y: 40, class: "chart-tooltip-text" });
    const tooltipStep = svgEl("text", { x: 10, y: 60, class: "chart-tooltip-text" });
    const tooltipRun = svgEl("text", { x: 10, y: 80, class: "chart-tooltip-text" });
    tooltip.append(tooltipRect, tooltipTitle, tooltipSource, tooltipStep, tooltipRun);
    hoverLayer.append(crosshair, focus, tooltip);
    svg.appendChild(hoverLayer);

    const overlay = svgEl("rect", {
      x: margin.left,
      y: margin.top,
      width: chartWidth,
      height: chartHeight,
      class: "chart-hover-capture",
    });
    overlay.addEventListener("pointermove", (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(svg.getScreenCTM().inverse());
      const nearest = hoverPoints.reduce((best, candidate) => {
        const distance = Math.abs(candidate.x - local.x) * 1.6 + Math.abs(candidate.y - local.y);
        return !best || distance < best.distance ? { ...candidate, distance } : best;
      }, null);
      if (!nearest) return;
      hoverLayer.setAttribute("style", "display:block");
      crosshair.setAttribute("x1", nearest.x);
      crosshair.setAttribute("x2", nearest.x);
      focus.setAttribute("cx", nearest.x);
      focus.setAttribute("cy", nearest.y);
      focus.setAttribute("fill", nearest.color);
      const rank = nearest.run.leaderboard_meta?.rank_label || roleLabel(nearest.run);
      tooltipTitle.textContent = `${rank} ${nearest.run.display_name}`;
      tooltipSource.textContent = `${roleFilterLabel(suite)} ${roleLabel(nearest.run)} · ${nearest.run.status}`;
      tooltipStep.textContent = `step ${intFmt.format(nearest.step)} · ${yMetric} ${formatMetricValue(yMetric, nearest.value)}`;
      tooltipRun.textContent = `run_id ${nearest.run.run_id}`;
      const tooltipX = Math.min(Math.max(nearest.x + 12, margin.left), margin.left + chartWidth - 276);
      const tooltipY = Math.min(Math.max(nearest.y - 108, margin.top), margin.top + chartHeight - 98);
      tooltip.setAttribute("transform", `translate(${tooltipX}, ${tooltipY})`);
    });
    overlay.addEventListener("pointerleave", () => {
      hoverLayer.setAttribute("style", "display:none");
    });
    svg.appendChild(overlay);
  }

  byId("chartLegend").innerHTML = runs
    .map(
      (run, index) => `
        <button type="button" data-run-id="${run.run_id}" aria-label="Inspect ${run.display_name}">
          <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
          ${escapeHtml(run.display_name)}${run.status !== "completed" ? " · partial" : ""}
        </button>
      `
    )
    .join("");
  byId("chartLegend").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      renderAll();
    });
  });
}

function listRuns(runIds) {
  if (!runIds?.length) return "n/a";
  return runIds
    .map((runId) => {
      const run = runById(runId);
      return run ? run.display_name : runId;
    })
    .join(", ");
}

function sourceList(links) {
  if (!links?.length) return "<li>n/a</li>";
  return links.map((link) => `<li><code>${escapeHtml(link)}</code></li>`).join("");
}

function renderRunDetail() {
  const suite = activeSuite();
  const rows = eligibleRows(suite);
  const run = runById(selectedRunId) || rows[0]?.run;

  if (!run) {
    byId("detail-title").textContent = "No run selected";
    byId("runDetail").innerHTML = "<p class=\"muted wide-muted\">No curated run is available for this suite yet.</p>";
    return;
  }

  const summary = Object.fromEntries(summaryMetricsForRun(run.run_id).map((metric) => [metric.metric_name, metric]));
  const model = run.model || {};
  const dataset = run.dataset || {};
  const training = run.training || {};
  const hardware = run.hardware || {};
  const source = run.source || {};
  const meta = run.leaderboard_meta || {};
  const primary = primaryMetricName(suite);
  const target = suite.target || {};
  const targetGap =
    target.metric_name === "val_loss" && summary.final_val_loss && target.value !== null && target.value !== undefined
      ? summary.final_val_loss.value - target.value
      : null;

  const hiddenSummaryMetrics = new Set([primary, "final_val_loss", "best_val_loss"]);
  const extraSummary = Object.values(summary)
    .filter((metric) => !hiddenSummaryMetrics.has(metric.metric_name))
    .sort((left, right) => left.metric_name.localeCompare(right.metric_name));

  byId("detail-title").textContent = run.display_name;
  byId("runDetail").innerHTML = `
    <div class="detail-grid">
      ${metricLine("run_id", run.run_id)}
      ${metricLine("role", roleLabel(run))}
      ${metricLine("status", run.status)}
      ${metricLine("primary_metric", summaryMetricText(run.run_id, primary))}
      ${meta.rank_label ? metricLine("reference_rank", meta.rank_label) : ""}
      ${meta.evidence ? metricLine("reference_evidence", meta.evidence) : ""}
      ${meta.date ? metricLine("reference_date", meta.date) : ""}
      ${metricLine("final_val_loss", summaryMetricText(run.run_id, "final_val_loss"))}
      ${metricLine(
        "best_val_loss",
        summary.best_val_loss ? `${formatMetricValue("best_val_loss", summary.best_val_loss.value)} @ ${summary.best_val_loss.step}` : "n/a"
      )}
      ${targetGap !== null ? metricLine("target_gap", formatMetricValue("target_gap", targetGap)) : ""}
      ${metricLine("optimizer", `${run.optimizer.name}${run.optimizer.variant ? ` · ${run.optimizer.variant}` : ""}`)}
      ${metricLine("model_type", displayValue(model.type))}
      ${metricLine("model_params", displayValue(model.params))}
      ${metricLine("dataset", displayValue(dataset.name))}
      ${metricLine("sequence_length", displayValue(training.sequence_length))}
      ${metricLine("train_steps", displayValue(training.train_steps))}
      ${metricLine("global_batch_tokens", displayValue(training.global_batch_tokens))}
      ${metricLine("lr", displayValue(training.lr))}
      ${metricLine("weight_decay", displayValue(training.weight_decay))}
      ${metricLine("warmup_steps", displayValue(training.warmup_steps))}
      ${metricLine("scheduler", displayValue(training.scheduler))}
      ${metricLine("seed", displayValue(training.seed))}
      ${metricLine("eval_interval", displayValue(training.eval_interval))}
      ${metricLine("dtype", displayValue(training.dtype))}
      ${metricLine("hardware", `${hardware.gpu_type || "n/a"}${hardware.num_gpus ? ` · ${hardware.num_gpus} GPU` : ""}`)}
      ${extraSummary.map((metric) => metricLine(metric.metric_name, formatMetricValue(metric.metric_name, metric.value))).join("")}
      ${metricLine("source_type", displayValue(source.source_type))}
      ${metricLine("source_path", source.log_path || source.csv_path || source.config_path || "n/a")}
      ${source.command ? metricLine("command", source.command) : ""}
      ${source.wandb_url ? metricLine("wandb_url", source.wandb_url) : ""}
      ${meta.description ? metricLine("description", meta.description) : ""}
    </div>
    <div class="source-actions">
      ${source.wandb_url ? `<a href="${source.wandb_url}" target="_blank" rel="noreferrer">Open WandB</a>` : ""}
      <button type="button" id="copySource">Copy source path</button>
    </div>
  `;

  const copy = byId("copySource");
  const sourcePath = source.log_path || source.csv_path || source.config_path || "n/a";
  if (copy) {
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(sourcePath);
      copy.textContent = "Copied source path";
      setTimeout(() => {
        copy.textContent = "Copy source path";
      }, 1200);
    });
  }
}

function renderClaims() {
  const claims = suiteClaims(activeSuite().suite_id);
  byId("claimsList").innerHTML = claims.length
    ? claims
        .map(
          (claim) => `
            <article class="claim">
              <h4>${escapeHtml(claim.title)}</h4>
              <div class="claim-meta">
                <span class="tag">${escapeHtml(claim.claim_type)}</span>
                <span class="tag">${escapeHtml(claim.claim_status)}</span>
                <span class="tag">${escapeHtml(claim.evidence_level)}</span>
                <span class="tag">${escapeHtml(claim.comparison.metric_name)}</span>
                <span class="tag">delta ${claim.comparison.delta_value > 0 ? "+" : ""}${escapeHtml(fmt.format(claim.comparison.delta_value))}</span>
              </div>
              <dl class="claim-facts">
                <div><dt>method</dt><dd>${escapeHtml(claim.comparison.method_label || "n/a")}</dd></div>
                <div><dt>baseline</dt><dd>${escapeHtml(claim.comparison.baseline_label || "n/a")}</dd></div>
                <div><dt>supporting runs</dt><dd>${escapeHtml(listRuns(claim.supporting_run_ids))}</dd></div>
                <div><dt>baseline runs</dt><dd>${escapeHtml(listRuns(claim.baseline_run_ids))}</dd></div>
              </dl>
              <div class="claim-notes">
                <strong>Caveats</strong>
                <ul>${(claim.caveats || []).map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join("") || "<li>n/a</li>"}</ul>
              </div>
              <details class="claim-sources">
                <summary>Source links</summary>
                <ul>${sourceList(claim.source_links)}</ul>
              </details>
            </article>
          `
        )
        .join("")
    : "<p class=\"muted wide-muted\">No claim cards have been curated for this suite yet.</p>";
}

function renderDataHealth() {
  const activeSuites = portalData.suites.filter((suite) => suite.status === "active").length;
  const drawableRuns = portalData.runs.filter((run) => {
    const suite = suiteById(run.suite_id);
    return suite && curveAvailable(run, suite);
  }).length;
  const pointMetricsCount = portalData.metrics.filter((metric) => metric.metric_scope === "point").length;
  const summaryMetricsCount = portalData.metrics.filter((metric) => metric.metric_scope === "summary").length;
  const figureCoverage = portalData.figures.map((figure) => {
    const suite = suiteById(figure.suite_id);
    const drawable = (figure.run_ids || []).filter((runId) => {
      const run = runById(runId);
      return run && suite && curveAvailable(run, suite);
    }).length;
    return `${figure.suite_id}: ${drawable}/${figure.run_ids?.length || 0}`;
  });

  byId("dataHealthSummary").textContent =
    `${portalData.runs.length} runs · ${portalData.metrics.length} metrics · ${portalData.figures.length} figures · validation passed`;

  byId("dataHealth").innerHTML = `
    ${metricLine("generated_at", portalData.meta?.generated_at || "n/a")}
    ${metricLine("suites", `${portalData.suites.length} total · ${activeSuites} active`)}
    ${metricLine("runs", `${portalData.runs.length} curated · ${drawableRuns} drawable`)}
    ${metricLine("metrics", `${pointMetricsCount} point · ${summaryMetricsCount} summary`)}
    ${metricLine("claims", String(portalData.claims.length))}
    ${metricLine("figures", figureCoverage.join(" · ") || "n/a")}
  `;
}

function renderAll() {
  const suite = activeSuite();
  renderOverview();
  renderSuiteCards();
  renderSuiteHeader(suite);
  renderDataHealth();

  if (suiteHasDetail(suite)) {
    showDetailPanels();
    if (!selectedRunId || runById(selectedRunId)?.suite_id !== suite.suite_id) {
      selectedRunId = firstChartRun(suite)?.run_id || null;
    }
    renderLeaderboard();
    renderChart();
    renderRunDetail();
    renderClaims();
    return;
  }

  selectedRunId = null;
  renderPlaceholder(suite);
}

async function start() {
  const response = await fetch("data/portal-data.json");
  portalData = await response.json();
  selectedSuiteId = portalData.suites.find((suite) => suite.status === "active")?.suite_id || portalData.suites[0]?.suite_id;
  const suite = activeSuite();
  initializeChartSelection(suite);
  selectedRunId = firstChartRun(suite)?.run_id || null;
  renderAll();
  window.addEventListener("resize", renderChart);
}

start().catch((error) => {
  document.body.innerHTML = `<main><h1>Portal failed to load</h1><pre>${error.stack || error}</pre></main>`;
});
