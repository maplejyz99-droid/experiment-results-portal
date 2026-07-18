const SEARCH_DEBOUNCE_MS = 140;

let portalData;
let portalCatalog;
let portalLoadMode = "aggregate";
let dataIndex;
let selectedSuiteId;
let selectedRunId;
let selectedChartRunIds = new Set();
let referenceHistoryOpen = {};
let chartSelectionNotice = "";
let chartScaleMode = "full";
let focusedChartRunId = null;
let runFilterText = "";
let runFilterRole = "all";
let runFilterFamily = "all";
let runFilterStatus = "all";
let runFilterTarget = "all";
let runFilterCurve = "all";
let runSearchTimer = 0;
let chartResizeFrame = 0;
let chartResizeObserver;
let currentChartModel = null;
let activeSuiteShardId = null;
let pendingSuiteId = null;
let protocolSwitchError = "";
let suiteLoadGeneration = 0;

const suiteShardCache = new Map();
const suiteShardRequests = new Map();

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function byId(id) {
  return document.getElementById(id);
}

function buildDataIndex(data) {
  const runsById = new Map();
  const suitesById = new Map();
  const figuresBySuite = new Map();
  const runsBySuite = new Map();
  const claimsBySuite = new Map();
  const summaryByRun = new Map();
  const pointsByRunMetric = new Map();

  for (const suite of data.suites || []) {
    suitesById.set(suite.suite_id, suite);
    runsBySuite.set(suite.suite_id, []);
    claimsBySuite.set(suite.suite_id, []);
  }

  for (const run of data.runs || []) {
    runsById.set(run.run_id, run);
    if (!runsBySuite.has(run.suite_id)) runsBySuite.set(run.suite_id, []);
    runsBySuite.get(run.suite_id).push(run);
  }

  for (const figure of data.figures || []) {
    if (figure.figure_type === "loss_curve" && !figuresBySuite.has(figure.suite_id)) {
      figuresBySuite.set(figure.suite_id, figure);
    }
  }

  for (const claim of data.claims || []) {
    if (!claimsBySuite.has(claim.suite_id)) claimsBySuite.set(claim.suite_id, []);
    claimsBySuite.get(claim.suite_id).push(claim);
  }

  for (const metric of data.metrics || []) {
    if (metric.metric_scope === "summary") {
      if (!summaryByRun.has(metric.run_id)) summaryByRun.set(metric.run_id, new Map());
      summaryByRun.get(metric.run_id).set(metric.metric_name, metric);
      continue;
    }
    if (metric.metric_scope !== "point") continue;
    if (!pointsByRunMetric.has(metric.run_id)) pointsByRunMetric.set(metric.run_id, new Map());
    const metricsByName = pointsByRunMetric.get(metric.run_id);
    if (!metricsByName.has(metric.metric_name)) metricsByName.set(metric.metric_name, []);
    metricsByName.get(metric.metric_name).push(metric);
  }

  for (const metricsByName of pointsByRunMetric.values()) {
    for (const points of metricsByName.values()) {
      points.sort((left, right) => left.step - right.step);
    }
  }

  dataIndex = {
    runsById,
    suitesById,
    figuresBySuite,
    runsBySuite,
    claimsBySuite,
    summaryByRun,
    pointsByRunMetric,
    leaderboardRowsBySuite: new Map(),
    leaderboardOrderBySuite: new Map(),
  };

  for (const suite of data.suites || []) {
    const allowed = new Set(suite.leaderboard_eligibility?.allowed_status || []);
    const rows = (runsBySuite.get(suite.suite_id) || [])
      .filter((run) => allowed.has(run.status))
      .map((run) => rowFromRun(suite, run))
      .sort((left, right) => compareRunRows(suite, left, right));
    dataIndex.leaderboardRowsBySuite.set(suite.suite_id, rows);
    dataIndex.leaderboardOrderBySuite.set(
      suite.suite_id,
      new Map(rows.map((row, index) => [row.run.run_id, index]))
    );
  }
}

function summaryMetric(runId, metricName) {
  return dataIndex?.summaryByRun.get(runId)?.get(metricName);
}

function summaryMetricsForRun(runId) {
  return Array.from(dataIndex?.summaryByRun.get(runId)?.values() || []);
}

function pointMetrics(runId, metricName) {
  return dataIndex?.pointsByRunMetric.get(runId)?.get(metricName) || [];
}

function runById(runId) {
  return dataIndex?.runsById.get(runId);
}

function suiteById(suiteId) {
  return dataIndex?.suitesById.get(suiteId);
}

function figureForSuite(suite) {
  return suite ? dataIndex?.figuresBySuite.get(suite.suite_id) : undefined;
}

function suiteRuns(suiteId) {
  return dataIndex?.runsBySuite.get(suiteId) || [];
}

