const COLORS = {
  "official-track3-newton-muon-r15": "#0d6f63",
  "official-track3-normuon-r10": "#384fb7",
  "official-track3-muon-r12": "#7b4aa8",
  "official-track3-adamw-r02": "#b7811f",
  "ours-track3-ademamix-tuned-3350": "#bd3f2b",
  "ours-track3-normuon-wandb-20step": "#0e8790"
};
const GENERATED_COLORS = [
  "#0d6f63", "#384fb7", "#7b4aa8", "#b7811f", "#bd3f2b", "#0e8790",
  "#6f5d22", "#8b3b72", "#2f6f9f", "#8f4f28", "#486b38", "#5d4c9b"
];
const MAX_CHART_RUNS = 8;

let portalData;
let selectedSuiteId;
let selectedRunId;
let selectedChartRunIds = new Set();
let officialHistoryOpen = false;
let chartSelectionNotice = "";

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function byId(id) {
  return document.getElementById(id);
}

function summaryMetric(runId, metricName) {
  return portalData.metrics.find(
    (m) => m.run_id === runId && m.metric_scope === "summary" && m.metric_name === metricName
  );
}

function runById(runId) {
  return portalData.runs.find((run) => run.run_id === runId);
}

function suiteById(suiteId) {
  return portalData.suites.find((suite) => suite.suite_id === suiteId);
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

function pointMetrics(runId) {
  return portalData.metrics
    .filter((m) => m.run_id === runId && m.metric_scope === "point" && m.metric_name === "val_loss")
    .sort((a, b) => a.step - b.step);
}

function figureForSuite(suite) {
  return portalData.figures.find((candidate) => candidate.suite_id === suite.suite_id && candidate.figure_type === "loss_curve");
}

function defaultChartRunIds(suite) {
  return figureForSuite(suite)?.run_ids || suiteRuns(suite.suite_id).map((run) => run.run_id);
}

function initializeChartSelection(suite) {
  selectedChartRunIds = new Set(defaultChartRunIds(suite));
  chartSelectionNotice = "";
}

function curveAvailable(run) {
  return run.leaderboard_meta?.curve_available !== false && pointMetrics(run.run_id).length >= 2;
}

function trackRankLabel(run) {
  return run.leaderboard_meta?.rank_label || (run.run_role === "ours" ? "ours" : "n/a");
}

function stepsToTargetLabel(run) {
  const metric = summaryMetric(run.run_id, "steps_to_target_3_28");
  return metric ? `${intFmt.format(metric.value)} steps` : "not reached";
}

function stepsToTargetSortValue(run) {
  const metric = summaryMetric(run.run_id, "steps_to_target_3_28");
  return metric ? Number(metric.value) : Number.POSITIVE_INFINITY;
}

function trackRankSortValue(run) {
  const rank = run.leaderboard_meta?.official_rank;
  return typeof rank === "number" ? rank : Number.POSITIVE_INFINITY;
}

function compareTrack3Runs(a, b) {
  const stepsDelta = stepsToTargetSortValue(a) - stepsToTargetSortValue(b);
  if (stepsDelta !== 0) return stepsDelta;
  const rankDelta = trackRankSortValue(a) - trackRankSortValue(b);
  if (rankDelta !== 0) return rankDelta;
  return a.display_name.localeCompare(b.display_name);
}

function runChipLabel(run) {
  return `${trackRankLabel(run)} ${run.display_name.replace(/^R\d+\s+/, "")} · ${stepsToTargetLabel(run)}`;
}

function runColor(run, index = 0) {
  return COLORS[run.run_id] || GENERATED_COLORS[index % GENERATED_COLORS.length];
}

function selectedChartRuns(suite) {
  const runs = Array.from(selectedChartRunIds).map(runById).filter((run) => run && run.suite_id === suite.suite_id);
  return suite.suite_id === "track3" ? runs.sort(compareTrack3Runs) : runs;
}

function selectableChartRuns(suite) {
  return suiteRuns(suite.suite_id).filter(curveAvailable);
}

function firstChartRun(suite) {
  return selectedChartRuns(suite)[0] || selectableChartRuns(suite)[0] || suiteRuns(suite.suite_id)[0] || null;
}

function toggleChartRun(runId, shouldSelect) {
  const run = runById(runId);
  if (!run || !curveAvailable(run)) return;
  chartSelectionNotice = "";
  if (shouldSelect) {
    if (!selectedChartRunIds.has(runId) && selectedChartRunIds.size >= MAX_CHART_RUNS) {
      chartSelectionNotice = `Chart is capped at ${MAX_CHART_RUNS} runs. Remove one selected run before adding another.`;
      return;
    }
    selectedChartRunIds.add(runId);
  } else {
    selectedChartRunIds.delete(runId);
    if (selectedRunId === runId) {
      selectedRunId = firstChartRun(activeSuite())?.run_id || null;
    }
  }
}

function activeSuite() {
  return suiteById(selectedSuiteId) || portalData.suites.find((suite) => suite.status === "active") || portalData.suites[0];
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
  return suiteDetailState(suite) === "available" && suiteRuns(suite.suite_id).length > 0;
}

function eligibleRuns(suite) {
  const allowed = new Set(suite.leaderboard_eligibility.allowed_status);
  const direction = suite.leaderboard_rule.direction === "desc" ? -1 : 1;
  return suiteRuns(suite.suite_id)
    .filter((run) => allowed.has(run.status))
    .map((run) => ({
      run,
      rankMetric: summaryMetric(run.run_id, suite.leaderboard_rule.sort_by),
      final: summaryMetric(run.run_id, "final_val_loss"),
      best: summaryMetric(run.run_id, "best_val_loss"),
      stepsToTarget: summaryMetric(run.run_id, suite.leaderboard_rule.formal_rank_metric)
    }))
    .filter((row) => row.final)
    .sort((a, b) => {
      if (a.rankMetric && b.rankMetric && a.rankMetric.value !== b.rankMetric.value) {
        return (a.rankMetric.value - b.rankMetric.value) * direction;
      }
      if (a.rankMetric && !b.rankMetric) return -1;
      if (!a.rankMetric && b.rankMetric) return 1;
      if (a.best && b.best && a.best.value !== b.best.value) return a.best.value - b.best.value;
      if (a.final.value !== b.final.value) return a.final.value - b.final.value;
      return (a.final.step || 0) - (b.final.step || 0);
    });
}

function renderOverview() {
  const totalSuites = portalData.suites.length;
  const activeSuites = portalData.suites.filter((suite) => suite.status === "active").length;
  const curatedRuns = portalData.runs.length;
  const claimCards = portalData.claims.length;

  byId("overviewMetrics").innerHTML = [
    [String(totalSuites), "tracked suites and views"],
    [String(activeSuites), "active suite with curated detail"],
    [String(curatedRuns), "curated runs with source trace"],
    [String(claimCards), "manual claim cards"]
  ]
    .map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderSuiteHeader(suite) {
  const runs = suiteRuns(suite.suite_id);
  const completed = runs.filter((run) => run.status === "completed").length;
  const target = suite.target || {};
  const targetText =
    target.metric_name && target.value !== null && target.value !== undefined
      ? `${target.metric_name} ${target.direction === "below" ? "<=" : ">="} ${target.value}`
      : "no single target";

  byId("suite-title").textContent = suite.title;
  byId("targetBox").innerHTML = `
    <strong>${suite.card?.metric_label || suite.primary_metric}</strong><br />
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
          <span class="suite-metric">${card.metric_label || suite.primary_metric}</span>
          <span class="suite-headline">${card.headline || suite.notes || "Curated evidence will be attached later."}</span>
        </button>
      `;
    })
    .join("");

  byId("suiteCards").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSuiteId = button.dataset.suiteId;
      const suite = activeSuite();
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
      ${metricLine("primary_metric", suite.primary_metric)}
      ${metricLine("expected_view", suite.card?.metric_label || suite.primary_metric)}
      ${metricLine("curated_runs", String(suiteRuns(suite.suite_id).length))}
      ${metricLine("family", suite.family)}
    </div>
    <p>
      ${suite.card?.headline || "No complete comparable runs have been curated yet."}
    </p>
    <p class="muted wide-muted">
      This card is visible so the portal shape is stable, but it will not render a leaderboard or curve until source-backed runs and metrics are attached.
    </p>
  `;
}

function showDetailPanels() {
  byId("suiteDataPanel").hidden = false;
  byId("detailBand").hidden = false;
  byId("suitePlaceholder").hidden = true;
}

function roleLabel(run) {
  if (run.run_role === "ours") return "ours";
  if (run.run_role === "official_reference") return "official ref";
  return run.run_role.replaceAll("_", " ");
}

function renderLeaderboard() {
  const suite = activeSuite();
  if (suite.suite_id === "track3") {
    renderTrack3Leaderboard(suite);
    return;
  }
  const rows = eligibleRuns(suite);
  if (!selectedRunId && rows.length) selectedRunId = rows[0].run.run_id;
  byId("leaderboard-title").textContent = suite.leaderboard_rule.display_name || "Suite leaderboard";
  byId("leaderboardNote").textContent = "Click a row to inspect provenance.";
  byId("leaderboardContent").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Run</th>
            <th>Role</th>
            <th>Steps to target</th>
            <th>Gap steps</th>
          </tr>
        </thead>
        <tbody>
          ${rows
    .map(({ run, final, stepsToTarget }, index) => {
      const bestSteps = rows.find((row) => row.stepsToTarget)?.stepsToTarget?.value;
      const stepGap = stepsToTarget && bestSteps !== undefined ? stepsToTarget.value - bestSteps : null;
      const gapClass = stepGap === 0 ? "loss-good" : "loss-bad";
      return `
        <tr class="${run.run_id === selectedRunId ? "selected" : ""}" data-run-id="${run.run_id}">
          <td>${index + 1}</td>
          <td><span class="run-name">${run.display_name}</span><br /><span class="muted">${run.optimizer.family || "optimizer"}</span></td>
          <td><span class="role ${run.run_role === "ours" ? "ours" : ""}">${roleLabel(run)}</span></td>
          <td class="${stepsToTarget ? "loss-good" : "loss-bad"}">${stepsToTarget ? intFmt.format(stepsToTarget.value) : "not reached"}</td>
          <td class="${stepGap === null ? "" : gapClass}">${stepGap === null ? "n/a" : `${stepGap >= 0 ? "+" : ""}${intFmt.format(stepGap)}`}</td>
        </tr>
      `;
    })
    .join("")}
        </tbody>
      </table>
    </div>
  `;

  byId("leaderboardContent").querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", () => {
      selectedRunId = row.dataset.runId;
      renderAll();
    });
  });
}

