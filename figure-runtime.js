(function installPortalFigureRuntime(root, factory) {
  const runtime = factory();
  if (typeof module === "object" && module?.exports) module.exports = runtime;
  root.PortalFigureRuntime = runtime;
})(typeof globalThis === "object" ? globalThis : this, function createPortalFigureRuntime() {
  "use strict";

  const SCHEMA_VERSION = "1.1";
  const PROFILES = {
    interactive: { name: "interactive", width: 960, height: 520 },
    presentation: { name: "presentation", width: 1200, height: 900 },
    paper: { name: "paper", width: 980, height: 720 },
  };
  const FAMILY_IDENTITIES = {
    muon: "muon",
    adam: "adam",
    "second-order": "second-order",
    mars: "second-order",
    lion: "momentum-sign",
    momentum: "momentum-sign",
    schedulefree: "experimental",
    optimizer: "other",
    unknown: "other",
  };
  const METHOD_COLORS = [
    "#175CD3",
    "#6941C6",
    "#087E8B",
    "#A15C07",
    "#C11574",
  ];
  const MARKERS = [
    "circle",
    "square",
    "triangle",
    "diamond",
    "plus",
    "cross",
    "hexagon",
    "star",
  ];

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function familyKey(run) {
    return String(run?.optimizer?.family || run?.optimizer?.name || "unknown")
      .trim()
      .toLowerCase()
      .replaceAll("_", "-");
  }

  function normalizedMethodGroup(value) {
    const rawValue = String(value || "").trim().toLowerCase();
    if (!rawValue) return "unknown";
    const asciiSlug = rawValue
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return asciiSlug || `method-${stableHash(rawValue).toString(36)}`;
  }

  function methodGroupKey(run) {
    return normalizedMethodGroup(
      run?.optimizer?.method_group ||
      run?.optimizer?.name ||
      run?.optimizer?.family ||
      "unknown"
    );
  }

  function methodGroupsFromRegistry(registry) {
    if (!registry || typeof registry !== "object") return {};
    if (registry.method_groups && typeof registry.method_groups === "object") {
      return registry.method_groups;
    }
    return registry;
  }

  function styleForRun(run, registry) {
    const optimizerFamily = familyKey(run);
    const family = FAMILY_IDENTITIES[optimizerFamily] || FAMILY_IDENTITIES.unknown;
    const methodGroup = methodGroupKey(run);
    const registered = methodGroupsFromRegistry(registry)[methodGroup];
    const fallbackColor = METHOD_COLORS[stableHash(methodGroup) % METHOD_COLORS.length];
    const color = /^#[0-9a-f]{6}$/iu.test(String(registered?.color || ""))
      ? String(registered.color).toUpperCase()
      : fallbackColor;
    const role = String(run?.run_role || "unknown");
    const status = String(run?.status || "unknown");
    const incomplete = status !== "completed";
    const dash = incomplete
      ? "2 5"
      : role === "official_reference"
        ? "8 4"
        : role === "ablation"
          ? "3 3"
          : "";
    const markerSeed = [
      methodGroup,
      run?.optimizer?.variant || "",
      run?.run_id || "",
    ].join("\u0000");
    const marker = MARKERS[stableHash(markerSeed) % MARKERS.length];
    return {
      family,
      optimizerFamily,
      methodGroup,
      methodLabel: String(registered?.label || run?.optimizer?.name || methodGroup),
      color,
      dash,
      marker,
      strokeWidth: 2.1,
      opacity: incomplete ? 0.76 : 0.82,
      role,
      status,
      collision: false,
      signature: `${color}|${dash || "solid"}|${marker}`,
      classes: [
        `series-family-${family}`,
        `series-method-${methodGroup}`,
        `series-role-${role.replaceAll("_", "-")}`,
        `series-status-${status.replaceAll("_", "-")}`,
        incomplete ? "is-partial" : "",
      ].filter(Boolean),
    };
  }

  function allocateRunStyles(runs, registry) {
    const orderedRuns = [...runs].sort((left, right) => {
      const leftSeed = stableHash(`${methodGroupKey(left)}\u0000${left?.run_id || ""}`);
      const rightSeed = stableHash(`${methodGroupKey(right)}\u0000${right?.run_id || ""}`);
      return leftSeed - rightSeed || String(left?.run_id || "").localeCompare(String(right?.run_id || ""));
    });
    const usedMarkers = new Set();
    const styles = new Map();
    for (const run of orderedRuns) {
      const base = styleForRun(run, registry);
      const initialIndex = MARKERS.indexOf(base.marker);
      let marker = base.marker;
      let collision = true;
      for (let offset = 0; offset < MARKERS.length; offset += 1) {
        const candidate = MARKERS[(Math.max(initialIndex, 0) + offset) % MARKERS.length];
        if (usedMarkers.has(candidate)) continue;
        marker = candidate;
        usedMarkers.add(candidate);
        collision = false;
        break;
      }
      if (collision) usedMarkers.add(marker);
      styles.set(run.run_id, {
        ...base,
        marker,
        collision,
        signature: `${base.color}|${base.dash || "solid"}|${marker}`,
      });
    }
    return styles;
  }

  function niceStep(rawStep) {
    if (!finite(rawStep) || rawStep <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
  }

  function niceTicks(minimum, maximum, count) {
    if (!finite(minimum) || !finite(maximum)) return [0, 1];
    if (minimum === maximum) return [minimum];
    const step = niceStep((maximum - minimum) / Math.max((count || 6) - 1, 1));
    const first = Math.ceil(minimum / step) * step;
    const ticks = [];
    for (let value = first; value <= maximum + step / 1000; value += step) {
      ticks.push(Number(value.toFixed(8)));
      if (ticks.length > 20) break;
    }
    if (!ticks.length) return [minimum, maximum];
    return ticks;
  }

  function numberExtent(values, fallback) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const value of values) {
      if (!finite(value)) continue;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    return minimum === Infinity ? fallback : [minimum, maximum];
  }

  function normalizedProfile(request) {
    const requested = request?.profile;
    const base = typeof requested === "string"
      ? PROFILES[requested] || PROFILES.interactive
      : requested && typeof requested === "object"
        ? { ...PROFILES[requested.name] || PROFILES.interactive, ...requested }
        : PROFILES.interactive;
    const width = finite(request?.width) ? request.width : base.width;
    const height = finite(request?.height) ? request.height : base.height;
    return {
      name: base.name || "interactive",
      width: Math.max(280, Math.round(width)),
      height: Math.max(280, Math.round(height)),
    };
  }

  function buildIndexes(data) {
    const suites = new Map((data?.suites || []).map((suite) => [suite.suite_id, suite]));
    const runs = new Map((data?.runs || []).map((run) => [run.run_id, run]));
    const figures = new Map((data?.figures || []).map((figure) => [figure.figure_id, figure]));
    const points = new Map();
    const summaries = new Map();
    for (const metric of data?.metrics || []) {
      if (!metric?.run_id || !metric?.metric_name) continue;
      if (metric.metric_scope === "summary") {
        if (!summaries.has(metric.run_id)) summaries.set(metric.run_id, new Map());
        summaries.get(metric.run_id).set(metric.metric_name, metric);
      } else if (metric.metric_scope === "point" && finite(metric.step) && finite(metric.value)) {
        const key = `${metric.run_id}\u0000${metric.metric_name}`;
        if (!points.has(key)) points.set(key, []);
        points.get(key).push(metric);
      }
    }
    for (const values of points.values()) values.sort((left, right) => left.step - right.step);
    return { suites, runs, figures, points, summaries };
  }

  function pointKey(runId, metricName) {
    return `${runId}\u0000${metricName}`;
  }

  function metricLabel(metricName) {
    const labels = {
      step: "Training step",
      val_loss: "Validation loss \u2193",
      final_val_loss: "Final validation loss \u2193",
      steps_to_target_3_28: "Steps to target \u2193",
    };
    return labels[metricName] || String(metricName || "Metric").replaceAll("_", " ");
  }

  function scaleLabel(scaleMode, domain) {
    if (scaleMode === "zoom") return `Focused range \u00b7 y \u2264 ${formatNumber(domain.yMax, 2)}`;
    if (scaleMode === "tail") {
      return `Tail focus \u00b7 x ${formatStep(domain.xMin)}\u2013${formatStep(domain.xMax)}`;
    }
    return "Full data range";
  }

  function resolveFigure(indexes, request) {
    if (request?.figureId && indexes.figures.has(request.figureId)) {
      return indexes.figures.get(request.figureId);
    }
    if (request?.suiteId) {
      for (const figure of indexes.figures.values()) {
        if (figure.suite_id === request.suiteId && figure.figure_type === "loss_curve") return figure;
      }
    }
    return indexes.figures.values().next().value;
  }

  function drawableRuns(indexes, suiteId, yMetric) {
    const result = [];
    for (const run of indexes.runs.values()) {
      if (run.suite_id !== suiteId) continue;
      if ((indexes.points.get(pointKey(run.run_id, yMetric)) || []).length >= 2) result.push(run);
    }
    return result;
  }

  function metricDirection(metricName) {
    return String(metricName || "").includes("tokens_per_sec") ||
      String(metricName || "").includes("val_acc")
      ? -1
      : 1;
  }

  function canonicalRunIds(indexes, figure, runIds) {
    const suite = indexes.suites.get(figure.suite_id);
    const rule = suite?.leaderboard_rule || {};
    const sortBy = rule.sort_by || suite?.primary_metric || "";
    const primaryDirection = rule.direction === "desc" ? -1 : 1;
    const metricValue = (runId, metricName) => {
      const metric = indexes.summaries.get(runId)?.get(metricName);
      return finite(metric?.value) ? metric.value : null;
    };
    const compareMetric = (leftId, rightId, metricName, direction) => {
      const left = metricValue(leftId, metricName);
      const right = metricValue(rightId, metricName);
      if (left !== null && right !== null && left !== right) return (left - right) * direction;
      if (left !== null && right === null) return -1;
      if (left === null && right !== null) return 1;
      return 0;
    };
    return [...runIds].sort((leftId, rightId) => {
      const primary = compareMetric(leftId, rightId, sortBy, primaryDirection);
      if (primary) return primary;
      for (const tieBreaker of rule.tie_breakers || []) {
        const tied = compareMetric(
          leftId,
          rightId,
          tieBreaker,
          metricDirection(tieBreaker)
        );
        if (tied) return tied;
      }
      const leftName = indexes.runs.get(leftId)?.display_name || leftId;
      const rightName = indexes.runs.get(rightId)?.display_name || rightId;
      return leftName.localeCompare(rightName);
    });
  }

  function normalizeSelection(indexes, figure, request, drawable) {
    const drawableIds = new Set(drawable.map((run) => run.run_id));
    const defaultIds = (figure.run_ids || []).filter((runId) => drawableIds.has(runId));
    const selected = canonicalRunIds(
      indexes,
      figure,
      Array.from(new Set(request?.selectedRunIds?.length ? request.selectedRunIds : defaultIds))
        .filter((runId) => drawableIds.has(runId))
    );
    const selectedSet = new Set(selected);
    const requestedVisible = new Set(request?.visibleRunIds || selected);
    const visible = selected.filter((runId) => requestedVisible.has(runId));
    const visibleSet = new Set(visible);
    const hidden = selected.filter((runId) => !visibleSet.has(runId));
    const requestedFocus = request?.focusRunId;
    const focus = requestedFocus === undefined
      ? visible[0] || null
      : visibleSet.has(requestedFocus)
        ? requestedFocus
        : null;
    return {
      selectedRunIds: selected,
      visibleRunIds: visible,
      hiddenRunIds: hidden,
      focusRunId: focus,
    };
  }

  function supportedScales(figure) {
    const result = ["full", "zoom"];
    if (finite(figure?.tail_step_min) && finite(figure?.tail_step_max) && figure.tail_step_max > figure.tail_step_min) {
      result.push("tail");
    }
    return result;
  }

  function computeDomain(indexes, suite, figure, drawable, scaleMode) {
    const yMetric = figure.y_metric || "val_loss";
    const allPoints = [];
    for (const run of drawable) {
      allPoints.push(...indexes.points.get(pointKey(run.run_id, yMetric)) || []);
    }
    if (!allPoints.length) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

    const stepExtent = numberExtent(allPoints.map((point) => point.step), [0, 1]);
    let xMin = Math.min(0, stepExtent[0]);
    let xMax = stepExtent[1];
    if (scaleMode === "tail") {
      xMin = figure.tail_step_min;
      xMax = figure.tail_step_max;
    } else {
      const xSpan = Math.max(xMax - xMin, 1);
      xMax += xSpan * 0.02;
    }

    const domainPoints = scaleMode === "tail"
      ? allPoints.filter((point) => point.step >= xMin && point.step <= xMax)
      : allPoints;
    const values = (domainPoints.length ? domainPoints : allPoints).map((point) => point.value);
    const target = suite.target;
    if (target?.metric_name === yMetric && finite(target.value)) values.push(target.value);
    const valueExtent = numberExtent(values, [0, 1]);
    const spread = Math.max(valueExtent[1] - valueExtent[0], 0.02);
    let yMin = Math.max(0, valueExtent[0] - Math.max(spread * 0.08, 0.006));
    let yMax = valueExtent[1] + Math.max(spread * 0.08, 0.006);
    if (scaleMode === "zoom") {
      yMax = finite(figure.y_axis_zoom_max)
        ? figure.y_axis_zoom_max
        : finite(figure.y_axis_max)
          ? figure.y_axis_max
          : yMetric === "val_loss"
            ? 5
            : yMax;
      const underCap = values.filter((value) => value <= yMax);
      const underExtent = numberExtent(underCap, [Math.max(0, yMax - 1), yMax]);
      const underSpread = Math.max(underExtent[1] - underExtent[0], 0.02);
      yMin = Math.max(0, underExtent[0] - Math.max(underSpread * 0.08, 0.006));
    }
    if (yMax <= yMin) yMax = yMin + 0.1;
    return { xMin, xMax, yMin, yMax };
  }

  function buildLayout(profile, rulerItemCount) {
    const hasRuler = rulerItemCount > 0;
    const compact = profile.name === "interactive" && profile.width < 620;
    if (profile.name === "interactive") {
      const left = compact ? 50 : 64;
      const rightGutter = compact ? 16 : profile.width < 760 ? 188 : 176;
      const top = 24;
      const bottom = profile.height - (compact ? 48 : 54);
      const plot = {
        left,
        top,
        right: profile.width - rightGutter,
        bottom,
        width: Math.max(80, profile.width - left - rightGutter),
        height: Math.max(100, bottom - top),
      };
      return {
        compact,
        header: { top: 0, height: 0 },
        plot,
        ruler: null,
        footer: null,
      };
    }

    const left = profile.name === "paper" ? 72 : 84;
    const rightGutter = profile.name === "paper" ? 172 : 220;
    const headerHeight = profile.name === "paper" ? 86 : 108;
    const footerHeight = 46;
    const footerTop = profile.height - footerHeight;
    const rulerRowGap = profile.name === "paper" ? 15 : 17;
    const rulerHeight = hasRuler
      ? 46 + Math.max(0, rulerItemCount - 1) * rulerRowGap
      : 0;
    const rulerBottom = footerTop - 18;
    const rulerTop = hasRuler ? rulerBottom - rulerHeight : null;
    const plotBottom = hasRuler ? rulerTop - 44 : footerTop - 48;
    const plot = {
      left,
      top: headerHeight,
      right: profile.width - rightGutter,
      bottom: plotBottom,
      width: Math.max(120, profile.width - left - rightGutter),
      height: Math.max(160, plotBottom - headerHeight),
    };
    return {
      compact: false,
      header: { top: 0, height: headerHeight },
      plot,
      ruler: hasRuler
        ? {
            top: rulerTop,
            height: rulerHeight,
            left,
            right: profile.width - 44,
            rowGap: rulerRowGap,
          }
        : null,
      footer: { top: footerTop, height: footerHeight },
    };
  }

  function linearMap(value, domain, range) {
    const span = domain[1] - domain[0];
    if (!finite(value) || !finite(span) || span === 0) return (range[0] + range[1]) / 2;
    return range[0] + ((value - domain[0]) / span) * (range[1] - range[0]);
  }

  function median(values) {
    const sorted = values.filter(finite).sort((left, right) => left - right);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function splitSegments(points) {
    if (!points.length) return [];
    const intervals = [];
    for (let index = 1; index < points.length; index += 1) {
      const interval = points[index].step - points[index - 1].step;
      if (interval > 0) intervals.push(interval);
    }
    const segments = [[points[0]]];
    for (let index = 1; index < points.length; index += 1) {
      const intervalIndex = index - 1;
      const interval = intervals[intervalIndex];
      const precedingCadence = median(
        intervals.slice(Math.max(0, intervalIndex - 3), intervalIndex)
      );
      const followingCadence = median(
        intervals.slice(intervalIndex + 1, intervalIndex + 4)
      );
      const localCadence = Math.max(precedingCadence, followingCadence, 1);
      const isInteriorGap =
        intervalIndex > 0 &&
        interval > localCadence * 2.25;
      if (isInteriorGap) segments.push([]);
      segments[segments.length - 1].push(points[index]);
    }
    return segments.filter((segment) => segment.length);
  }

  function labelForRun(run) {
    const rank = run?.leaderboard_meta?.rank_label;
    const name = String(run?.display_name || run?.run_id || "run");
    if (rank && rank !== "ours") return `${rank} \u00b7 ${name}`;
    return name;
  }

  function fitLabelText(value, maximum) {
    const text = String(value || "");
    if (text.length <= maximum) return text;
    return `${text.slice(0, Math.max(1, maximum - 1)).trimEnd()}\u2026`;
  }

  function layoutDirectLabels(series, plot, domain, compact) {
    const candidates = series
      .map((entry) => {
        const inDomain = entry.plotPoints.filter((point) =>
          point.step >= domain.xMin &&
          point.step <= domain.xMax &&
          point.value >= domain.yMin &&
          point.value <= domain.yMax
        );
        const point = inDomain[inDomain.length - 1];
        if (!point) return null;
        return {
          runId: entry.runId,
          text: fitLabelText(entry.label, compact ? 18 : 28),
          value: point.value,
          point: {
            step: point.step,
            value: point.value,
            x: linearMap(point.step, [domain.xMin, domain.xMax], [plot.left, plot.right]),
            y: linearMap(point.value, [domain.yMin, domain.yMax], [plot.bottom, plot.top]),
          },
          color: entry.style.color,
          focused: entry.focused,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.point.y - right.point.y);

    const minimumGap = compact ? 13 : 16;
    if (compact) {
      for (const label of candidates) {
        label.y = clamp(label.point.y, plot.top + 6, plot.bottom - 6);
      }
    } else {
      let cursor = plot.top + 6;
      for (const label of candidates) {
        label.y = Math.max(label.point.y, cursor);
        cursor = label.y + minimumGap;
      }
      if (candidates.length) {
        const overflow = candidates[candidates.length - 1].y - (plot.bottom - 6);
        if (overflow > 0) {
          for (let index = candidates.length - 1; index >= 0; index -= 1) {
            const maximum = index === candidates.length - 1
              ? plot.bottom - 6
              : candidates[index + 1].y - minimumGap;
            candidates[index].y = Math.min(candidates[index].y - overflow, maximum);
          }
        }
      }
    }
    for (const label of candidates) {
      const width = Math.max(36, label.text.length * (compact ? 5.5 : 6.2));
      label.x = compact ? plot.right - 4 : plot.right + 12;
      label.textAnchor = compact ? "end" : "start";
      label.bounds = {
        x: compact ? label.x - width : label.x,
        y: label.y - 9,
        width,
        height: 13,
      };
      label.connector = {
        x1: label.point.x + 3,
        y1: label.point.y,
        x2: compact ? label.x - width - 4 : label.x - 4,
        y2: label.y - 3,
      };
    }
    return candidates;
  }

  function buildEvidenceRuler(indexes, suite, figure, series, profile) {
    const metricName = figure.target_marker_metric || suite.primary_metric || "final_val_loss";
    const values = [];
    const items = series.map((entry) => {
      const metric = indexes.summaries.get(entry.runId)?.get(metricName);
      const value = finite(metric?.value) ? metric.value : null;
      if (value !== null) values.push(value);
      return {
        runId: entry.runId,
        label: fitLabelText(entry.label, profile.name === "paper" ? 24 : 32),
        value,
        color: entry.style.color,
        marker: entry.style.marker,
        methodGroup: entry.methodGroup,
        role: entry.role,
        status: entry.status,
        focused: entry.focused,
      };
    });
    if (!items.length) return null;
    const extent = numberExtent(values, [0, 1]);
    const spread = Math.max(extent[1] - extent[0], metricName.includes("step") ? 50 : 0.01);
    const domain = [
      extent[0] - spread * 0.08,
      extent[1] + spread * 0.08,
    ];
    const ticks = niceTicks(domain[0], domain[1], 4);
    return {
      metricName,
      label: metricLabel(metricName),
      direction: metricName.includes("step") || metricName.includes("loss") ? "lower" : "higher",
      domain,
      ticks,
      items,
    };
  }

  function addEvidenceGeometry(ruler, layout) {
    if (!ruler || !layout.ruler) return ruler;
    const trackLeft = layout.ruler.left + 185;
    const trackRight = layout.ruler.right - 82;
    ruler.items.forEach((item, index) => {
      item.x = item.value === null
        ? null
        : linearMap(item.value, ruler.domain, [trackLeft, trackRight]);
      item.labelX = layout.ruler.left;
      item.labelY = layout.ruler.top + 34 + index * layout.ruler.rowGap;
      item.lane = index;
      item.bounds = {
        x: layout.ruler.left,
        y: item.labelY - 11,
        width: layout.ruler.right - layout.ruler.left,
        height: 16,
      };
    });
    ruler.track = { left: trackLeft, right: trackRight };
    return ruler;
  }

  function buildFigureModel(data, request) {
    const indexes = buildIndexes(data);
    const figure = resolveFigure(indexes, request || {});
    if (!figure) throw new Error("No figure matches the requested figureId or suiteId.");
    const suite = indexes.suites.get(figure.suite_id);
    if (!suite) throw new Error(`Figure ${figure.figure_id} references an unknown suite.`);
    const scaleMode = String(request?.scaleMode || "full").toLowerCase();
    if (!supportedScales(figure).includes(scaleMode)) {
      throw new Error(`Figure ${figure.figure_id} does not support scale mode ${scaleMode}.`);
    }
    const profile = normalizedProfile(request || {});
    const yMetric = figure.y_metric || "val_loss";
    const drawable = drawableRuns(indexes, suite.suite_id, yMetric);
    const selection = normalizeSelection(indexes, figure, request || {}, drawable);
    const domain = computeDomain(indexes, suite, figure, drawable, scaleMode);

    const styleRegistry = data?.visual_style_registry || {};
    const drawableIds = new Set(drawable.map((run) => run.run_id));
    const anchorRunIds = canonicalRunIds(
      indexes,
      figure,
      (figure.run_ids?.length ? figure.run_ids : selection.selectedRunIds)
        .filter((runId) => drawableIds.has(runId))
    );
    const anchorRuns = anchorRunIds
      .map((runId) => indexes.runs.get(runId))
      .filter(Boolean);
    const allocatedStyles = allocateRunStyles(anchorRuns, styleRegistry);
    const hasFocusedSeries = selection.focusRunId !== null;
    const series = selection.visibleRunIds.map((runId) => {
      const run = indexes.runs.get(runId);
      const style = allocatedStyles.get(runId) || styleForRun(run, styleRegistry);
      const points = (indexes.points.get(pointKey(runId, yMetric)) || []).map((point, pointIndex) => ({
        pointIndex,
        metricId: point.metric_id || "",
        step: point.step,
        value: point.value,
        tokensSeen: finite(point.tokens_seen) ? point.tokens_seen : null,
        wallTimeSec: finite(point.wall_time_sec) ? point.wall_time_sec : null,
        split: point.split || "",
      }));
      const plotPoints = scaleMode === "tail"
        ? points.filter((point) => point.step >= domain.xMin && point.step <= domain.xMax)
        : points;
      const focused = runId === selection.focusRunId;
      const contextOpacity = profile.name === "interactive"
        ? style.status === "completed" ? 0.52 : 0.36
        : style.status === "completed" ? 0.82 : 0.68;
      const neutralOpacity = style.status === "completed"
        ? 1
        : profile.name === "interactive" ? 0.76 : 0.84;
      const contextStrokeWidth = style.strokeWidth;
      const focusStrokeWidth = Math.max(style.strokeWidth, 2.9);
      return {
        runId,
        displayName: run.display_name,
        label: labelForRun(run),
        family: style.family,
        optimizerFamily: style.optimizerFamily,
        methodGroup: style.methodGroup,
        methodLabel: style.methodLabel,
        role: style.role,
        status: style.status,
        focused,
        style: {
          ...style,
          contextOpacity,
          neutralOpacity,
          focusOpacity: 1,
          contextStrokeWidth,
          focusStrokeWidth,
          opacity: hasFocusedSeries ? focused ? 1 : contextOpacity : neutralOpacity,
          strokeWidth: focused ? focusStrokeWidth : contextStrokeWidth,
        },
        points,
        plotPoints,
        segments: splitSegments(plotPoints),
        markerPoints: [],
        endLabel: null,
      };
    });
    const grayscaleSignatures = new Map();
    for (const entry of series) {
      const signature = `${entry.style.dash || "solid"}|${entry.style.marker}`;
      if (!grayscaleSignatures.has(signature)) grayscaleSignatures.set(signature, []);
      grayscaleSignatures.get(signature).push(entry);
    }
    const styleCollisions = Array.from(grayscaleSignatures.entries())
      .filter(([, entries]) => entries.length > 1)
      .map(([signature, entries]) => ({
        signature,
        runIds: entries.map((entry) => entry.runId),
      }));
    for (const collision of styleCollisions) {
      for (const runId of collision.runIds) {
        const entry = series.find((candidate) => candidate.runId === runId);
        if (entry) entry.style.collision = true;
      }
    }

    const provisionalRuler = buildEvidenceRuler(indexes, suite, figure, series, profile);
    const layout = buildLayout(profile, provisionalRuler?.items.length || 0);
    const geometry = {
      xScale: { domain: [domain.xMin, domain.xMax], range: [layout.plot.left, layout.plot.right] },
      yScale: { domain: [domain.yMin, domain.yMax], range: [layout.plot.bottom, layout.plot.top] },
    };
    const directLabels = layoutDirectLabels(series, layout.plot, domain, layout.compact);
    const labelsByRun = new Map(directLabels.map((label) => [label.runId, label]));
    series.forEach((entry) => {
      entry.endLabel = labelsByRun.get(entry.runId) || null;
    });

    const clippingRuns = new Set();
    let clippedPointCount = 0;
    if (scaleMode === "zoom") {
      for (const entry of series) {
        for (const point of entry.points) {
          if (point.value > domain.yMax) {
            clippingRuns.add(entry.runId);
            clippedPointCount += 1;
          }
        }
      }
    }
    const clipping = {
      active: scaleMode !== "full",
      pointCount: clippedPointCount,
      runCount: clippingRuns.size,
      runIds: Array.from(clippingRuns),
      reasons: [
        scaleMode === "zoom" ? "y-maximum" : "",
        scaleMode === "tail" ? "x-window" : "",
      ].filter(Boolean),
      note: scaleMode === "zoom"
        ? clippingRuns.size
          ? `${clippingRuns.size} ${clippingRuns.size === 1 ? "series" : "series"} clipped above y=${formatNumber(domain.yMax, 2)}`
          : `Focused range y \u2264 ${formatNumber(domain.yMax, 2)}`
        : scaleMode === "tail"
          ? `Tail focus x ${formatStep(domain.xMin)}\u2013${formatStep(domain.xMax)}`
          : "",
    };

    const target = suite.target?.metric_name === yMetric && finite(suite.target?.value)
      ? {
          metricName: suite.target.metric_name,
          value: suite.target.value,
          direction: suite.target.direction || "below",
          label: figure.target_label ||
            `Target ${suite.target.direction === "above" ? "\u2265" : "\u2264"} ${formatNumber(suite.target.value, 4)}`,
        }
      : null;
    const evidenceRuler = addEvidenceGeometry(provisionalRuler, layout);
    const xTicks = niceTicks(domain.xMin, domain.xMax, layout.compact ? 4 : 6);
    const yTicks = niceTicks(domain.yMin, domain.yMax, layout.compact ? 5 : 7);
    const selectedCount = selection.visibleRunIds.length;
    const subtitleParts = [
      suite.title,
      `${selectedCount} selected ${selectedCount === 1 ? "run" : "runs"}`,
      target ? target.label.toLowerCase() : "",
      scaleLabel(scaleMode, domain),
    ].filter(Boolean);
    const snapshot = {
      schemaVersion: data?.meta?.version || "",
      generatedAt: data?.meta?.generated_at || "",
      sourceLabel: data?.meta?.title || "Curated static snapshot",
    };
    const metadata = [
      { name: "figure_id", value: figure.figure_id },
      { name: "suite_id", value: suite.suite_id },
      { name: "scale_mode", value: scaleMode },
      { name: "visible_run_ids", value: selection.visibleRunIds.join(",") },
      { name: "focus_run_id", value: selection.focusRunId || "" },
      { name: "snapshot_version", value: snapshot.schemaVersion },
      { name: "snapshot_date", value: snapshot.generatedAt },
      {
        name: "method_groups",
        value: series.map((entry) => entry.methodGroup).join(","),
      },
    ];
    return {
      schemaVersion: SCHEMA_VERSION,
      figure: {
        id: figure.figure_id,
        title: figure.title || `${suite.title} ${metricLabel(yMetric)}`,
        subtitle: subtitleParts.join(" \u00b7 "),
        caption: figure.caption || "",
        type: figure.figure_type || "loss_curve",
        xAxis: figure.x_axis || "step",
        yMetric,
        targetMarkerMetric: figure.target_marker_metric || null,
        sourceClaimIds: [...figure.source_claim_ids || []],
      },
      suite: {
        id: suite.suite_id,
        title: suite.title,
        family: suite.family || "",
        status: suite.status || "",
        primaryMetric: suite.primary_metric || "",
        target: suite.target || null,
        comparability: suite.comparability_constraints || {},
      },
      snapshot,
      request: {
        figureId: figure.figure_id,
        selectedRunIds: [...selection.selectedRunIds],
        visibleRunIds: [...selection.visibleRunIds],
        focusRunId: selection.focusRunId,
        scaleMode,
        profile: profile.name,
        width: profile.width,
        height: profile.height,
        filterSummary: String(request?.filterSummary || ""),
      },
      selection,
      profile,
      layout,
      plotRect: layout.plot,
      geometry,
      axes: {
        x: {
          key: figure.x_axis || "step",
          label: figure.x_label || metricLabel(figure.x_axis || "step"),
          domain: [domain.xMin, domain.xMax],
          ticks: xTicks,
        },
        y: {
          key: yMetric,
          label: figure.y_label || metricLabel(yMetric),
          domain: [domain.yMin, domain.yMax],
          ticks: yTicks,
        },
      },
      domain,
      series,
      target,
      clipping,
      evidenceRuler,
      directLabels,
      styleCollisions,
      metadata,
      warnings: [
        ...(selection.hiddenRunIds.length
          ? [`${selection.hiddenRunIds.length} selected run(s) hidden by filters`]
          : []),
      ],
      stats: {
        selectedRuns: selection.selectedRunIds.length,
        visibleRuns: selection.visibleRunIds.length,
        hiddenRuns: selection.hiddenRunIds.length,
        points: series.reduce((total, entry) => total + entry.points.length, 0),
        observationMarkers: series.reduce(
          (total, entry) => total + entry.markerPoints.length,
          0
        ),
        drawableSuiteRuns: drawable.length,
      },
    };
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function formatNumber(value, digits) {
    if (!finite(value)) return "n/a";
    const fixed = Number(value).toFixed(digits ?? 4);
    if (!fixed.includes(".")) return fixed;
    return fixed.replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatStep(value) {
    if (!finite(value)) return "n/a";
    const absolute = Math.abs(value);
    if (absolute >= 1000000) return `${formatNumber(value / 1000000, 1)}m`;
    if (absolute >= 1000) return `${formatNumber(value / 1000, absolute >= 10000 ? 0 : 1)}k`;
    return Math.round(value).toLocaleString("en-US");
  }

  function pathData(model, segments) {
    return segments
      .map((segment) =>
        segment
          .map((point, index) => {
            const x = linearMap(point.step, model.geometry.xScale.domain, model.geometry.xScale.range);
            const y = linearMap(point.value, model.geometry.yScale.domain, model.geometry.yScale.range);
            return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
          })
          .join(" ")
      )
      .join(" ");
  }

  function serializeStandaloneSvg(model, profileOverride) {
    if (!model?.figure || !model?.layout || !model?.geometry) {
      throw new Error("serializeStandaloneSvg requires a FigureModel.");
    }
    if (
      profileOverride &&
      finite(profileOverride.width) &&
      finite(profileOverride.height) &&
      (profileOverride.width !== model.profile.width || profileOverride.height !== model.profile.height)
    ) {
      throw new Error("Profile dimensions must match the dimensions used to build the FigureModel.");
    }
    const width = model.profile.width;
    const height = model.profile.height;
    const plot = model.plotRect;
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
      `<title>${escapeXml(model.figure.title)}</title>`,
      `<desc>${escapeXml(
        [
          model.figure.subtitle,
          model.clipping.note,
          ...model.warnings,
        ].filter(Boolean).join(". ")
      )}</desc>`,
      `<metadata>${escapeXml(JSON.stringify({
        schemaVersion: model.schemaVersion,
        figure: model.figure.id,
        suite: model.suite.id,
        scale: model.request.scaleMode,
        runIds: model.selection.visibleRunIds,
        focusRunId: model.selection.focusRunId,
        domain: model.domain,
        snapshot: model.snapshot,
        comparability: model.suite.comparability,
      }))}</metadata>`,
      "<style>",
      "text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;fill:#172033}",
      ".title{font-size:25px;font-weight:700;letter-spacing:-.4px}",
      ".subtitle{font-size:12px;fill:#667085}",
      ".tick{font-size:10px;fill:#667085;font-variant-numeric:tabular-nums}",
      ".axis-label{font-size:11px;font-weight:650;fill:#344054}",
      ".grid{stroke:#E3E9F1;stroke-width:1}",
      ".axis{stroke:#667085;stroke-width:1}",
      ".target{stroke:#344054;stroke-width:1.5;stroke-dasharray:4 4}",
      ".target-label{font-size:10px;font-weight:650;fill:#344054}",
      ".curve{fill:none;stroke-linecap:round;stroke-linejoin:round}",
      ".end-label{font-size:10px;font-weight:650}",
      ".clip-note{font-size:10px;font-weight:650;fill:#985A06}",
      ".ruler-title{font-size:11px;font-weight:700}",
      ".ruler-label{font-size:9px;fill:#475467}",
      ".ruler-marker{stroke-linecap:round}",
      ".footer{font-size:9px;fill:#667085}",
      "</style>",
      `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<text class="title" x="${plot.left}" y="38">${escapeXml(model.figure.title)}</text>`,
      `<text class="subtitle" x="${plot.left}" y="61">${escapeXml(model.figure.subtitle)}</text>`,
    ];

    if (model.clipping.note) {
      lines.push(`<text class="clip-note" x="${plot.right}" y="${plot.top - 12}" text-anchor="end">${escapeXml(model.clipping.note)}</text>`);
    }

    for (const tick of model.axes.y.ticks) {
      if (tick < model.domain.yMin || tick > model.domain.yMax) continue;
      const y = linearMap(tick, model.geometry.yScale.domain, model.geometry.yScale.range);
      lines.push(`<line class="grid" x1="${plot.left}" x2="${plot.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"/>`);
      lines.push(`<text class="tick" x="${plot.left - 10}" y="${(y + 3.5).toFixed(2)}" text-anchor="end">${escapeXml(formatNumber(tick, 2))}</text>`);
    }
    model.axes.x.ticks.forEach((tick, index, ticks) => {
      if (tick < model.domain.xMin || tick > model.domain.xMax) return;
      const x = linearMap(tick, model.geometry.xScale.domain, model.geometry.xScale.range);
      if (index > 0 && index < ticks.length - 1) {
        lines.push(`<line class="grid" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${plot.top}" y2="${plot.bottom}" opacity=".55"/>`);
      }
      const anchor = index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle";
      lines.push(`<text class="tick" x="${x.toFixed(2)}" y="${plot.bottom + 22}" text-anchor="${anchor}">${escapeXml(formatStep(tick))}</text>`);
    });
    lines.push(`<line class="axis" x1="${plot.left}" x2="${plot.left}" y1="${plot.top}" y2="${plot.bottom}"/>`);
    lines.push(`<line class="axis" x1="${plot.left}" x2="${plot.right}" y1="${plot.bottom}" y2="${plot.bottom}"/>`);
    lines.push(`<text class="axis-label" x="${(plot.left + plot.right) / 2}" y="${plot.bottom + 45}" text-anchor="middle">${escapeXml(model.axes.x.label)}</text>`);
    lines.push(`<text class="axis-label" transform="translate(${plot.left - 52} ${(plot.top + plot.bottom) / 2}) rotate(-90)" text-anchor="middle">${escapeXml(model.axes.y.label)}</text>`);

    if (model.target && model.target.value >= model.domain.yMin && model.target.value <= model.domain.yMax) {
      const y = linearMap(model.target.value, model.geometry.yScale.domain, model.geometry.yScale.range);
      lines.push(`<line class="target" x1="${plot.left}" x2="${plot.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"/>`);
      lines.push(`<text class="target-label" x="${plot.right - 5}" y="${(y - 7).toFixed(2)}" text-anchor="end">${escapeXml(model.target.label)}</text>`);
    }

    const clipId = `plot-${String(model.figure.id).replace(/[^a-z0-9_-]/gi, "-")}`;
    lines.push(`<defs><clipPath id="${clipId}"><rect x="${plot.left}" y="${plot.top}" width="${plot.width}" height="${plot.height}"/></clipPath></defs>`);
    lines.push(`<g clip-path="url(#${clipId})">`);
    const orderedSeries = [...model.series].sort((left, right) => Number(left.focused) - Number(right.focused));
    for (const entry of orderedSeries) {
      lines.push(
        `<path class="curve" d="${pathData(model, entry.segments)}" stroke="${entry.style.color}" stroke-width="${entry.style.strokeWidth}" opacity="${entry.style.opacity}"${entry.style.dash ? ` stroke-dasharray="${entry.style.dash}"` : ""}/>`
      );
    }
    lines.push("</g>");

    if (model.clipping.runCount) {
      model.series
        .filter((entry) => model.clipping.runIds.includes(entry.runId))
        .forEach((entry, index) => {
          const x = plot.left + 12 + index * 13;
          lines.push(`<path d="M${x} ${plot.top + 2} l5 -7 l5 7 Z" fill="${entry.style.color}"/>`);
        });
    }

    for (const label of model.directLabels) {
      lines.push(`<line x1="${label.connector.x1.toFixed(2)}" y1="${label.connector.y1.toFixed(2)}" x2="${label.connector.x2.toFixed(2)}" y2="${label.connector.y2.toFixed(2)}" stroke="${label.color}" stroke-width="1" opacity=".7"/>`);
      lines.push(`<text class="end-label" x="${label.x.toFixed(2)}" y="${label.y.toFixed(2)}" text-anchor="${label.textAnchor || "start"}" fill="${label.color}"${label.focused ? ' font-weight="750"' : ' opacity=".78"'}>${escapeXml(label.text)}</text>`);
    }

    if (model.evidenceRuler && model.layout.ruler) {
      const ruler = model.evidenceRuler;
      const box = model.layout.ruler;
      lines.push(`<line x1="${box.left}" x2="${box.right}" y1="${box.top - 18}" y2="${box.top - 18}" stroke="#DCE3EC"/>`);
      lines.push(`<text class="ruler-title" x="${box.left}" y="${box.top}">${escapeXml(`${ruler.label.toUpperCase()} \u00b7 ${ruler.direction === "lower" ? "LOWER IS BETTER" : "HIGHER IS BETTER"}`)}</text>`);
      for (const item of ruler.items) {
        lines.push(`<text class="ruler-label" x="${item.labelX}" y="${item.labelY}">${escapeXml(item.label)}</text>`);
        lines.push(`<line x1="${ruler.track.left}" x2="${ruler.track.right}" y1="${item.labelY - 3}" y2="${item.labelY - 3}" stroke="#E3E9F1"/>`);
        if (item.value === null) {
          lines.push(`<text class="ruler-label" x="${ruler.track.right}" y="${item.labelY}" text-anchor="end">Not reached</text>`);
        } else {
          lines.push(`<line class="ruler-marker" x1="${item.x}" x2="${item.x}" y1="${item.labelY - 9}" y2="${item.labelY + 3}" stroke="${item.color}" stroke-width="${item.focused ? 3 : 2}"/>`);
          lines.push(`<text class="ruler-label" x="${box.right}" y="${item.labelY}" text-anchor="end">${escapeXml(formatNumber(item.value, ruler.metricName.includes("step") ? 0 : 4))}</text>`);
        }
      }
    }

    const footerY = height - 22;
    const footerLeft = [
      model.figure.caption,
      model.request.filterSummary ? `Filters: ${model.request.filterSummary}` : "",
    ].filter(Boolean).join(" \u00b7 ");
    const footerRight = [
      model.snapshot.generatedAt ? `Snapshot ${model.snapshot.generatedAt}` : "",
      model.snapshot.schemaVersion ? `v${model.snapshot.schemaVersion}` : "",
    ].filter(Boolean).join(" \u00b7 ");
    lines.push(`<text class="footer" x="${plot.left}" y="${footerY}">${escapeXml(footerLeft)}</text>`);
    lines.push(`<text class="footer" x="${width - 42}" y="${footerY}" text-anchor="end">${escapeXml(footerRight)}</text>`);
    lines.push("</svg>");
    return `${lines.join("\n")}\n`;
  }

  function serializeFigureCsv(model) {
    if (!model?.series) throw new Error("serializeFigureCsv requires a FigureModel.");
    const headers = [
      "figure_id",
      "suite_id",
      "run_id",
      "display_name",
      "selection_order",
      "focused",
      "role",
      "status",
      "optimizer_family",
      "optimizer_method_group",
      "series_color",
      "line_dash",
      "marker_shape",
      "scale_mode",
      "filter_summary",
      "step",
      "metric_name",
      "value",
      "observation_marker",
      "in_domain",
      "x_domain_min",
      "x_domain_max",
      "y_domain_min",
      "y_domain_max",
      "clipped",
      "snapshot_version",
      "snapshot_date",
      "comparability",
    ];
    const comparability = JSON.stringify(model.suite.comparability || {});
    const rows = [headers];
    model.series.forEach((entry, selectionIndex) => {
      const observationMarkerIndexes = new Set(
        entry.markerPoints.map((point) => point.pointIndex)
      );
      entry.points.forEach((point) => {
        const inDomain =
          point.step >= model.domain.xMin &&
          point.step <= model.domain.xMax &&
          point.value >= model.domain.yMin &&
          point.value <= model.domain.yMax;
        rows.push([
          model.figure.id,
          model.suite.id,
          entry.runId,
          entry.displayName,
          selectionIndex + 1,
          entry.focused,
          entry.role,
          entry.status,
          entry.optimizerFamily,
          entry.methodGroup,
          entry.style.color,
          entry.style.dash || "",
          entry.style.marker,
          model.request.scaleMode,
          model.request.filterSummary,
          point.step,
          model.figure.yMetric,
          point.value,
          observationMarkerIndexes.has(point.pointIndex),
          inDomain,
          model.domain.xMin,
          model.domain.xMax,
          model.domain.yMin,
          model.domain.yMax,
          !inDomain,
          model.snapshot.schemaVersion,
          model.snapshot.generatedAt,
          comparability,
        ]);
      });
    });
    return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  }

  return Object.freeze({
    SCHEMA_VERSION,
    PROFILES,
    styleForRun,
    buildFigureModel,
    serializeStandaloneSvg,
    serializeFigureCsv,
  });
});