function suiteClaims(suiteId) {
  return dataIndex?.claimsBySuite.get(suiteId) || [];
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

function safeExternalUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function normalizedPortalData(data) {
  return {
    ...data,
    suites: Array.isArray(data?.suites) ? data.suites : [],
    runs: Array.isArray(data?.runs) ? data.runs : [],
    metrics: Array.isArray(data?.metrics) ? data.metrics : [],
    claims: Array.isArray(data?.claims) ? data.claims : [],
    figures: Array.isArray(data?.figures) ? data.figures : [],
  };
}

function catalogSnapshot() {
  return portalCatalog || portalData || normalizedPortalData({});
}

function catalogSuites() {
  return catalogSnapshot().suites || [];
}

function catalogSuiteById(suiteId) {
  return catalogSuites().find((suite) => suite.suite_id === suiteId);
}

function numericEvidenceValue(summary, keys) {
  for (const key of keys) {
    const value = summary?.[key];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function suiteEvidenceSummary(suite) {
  const configured = suite?.evidence_summary || suite?.protocol?.evidence_summary || {};
  const loadedRuns = suite ? suiteRuns(suite.suite_id) : [];
  const statusCounts = configured.status_counts || {};
  const derivedComplete = loadedRuns.filter((run) => run.status === "completed").length;
  const derivedPartial = loadedRuns.filter((run) =>
    ["partial", "stopped", "failed", "oom", "nan"].includes(String(run.status).toLowerCase())
  ).length;
  return {
    expected: numericEvidenceValue(configured, ["expected"]),
    mapped: numericEvidenceValue(configured, ["mapped", "runs"]) ?? loadedRuns.length,
    complete:
      numericEvidenceValue(configured, ["complete", "completed"]) ??
      numericEvidenceValue(statusCounts, ["completed"]) ??
      derivedComplete,
    partial:
      numericEvidenceValue(configured, ["partial"]) ??
      derivedPartial,
    nonfinite: numericEvidenceValue(configured, ["nonfinite"]) ?? 0,
    unresolved: numericEvidenceValue(configured, ["unresolved"]) ?? 0,
    drawable:
      numericEvidenceValue(configured, ["drawable", "curves"]) ??
      (suite ? loadedRuns.filter((run) => curveAvailable(run, suite)).length : 0),
    metrics: numericEvidenceValue(configured, ["metrics"]) ?? 0,
    claims: numericEvidenceValue(configured, ["claims"]) ?? 0,
    figures: numericEvidenceValue(configured, ["figures"]) ?? 0,
  };
}

function sumSuiteEvidence(suites) {
  const keys = [
    "expected",
    "mapped",
    "complete",
    "partial",
    "nonfinite",
    "unresolved",
    "drawable",
    "metrics",
    "claims",
    "figures",
  ];
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  let hasExpected = false;
  for (const suite of suites) {
    const summary = suiteEvidenceSummary(suite);
    for (const key of keys) {
      if (key === "expected" && summary[key] === null) continue;
      totals[key] += summary[key] || 0;
    }
    hasExpected ||= summary.expected !== null;
  }
  if (!hasExpected) totals.expected = null;
  return totals;
}

function groupId(group) {
  return group?.benchmark_group_id || group?.group_id || "";
}

function suiteGroupId(suite) {
  return suite?.benchmark_group_id || "";
}

function benchmarkGroupRecords() {
  const raw = catalogSnapshot().benchmark_groups;
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([benchmarkGroupId, value]) => ({
    benchmark_group_id: benchmarkGroupId,
    ...(value || {}),
  }));
}

function groupSuiteIds(group) {
  const configured = group?.suite_ids || group?.protocol_suite_ids || group?.suites || [];
  return configured
    .map((entry) => (typeof entry === "string" ? entry : entry?.suite_id))
    .filter(Boolean);
}

function benchmarkNavigationEntries() {
  const suites = catalogSuites();
  const suitesById = new Map(suites.map((suite) => [suite.suite_id, suite]));
  const assigned = new Set();
  const explicit = benchmarkGroupRecords()
    .map((group, index) => {
      const id = groupId(group);
      const ids = groupSuiteIds(group);
      const inferred = suites
        .filter((suite) => suiteGroupId(suite) === id)
        .map((suite) => suite.suite_id);
      const suiteIds = Array.from(new Set([...ids, ...inferred])).filter((suiteId) =>
        suitesById.has(suiteId)
      );
      suiteIds.forEach((suiteId) => assigned.add(suiteId));
      const groupSuites = suiteIds.map((suiteId) => suitesById.get(suiteId));
      const defaultSuite =
        suitesById.get(group.default_suite_id) ||
        groupSuites.find((suite) => suite.status === "active") ||
        groupSuites[0];
      return {
        kind: "group",
        id: id || `group-${index + 1}`,
        order: Number.isFinite(group.display_order) ? group.display_order : index,
        record: group,
        suites: groupSuites,
        defaultSuite,
      };
    })
    .filter((entry) => entry.suites.length);

  const derivedById = new Map();
  suites.forEach((suite, index) => {
    const id = suiteGroupId(suite);
    if (!id || assigned.has(suite.suite_id)) return;
    if (!derivedById.has(id)) {
      derivedById.set(id, {
        kind: "group",
        id,
        order: explicit.length + index,
        record: { benchmark_group_id: id },
        suites: [],
        defaultSuite: null,
      });
    }
    const entry = derivedById.get(id);
    entry.suites.push(suite);
    entry.defaultSuite ||= suite;
    assigned.add(suite.suite_id);
  });

  const standalone = suites
    .filter((suite) => !assigned.has(suite.suite_id))
    .map((suite, index) => ({
      kind: "suite",
      id: `suite:${suite.suite_id}`,
      order: explicit.length + derivedById.size + index,
      record: null,
      suites: [suite],
      defaultSuite: suite,
    }));

  return [...explicit, ...derivedById.values(), ...standalone].sort(
    (left, right) => left.order - right.order
  );
}

function navigationEntryForSuite(suiteId) {
  return benchmarkNavigationEntries().find((entry) =>
    entry.suites.some((suite) => suite.suite_id === suiteId)
  );
}

function navigationEntryTitle(entry) {
  return (
    entry.record?.title ||
    entry.record?.model_label ||
    entry.defaultSuite?.title ||
    "Untitled benchmark"
  );
}

function navigationEntryStatus(entry) {
  if (entry.record?.status) return entry.record.status;
  if (entry.suites.some((suite) => suite.status === "active")) return "active";
  if (entry.suites.some((suite) => suite.status === "partial")) return "partial";
  if (entry.suites.some((suite) => suite.status === "view")) return "view";
  return entry.defaultSuite?.status || "planned";
}

function navigationEntryEvidence(entry) {
  return entry.record?.evidence_summary || sumSuiteEvidence(entry.suites);
}

function protocolSourceCoordinate(suite) {
  const protocol = suite?.protocol || {};
  const key = protocol.source_kind || protocol.source_id || "protocol";
  return {
    key,
    label:
      protocol.source_label ||
      (key === "current_curated"
        ? "Current"
        : key === "paper_main_benchmark"
          ? "Paper"
          : String(key).replaceAll("_", " ")),
    dataset:
      protocol.dataset ||
      suite?.comparability_constraints?.dataset ||
      "Dataset not specified",
  };
}

function protocolBatchCoordinate(suite) {
  const protocol = suite?.protocol || {};
  const batch = protocol.batch_size_sequences ?? protocol.global_batch_sequences ?? protocol.batch_size;
  const sequenceLength = protocol.sequence_length;
  return {
    key: batch === null || batch === undefined ? "unspecified" : String(batch),
    batch,
    sequenceLength,
    label:
      protocol.batch_label ||
      (batch !== null && batch !== undefined
        ? `${intFmt.format(batch)}${Number.isFinite(sequenceLength) ? ` × ${intFmt.format(sequenceLength)}` : ""}`
        : "Not specified"),
    tokensPerStep:
      protocol.tokens_per_step ??
      (Number.isFinite(batch) && Number.isFinite(sequenceLength) ? batch * sequenceLength : null),
  };
}

function protocolBudgetCoordinate(suite) {
  const protocol = suite?.protocol || {};
  const plannedTokens = protocol.planned_tokens;
  const label =
    protocol.budget_label ||
    protocol.token_budget_label ||
    suite?.comparability_constraints?.token_budget ||
    (Number.isFinite(plannedTokens) ? intFmt.format(plannedTokens) : "Not specified");
  return {
    key: protocol.budget_key || (Number.isFinite(plannedTokens) ? String(plannedTokens) : String(label)),
    label,
    plannedTokens: Number.isFinite(plannedTokens) ? plannedTokens : null,
    steps: Number.isFinite(protocol.budget_steps) ? protocol.budget_steps : null,
  };
}

function protocolDisplayOrder(suite) {
  const configured = suite?.protocol?.display_order;
  if (Number.isFinite(configured)) return configured;
  return protocolBudgetCoordinate(suite).plannedTokens ?? Number.MAX_SAFE_INTEGER;
}

function protocolSelectable(suite) {
  if (!suite?.protocol) return false;
  if (suite.protocol.enabled === false) return false;
  const detailAvailable = suiteDetailState(suite) === "available";
  const drawable = numericEvidenceValue(
    suite.evidence_summary || suite.protocol.evidence_summary,
    ["drawable", "curves"]
  );
  if (!detailAvailable) return false;
  return drawable === null ? suite.status === "active" : drawable > 0;
}

function sortedProtocolSuites(suites) {
  return suites
    .filter((suite) => suite?.protocol)
    .slice()
    .sort((left, right) => {
      const orderDelta = protocolDisplayOrder(left) - protocolDisplayOrder(right);
      return orderDelta || left.suite_id.localeCompare(right.suite_id);
    });
}

function chooseProtocolSuite(
  suites,
  { sourceKey = "", batchKey = "", budgetKey = "" } = {}
) {
  let candidates = sortedProtocolSuites(suites).filter(protocolSelectable);
  if (sourceKey) {
    const sourceMatches = candidates.filter(
      (suite) => protocolSourceCoordinate(suite).key === sourceKey
    );
    if (sourceMatches.length) candidates = sourceMatches;
  }
  if (batchKey) {
    const batchMatches = candidates.filter(
      (suite) => protocolBatchCoordinate(suite).key === String(batchKey)
    );
    if (batchMatches.length) candidates = batchMatches;
  }
  if (budgetKey) {
    const budgetMatch = candidates.find(
      (suite) => protocolBudgetCoordinate(suite).key === String(budgetKey)
    );
    if (budgetMatch) return budgetMatch;
  }
  return candidates[0] || null;
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

function initializeChartSelection(suite) {
  selectedChartRunIds = new Set(defaultChartRunIds(suite));
  focusedChartRunId = null;
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

function tailStepDomain(suite, figure = figureForSuite(suite)) {
  const configuredMin = figure?.tail_step_min ?? figure?.x_axis_tail_min;
  const configuredMax = figure?.tail_step_max ?? figure?.x_axis_tail_max;
  if (Number.isFinite(configuredMin) && Number.isFinite(configuredMax) && configuredMax > configuredMin) {
    return { min: configuredMin, max: configuredMax };
  }
  return null;
}

function normalizeChartScaleMode(suite) {
  const allowed = new Set(["full", "zoom"]);
  if (tailStepDomain(suite)) allowed.add("tail");
  if (!allowed.has(chartScaleMode)) chartScaleMode = "full";
}

function chartFocusRunId() {
  const suite = activeSuite();
  const run = runById(focusedChartRunId);
  if (
    !suite ||
    !run ||
    run.suite_id !== suite.suite_id ||
    !selectedChartRunIds.has(run.run_id)
  ) {
    return null;
  }
  const visibleRunIds = new Set(chartVisibleRuns(suite).map((entry) => entry.run_id));
  return visibleRunIds.has(run.run_id) ? run.run_id : null;
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
  return dataIndex?.leaderboardRowsBySuite.get(suite.suite_id) || [];
}

function unrankedRows(suite) {
  const allowed = new Set(suite.leaderboard_eligibility?.allowed_status || []);
  return suiteRuns(suite.suite_id)
    .filter((run) => !allowed.has(run.status))
    .map((run) => rowFromRun(suite, run))
    .sort((left, right) => {
      const statusDelta = String(left.run.status).localeCompare(String(right.run.status));
      return statusDelta || left.run.display_name.localeCompare(right.run.display_name);
    });
}

function allRunRows(suite) {
  return suiteRuns(suite.suite_id).map((run) => rowFromRun(suite, run));
}

function leaderboardOrderMap(suite) {
  return dataIndex?.leaderboardOrderBySuite.get(suite.suite_id) || new Map();
}

function compareRunsForSuite(suite, leftRun, rightRun, order = leaderboardOrderMap(suite)) {
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
  const order = leaderboardOrderMap(suite);
  return Array.from(selectedChartRunIds)
    .map(runById)
    .filter((run) => run && run.suite_id === suite.suite_id)
    .sort((left, right) => compareRunsForSuite(suite, left, right, order));
}

function chartVisibleRuns(suite) {
  const visibleIds = new Set(
    filteredRows(allRunRows(suite), suite).map((row) => row.run.run_id)
  );
  return selectedChartRuns(suite).filter((run) => visibleIds.has(run.run_id));
}

function hiddenPlottedRuns(suite) {
  const visibleIds = new Set(chartVisibleRuns(suite).map((run) => run.run_id));
  return selectedChartRuns(suite).filter((run) => !visibleIds.has(run.run_id));
}

function chartFilterSummary() {
  return [
    runFilterText.trim() ? `search=${runFilterText.trim()}` : "",
    runFilterRole !== "all" ? `role=${runFilterRole}` : "",
    runFilterFamily !== "all" ? `family=${runFilterFamily}` : "",
    runFilterStatus !== "all" ? `status=${runFilterStatus}` : "",
    runFilterTarget !== "all" ? `target=${runFilterTarget}` : "",
    runFilterCurve !== "all" ? `curve=${runFilterCurve}` : "",
  ].filter(Boolean).join(";");
}

function buildCurrentFigureModel({
  profile = "interactive",
  width = 1200,
  height = 900,
} = {}) {
  const runtime = globalThis.PortalFigureRuntime;
  const suite = activeSuite();
  const figure = figureForSuite(suite);
  if (!runtime?.buildFigureModel || !suite || !figure) return null;
  const selectedRunIds = selectedChartRuns(suite).map((run) => run.run_id);
  const visibleRunIds = chartVisibleRuns(suite)
    .filter((run) => curveAvailable(run, suite))
    .map((run) => run.run_id);
  return runtime.buildFigureModel(portalData, {
    figureId: figure.figure_id,
    selectedRunIds,
    visibleRunIds,
    focusRunId: chartFocusRunId(),
    scaleMode: chartScaleMode,
    profile,
    width,
    height,
    filterSummary: chartFilterSummary(),
  });
}

function selectableChartRuns(suite) {
  const order = leaderboardOrderMap(suite);
  return suiteRuns(suite.suite_id)
    .filter((run) => curveAvailable(run, suite))
    .sort((left, right) => compareRunsForSuite(suite, left, right, order));
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
  if (!selectedChartRunIds.has(focusedChartRunId)) focusedChartRunId = null;
  chartSelectionNotice = notice;
  selectedRunId = firstChartRun(suite)?.run_id || null;
}

function bestChartRunIds(suite) {
  return eligibleRows(suite)
    .map((row) => row.run)
    .filter((run) => curveAvailable(run, suite))
    .slice(0, chartSelectionLimit(suite))
    .map((run) => run.run_id);
}

function runColor(run) {
  return globalThis.PortalFigureRuntime
    ?.styleForRun(run, portalData?.visual_style_registry)
    ?.color || "#475467";
}

function seriesKeyHtml(style, role) {
  const color = escapeHtml(style?.color || "#475467");
  return `
    <span
      class="series-key"
      data-series-role="${escapeHtml(role || "unknown")}"
      style="color:${color}"
      aria-hidden="true"
    >
      <span class="series-key-line"></span>
    </span>
  `;
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
  if (focusedChartRunId === runId) focusedChartRunId = null;
  if (selectedRunId === runId) {
    selectedRunId = firstChartRun(suite)?.run_id || null;
  }
}

function captureFocusState() {
  const element = document.activeElement;
  if (!element || element === document.body) return null;
  return {
    id: element.id || "",
    runId: element.dataset?.runId || "",
    removeRunId: element.dataset?.removeRunId || "",
    chartAction: element.dataset?.chartAction || "",
    filterAction: element.dataset?.filterAction || "",
    scaleMode: element.dataset?.scaleMode || "",
    chartFocusAction: element.dataset?.chartFocusAction || "",
    controlKind: element.matches?.(".plot-toggle input") ? "plot-toggle" : "",
    selectionStart: typeof element.selectionStart === "number" ? element.selectionStart : null,
    selectionEnd: typeof element.selectionEnd === "number" ? element.selectionEnd : null,
  };
}

function restoreFocusState(state) {
  if (!state) return;
  let element = state.id ? byId(state.id) : null;
  const descriptors = [
    ["runId", "runId"],
    ["removeRunId", "removeRunId"],
    ["chartAction", "chartAction"],
    ["filterAction", "filterAction"],
    ["scaleMode", "scaleMode"],
    ["chartFocusAction", "chartFocusAction"],
  ];
  if (!element) {
    if (state.controlKind === "plot-toggle" && state.runId) {
      element = Array.from(document.querySelectorAll(".plot-toggle input[data-run-id]"))
        .find((candidate) => candidate.dataset.runId === state.runId);
    }
  }
  if (!element) {
    for (const [stateKey, dataKey] of descriptors) {
      if (!state[stateKey]) continue;
      element = Array.from(document.querySelectorAll(`[data-${dataKey.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`))
        .find((candidate) => candidate.dataset[dataKey] === state[stateKey]);
      if (element) break;
    }
  }
  if (!element) return;
  element.focus({ preventScroll: true });
  if (
    state.selectionStart !== null &&
    state.selectionEnd !== null &&
    typeof element.setSelectionRange === "function"
  ) {
    element.setSelectionRange(state.selectionStart, state.selectionEnd);
  }
}

function updateSelectedRunVisuals() {
  const focusedRunId = chartFocusRunId();
  const detailSelectors = [
    "#leaderboardContent tr[data-run-id]",
    "#leaderboardContent .selected-run-pill[data-run-id]",
  ];
  document.querySelectorAll(detailSelectors.join(",")).forEach((element) => {
    const selected = element.dataset.runId === selectedRunId;
    element.classList.toggle(element.matches("tr") ? "selected" : "active", selected);
    if (element.matches("tr")) {
      element.setAttribute("aria-selected", String(selected));
    } else {
      element.setAttribute("aria-pressed", String(selected));
    }
  });

  const chartSelectors = [
    "#chartSelectionChips button[data-run-id]",
    "#targetStepStrip button[data-run-id]",
    "#chartLegend button[data-run-id]",
  ];
  document.querySelectorAll(chartSelectors.join(",")).forEach((element) => {
    const focused = element.dataset.runId === focusedRunId;
    element.classList.toggle("active", focused);
    element.setAttribute("aria-pressed", String(focused));
    if (element.closest("#targetStepStrip")) {
      element.setAttribute("aria-current", String(focused));
    }
  });

  document.querySelectorAll("#lossChart [data-chart-run-id]").forEach((element) => {
    const focused = element.dataset.chartRunId === focusedRunId;
    const opacity = focused
      ? element.dataset.focusOpacity
      : focusedRunId
        ? element.dataset.contextOpacity
        : element.dataset.neutralOpacity;
    const strokeWidth = focused
      ? element.dataset.focusStrokeWidth
      : element.dataset.baseStrokeWidth;
    if (opacity) element.setAttribute("opacity", opacity);
    if (strokeWidth) element.setAttribute("stroke-width", strokeWidth);
    element.classList.toggle("selected", focused);
    element.classList.toggle("is-selected", focused);
    element.classList.toggle("is-context", Boolean(focusedRunId) && !focused);
    element.setAttribute("aria-current", String(focused));
  });

  const curveLayer = document.querySelector("#lossChart [data-curve-layer=\"series\"]");
  if (curveLayer && focusedRunId) {
    Array.from(curveLayer.children)
      .filter((element) => element.dataset.chartRunId === focusedRunId)
      .forEach((element) => curveLayer.appendChild(element));
  }
}

function clearChartFocus({ updateUrl = true } = {}) {
  const changed = focusedChartRunId !== null;
  focusedChartRunId = null;
  if (byId("chartEmphasisSwitch")) renderChartEmphasisSwitch();
  updateSelectedRunVisuals();
  if (updateUrl) syncUrlState();
  return changed;
}

function selectRun(runId, { updateUrl = true, focusChart = false } = {}) {
  const run = runById(runId);
  const suite = activeSuite();
  if (!run || !suite || run.suite_id !== suite.suite_id) return false;
  selectedRunId = run.run_id;
  if (focusChart && selectedChartRunIds.has(run.run_id)) {
    focusedChartRunId = run.run_id;
    if (byId("chartEmphasisSwitch")) renderChartEmphasisSwitch();
  }
  if (byId("runDetail")) {
    updateSelectedRunVisuals();
    renderRunDetail();
  }
  if (updateUrl) syncUrlState();
  return true;
}

function refreshRunViews({ focusState = captureFocusState(), includeDetail = true } = {}) {
  renderLeaderboard();
  renderChart();
  if (includeDetail) renderRunDetail();
  restoreFocusState(focusState);
  syncUrlState();
}

function applyUrlState() {
  if (!globalThis.location) return;
  const params = new URLSearchParams(globalThis.location.search);
  const requestedSuite = params.get("suite");
  if (requestedSuite && suiteById(requestedSuite)) selectedSuiteId = requestedSuite;
  const suite = activeSuite();
  const requestedScale = params.get("scale");
  if (requestedScale) chartScaleMode = requestedScale;
  normalizeChartScaleMode(suite);
  initializeChartSelection(suite);
  const rows = allRunRows(suite);
  const readFilter = (name, values) => {
    const value = params.get(name);
    return value && values.has(value) ? value : "all";
  };
  runFilterText = params.get("q") || "";
  runFilterRole = readFilter("role", new Set(rows.map((row) => row.run.run_role)));
  runFilterFamily = readFilter(
    "family",
    new Set(rows.map((row) => row.run.optimizer?.family || row.run.optimizer?.name || "unknown"))
  );
  runFilterStatus = readFilter("status", new Set(rows.map((row) => row.run.status)));
  runFilterTarget = readFilter(
    "target",
    new Set(rows.map((row) => targetStatus(row, suite)).filter(Boolean))
  );
  runFilterCurve = readFilter("curve", new Set(rows.map((row) => curveState(row, suite))));
  const requestedRun = runById(params.get("run"));
  selectedRunId = requestedRun?.suite_id === suite.suite_id
    ? requestedRun.run_id
    : firstChartRun(suite)?.run_id || null;
  const requestedFocus = runById(params.get("focus"));
  focusedChartRunId =
    requestedFocus?.suite_id === suite.suite_id &&
    selectedChartRunIds.has(requestedFocus.run_id)
      ? requestedFocus.run_id
      : params.get("emphasis") === "selected" &&
          selectedRunId &&
          selectedChartRunIds.has(selectedRunId)
        ? selectedRunId
        : null;
}

function syncUrlState({ push = false } = {}) {
  if (!globalThis.location || !globalThis.history?.replaceState || !selectedSuiteId) return;
  const url = new URL(globalThis.location.href);
  url.searchParams.set("suite", selectedSuiteId);
  if (selectedRunId) url.searchParams.set("run", selectedRunId);
  else url.searchParams.delete("run");
  url.searchParams.set("scale", chartScaleMode);
  const focusedRunId = chartFocusRunId();
  if (focusedRunId) url.searchParams.set("focus", focusedRunId);
  else url.searchParams.delete("focus");
  url.searchParams.delete("emphasis");
  const filters = {
    q: runFilterText.trim(),
    role: runFilterRole === "all" ? "" : runFilterRole,
    family: runFilterFamily === "all" ? "" : runFilterFamily,
    status: runFilterStatus === "all" ? "" : runFilterStatus,
    target: runFilterTarget === "all" ? "" : runFilterTarget,
    curve: runFilterCurve === "all" ? "" : runFilterCurve,
  };
  Object.entries(filters).forEach(([name, value]) => {
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  });
  const nextLocation = `${url.pathname}${url.search}${url.hash}`;
  if (push && typeof globalThis.history.pushState === "function") {
    globalThis.history.pushState(null, "", nextLocation);
  } else {
    globalThis.history.replaceState(null, "", nextLocation);
  }
}

function renderOverview() {
  const snapshot = catalogSnapshot();
  const entries = benchmarkNavigationEntries();
  const globalEvidence = snapshot.evidence_summary || snapshot.meta?.evidence_summary || {};
  const summedEvidence = sumSuiteEvidence(catalogSuites());
  const totalSuites =
    numericEvidenceValue(globalEvidence, ["benchmark_groups", "groups"]) ??
    entries.length;
  const activeSuites =
    numericEvidenceValue(globalEvidence, ["active_groups"]) ??
    entries.filter((entry) => navigationEntryStatus(entry) === "active").length;
  const curatedRuns =
    numericEvidenceValue(globalEvidence, ["runs", "mapped"]) ??
    (portalLoadMode === "aggregate" ? portalData.runs.length : summedEvidence.mapped);
  const claimCards =
    numericEvidenceValue(globalEvidence, ["claims"]) ??
    (portalLoadMode === "aggregate" ? portalData.claims.length : summedEvidence.claims);

  byId("overviewMetrics").innerHTML = [
    [String(totalSuites), "benchmark groups and standalone views"],
    [String(activeSuites), "active workspaces with curated detail"],
    [String(curatedRuns), "curated runs with source trace"],
    [String(claimCards), "manual claim cards"],
  ]
    .map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderSuiteHeader(suite) {
  const runs = suiteRuns(suite.suite_id);
  const navigationEntry = navigationEntryForSuite(suite.suite_id);
  const evidence = suiteEvidenceSummary(suite);
  const completed = evidence.complete;
  const mapped = evidence.mapped;
  const drawable = evidence.drawable;
  const target = suite.target || {};
  const constraints = suite.comparability_constraints || {};
  const figure = figureForSuite(suite);
  const yMetric = figure?.y_metric || primaryMetricName(suite);
  const targetText =
    target.metric_name && target.value !== null && target.metric_name === yMetric
      ? `${target.metric_name} ${target.direction === "below" ? "<=" : ">="} ${target.value}`
      : "no chart target";

  byId("suite-title").textContent =
    navigationEntry?.kind === "group"
      ? navigationEntryTitle(navigationEntry)
      : suite.title;
  byId("targetBox").innerHTML = `
    <span class="target-box-label">Evidence coverage</span>
    <strong>${completed}/${mapped} runs complete</strong>
    <span class="target-box-value">${drawable} curves</span>
    <span class="target-box-meta">${suite.status} · ${suite.family} · static snapshot</span>
  `;

  const rankDirection = suite.leaderboard_rule?.direction === "desc" ? "higher first" : "lower first";
  const railItems = [
    ["Model", constraints.model || "Not specified"],
    ["Dataset", constraints.dataset || "Not specified"],
    ["Token budget", constraints.token_budget || "Not specified"],
    [
      "Rank metric",
      `${suite.leaderboard_rule?.formal_rank_metric || suite.leaderboard_rule?.sort_by || primaryMetricName(suite)} · ${rankDirection}`,
    ],
    ["Target", targetText === "no chart target" ? "No target declared" : targetText],
    ["Hardware scope", constraints.hardware_scope || "Not specified"],
  ];
  const protocolRail = byId("protocolRail");
  protocolRail.dataset.status = suite.status;
  protocolRail.innerHTML = railItems
    .map(
      ([label, value], index) => `
        <div class="protocol-node">
          <span class="protocol-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="protocol-label">${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `
    )
    .join("");
}

function renderSuiteCards() {
  const selected = activeSuite();
  const entries = benchmarkNavigationEntries();
  const selectedEntry = navigationEntryForSuite(selected?.suite_id);
  byId("suiteCards").innerHTML = entries
    .map((entry) => {
      const suite = entry.defaultSuite;
      const card = entry.record?.card || suite?.card || {};
      const status = navigationEntryStatus(entry);
      const evidence = navigationEntryEvidence(entry);
      const isSelected = entry.id === selectedEntry?.id;
      const targetSuiteId = isSelected ? selected.suite_id : suite?.suite_id;
      const isPending = entry.suites.some((candidate) => candidate.suite_id === pendingSuiteId);
      const protocolCount = entry.suites.filter((candidate) => candidate.protocol).length;
      return `
        <button class="suite-card suite-status-${escapeHtml(status)} ${isSelected ? "selected" : ""} ${isPending ? "pending" : ""} ${status === "view" ? "view-card" : ""}" type="button" data-suite-id="${escapeHtml(targetSuiteId)}" data-benchmark-group-id="${escapeHtml(entry.id)}" data-suite-status="${escapeHtml(status)}" aria-pressed="${isSelected}" aria-busy="${isPending}">
          <span class="suite-card-topline">
            <span class="suite-status">${escapeHtml(card.status_label || status)}</span>
            <span>${escapeHtml(`${evidence.mapped || 0} runs${protocolCount > 1 ? ` · ${protocolCount} protocols` : ""}`)}</span>
          </span>
          <strong>${escapeHtml(navigationEntryTitle(entry))}</strong>
          <span class="suite-metric">${escapeHtml(card.metric_label || primaryMetricName(suite))}</span>
          <span class="suite-headline">${escapeHtml(card.headline || suite?.notes || "Curated evidence will be attached later.")}</span>
        </button>
      `;
    })
    .join("");

  byId("suiteCards").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-pressed") === "true" && !pendingSuiteId) {
        button.focus({ preventScroll: true });
        return;
      }
      void requestSuiteChange(button.dataset.suiteId, {
        push: true,
        focusGroupId: button.dataset.benchmarkGroupId,
      });
    });
  });
}