function officialTrack3Runs(suite) {
  return suiteRuns(suite.suite_id)
    .filter((run) => run.run_role === "official_reference")
    .sort(compareTrack3Runs);
}

function localTrack3Runs(suite) {
  return suiteRuns(suite.suite_id).filter((run) => run.run_role !== "official_reference").sort(compareTrack3Runs);
}

function plotCell(run) {
  const checked = selectedChartRunIds.has(run.run_id);
  const disabled = !curveAvailable(run);
  const reason = run.leaderboard_meta?.curve_reason || "curve unavailable";
  return `
    <label class="plot-toggle ${disabled ? "disabled" : ""}" title="${escapeHtml(disabled ? reason : "Toggle this run in the chart")}">
      <input type="checkbox" data-run-id="${run.run_id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span>${checked ? "on" : "plot"}</span>
    </label>
  `;
}

function track3TableRow(run) {
  const steps = summaryMetric(run.run_id, "steps_to_target_3_28");
  const curveText = curveAvailable(run) ? "available" : "unavailable";
  return `
    <tr class="${run.run_id === selectedRunId ? "selected" : ""}" data-run-id="${run.run_id}">
      <td>${plotCell(run)}</td>
      <td><span class="rank-token">${escapeHtml(trackRankLabel(run))}</span></td>
      <td>
        <span class="run-name">${escapeHtml(run.display_name)}</span><br />
        <span class="muted table-note">${escapeHtml(run.optimizer.family || "optimizer")}</span>
      </td>
      <td class="${steps ? "loss-good" : "loss-bad"}">${steps ? intFmt.format(steps.value) : "not reached"}</td>
      <td><span class="curve-status ${curveAvailable(run) ? "ok" : "missing"}">${curveText}</span></td>
    </tr>
  `;
}