function protocolEvidenceText(summary) {
  const coverage =
    summary.expected === null
      ? `${summary.mapped} mapped`
      : `${summary.mapped}/${summary.expected} mapped`;
  return {
    coverage,
    status: `${summary.complete} complete · ${summary.partial} partial`,
    caveat:
      summary.nonfinite || summary.unresolved
        ? `${summary.nonfinite} nonfinite · ${summary.unresolved} unresolved`
        : `${summary.drawable} drawable curves`,
  };
}

function renderProtocolSelector(suite) {
  const mount = byId("protocolSelector");
  if (!mount) return;
  const entry = navigationEntryForSuite(suite?.suite_id);
  const protocolSuites = sortedProtocolSuites(entry?.suites || []);

  if (!suite?.protocol || !entry || !protocolSuites.length) {
    if (!protocolSwitchError) {
      mount.hidden = true;
      mount.innerHTML = "";
      return;
    }
    mount.hidden = false;
    mount.innerHTML = `
      <div class="protocol-ledger-error" role="alert">
        <strong>Protocol unchanged.</strong>
        <span>${escapeHtml(protocolSwitchError)}</span>
      </div>
    `;
    return;
  }

  const currentSource = protocolSourceCoordinate(suite);
  const currentBatch = protocolBatchCoordinate(suite);
  const currentBudget = protocolBudgetCoordinate(suite);
  const sources = Array.from(
    new Map(
      protocolSuites.map((candidate) => {
        const coordinate = protocolSourceCoordinate(candidate);
        return [coordinate.key, coordinate];
      })
    ).values()
  );
  const sourceSuites = protocolSuites.filter(
    (candidate) => protocolSourceCoordinate(candidate).key === currentSource.key
  );
  const batches = Array.from(
    new Map(
      sourceSuites.map((candidate) => {
        const coordinate = protocolBatchCoordinate(candidate);
        return [coordinate.key, coordinate];
      })
    ).values()
  );
  const budgetSuites = sourceSuites.filter(
    (candidate) => protocolBatchCoordinate(candidate).key === currentBatch.key
  );
  const evidence = suiteEvidenceSummary(suite);
  const evidenceText = protocolEvidenceText(evidence);

  const sourceControl =
    sources.length > 1
      ? `<div class="protocol-choice-row" role="group" aria-label="Protocol source">
          ${sources
            .map((source) => {
              const target = chooseProtocolSuite(protocolSuites, {
                sourceKey: source.key,
                budgetKey: currentBudget.key,
              });
              const active = source.key === currentSource.key;
              const loading = target?.suite_id === pendingSuiteId;
              return `
                <button type="button" class="${active ? "active" : ""} ${loading ? "loading" : ""}" data-target-suite-id="${escapeHtml(target?.suite_id || "")}" aria-pressed="${active}" aria-busy="${loading}" ${target ? "" : "disabled"}>
                  ${escapeHtml(source.label)}
                </button>
              `;
            })
            .join("")}
        </div>`
      : `<span class="protocol-static-value">${escapeHtml(currentSource.label)}</span>`;

  const batchControl =
    batches.length > 1
      ? `<div class="protocol-choice-row" role="group" aria-label="Global batch and sequence length">
          ${batches
            .map((batch) => {
              const target = chooseProtocolSuite(protocolSuites, {
                sourceKey: currentSource.key,
                batchKey: batch.key,
                budgetKey: currentBudget.key,
              });
              const active = batch.key === currentBatch.key;
              const loading = target?.suite_id === pendingSuiteId;
              return `
                <button type="button" class="${active ? "active" : ""} ${loading ? "loading" : ""}" data-target-suite-id="${escapeHtml(target?.suite_id || "")}" aria-pressed="${active}" aria-busy="${loading}" ${target ? "" : "disabled"}>
                  ${escapeHtml(batch.label)}
                </button>
              `;
            })
            .join("")}
        </div>`
      : `<span class="protocol-static-value">${escapeHtml(currentBatch.label)}</span>`;

  const budgetControl = `
    <div class="protocol-budget-row" role="group" aria-label="Token budget">
      ${budgetSuites
        .map((candidate) => {
          const coordinate = protocolBudgetCoordinate(candidate);
          const selectable = protocolSelectable(candidate);
          const active = candidate.suite_id === suite.suite_id;
          const loading = candidate.suite_id === pendingSuiteId;
          const detail = [
            coordinate.steps === null ? "" : `${intFmt.format(coordinate.steps)} steps`,
            coordinate.plannedTokens === null ? "" : `${intFmt.format(coordinate.plannedTokens)} tokens`,
          ]
            .filter(Boolean)
            .join(" · ");
          return `
            <button
              type="button"
              class="protocol-budget-chip ${active ? "active" : ""} ${loading ? "loading" : ""}"
              data-target-suite-id="${escapeHtml(candidate.suite_id)}"
              aria-pressed="${active}"
              aria-busy="${loading}"
              title="${escapeHtml(detail || coordinate.label)}"
              ${selectable || active ? "" : "disabled"}
            >
              ${escapeHtml(coordinate.label)}
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  const tokensPerStep =
    currentBatch.tokensPerStep === null
      ? "Tokens per step not specified"
      : `${intFmt.format(currentBatch.tokensPerStep)} tokens / step`;
  const paper = suite.protocol.paper;
  const sourceNote = paper?.arxiv_id
    ? `${paper.arxiv_id}${paper.section ? ` · ${paper.section}` : ""}`
    : suite.protocol.source_kind === "current_curated"
      ? "Local curated benchmark"
      : "Curated static source";

  mount.hidden = false;
  mount.dataset.loading = pendingSuiteId ? "true" : "false";
  mount.innerHTML = `
    <div class="protocol-ledger-head">
      <div>
        <p class="panel-kicker">Comparable experiment coordinate</p>
        <h3 id="protocol-selector-title">Protocol selector</h3>
      </div>
      <p>${escapeHtml(sourceNote)}</p>
    </div>
    <div class="protocol-ledger-grid">
      <div class="protocol-ledger-cell protocol-source-cell">
        <span class="protocol-ledger-label">Source / dataset</span>
        ${sourceControl}
        <small>${escapeHtml(currentSource.dataset)}</small>
      </div>
      <div class="protocol-ledger-cell protocol-batch-cell">
        <span class="protocol-ledger-label">Batch × sequence</span>
        ${batchControl}
        <small>${escapeHtml(tokensPerStep)}</small>
      </div>
      <div class="protocol-ledger-cell protocol-budget-cell">
        <span class="protocol-ledger-label">Token budget</span>
        ${budgetControl}
        <small>Each budget is an isolated leaderboard and figure.</small>
      </div>
      <div class="protocol-ledger-cell protocol-evidence-cell" aria-live="polite">
        <span class="protocol-ledger-label">Evidence</span>
        <strong>${escapeHtml(evidenceText.coverage)}</strong>
        <small>${escapeHtml(evidenceText.status)}</small>
        <small>${escapeHtml(evidenceText.caveat)}</small>
      </div>
    </div>
    <div class="protocol-ledger-error" role="alert" ${protocolSwitchError ? "" : "hidden"}>
      <strong>Protocol unchanged.</strong>
      <span>${escapeHtml(protocolSwitchError)}</span>
    </div>
  `;

  mount.querySelectorAll("button[data-target-suite-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetSuiteId = button.dataset.targetSuiteId;
      if (!targetSuiteId) {
        button.focus({ preventScroll: true });
        return;
      }
      if (targetSuiteId === selectedSuiteId && !pendingSuiteId) {
        button.focus({ preventScroll: true });
        return;
      }
      void requestSuiteChange(targetSuiteId, {
        push: true,
        focusProtocolSuiteId: targetSuiteId,
      });
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
    <p>${escapeHtml(suite.card?.headline || "No complete comparable runs have been curated yet.")}</p>
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
            <button class="selected-run-pill ${run.run_id === selectedRunId ? "active" : ""}" type="button" data-run-id="${escapeHtml(run.run_id)}" aria-pressed="${run.run_id === selectedRunId}">
              <span class="legend-swatch" style="background:${runColor(run, index)}"></span>
              ${escapeHtml(runChipLabel(run, suite))}
            </button>
            <button class="remove-run" type="button" data-remove-run-id="${escapeHtml(run.run_id)}" aria-label="Remove ${escapeHtml(run.display_name)} from chart">×</button>
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
      <input type="checkbox" data-run-id="${escapeHtml(run.run_id)}" aria-label="${escapeHtml(`${checked ? "Remove" : "Plot"} ${run.display_name}${disabled ? ", curve unavailable" : ""}`)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
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

function metricValueWithOptionalStep(metricName, metric) {
  if (!metric) return "n/a";
  const value = formatMetricValue(metricName, metric.value);
  return Number.isFinite(metric.step) ? `${value} @ ${intFmt.format(metric.step)}` : value;
}

function tableColumnsForRows(suite, rows) {
  const isTrack3 = suite.suite_id === "track3";
  const allowedStatuses = new Set(suite.leaderboard_eligibility?.allowed_status || []);
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
  if (
    statuses.length > 1 ||
    rows.some((row) => !allowedStatuses.has(row.run.status))
  ) {
    columns.push("status");
  }
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
  const primaryText = row.primaryMetric
    ? formatMetricValue(primary, row.primaryMetric.value)
    : targetStatus(row, suite) === "not_reached"
      ? "Not reached"
      : "n/a";
  const bestText = metricValueWithOptionalStep("best_val_loss", row.bestMetric);
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
      <table aria-label="${escapeHtml(`${suite.title} run results`)}">
        <thead>
          <tr>
            ${columns.map((column) => `<th scope="col">${escapeHtml(tableHeader(column, suite))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row, index) => {
              const run = row.run;
              const rankLabel = run.leaderboard_meta?.rank_label || row.displayRank || String(startingRank + index);
              return `
                <tr class="${run.run_id === selectedRunId ? "selected" : ""}" data-run-id="${escapeHtml(run.run_id)}" tabindex="0" aria-selected="${run.run_id === selectedRunId}" aria-label="Inspect ${escapeHtml(run.display_name)}">
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
      <span class="filter-summary" aria-live="polite">Showing ${visibleCount}/${rows.length}${activeFilterCount() ? ` · ${activeFilterCount()} active` : ""}</span>
      <button type="button" id="clearRunFilters">Reset filters</button>
    </div>
  `;
}

function bindRowInteractions(root) {
  root.querySelectorAll("tr[data-run-id], .selected-run-pill").forEach((target) => {
    target.addEventListener("click", (event) => {
      if (
        target.matches("tr") &&
        event.target !== target &&
        event.target?.closest?.("a, button, input, select, textarea, label")
      ) return;
      selectRun(target.dataset.runId);
    });
    if (target.matches("tr")) {
      target.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (
          event.target !== target &&
          event.target?.closest?.("a, button, input, select, textarea, label")
        ) return;
        event.preventDefault();
        selectRun(target.dataset.runId);
      });
    }
  });

  root.querySelectorAll(".plot-toggle input").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (![" ", "Space", "Spacebar"].includes(event.key)) return;
      event.preventDefault();
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    input.addEventListener("change", () => {
      toggleChartRun(input.dataset.runId, input.checked);
      refreshRunViews();
    });
  });

  root.querySelectorAll("[data-remove-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleChartRun(button.dataset.removeRunId, false);
      refreshRunViews();
    });
  });
}

function bindLeaderboardInteractions() {
  const content = byId("leaderboardContent");
  bindRowInteractions(content);

  content.querySelectorAll("[data-chart-action]").forEach((button) => {
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
      refreshRunViews();
    });
  });

  const search = byId("runSearch");
  if (search) {
    search.addEventListener("input", () => {
      runFilterText = search.value;
      const focusState = {
        id: "runSearch",
        selectionStart: search.selectionStart,
        selectionEnd: search.selectionEnd,
      };
      clearTimeout(runSearchTimer);
      runSearchTimer = setTimeout(() => {
        refreshRunViews({ focusState, includeDetail: false });
      }, SEARCH_DEBOUNCE_MS);
    });
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      clearTimeout(runSearchTimer);
      refreshRunViews();
    });
  }

  const role = byId("roleFilter");
  if (role) {
    role.addEventListener("change", () => {
      runFilterRole = role.value;
      refreshRunViews({ includeDetail: false });
    });
  }

  const family = byId("familyFilter");
  if (family) {
    family.addEventListener("change", () => {
      runFilterFamily = family.value;
      refreshRunViews({ includeDetail: false });
    });
  }

  const status = byId("statusFilter");
  if (status) {
    status.addEventListener("change", () => {
      runFilterStatus = status.value;
      refreshRunViews({ includeDetail: false });
    });
  }

  const target = byId("targetFilter");
  if (target) {
    target.addEventListener("change", () => {
      runFilterTarget = target.value;
      refreshRunViews({ includeDetail: false });
    });
  }

  const curve = byId("curveFilter");
  if (curve) {
    curve.addEventListener("change", () => {
      runFilterCurve = curve.value;
      refreshRunViews({ includeDetail: false });
    });
  }

  const clearFilters = byId("clearRunFilters");
  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      resetRunFilters();
      refreshRunViews({ includeDetail: false });
    });
  }
}

function renderLeaderboard() {
  const suite = activeSuite();
  const rows = eligibleRows(suite).map((row, index) => ({
    ...row,
    displayRank: row.primaryMetric ? String(index + 1) : "—",
  }));
  const unranked = unrankedRows(suite);
  const filterableRows = [...rows, ...unranked];
  const visibleRows = filteredRows(rows, suite);
  const visibleUnranked = filteredRows(unranked, suite);
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
    ${renderRunFilters(
      filterableRows,
      suite,
      visibleRows.length + visibleUnranked.length
    )}
  `;
  const unrankedBlock = unranked.length
    ? `
      <details class="history-details unranked-evidence section-callout">
        <summary>
          <span>Unranked evidence (${visibleUnranked.length}/${unranked.length})</span>
          <span class="muted">partial, stopped, or non-finite · excluded from rank</span>
        </summary>
        ${
          visibleUnranked.length
            ? leaderboardTable(
                suite,
                visibleUnranked,
                1,
                "compact-table scroll-table unranked-table"
              )
            : "<p class=\"empty-table-note\">No unranked evidence matches the current filters.</p>"
        }
      </details>
    `
    : "";

  if (hasReferenceAndLocal) {
    const isOpen = Boolean(referenceHistoryOpen[suite.suite_id]);
    const open = isOpen ? "open" : "";
    const referenceLabel = suite.suite_id === "track3" ? "Official Track 3 history" : "Reference history";
    const localLabel = suite.suite_id === "track3" ? "Our representative runs" : "Local or comparison runs";
    byId("leaderboardContent").innerHTML = `
      ${selectionBlock}
      <details class="history-details section-callout ${suite.suite_id === "track3" ? "track3-history-callout" : ""}" ${open}>
        <summary>
          <span>${escapeHtml(referenceLabel)} (${referenceRows.length})</span>
          <span class="muted">${suite.suite_id === "track3" ? "click to expand · sorted by steps" : "curated source-backed rows"}</span>
        </summary>
        <div class="history-table-slot" data-mounted="${isOpen}">
          ${isOpen
            ? referenceRows.length
              ? leaderboardTable(suite, referenceRows, 1, "compact-table scroll-table")
              : "<p class=\"empty-table-note\">No reference rows match the current filters.</p>"
            : ""}
        </div>
      </details>
      <div class="local-runs-block section-callout">
        <div class="mini-heading">
          <strong>${escapeHtml(localLabel)}</strong>
          <span>${localRows.length} rows</span>
        </div>
        ${localRows.length ? leaderboardTable(suite, localRows, 1, "compact-table scroll-table") : "<p class=\"empty-table-note\">No local rows match the current filters.</p>"}
      </div>
      ${unrankedBlock}
    `;
    const details = byId("leaderboardContent").querySelector(".history-details");
    if (details) {
      details.addEventListener("toggle", () => {
        referenceHistoryOpen[suite.suite_id] = details.open;
        const slot = details.querySelector(".history-table-slot");
        if (!slot) return;
        if (!details.open) {
          slot.replaceChildren();
          slot.dataset.mounted = "false";
          return;
        }
        if (slot.dataset.mounted === "true") return;
        slot.innerHTML = referenceRows.length
          ? leaderboardTable(suite, referenceRows, 1, "compact-table scroll-table")
          : "<p class=\"empty-table-note\">No reference rows match the current filters.</p>";
        slot.dataset.mounted = "true";
        bindRowInteractions(slot);
      });
    }
    bindLeaderboardInteractions();
    return;
  }

  byId("leaderboardContent").innerHTML = `
    ${selectionBlock}
    <details class="history-details optimizer-details section-callout" open>
      <summary>
        <span>Optimizer runs (${visibleRows.length}/${rows.length})</span>
        <span class="muted">ranked by ${escapeHtml(primaryMetricName(suite))}</span>
      </summary>
      ${visibleRows.length ? leaderboardTable(suite, visibleRows, 1, "compact-table scroll-table") : "<p class=\"empty-table-note\">No rows match the current filters.</p>"}
    </details>
    ${unrankedBlock}
  `;
  bindLeaderboardInteractions();
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function shortRunLabel(run) {
  const rank = run.leaderboard_meta?.official_rank;
  if (Number.isInteger(rank)) return `R${String(rank).padStart(2, "0")}`;
  const labels = {
    "ours-track3-rtx5090-gated-softmuoneq": "Gated",
    "ours-track3-rtx5090-muoneq-colrow": "Row+Col",
    "ours-track3-rtx5090-muoneq-row": "Row",
    "ours-track3-rtx5090-softeq-k1000": "K=1000",
    "ours-track3-rtx5090-softeq-k2000": "K=2000",
  };
  return labels[run.run_id] || run.leaderboard_meta?.rank_label || run.display_name.split(/\s+/).slice(0, 2).join(" ");
}

function renderChartModeSwitch() {
  const modeSwitch = byId("chartModeSwitch");
  const tailDomain = tailStepDomain(activeSuite());
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
    ${tailDomain ? `
      <button type="button" class="${chartScaleMode === "tail" ? "active" : ""}" data-scale-mode="tail" aria-pressed="${chartScaleMode === "tail"}">
        <span class="mode-icon">${escapeHtml(tailDomain.min)}</span>
        <span>Tail</span>
      </button>
    ` : ""}
  `;
  modeSwitch.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const focusState = captureFocusState();
      chartScaleMode = button.dataset.scaleMode;
      renderChart();
      restoreFocusState(focusState);
      syncUrlState();
    });
  });
}

function renderChartEmphasisSwitch() {
  const emphasisSwitch = byId("chartEmphasisSwitch");
  const focusedRunId = chartFocusRunId();
  emphasisSwitch.innerHTML = `
    <span class="chart-mode-label">Emphasis</span>
    <button
      type="button"
      class="${focusedRunId ? "" : "active"}"
      data-chart-focus-action="clear"
      aria-pressed="${!focusedRunId}"
      title="Give every visible curve equal visual weight"
    >
      <span>All</span>
    </button>
  `;
  emphasisSwitch.querySelector("[data-chart-focus-action=\"clear\"]")?.addEventListener("click", () => {
    if (!focusedChartRunId) return;
    const focusState = captureFocusState();
    clearChartFocus();
    restoreFocusState(focusState);
  });
}

function renderTargetMarkerStrip(suite, runs, metricName, model = currentChartModel) {
  const strip = byId("targetStepStrip");
  const ruler = model?.evidenceRuler;
  const focusedRunId = chartFocusRunId();
  if (!ruler?.items?.length) {
    strip.hidden = true;
    strip.classList.remove("target-ranking-panel");
    strip.classList.remove("evidence-ruler");
    strip.setAttribute("aria-label", "Selected run evidence ruler");
    strip.innerHTML = "";
    return;
  }

  strip.hidden = false;
  strip.classList.add("target-ranking-panel", "evidence-ruler");
  strip.setAttribute("aria-label", `Selected run ${metricAriaLabel(ruler.metricName)} evidence ruler`);
  const [domainMin, domainMax] = ruler.domain;
  const span = Math.max(domainMax - domainMin, Number.EPSILON);
  const directionText = ruler.direction === "lower" ? "lower is better" : "higher is better";
  strip.innerHTML = `
    <div class="evidence-ruler-head">
      <span>${escapeHtml(ruler.label)}</span>
      <small>${escapeHtml(directionText)} · formal summary metric</small>
    </div>
    <div class="evidence-ruler-scale" aria-hidden="true">
      <span>${escapeHtml(formatMetricValue(ruler.metricName, domainMin))}</span>
      <span>${escapeHtml(formatMetricValue(ruler.metricName, domainMax))}</span>
    </div>
    <div class="evidence-ruler-rows">
      ${ruler.items
        .map((item) => {
          const run = runById(item.runId);
          const position = item.value === null
            ? null
            : Math.max(0, Math.min(100, ((item.value - domainMin) / span) * 100));
          return `
            <button
              type="button"
              class="evidence-ruler-row ${item.runId === focusedRunId ? "active" : ""}"
              data-run-id="${escapeHtml(item.runId)}"
              aria-pressed="${item.runId === focusedRunId}"
              aria-current="${item.runId === focusedRunId}"
            >
              ${seriesKeyHtml(
                {
                  color: item.color,
                  marker: item.marker,
                },
                item.role
              )}
              <strong>${escapeHtml(shortRunLabel(run || { display_name: item.label }))}</strong>
              <span class="evidence-ruler-track">
                ${
                  position === null
                    ? `<span class="evidence-ruler-not-reached">Not reached</span>`
                    : `<span class="evidence-ruler-marker" style="left:${position}%; color:${escapeHtml(item.color)}" aria-hidden="true"></span>`
                }
              </span>
              <span>${escapeHtml(item.value === null ? "Not reached" : formatMetricValue(ruler.metricName, item.value))}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  strip.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectRun(button.dataset.runId, { focusChart: true });
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
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function chartSelectionHash(runIds) {
  let hash = 2166136261;
  for (const character of [...runIds].sort().join("|")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

function buildPublicationFigureModel() {
  return buildCurrentFigureModel({
    profile: "presentation",
    width: 1200,
    height: 900,
  });
}

function chartExportFilename(model, extension) {
  const date = safeFilename(model?.snapshot?.generatedAt || "snapshot");
  const count = model?.selection?.visibleRunIds?.length || 0;
  const hash = chartSelectionHash(model?.selection?.visibleRunIds || []);
  return [
    safeFilename(model?.figure?.id || activeSuite()?.suite_id),
    safeFilename(model?.request?.scaleMode || chartScaleMode),
    model?.selection?.focusRunId ? "selected-focus" : "equal-emphasis",
    `runs${count}`,
    hash,
    date,
  ].filter(Boolean).join("-") + `.${extension}`;
}

function chartSvgXml(model = buildPublicationFigureModel()) {
  if (!model) throw new Error("No chart model is available for export.");
  return globalThis.PortalFigureRuntime.serializeStandaloneSvg(model, model.profile);
}

function exportCurrentChartCsv() {
  const model = buildPublicationFigureModel();
  if (!model) return;
  const csv = globalThis.PortalFigureRuntime.serializeFigureCsv(model);
  downloadText(chartExportFilename(model, "csv"), csv, "text/csv;charset=utf-8");
}

function exportCurrentChartSvg() {
  const model = buildPublicationFigureModel();
  if (!model) return;
  downloadText(
    chartExportFilename(model, "svg"),
    chartSvgXml(model),
    "image/svg+xml;charset=utf-8"
  );
}

function exportCurrentChartPng() {
  const model = buildPublicationFigureModel();
  if (!model) return;
  const xml = chartSvgXml(model);
  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(chartExportFilename(model, "png"), blob);
    }, "image/png");
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

function bindChartExportControls() {
  const pngButton = byId("downloadPng");
  const svgButton = byId("downloadSvg");
  const csvButton = byId("downloadCsv");
  if (pngButton) pngButton.onclick = exportCurrentChartPng;
  if (svgButton) svgButton.onclick = exportCurrentChartSvg;
  if (csvButton) csvButton.onclick = exportCurrentChartCsv;
}

function mapFigureValue(value, scale) {
  const [domainMin, domainMax] = scale.domain;
  const [rangeMin, rangeMax] = scale.range;
  const span = domainMax - domainMin;
  if (!Number.isFinite(value) || !Number.isFinite(span) || span === 0) {
    return (rangeMin + rangeMax) / 2;
  }
  return rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

function interactivePathData(model, segments) {
  return segments
    .map((segment) =>
      segment
        .map((point, index) => {
          const x = mapFigureValue(point.step, model.geometry.xScale);
          const y = mapFigureValue(point.value, model.geometry.yScale);
          return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ")
    )
    .join(" ");
}

function compactTooltipText(value, maximum = 42) {
  const text = String(value || "");
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function closestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared
    ? ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
    : 0;
  const t = Math.max(0, Math.min(1, projection));
  return {
    x: start.x + dx * t,
    y: start.y + dy * t,
    t,
  };
}

function nearestCurveObservation(
  seriesList,
  pointer,
  { maxDistance = 24, preferredRunId = null } = {}
) {
  let best = null;
  const tieTolerance = 0.25;

  seriesList.forEach((series) => {
    (series.segments || []).forEach((segment) => {
      if (!segment.length) return;
      let startIndex = 0;
      if (segment.length > 1) {
        let low = 1;
        let high = segment.length - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (segment[middle].x < pointer.x) low = middle + 1;
          else high = middle;
        }
        startIndex = Math.max(0, Math.min(segment.length - 2, low - 1));
      }

      const start = segment[startIndex];
      const end = segment[Math.min(startIndex + 1, segment.length - 1)];
      const curvePoint = closestPointOnSegment(pointer, start, end);
      const distance = Math.hypot(pointer.x - curvePoint.x, pointer.y - curvePoint.y);
      const observation =
        Math.hypot(start.x - curvePoint.x, start.y - curvePoint.y) <=
        Math.hypot(end.x - curvePoint.x, end.y - curvePoint.y)
          ? start
          : end;
      const candidate = {
        ...series,
        ...observation,
        curveX: curvePoint.x,
        curveY: curvePoint.y,
        distance,
      };
      const candidatePreferred = series.entry?.runId === preferredRunId;
      const bestPreferred = best?.entry?.runId === preferredRunId;
      if (
        !best ||
        distance < best.distance - tieTolerance ||
        (Math.abs(distance - best.distance) <= tieTolerance &&
          candidatePreferred &&
          !bestPreferred)
      ) {
        best = candidate;
      }
    });
  });

  return best && best.distance <= maxDistance ? best : null;
}

function renderChart() {
  const svg = byId("lossChart");
  svg.innerHTML = "";
  byId("chartLegend").innerHTML = "";

  const suite = activeSuite();
  normalizeChartScaleMode(suite);
  const yMetric = curveMetricName(suite);
  const markerMetric = targetMarkerMetric(suite);
  renderChartModeSwitch();
  renderChartEmphasisSwitch();
  bindChartExportControls();
  const width = Math.max(280, Math.round(svg.clientWidth || 740));
  const height = Math.max(280, Math.round(svg.clientHeight || 420));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  currentChartModel = buildCurrentFigureModel({
    profile: "interactive",
    width,
    height,
  });

  const model = currentChartModel;
  const hiddenRuns = hiddenPlottedRuns(suite);
  const runs = (model?.series || []).map((entry) => runById(entry.runId)).filter(Boolean);
  const seriesByRun = new Map((model?.series || []).map((entry) => [entry.runId, entry]));
  const focusedRunId = chartFocusRunId();

  byId("chartMeta").textContent = model
    ? `${model.axes.y.label} by ${model.axes.x.label}${model.target ? ` · ${model.target.label}` : ""}`
    : `${yMetric} by step`;

  byId("chartSelectionChips").innerHTML = runs.length
    ? [
        ...runs
        .map(
          (run) => {
            const entry = seriesByRun.get(run.run_id);
            return `
            <button
              type="button"
              class="${run.run_id === focusedRunId ? "active" : ""}"
              data-run-id="${escapeHtml(run.run_id)}"
              data-series-family="${escapeHtml(entry?.style?.family || "other")}"
              data-series-method-group="${escapeHtml(entry?.methodGroup || "unknown")}"
              aria-pressed="${run.run_id === focusedRunId}"
            >
              ${seriesKeyHtml(entry?.style, entry?.role)}
              ${escapeHtml(`${shortRunLabel(run)} · ${summaryMetricText(run.run_id, primaryMetricName(suite))}`)}
            </button>
          `;
          }
        ),
        hiddenFilterChip(hiddenRuns),
      ].join("")
    : hiddenRuns.length
      ? hiddenFilterChip(hiddenRuns)
      : "<span class=\"muted\">No selected runs have drawable curves.</span>";
  byId("chartSelectionChips").querySelectorAll("button[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectRun(button.dataset.runId, { focusChart: true });
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
      refreshRunViews({ includeDetail: false });
    });
  });

  renderTargetMarkerStrip(suite, runs, markerMetric, model);

  if (!model?.series?.length || !model.stats.points) {
    byId("chartToolbarMeta").textContent = `${runs.length}/${chartSelectionLimit(suite)} visible · ${hiddenRuns.length} hidden by filters`;
    const empty = svgEl("text", { x: 24, y: 48, class: "chart-label" });
    empty.textContent = "Select a run with an available curve.";
    svg.appendChild(empty);
    return;
  }

  byId("chartToolbarMeta").textContent = [
    `${model.stats.visibleRuns}/${chartSelectionLimit(suite)} visible`,
    hiddenRuns.length ? `${hiddenRuns.length} hidden by filters` : "",
    chartScaleMode === "full" ? "Full data range" : "",
    model.clipping.note,
    ...model.warnings,
  ].filter(Boolean).join(" · ");
  svg.setAttribute(
    "aria-label",
    `${model.figure.title}. ${model.figure.subtitle}${model.clipping.note ? `. ${model.clipping.note}` : ""}${model.warnings.length ? `. ${model.warnings.join(". ")}` : ""}`
  );
  const chartTitle = svgEl("title");
  chartTitle.textContent = model.figure.title;
  const chartDescription = svgEl("desc");
  chartDescription.textContent =
    `${model.figure.subtitle}${model.clipping.note ? `. ${model.clipping.note}` : ""}${model.warnings.length ? `. ${model.warnings.join(". ")}` : ""}`;
  svg.append(chartTitle, chartDescription);

  const plot = model.plotRect;
  const x = (step) => mapFigureValue(step, model.geometry.xScale);
  const y = (value) => mapFigureValue(value, model.geometry.yScale);
  const clipId = `chart-clip-${model.figure.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const defs = svgEl("defs");
  const clipPath = svgEl("clipPath", { id: clipId });
  clipPath.appendChild(svgEl("rect", {
    x: plot.left,
    y: plot.top,
    width: plot.width,
    height: plot.height,
  }));
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  model.axes.y.ticks
    .filter((tick) => tick >= model.domain.yMin && tick <= model.domain.yMax)
    .forEach((tick) => {
      const tickY = y(tick);
      svg.appendChild(svgEl("line", {
        x1: plot.left,
        x2: plot.right,
        y1: tickY,
        y2: tickY,
        class: "gridline chart-gridline",
      }));
      const label = svgEl("text", {
        x: plot.left - 9,
        y: tickY + 3.5,
        class: "chart-label chart-tick-label",
        "text-anchor": "end",
      });
      label.textContent = formatMetricValue(yMetric, tick);
      svg.appendChild(label);
    });

  const xTicks = model.axes.x.ticks
    .filter((tick) => tick >= model.domain.xMin && tick <= model.domain.xMax);
  xTicks.forEach((tick, index) => {
      const tickX = x(tick);
      svg.appendChild(svgEl("line", {
        x1: tickX,
        x2: tickX,
        y1: plot.top,
        y2: plot.bottom,
        class: "gridline chart-gridline",
        opacity: "0.55",
      }));
      const label = svgEl("text", {
        x: tickX,
        y: plot.bottom + 20,
        class: "chart-label chart-tick-label",
        "text-anchor": index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle",
      });
      label.textContent = intFmt.format(tick);
      svg.appendChild(label);
  });

  svg.appendChild(svgEl("line", {
    x1: plot.left,
    x2: plot.left,
    y1: plot.top,
    y2: plot.bottom,
    class: "axis chart-axis",
  }));
  svg.appendChild(svgEl("line", {
    x1: plot.left,
    x2: plot.right,
    y1: plot.bottom,
    y2: plot.bottom,
    class: "axis chart-axis",
  }));
  const xTitle = svgEl("text", {
    x: (plot.left + plot.right) / 2,
    y: plot.bottom + 43,
    class: "chart-axis-title",
    "text-anchor": "middle",
  });
  xTitle.textContent = model.axes.x.label;
  svg.appendChild(xTitle);
  const yTitle = svgEl("text", {
    transform: `translate(${plot.left - 43} ${(plot.top + plot.bottom) / 2}) rotate(-90)`,
    class: "chart-axis-title",
    "text-anchor": "middle",
  });
  yTitle.textContent = model.axes.y.label;
  svg.appendChild(yTitle);

  if (
    model.target &&
    model.target.value >= model.domain.yMin &&
    model.target.value <= model.domain.yMax
  ) {
    const targetY = y(model.target.value);
    svg.appendChild(svgEl("line", {
      x1: plot.left,
      x2: plot.right,
      y1: targetY,
      y2: targetY,
      class: "target-line chart-target",
    }));
    const targetLabel = svgEl("text", {
      x: plot.right - 5,
      y: targetY - 7,
      class: "chart-target-label target-line-label",
      "text-anchor": "end",
    });
    targetLabel.textContent = model.target.label;
    svg.appendChild(targetLabel);
  }

  if (model.clipping.note) {
    const note = svgEl("text", {
      x: plot.right,
      y: Math.max(12, plot.top - 9),
      class: "chart-clip-note",
      "text-anchor": "end",
    });
    note.textContent = model.clipping.note;
    svg.appendChild(note);
  }

  const curveLayer = svgEl("g", {
    "clip-path": `url(#${clipId})`,
    "data-curve-layer": "series",
  });
  svg.appendChild(curveLayer);
  const hoverSeries = [];

  [...model.series]
    .sort((left, right) => Number(left.focused) - Number(right.focused))
    .forEach((entry) => {
    const run = runById(entry.runId);
    if (!run || !entry.segments.length) return;
    const defaultOpacity = String(entry.style.contextOpacity ?? 0.52);
    const neutralOpacity = String(entry.style.neutralOpacity ?? 1);
    const defaultStrokeWidth = String(entry.style.contextStrokeWidth || 2.1);
    const selectedStrokeWidth = String(entry.style.focusStrokeWidth || 2.9);
    const selected = entry.focused;
    const path = svgEl("path", {
      d: interactivePathData(model, entry.segments),
      class: [
        "curve",
        "series-path",
        ...entry.style.classes,
        entry.role === "ours" ? "ours" : "",
        entry.status !== "completed" ? "partial" : "",
        selected ? "is-selected selected" : focusedRunId ? "is-context" : "",
      ].filter(Boolean).join(" "),
      stroke: entry.style.color,
      opacity: selected ? "1" : focusedRunId ? defaultOpacity : neutralOpacity,
      "stroke-width": selected ? selectedStrokeWidth : defaultStrokeWidth,
      "stroke-dasharray": entry.style.dash || "none",
      "data-series-role": entry.role,
      "data-series-family": entry.style.family,
      "data-series-method-group": entry.methodGroup,
      "data-chart-run-id": entry.runId,
      "data-context-opacity": defaultOpacity,
      "data-neutral-opacity": neutralOpacity,
      "data-focus-opacity": "1",
      "data-base-stroke-width": defaultStrokeWidth,
      "data-focus-stroke-width": selectedStrokeWidth,
      tabindex: "0",
      role: "button",
      "aria-label": `Inspect ${run.display_name}`,
      "aria-current": String(selected),
    });
    path.addEventListener("click", () => {
      selectRun(entry.runId, { focusChart: true });
    });
    path.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectRun(entry.runId, { focusChart: true });
    });
    curveLayer.appendChild(path);

    const visibleSegments = entry.segments
      .map((segment) =>
        segment
          .map((point) => ({
            step: point.step,
            value: point.value,
            x: x(point.step),
            y: y(point.value),
          }))
      )
      .filter((segment) => segment.length);
    if (visibleSegments.length) {
      hoverSeries.push({
        entry,
        run,
        color: entry.style.color,
        segments: visibleSegments,
      });
    }
    });

  model.directLabels.forEach((label) => {
    const entry = seriesByRun.get(label.runId);
    if (!entry) return;
    const selected = entry.focused;
    const connector = svgEl("line", {
      x1: label.connector.x1,
      y1: label.connector.y1,
      x2: label.connector.x2,
      y2: label.connector.y2,
      class: `series-end-connector ${selected ? "is-selected selected" : ""}`,
      color: entry.style.color,
      opacity: selected ? "0.82" : focusedRunId ? "0.42" : "0.7",
      "data-chart-run-id": entry.runId,
      "data-context-opacity": "0.42",
      "data-neutral-opacity": "0.7",
      "data-focus-opacity": "0.82",
      "aria-current": String(selected),
    });
    svg.appendChild(connector);
    const text = svgEl("text", {
      x: label.x,
      y: label.y,
      "text-anchor": label.textAnchor || "start",
      class: `series-end-label ${selected ? "is-selected selected" : ""}`,
      fill: entry.style.color,
      opacity: selected ? "1" : focusedRunId ? "0.76" : "0.9",
      "data-chart-run-id": entry.runId,
      "data-context-opacity": "0.76",
      "data-neutral-opacity": "0.9",
      "data-focus-opacity": "1",
      "aria-current": String(selected),
    });
    text.textContent = label.text;
    text.addEventListener("click", () => selectRun(entry.runId, { focusChart: true }));
    svg.appendChild(text);
  });

  model.clipping.runIds.forEach((runId, index) => {
    const entry = seriesByRun.get(runId);
    if (!entry) return;
    const markerX = plot.left + 10 + index * 14;
    const selected = entry.focused;
    svg.appendChild(svgEl("path", {
      d: `M ${markerX} ${plot.top + 3} l 5 -7 l 5 7 Z`,
      class: `chart-clip-marker ${selected ? "is-selected selected" : ""}`,
      fill: entry.style.color,
      opacity: selected ? "1" : focusedRunId ? "0.58" : "0.82",
      "data-chart-run-id": entry.runId,
      "data-context-opacity": "0.58",
      "data-neutral-opacity": "0.82",
      "data-focus-opacity": "1",
      "aria-current": String(selected),
    }));
  });

  if (hoverSeries.length) {
    const hoverLayer = svgEl("g", { class: "chart-hover", style: "display:none" });
    const crosshair = svgEl("line", {
      y1: plot.top,
      y2: plot.bottom,
      class: "chart-crosshair",
    });
    const focus = svgEl("circle", { r: 5, class: "chart-focus" });
    const tooltipWidth = Math.min(286, Math.max(188, plot.width - 20));
    const tooltipHeight = model.target ? 98 : 84;
    const tooltip = svgEl("g", { class: "chart-tooltip" });
    const tooltipRect = svgEl("rect", {
      rx: 7,
      ry: 7,
      width: tooltipWidth,
      height: tooltipHeight,
    });
    const tooltipTitle = svgEl("text", { x: 11, y: 20, class: "chart-tooltip-title" });
    const tooltipSource = svgEl("text", { x: 11, y: 39, class: "chart-tooltip-text" });
    const tooltipValue = svgEl("text", { x: 11, y: 59, class: "chart-tooltip-value" });
    const tooltipContext = svgEl("text", {
      x: 11,
      y: model.target ? 79 : 76,
      class: model.target ? "chart-tooltip-target-gap" : "chart-tooltip-text",
    });
    tooltip.append(tooltipRect, tooltipTitle, tooltipSource, tooltipValue, tooltipContext);
    hoverLayer.append(crosshair, focus, tooltip);
    svg.appendChild(hoverLayer);

    const overlay = svgEl("rect", {
      x: plot.left,
      y: plot.top,
      width: plot.width,
      height: plot.height,
      class: "chart-hover-capture",
    });

    const nearestPoint = (event) => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse());
      return nearestCurveObservation(hoverSeries, local, {
        maxDistance: event.pointerType === "touch" ? 34 : 24,
        preferredRunId: chartFocusRunId(),
      });
    };

    const showNearest = (event) => {
      const nearest = nearestPoint(event);
      if (!nearest) {
        hoverLayer.setAttribute("style", "display:none");
        delete overlay.dataset.nearestRunId;
        return null;
      }
      hoverLayer.setAttribute("style", "display:block");
      crosshair.setAttribute("x1", nearest.x);
      crosshair.setAttribute("x2", nearest.x);
      focus.setAttribute("cx", nearest.x);
      focus.setAttribute("cy", nearest.y);
      focus.setAttribute("fill", nearest.color);
      const rank = nearest.run.leaderboard_meta?.rank_label || roleLabel(nearest.run);
      tooltipTitle.textContent = compactTooltipText(`${rank} ${nearest.run.display_name}`, width < 720 ? 32 : 44);
      tooltipSource.textContent = compactTooltipText(
        `Nearest curve · ${roleFilterLabel(suite)} ${roleLabel(nearest.run)} · ${nearest.run.status}`,
        width < 720 ? 35 : 48
      );
      tooltipValue.textContent =
        `observed step ${intFmt.format(nearest.step)} · ${yMetric} ${formatMetricValue(yMetric, nearest.value)}`;
      tooltipContext.textContent = model.target
        ? `target gap ${nearest.value - model.target.value >= 0 ? "+" : ""}${formatMetricValue(yMetric, nearest.value - model.target.value)}`
        : compactTooltipText(`run_id ${nearest.run.run_id}`, width < 720 ? 35 : 48);
      const preferredX = nearest.x + 14 + tooltipWidth <= width - 6
        ? nearest.x + 14
        : nearest.x - tooltipWidth - 14;
      const tooltipX = Math.min(Math.max(preferredX, 4), width - tooltipWidth - 4);
      const tooltipY = Math.min(
        Math.max(nearest.y - tooltipHeight / 2, plot.top + 4),
        plot.bottom - tooltipHeight - 4
      );
      tooltip.setAttribute("transform", `translate(${tooltipX}, ${tooltipY})`);
      overlay.dataset.nearestRunId = nearest.entry.runId;
      return nearest;
    };

    overlay.addEventListener("pointermove", showNearest);
    overlay.addEventListener("pointerdown", (event) => {
      const nearest = showNearest(event);
      overlay.dataset.pointerDownRunId = nearest?.entry?.runId || "";
    });
    overlay.addEventListener("click", (event) => {
      const nearest = showNearest(event);
      const runId = nearest?.entry?.runId || overlay.dataset.nearestRunId;
      if (runId) selectRun(runId, { focusChart: true });
    });
    overlay.addEventListener("pointerleave", () => {
      hoverLayer.setAttribute("style", "display:none");
      overlay.dataset.pointerDownRunId = "";
      delete overlay.dataset.nearestRunId;
    });
    svg.appendChild(overlay);
  }
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
  const run = runById(selectedRunId) || rows[0]?.run || suiteRuns(suite.suite_id)[0];

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
  const wandbUrl = safeExternalUrl(source.wandb_url);
  const meta = run.leaderboard_meta || {};
  const primary = primaryMetricName(suite);
  const target = suite.target || {};
  const primaryDisplay = summary[primary]
    ? summaryMetricText(run.run_id, primary)
    : targetStatus({ run, metrics: summary }, suite) === "not_reached"
      ? "Not reached"
      : "n/a";
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
      ${metricLine("primary_metric", primaryDisplay)}
      ${meta.rank_label ? metricLine("reference_rank", meta.rank_label) : ""}
      ${meta.evidence ? metricLine("reference_evidence", meta.evidence) : ""}
      ${meta.date ? metricLine("reference_date", meta.date) : ""}
      ${metricLine("final_val_loss", summaryMetricText(run.run_id, "final_val_loss"))}
      ${metricLine(
        "best_val_loss",
        metricValueWithOptionalStep("best_val_loss", summary.best_val_loss)
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
      ${wandbUrl ? `<a href="${escapeHtml(wandbUrl)}" target="_blank" rel="noreferrer">Open WandB</a>` : ""}
      <button type="button" id="copySource">Copy source path</button>
    </div>
  `;

  const copy = byId("copySource");
  const sourcePath = source.log_path || source.csv_path || source.config_path || "n/a";
  if (copy) {
    copy.setAttribute("aria-live", "polite");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(sourcePath);
        copy.textContent = "Copied source path";
      } catch {
        copy.textContent = "Copy failed";
      }
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
  const snapshot = catalogSnapshot();
  const globalEvidence = snapshot.evidence_summary || snapshot.meta?.evidence_summary || {};
  const summedEvidence = sumSuiteEvidence(catalogSuites());
  const activeSuites =
    numericEvidenceValue(globalEvidence, ["active_suites"]) ??
    catalogSuites().filter((suite) => suite.status === "active").length;
  const drawableRuns = portalData.runs.filter((run) => {
    const suite = suiteById(run.suite_id);
    return suite && curveAvailable(run, suite);
  }).length;
  const pointMetricsCount = portalData.metrics.filter((metric) => metric.metric_scope === "point").length;
  const summaryMetricsCount = portalData.metrics.filter((metric) => metric.metric_scope === "summary").length;
  const totalRuns =
    numericEvidenceValue(globalEvidence, ["runs", "mapped"]) ??
    (portalLoadMode === "aggregate" ? portalData.runs.length : summedEvidence.mapped);
  const totalMetrics =
    numericEvidenceValue(globalEvidence, ["metrics"]) ??
    (portalLoadMode === "aggregate" ? portalData.metrics.length : summedEvidence.metrics);
  const totalClaims =
    numericEvidenceValue(globalEvidence, ["claims"]) ??
    (portalLoadMode === "aggregate" ? portalData.claims.length : summedEvidence.claims);
  const totalFigures =
    numericEvidenceValue(globalEvidence, ["figures"]) ??
    (portalLoadMode === "aggregate" ? portalData.figures.length : summedEvidence.figures);
  const figureCoverage = portalData.figures.map((figure) => {
    const suite = suiteById(figure.suite_id);
    const drawable = (figure.run_ids || []).filter((runId) => {
      const run = runById(runId);
      return run && suite && curveAvailable(run, suite);
    }).length;
    return `${figure.suite_id}: ${drawable}/${figure.run_ids?.length || 0}`;
  });

  byId("dataHealthSummary").textContent =
    `${totalRuns} runs · ${totalMetrics} metrics · ${totalFigures} figures · ${portalLoadMode === "catalog" ? "active suite shard loaded" : "snapshot loaded"}`;

  byId("dataHealth").innerHTML = `
    ${metricLine("generated_at", snapshot.meta?.generated_at || portalData.meta?.generated_at || "n/a")}
    ${metricLine("suites", `${catalogSuites().length} total · ${activeSuites} active`)}
    ${metricLine("runs", `${totalRuns} curated · ${drawableRuns} drawable in loaded suite`)}
    ${metricLine("metrics", `${totalMetrics} catalogued · ${pointMetricsCount} point and ${summaryMetricsCount} summary loaded`)}
    ${metricLine("claims", String(totalClaims))}
    ${metricLine("figures", `${totalFigures} catalogued${figureCoverage.length ? ` · loaded ${figureCoverage.join(" · ")}` : ""}`)}
  `;
}

function renderSuiteView() {
  const suite = activeSuite();
  normalizeChartScaleMode(suite);
  renderOverview();
  renderSuiteCards();
  renderSuiteHeader(suite);
  renderProtocolSelector(suite);
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

function setPortalStatus(message, state) {
  const pill = document.querySelector(".source-pill");
  if (!pill) return;
  pill.dataset.state = state;
  pill.setAttribute("aria-live", "polite");
  let label = pill.querySelector(".source-pill-label");
  if (!label) {
    label = document.createElement("span");
    label.className = "source-pill-label";
    Array.from(pill.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .forEach((node) => node.remove());
    pill.appendChild(label);
  }
  label.textContent = message;
}

function setLoadingState(isLoading) {
  const main = document.querySelector("main");
  if (main) main.setAttribute("aria-busy", String(isLoading));
  if (isLoading) {
    byId("portalLoadError")?.remove();
    setPortalStatus("Loading curated snapshot", "loading");
  }
}

function renderLoadError(error) {
  const main = document.querySelector("main");
  if (!main) return;
  const isLocalFile = window.location.protocol === "file:";
  setLoadingState(false);
  setPortalStatus("Snapshot unavailable", "error");
  let panel = byId("portalLoadError");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "portalLoadError";
    panel.className = "panel load-error";
    panel.setAttribute("role", "alert");
    main.prepend(panel);
  }
  panel.innerHTML = `
    <p class="panel-kicker">Snapshot error</p>
    <h2>${isLocalFile ? "The local snapshot bundle could not be loaded." : "The curated results could not be loaded."}</h2>
    <p class="muted wide-muted">${
      isLocalFile
        ? "Rebuild <code>data/portal-data.js</code>, then retry. The canonical JSON has not been changed."
        : "Check the connection, then retry. Existing source data has not been changed."
    }</p>
    <button type="button" id="retryPortalLoad">Retry loading</button>
    <details>
      <summary>Technical detail</summary>
      <pre>${escapeHtml(error?.message || String(error))}</pre>
    </details>
  `;
  byId("retryPortalLoad")?.addEventListener("click", start);
}

function scheduleChartResize() {
  if (chartResizeFrame || !portalData || !byId("lossChart") || byId("suiteDataPanel")?.hidden) return;
  chartResizeFrame = requestAnimationFrame(() => {
    chartResizeFrame = 0;
    renderChart();
  });
}

function initializeResponsiveChart() {
  chartResizeObserver?.disconnect();
  if (typeof ResizeObserver === "function") {
    chartResizeObserver = new ResizeObserver(scheduleChartResize);
    const frame = byId("lossChart")?.parentElement;
    if (frame) chartResizeObserver.observe(frame);
  }
  if (!initializeResponsiveChart.windowBound) {
    window.addEventListener("resize", scheduleChartResize, { passive: true });
    window.addEventListener("popstate", () => {
      if (!portalData) return;
      clearTimeout(runSearchTimer);
      void restoreSuiteFromLocation();
    });
    initializeResponsiveChart.windowBound = true;
  }
}

async function loadPortalSnapshot() {
  if (window.location.protocol === "file:") {
    if (globalThis.__PORTAL_DATA__) return globalThis.__PORTAL_DATA__;

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "data/portal-data.js";
      script.onload = () => {
        script.remove();
        if (globalThis.__PORTAL_DATA__) {
          resolve();
        } else {
          reject(new Error("data/portal-data.js loaded without defining globalThis.__PORTAL_DATA__"));
        }
      };
      script.onerror = () => {
        script.remove();
        reject(
          new Error(
            "Local snapshot bundle is missing or invalid. Run `python3 scripts/build_portal_data_bundle.py`."
          )
        );
      };
      document.head.appendChild(script);
    });

    return globalThis.__PORTAL_DATA__;
  }

  const response = await fetch("data/portal-data.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Snapshot request failed with HTTP ${response.status}`);
  return response.json();
}

function mergePlainObjects(base, extra) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return extra ?? base;
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return extra ?? base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    merged[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
        ? mergePlainObjects(merged[key], value)
        : value;
  }
  return merged;
}

function injectLocalDataScript(src, hasPayload, missingMessage) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      script.remove();
      if (hasPayload()) resolve();
      else reject(new Error(`${src} loaded without registering its data payload`));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(missingMessage));
    };
    document.head.appendChild(script);
  });
}