function renderSelectedChartRows(suite) {
  const selected = selectedChartRuns(suite);
  if (!selected.length) {
    return `<p class="muted wide-muted">No runs selected for the chart. Pick rows from the official history or local runs below.</p>`;
  }
  return `
    <div class="selected-run-list">
      ${selected
        .map((run, index) => `
          <button class="selected-run-pill ${run.run_id === selectedRunId ? "active" : ""}" type="button" data-run-id="${run.run_id}">
            <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
            ${escapeHtml(runChipLabel(run))}
          </button>
          <button class="remove-run" type="button" data-remove-run-id="${run.run_id}" aria-label="Remove ${escapeHtml(run.display_name)} from chart">×</button>
        `)
        .join("")}
    </div>
  `;
}

function renderTrack3Leaderboard(suite) {
  const officialRuns = officialTrack3Runs(suite);
  const oursRuns = localTrack3Runs(suite);
  if (!selectedRunId) selectedRunId = firstChartRun(suite)?.run_id || null;

  byId("leaderboard-title").textContent = "Track 3 official history";
  byId("leaderboardNote").textContent =
    "Official Track # is the README history number; chart selection is independent from rank.";

  byId("leaderboardContent").innerHTML = `
    <div class="selected-chart-box">
      <div class="mini-heading">
        <div>
          <strong>Selected for chart</strong>
          <span>${selectedChartRunIds.size}/${MAX_CHART_RUNS} plotted</span>
        </div>
        <span class="muted">Shown above the full history; ranks stay official.</span>
      </div>
      ${renderSelectedChartRows(suite)}
      <p class="selection-notice ${chartSelectionNotice ? "" : "empty"}">${escapeHtml(chartSelectionNotice || "Select up to eight runs for a readable curve comparison.")}</p>
    </div>

    <details class="history-details" ${officialHistoryOpen ? "open" : ""}>
      <summary>
        <span>Official Track 3 history (${officialRuns.length})</span>
        <span class="muted">default collapsed</span>
      </summary>
      <div class="table-wrap compact-table scroll-table">
        <table>
          <thead>
            <tr>
              <th>Plot</th>
              <th>Track #</th>
              <th>Run</th>
              <th>Steps to target</th>
              <th>Curve</th>
            </tr>
          </thead>
          <tbody>${officialRuns.map(track3TableRow).join("")}</tbody>
        </table>
      </div>
    </details>

    <div class="local-runs-block">
      <div class="mini-heading">
        <strong>Our representative runs</strong>
        <span>${oursRuns.length} local</span>
      </div>
      <div class="table-wrap compact-table scroll-table">
        <table>
          <thead>
            <tr>
              <th>Plot</th>
              <th>Track #</th>
              <th>Run</th>
              <th>Steps to target</th>
              <th>Curve</th>
            </tr>
          </thead>
          <tbody>${oursRuns.map(track3TableRow).join("")}</tbody>
        </table>
      </div>
    </div>
  `;

  const details = byId("leaderboardContent").querySelector(".history-details");
  if (details) {
    details.addEventListener("toggle", () => {
      officialHistoryOpen = details.open;
    });
  }

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
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
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

function figureRuns(suite) {
  return selectedChartRuns(suite).filter(curveAvailable);
}

function renderTargetStepStrip(runs) {
  const reachedRuns = runs.filter((run) => summaryMetric(run.run_id, "steps_to_target_3_28"));
  const targetStepStrip = byId("targetStepStrip");
  if (!targetStepStrip) return;
  targetStepStrip.innerHTML = reachedRuns.length
    ? `
      <span class="target-step-label">Target steps</span>
      <div class="target-step-pills">
        ${reachedRuns
          .map((run, index) => {
            const steps = summaryMetric(run.run_id, "steps_to_target_3_28");
            return `
              <button type="button" class="${run.run_id === selectedRunId ? "active" : ""}" data-run-id="${run.run_id}">
                <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
                <strong>${escapeHtml(trackRankLabel(run))}</strong>
                <span>@${intFmt.format(steps.value)}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `
    : "<span class=\"muted\">No selected run has reached the target.</span>";
  targetStepStrip.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      renderAll();
    });
  });
}

function renderChart() {
  const svg = byId("lossChart");
  svg.innerHTML = "";
  const width = svg.clientWidth || 740;
  const height = svg.clientHeight || 420;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const margin = { top: 22, right: 24, bottom: 42, left: 58 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const suite = activeSuite();
  const target = suite.target.value;
  const runs = figureRuns(suite);
  const allPoints = runs.flatMap((run) => pointMetrics(run.run_id));
  renderTargetStepStrip(runs);
  byId("chartMeta").textContent = `Target line: ${target} · ${runs.length}/${MAX_CHART_RUNS} plotted`;
  byId("chartSelectionChips").innerHTML = runs.length
    ? runs
        .map((run, index) => `
          <button type="button" class="${run.run_id === selectedRunId ? "active" : ""}" data-run-id="${run.run_id}">
            <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
            ${escapeHtml(runChipLabel(run))}
          </button>
        `)
        .join("")
    : "<span class=\"muted\">No selected runs have drawable curves.</span>";
  byId("chartSelectionChips").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      renderAll();
    });
  });

  if (!allPoints.length) {
    const empty = svgEl("text", { x: 24, y: 48, class: "chart-label" });
    empty.textContent = "Select a run with an available curve.";
    svg.appendChild(empty);
    byId("chartLegend").innerHTML = "";
    renderTargetStepStrip([]);
    return;
  }
  const targetSteps = runs
    .map((run) => summaryMetric(run.run_id, "steps_to_target_3_28")?.value)
    .filter((value) => Number.isFinite(value));
  const maxStep = Math.max(...allPoints.map((point) => point.step), ...targetSteps);
  const lossValues = allPoints.map((point) => point.value).concat(target);
  const rawMinLoss = Math.min(...lossValues);
  const rawMaxLoss = Math.max(...lossValues);
  const lossPadding = Math.max((rawMaxLoss - rawMinLoss) * 0.08, 0.08);
  const minLoss = Math.max(0, rawMinLoss - lossPadding);
  const maxLoss = rawMaxLoss + lossPadding;
  const x = (step) => margin.left + (step / maxStep) * chartWidth;
  const y = (loss) => margin.top + ((maxLoss - loss) / (maxLoss - minLoss)) * chartHeight;

  niceTicks(minLoss, maxLoss, 5).forEach((tick) => {
    const line = svgEl("line", {
      x1: margin.left,
      x2: margin.left + chartWidth,
      y1: y(tick),
      y2: y(tick),
      class: "gridline"
    });
    svg.appendChild(line);
    const label = svgEl("text", { x: 8, y: y(tick) + 4, class: "chart-label" });
    label.textContent = fmt.format(tick);
    svg.appendChild(label);
  });

  const targetLine = svgEl("line", {
    x1: margin.left,
    x2: margin.left + chartWidth,
    y1: y(target),
    y2: y(target),
    class: "target-line"
  });
  svg.appendChild(targetLine);
  const targetLabel = svgEl("text", { x: 8, y: y(target) + 4, class: "chart-label" });
  targetLabel.textContent = `target ${target}`;
  svg.appendChild(targetLabel);

  niceTicks(0, maxStep, 6).filter((tick) => tick >= 0 && tick <= maxStep).forEach((tick) => {
    const tx = x(tick);
    const line = svgEl("line", {
      x1: tx,
      x2: tx,
      y1: margin.top,
      y2: margin.top + chartHeight,
      class: "gridline"
    });
    svg.appendChild(line);
    const label = svgEl("text", { x: tx - 12, y: height - 13, class: "chart-label" });
    label.textContent = tick;
    svg.appendChild(label);
  });

  svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + chartHeight, class: "axis" }));
  svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left + chartWidth, y1: margin.top + chartHeight, y2: margin.top + chartHeight, class: "axis" }));

  runs.forEach((run, index) => {
    const points = pointMetrics(run.run_id);
    if (points.length < 2) return;
    const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.step).toFixed(2)} ${y(point.value).toFixed(2)}`).join(" ");
    const isPartial = run.status !== "completed";
    const path = svgEl("path", {
      d,
      class: `curve ${run.run_role === "ours" ? "ours" : ""} ${isPartial ? "partial" : ""}`,
      stroke: runColor(run, index),
      opacity: run.run_id === selectedRunId ? "1" : (isPartial ? "0.36" : "0.68"),
      "stroke-dasharray": isPartial ? "6 6" : "none"
    });
    path.addEventListener("click", () => {
      selectedRunId = run.run_id;
      renderAll();
    });
    svg.appendChild(path);

    const last = points[points.length - 1];
    const dot = svgEl("circle", {
      cx: x(last.step),
      cy: y(last.value),
      r: run.run_id === selectedRunId ? 5 : 3,
      fill: runColor(run, index)
    });
    dot.addEventListener("click", () => {
      selectedRunId = run.run_id;
      renderAll();
    });
    svg.appendChild(dot);
  });

  runs.forEach((run, index) => {
    const stepsToTarget = summaryMetric(run.run_id, "steps_to_target_3_28");
    if (!stepsToTarget) return;
    const tx = x(stepsToTarget.value);
    svg.appendChild(svgEl("line", {
      x1: tx,
      x2: tx,
      y1: y(target) - 13,
      y2: y(target) + 13,
      class: "target-tick",
      stroke: runColor(run, index)
    }));
    const marker = svgEl("circle", {
      cx: tx,
      cy: y(target),
      r: run.run_id === selectedRunId ? 5 : 4,
      class: "target-marker",
      fill: runColor(run, index)
    });
    svg.appendChild(marker);
  });

  byId("chartLegend").innerHTML = runs
    .map((run, index) => `
      <button type="button" data-run-id="${run.run_id}" aria-label="Inspect ${run.display_name}">
        <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
        ${escapeHtml(run.display_name)}${run.status !== "completed" ? " · partial" : ""}
      </button>
    `)
    .join("");

  byId("chartLegend").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      renderAll();
    });
  });
}

function metricLine(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "n/a")}</strong></div>`;
}

function listRuns(runIds) {
  if (!runIds || !runIds.length) return "n/a";
  return runIds
    .map((runId) => {
      const run = runById(runId);
      return run ? run.display_name : runId;
    })
    .join(", ");
}

function sourceList(links) {
  if (!links || !links.length) return "<li>n/a</li>";
  return links.map((link) => `<li><code>${link}</code></li>`).join("");
}

function renderRunDetail() {
  const suite = activeSuite();
  const rows = eligibleRuns(suite);
  const run = portalData.runs.find((candidate) => candidate.run_id === selectedRunId) || rows[0]?.run;
  if (!run) {
    byId("detail-title").textContent = "No run selected";
    byId("runDetail").innerHTML = "<p class=\"muted wide-muted\">No curated run is available for this suite yet.</p>";
    return;
  }
  const final = summaryMetric(run.run_id, "final_val_loss");
  const best = summaryMetric(run.run_id, "best_val_loss");
  const stepsToTarget = summaryMetric(run.run_id, "steps_to_target_3_28");
  const tps = summaryMetric(run.run_id, "tokens_per_sec");
  const mem = summaryMetric(run.run_id, "peak_memory_allocated_gb");
  const meta = run.leaderboard_meta || {};
  const source = run.source;
  const sourcePath = source.log_path || source.csv_path || source.config_path || "n/a";
  const model = run.model || {};
  const dataset = run.dataset || {};
  const training = run.training || {};
  const target = suite.target || {};
  const targetGap = final && target.value !== null && target.value !== undefined ? fmt.format(final.value - target.value) : "n/a";

  byId("detail-title").textContent = run.display_name;
  byId("runDetail").innerHTML = `
    <div class="detail-grid">
      ${metricLine("run_id", run.run_id)}
      ${metricLine("role", roleLabel(run))}
      ${metricLine("track_rank", trackRankLabel(run))}
      ${metricLine("official_evidence", meta.evidence || "n/a")}
      ${metricLine("official_date", meta.date || "n/a")}
      ${metricLine("curve_status", meta.curve_available === false ? "unavailable" : "available")}
      ${metricLine("optimizer", `${run.optimizer.name}${run.optimizer.variant ? ` · ${run.optimizer.variant}` : ""}`)}
      ${metricLine("status", run.status)}
      ${metricLine("final_val_loss", final ? fmt.format(final.value) : "n/a")}
      ${metricLine("best_val_loss", best ? `${fmt.format(best.value)} @ step ${best.step}` : "n/a")}
      ${metricLine("steps_to_target_3_28", stepsToTarget ? intFmt.format(stepsToTarget.value) : "n/a")}
      ${metricLine("target_gap", targetGap)}
      ${metricLine("model_params", displayValue(model.params))}
      ${metricLine("dataset", displayValue(dataset.name))}
      ${metricLine("sequence_length", displayValue(training.sequence_length))}
      ${metricLine("global_batch_tokens", displayValue(training.global_batch_tokens))}
      ${metricLine("lr", displayValue(training.lr))}
      ${metricLine("weight_decay", displayValue(training.weight_decay))}
      ${metricLine("warmup_steps", displayValue(training.warmup_steps))}
      ${metricLine("scheduler", displayValue(training.scheduler))}
      ${metricLine("seed", displayValue(training.seed))}
      ${metricLine("eval_interval", displayValue(training.eval_interval))}
      ${metricLine("dtype", displayValue(training.dtype))}
      ${metricLine("hardware", `${run.hardware.gpu_type || "n/a"}${run.hardware.num_gpus ? ` · ${run.hardware.num_gpus} GPU` : ""}`)}
      ${metricLine("tokens_per_sec", tps ? fmt.format(tps.value) : "n/a")}
      ${metricLine("peak_memory_allocated_gb", mem ? fmt.format(mem.value) : "n/a")}
      ${metricLine("source_type", source.source_type)}
      ${metricLine("source_path", sourcePath)}
      ${metricLine("description", meta.description || "n/a")}
      ${metricLine("command", source.command || "n/a")}
      ${metricLine("wandb_url", source.wandb_url || "n/a")}
    </div>
    <div class="source-actions">
      ${source.wandb_url ? `<a href="${source.wandb_url}" target="_blank" rel="noreferrer">Open WandB</a>` : ""}
      <button type="button" id="copySource">Copy source path</button>
    </div>
  `;

  const copy = byId("copySource");
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
  byId("claimsList").innerHTML = claims.length ? claims
    .map((claim) => `
      <article class="claim">
        <h4>${claim.title}</h4>
        <div class="claim-meta">
          <span class="tag">${claim.claim_type}</span>
          <span class="tag">${claim.claim_status}</span>
          <span class="tag">${claim.evidence_level}</span>
          <span class="tag">${claim.comparison.metric_name}</span>
          <span class="tag">delta ${claim.comparison.delta_value > 0 ? "+" : ""}${fmt.format(claim.comparison.delta_value)}</span>
        </div>
        <dl class="claim-facts">
          <div><dt>method</dt><dd>${claim.comparison.method_label || "n/a"}</dd></div>
          <div><dt>baseline</dt><dd>${claim.comparison.baseline_label || "n/a"}</dd></div>
          <div><dt>supporting runs</dt><dd>${listRuns(claim.supporting_run_ids)}</dd></div>
          <div><dt>baseline runs</dt><dd>${listRuns(claim.baseline_run_ids)}</dd></div>
        </dl>
        <div class="claim-notes">
          <strong>Caveats</strong>
          <ul>${(claim.caveats || []).map((caveat) => `<li>${caveat}</li>`).join("") || "<li>n/a</li>"}</ul>
        </div>
        <details class="claim-sources">
          <summary>Source links</summary>
          <ul>${sourceList(claim.source_links)}</ul>
        </details>
      </article>
    `)
    .join("") : "<p class=\"muted wide-muted\">No claim cards have been curated for this suite yet.</p>";
}

function renderAll() {
  const suite = activeSuite();
  renderOverview();
  renderSuiteCards();
  renderSuiteHeader(suite);
  if (suiteHasDetail(suite)) {
    showDetailPanels();
    if (!selectedRunId || runById(selectedRunId)?.suite_id !== suite.suite_id) {
      selectedRunId = firstChartRun(suite)?.run_id || null;
    }
    renderLeaderboard();
    renderChart();
    renderRunDetail();
    renderClaims();
  } else {
    selectedRunId = null;
    renderPlaceholder(suite);
  }
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