async function loadPortalCatalogSource() {
  try {
    let catalog;
    if (window.location.protocol === "file:") {
      if (!globalThis.__PORTAL_CATALOG__) {
        await injectLocalDataScript(
          "data/portal-catalog.js",
          () => Boolean(globalThis.__PORTAL_CATALOG__),
          "The local portal catalog bundle is missing."
        );
      }
      catalog = globalThis.__PORTAL_CATALOG__;
    } else {
      const response = await fetch("data/portal-catalog.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}`);
      catalog = await response.json();
    }

    if (!catalog || !Array.isArray(catalog.suites)) {
      throw new Error("Portal catalog does not contain a suites array");
    }
    return { data: normalizedPortalData(catalog), mode: "catalog" };
  } catch (catalogError) {
    const aggregate = await loadPortalSnapshot();
    if (!aggregate || !Array.isArray(aggregate.suites)) throw catalogError;
    return {
      data: normalizedPortalData(aggregate),
      mode: "aggregate",
      fallbackReason: catalogError,
    };
  }
}

function normalizeSuiteShard(rawShard, suiteId) {
  if (!rawShard || typeof rawShard !== "object") {
    throw new Error(`Suite shard ${suiteId} is not an object`);
  }
  if (rawShard.suite_id && rawShard.suite_id !== suiteId) {
    throw new Error(`Suite shard ${suiteId} registered as ${rawShard.suite_id}`);
  }
  const catalogDeliveryId =
    portalCatalog?.delivery_id || portalCatalog?.meta?.delivery_id || "";
  const shardDeliveryId = rawShard.delivery_id || rawShard.meta?.delivery_id || "";
  if (
    (catalogDeliveryId || shardDeliveryId) &&
    (!catalogDeliveryId || !shardDeliveryId || catalogDeliveryId !== shardDeliveryId)
  ) {
    throw new Error(
      `Suite shard ${suiteId} belongs to a different snapshot delivery`
    );
  }
  const shard = {
    ...rawShard,
    suite_id: suiteId,
    runs: Array.isArray(rawShard.runs) ? rawShard.runs : [],
    metrics: Array.isArray(rawShard.metrics) ? rawShard.metrics : [],
    claims: Array.isArray(rawShard.claims) ? rawShard.claims : [],
    figures: Array.isArray(rawShard.figures) ? rawShard.figures : [],
  };
  for (const collectionName of ["runs", "claims", "figures"]) {
    const foreign = shard[collectionName].find(
      (record) => record.suite_id && record.suite_id !== suiteId
    );
    if (foreign) {
      throw new Error(
        `Suite shard ${suiteId} contains a foreign ${collectionName.slice(0, -1)} record`
      );
    }
  }
  const shardRunIds = new Set(shard.runs.map((run) => run.run_id));
  const foreignMetric = shard.metrics.find(
    (metric) => metric.run_id && !shardRunIds.has(metric.run_id)
  );
  if (foreignMetric) {
    throw new Error(`Suite shard ${suiteId} contains a metric for an unknown run`);
  }
  return shard;
}

async function loadSuiteShard(suiteId) {
  if (portalLoadMode !== "catalog") return null;
  if (suiteShardCache.has(suiteId)) return suiteShardCache.get(suiteId);
  if (suiteShardRequests.has(suiteId)) return suiteShardRequests.get(suiteId);

  const request = (async () => {
    let rawShard;
    if (window.location.protocol === "file:") {
      globalThis.__PORTAL_SUITE_SHARDS__ ||= {};
      if (!globalThis.__PORTAL_SUITE_SHARDS__[suiteId]) {
        const encodedId = encodeURIComponent(suiteId);
        await injectLocalDataScript(
          `data/suites/${encodedId}.js`,
          () => Boolean(globalThis.__PORTAL_SUITE_SHARDS__?.[suiteId]),
          `The local suite shard for ${suiteId} is missing.`
        );
      }
      rawShard = globalThis.__PORTAL_SUITE_SHARDS__[suiteId];
    } else {
      const encodedId = encodeURIComponent(suiteId);
      const response = await fetch(`data/suites/${encodedId}.json`, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Suite ${suiteId} request failed with HTTP ${response.status}`);
      }
      rawShard = await response.json();
    }
    const shard = normalizeSuiteShard(rawShard, suiteId);
    suiteShardCache.set(suiteId, shard);
    return shard;
  })();

  suiteShardRequests.set(suiteId, request);
  try {
    return await request;
  } finally {
    suiteShardRequests.delete(suiteId);
  }
}

function suiteNeedsShard(suite) {
  return (
    portalLoadMode === "catalog" &&
    suiteDetailState(suite) === "available"
  );
}

function composePortalData(catalog, shard = null) {
  if (portalLoadMode === "aggregate") return normalizedPortalData(catalog);
  return normalizedPortalData({
    ...catalog,
    meta: mergePlainObjects(catalog.meta || {}, shard?.meta || {}),
    visual_style_registry: mergePlainObjects(
      catalog.visual_style_registry || {},
      shard?.visual_style_registry || {}
    ),
    runs: shard?.runs || [],
    metrics: shard?.metrics || [],
    claims: shard?.claims || [],
    figures: shard?.figures || [],
    sources: shard?.sources || [],
  });
}

async function portalDataForSuite(suite) {
  if (!suiteNeedsShard(suite)) return composePortalData(portalCatalog, null);
  const shard = await loadSuiteShard(suite.suite_id);
  return composePortalData(portalCatalog, shard);
}

function resetSuiteInteractionState(suite) {
  clearTimeout(runSearchTimer);
  resetRunFilters();
  chartScaleMode = "full";
  focusedChartRunId = null;
  currentChartModel = null;
  initializeChartSelection(suite);
  selectedRunId = firstChartRun(suite)?.run_id || null;
}

function focusSuiteChangeControl({ focusGroupId = "", focusProtocolSuiteId = "" } = {}) {
  let control = null;
  if (focusProtocolSuiteId) {
    control = Array.from(
      byId("protocolSelector")?.querySelectorAll("[data-target-suite-id]") || []
    ).find((candidate) => candidate.dataset.targetSuiteId === focusProtocolSuiteId);
  }
  if (!control && focusGroupId) {
    control = Array.from(
      byId("suiteCards")?.querySelectorAll("[data-benchmark-group-id]") || []
    ).find((candidate) => candidate.dataset.benchmarkGroupId === focusGroupId);
  }
  control?.focus({ preventScroll: true });
}

async function requestSuiteChange(
  targetSuiteId,
  {
    push = false,
    restoreUrl = false,
    initial = false,
    focusGroupId = "",
    focusProtocolSuiteId = "",
  } = {}
) {
  const targetCatalogSuite = catalogSuiteById(targetSuiteId);
  if (!targetCatalogSuite) return false;
  const generation = ++suiteLoadGeneration;

  if (
    targetSuiteId === selectedSuiteId &&
    (portalLoadMode === "aggregate" ||
      !suiteNeedsShard(targetCatalogSuite) ||
      activeSuiteShardId === targetSuiteId)
  ) {
    pendingSuiteId = null;
    protocolSwitchError = "";
    if (restoreUrl) {
      applyUrlState();
      renderSuiteView();
    } else if (portalData) {
      renderSuiteCards();
      renderProtocolSelector(activeSuite());
      setPortalStatus(
        portalLoadMode === "catalog" ? "Curated catalog · suite loaded" : "Curated static snapshot",
        "ready"
      );
    }
    focusSuiteChangeControl({ focusGroupId, focusProtocolSuiteId });
    return true;
  }

  pendingSuiteId = targetSuiteId;
  protocolSwitchError = "";
  if (!initial && portalData) {
    renderSuiteCards();
    renderProtocolSelector(activeSuite());
  }
  setPortalStatus(`Loading ${targetCatalogSuite.title || targetSuiteId}`, "loading");

  try {
    const nextPortalData = await portalDataForSuite(targetCatalogSuite);
    if (generation !== suiteLoadGeneration) return false;

    portalData = nextPortalData;
    buildDataIndex(portalData);
    selectedSuiteId = targetSuiteId;
    activeSuiteShardId = suiteNeedsShard(targetCatalogSuite) ? targetSuiteId : null;
    pendingSuiteId = null;
    protocolSwitchError = "";

    const suite = activeSuite();
    if (restoreUrl) applyUrlState();
    else resetSuiteInteractionState(suite);
    renderSuiteView();
    if (!restoreUrl) syncUrlState({ push });
    setPortalStatus("Curated static snapshot", "ready");
    focusSuiteChangeControl({ focusGroupId, focusProtocolSuiteId });
    return true;
  } catch (error) {
    if (generation !== suiteLoadGeneration) return false;
    pendingSuiteId = null;
    protocolSwitchError = `Could not load ${targetCatalogSuite.title || targetSuiteId}. ${error?.message || String(error)}`;
    if (initial) throw error;
    renderSuiteCards();
    renderProtocolSelector(activeSuite());
    setPortalStatus("Curated snapshot · protocol unchanged", "ready");
    if (restoreUrl) syncUrlState();
    return false;
  }
}

async function restoreSuiteFromLocation() {
  if (!portalData || !globalThis.location) return;
  const requestedSuiteId = new URLSearchParams(globalThis.location.search).get("suite");
  const targetSuiteId = catalogSuiteById(requestedSuiteId)
    ? requestedSuiteId
    : selectedSuiteId;
  await requestSuiteChange(targetSuiteId, { restoreUrl: true });
}

async function start() {
  setLoadingState(true);
  ++suiteLoadGeneration;
  pendingSuiteId = null;
  protocolSwitchError = "";
  suiteShardCache.clear();
  suiteShardRequests.clear();
  if (window.location.protocol === "file:") {
    globalThis.__PORTAL_SUITE_SHARDS__ = {};
  }
  try {
    const loaded = await loadPortalCatalogSource();
    let usedAggregateFallback = Boolean(loaded.fallbackReason);
    portalLoadMode = loaded.mode;
    portalCatalog = loaded.data;
    portalData = composePortalData(portalCatalog, null);
    buildDataIndex(portalData);
    const defaultSuiteId =
      portalCatalog.suites.find((suite) => suite.status === "active")?.suite_id ||
      portalCatalog.suites[0]?.suite_id;
    const requestedSuiteId = globalThis.location
      ? new URLSearchParams(globalThis.location.search).get("suite")
      : null;
    selectedSuiteId = catalogSuiteById(requestedSuiteId)
      ? requestedSuiteId
      : defaultSuiteId;
    try {
      await requestSuiteChange(selectedSuiteId, { restoreUrl: true, initial: true });
    } catch (initialShardError) {
      const aggregate = normalizedPortalData(await loadPortalSnapshot());
      if (!Array.isArray(aggregate.suites) || !aggregate.suites.length) {
        throw initialShardError;
      }
      usedAggregateFallback = true;
      portalLoadMode = "aggregate";
      portalCatalog = aggregate;
      portalData = aggregate;
      activeSuiteShardId = null;
      pendingSuiteId = null;
      protocolSwitchError = "";
      buildDataIndex(portalData);
      const aggregateDefaultSuiteId =
        portalCatalog.suites.find((suite) => suite.status === "active")?.suite_id ||
        portalCatalog.suites[0]?.suite_id;
      selectedSuiteId = catalogSuiteById(requestedSuiteId)
        ? requestedSuiteId
        : aggregateDefaultSuiteId;
      applyUrlState();
      renderSuiteView();
    }
    initializeResponsiveChart();
    syncUrlState();
    setLoadingState(false);
    const sourcePath = byId("sourceSnapshotPath");
    if (sourcePath) {
      sourcePath.textContent =
        portalLoadMode === "catalog" ? "data/portal-catalog.json" : "data/portal-data.json";
    }
    setPortalStatus(
      usedAggregateFallback
        ? "Curated static snapshot · aggregate fallback"
        : portalLoadMode === "catalog"
          ? "Curated catalog · suite loaded"
          : "Curated static snapshot",
      "ready"
    );
  } catch (error) {
    renderLoadError(error);
  }
}

function installPortalTestApi() {
  globalThis.__PORTAL_TEST__ = {
    setData(data) {
      portalLoadMode = "aggregate";
      portalCatalog = normalizedPortalData(data);
      portalData = portalCatalog;
      activeSuiteShardId = null;
      pendingSuiteId = null;
      protocolSwitchError = "";
      buildDataIndex(portalData);
      selectedSuiteId =
        data.suites.find((suite) => suite.status === "active")?.suite_id ||
        data.suites[0]?.suite_id ||
        null;
      chartScaleMode = "full";
      focusedChartRunId = null;
      resetRunFilters();
      const suite = activeSuite();
      if (suite) {
        initializeChartSelection(suite);
        selectedRunId = firstChartRun(suite)?.run_id || null;
      }
      return this.getState();
    },
    getLeaderboardRows(suiteId = selectedSuiteId) {
      const suite = suiteById(suiteId);
      return suite ? eligibleRows(suite).slice() : [];
    },
    getUnrankedRows(suiteId = selectedSuiteId) {
      const suite = suiteById(suiteId);
      return suite ? unrankedRows(suite).slice() : [];
    },
    getVisibleChartRunIds() {
      const suite = activeSuite();
      return suite ? chartVisibleRuns(suite).map((run) => run.run_id) : [];
    },
    selectRun(runId, { focusChart = false } = {}) {
      const run = runById(runId);
      if (!run || run.suite_id !== selectedSuiteId) return false;
      selectedRunId = runId;
      if (focusChart && selectedChartRunIds.has(runId)) focusedChartRunId = runId;
      return true;
    },
    clearChartFocus() {
      const changed = focusedChartRunId !== null;
      focusedChartRunId = null;
      return changed;
    },
    getBenchmarkNavigation() {
      return benchmarkNavigationEntries().map((entry) => ({
        id: entry.id,
        title: navigationEntryTitle(entry),
        status: navigationEntryStatus(entry),
        suiteIds: entry.suites.map((suite) => suite.suite_id),
        defaultSuiteId: entry.defaultSuite?.suite_id || null,
      }));
    },
    chooseProtocol(groupSuiteIds, coordinates = {}) {
      const suites = groupSuiteIds.map(catalogSuiteById).filter(Boolean);
      return chooseProtocolSuite(suites, coordinates)?.suite_id || null;
    },
    composeShard(suiteId, shard) {
      const previousMode = portalLoadMode;
      portalLoadMode = "catalog";
      try {
        return composePortalData(portalCatalog, normalizeSuiteShard(shard, suiteId));
      } finally {
        portalLoadMode = previousMode;
      }
    },
    safeExternalUrl,
    getState() {
      return {
        selectedSuiteId,
        selectedRunId,
        chartScaleMode,
        focusedChartRunId,
        selectedChartRunIds: Array.from(selectedChartRunIds),
        pendingSuiteId,
        suiteLoadGeneration,
      };
    },
    diagnostics() {
      return {
        suites: dataIndex?.suitesById.size || 0,
        runs: dataIndex?.runsById.size || 0,
        metrics: portalData?.metrics?.length || 0,
        indexedSummaryRuns: dataIndex?.summaryByRun.size || 0,
        indexedPointRuns: dataIndex?.pointsByRunMetric.size || 0,
        leaderboardRows: Object.fromEntries(
          Array.from(dataIndex?.leaderboardRowsBySuite || []).map(([suiteId, rows]) => [suiteId, rows.length])
        ),
      };
    },
  };
}

if (globalThis.__PORTAL_TEST_MODE__) {
  installPortalTestApi();
} else {
  start();
}
