(function installPortalI18n(global) {
  "use strict";

  const STORAGE_KEY = "optimizer-portal-locale-v1";
  const DEFAULT_LOCALE = "en";
  const dictionaries = {
    en: {
      "a11y.skip_workspace": "Skip to benchmark workspace",
      "a11y.home": "LLM Optimizer Benchmark home",
      "a11y.portal_sections": "Portal sections",
      "a11y.snapshot": "Snapshot overview",
      "a11y.summary_metrics": "Portal summary metrics",
      "a11y.scroll_workspace": "Scroll to benchmark workspace",
      "a11y.benchmark_navigation": "Benchmark selection",
      "a11y.experiment_suites": "Experiment suites",
      "a11y.protocol": "Active experiment protocol",
      "a11y.protocol_selector": "Protocol selector",
      "a11y.chart_tools": "Chart tools",
      "a11y.chart_scale": "Chart scale mode",
      "a11y.chart_focus": "Chart focus reset",
      "a11y.chart_export": "Chart export tools",
      "a11y.selected_runs": "Selected chart runs",
      "a11y.language": "Interface language",
      "a11y.expand_benchmarks": "Expand benchmark navigation",
      "a11y.collapse_benchmarks": "Collapse benchmark navigation",
      "a11y.return_home": "Return to portal home from {workspace}",
      "brand.archive": "Optimizer experiment archive",
      "brand.portal": "LLM Optimizer Benchmark",
      "nav.benchmarks": "Benchmarks",
      "nav.evidence": "Evidence",
      "status.snapshot": "Curated snapshot",
      "status.active": "active",
      "status.partial": "partial",
      "status.planned": "planned",
      "status.view": "cross-suite view",
      "hero.kicker": "Optimizer Experiment Archive",
      "hero.comparable": "Comparable results.",
      "hero.traceable": "Traceable runs.",
      "hero.lede": "Explore optimizer experiments without mixing models, datasets, batches, or token budgets.",
      "hero.explore": "Explore benchmarks",
      "hero.workspace": "Research workspace",
      "snapshot.model": "MODEL",
      "snapshot.data": "DATA",
      "snapshot.batch": "BATCH",
      "snapshot.budget": "BUDGET",
      "overview.groups": "benchmark groups and standalone views",
      "overview.active": "active workspaces with curated detail",
      "overview.runs": "curated runs with source trace",
      "overview.claims": "manual claim cards",
      "dock.kicker": "Benchmark index",
      "dock.title": "Models",
      "dock.protocol": "{count} protocol",
      "dock.protocols": "{count} protocols",
      "dock.single_view": "single view",
      "dock.runs": "{count} runs",
      "workspace.kicker": "Active protocol workspace",
      "workspace.intro": "One protocol, one leaderboard, and one inspectable body of evidence.",
      "workspace.active_benchmark": "{status} benchmark · {source}",
      "workspace.mapped_curves": "mapped · {count} curves",
      "coverage.label": "Evidence coverage",
      "coverage.complete": "{complete}/{mapped} runs complete",
      "coverage.curves": "{count} curves",
      "protocol.model": "Model",
      "protocol.source": "Source / dataset",
      "protocol.batch": "Batch × sequence",
      "protocol.global_batch": "Global batch × sequence",
      "protocol.budget": "Token budget",
      "protocol.target": "Target",
      "protocol.evidence": "Evidence",
      "protocol.single": "Single protocol",
      "protocol.fixed_architecture": "Fixed benchmark architecture",
      "protocol.tokens_step": "{count} tokens / step",
      "protocol.metadata_unavailable": "Protocol metadata unavailable",
      "protocol.metadata_inconsistent": "Training metadata is missing or inconsistent",
      "protocol.rank_target": "ranked by steps-to-target",
      "protocol.isolated": "Each budget is an isolated leaderboard and figure.",
      "protocol.unchanged": "Protocol unchanged",
      "evidence.mapped": "{count} mapped",
      "evidence.mapped_expected": "{mapped}/{expected} mapped",
      "evidence.complete_partial": "{complete} complete · {partial} partial",
      "evidence.nonfinite": "{nonfinite} nonfinite · {unresolved} unresolved",
      "evidence.drawable": "{count} drawable curves",
      "runs.kicker": "Run selection",
      "runs.title": "Optimizer runs",
      "runs.rank_note": "{title} · ranked by {metric}",
      "runs.chart_selection": "Chart selection",
      "runs.plotted": "{count}/{limit} plotted",
      "runs.inspect_remove": "Click to inspect · × to remove",
      "runs.curated": "Curated",
      "runs.top": "Top {count}",
      "runs.clear": "Clear",
      "runs.search": "Search",
      "runs.search_placeholder": "Search optimizer or run ID",
      "runs.showing": "Showing {visible}/{total}",
      "runs.reference": "Reference runs",
      "runs.track3_official": "Official Track 3 history",
      "runs.comparison": "Comparison runs",
      "runs.track3_ours": "Our representative runs",
      "runs.official_helper": "official source · rank-eligible",
      "runs.comparison_helper": "curated non-reference · rank-eligible",
      "runs.unranked": "Unranked evidence",
      "runs.excluded": "excluded from rank",
      "runs.no_reference": "No reference runs match the current search.",
      "runs.no_comparison": "No comparison runs match the current search.",
      "runs.no_unranked": "No unranked evidence matches the current search.",
      "runs.no_rows": "No rows match the current search.",
      "runs.table": "{title} optimizer run results",
      "runs.inspect": "Inspect {name}",
      "runs.remove": "Remove {name} from chart",
      "runs.chart_limit": "Chart is capped at {limit} runs. Remove one selected run before adding another.",
      "runs.restore_notice": "Curated chart set restored.",
      "runs.best_notice": "Top drawable runs selected by the suite leaderboard metric.",
      "runs.clear_notice": "Chart cleared. Pick rows from the tables below.",
      "runs.none_selected": "No runs selected for the chart. Pick rows from the tables below.",
      "runs.plot": "plot",
      "runs.on": "on",
      "runs.curve_unavailable": "curve unavailable",
      "runs.toggle_curve": "Toggle this run in the chart",
      "role.ours": "ours",
      "role.official": "official ref",
      "table.plot": "Plot",
      "table.rank": "Rank",
      "table.track_rank": "Track #",
      "table.run": "Run",
      "table.source": "Source",
      "table.run_type": "Run type",
      "table.best": "Best val loss",
      "table.final": "Final val loss",
      "table.last_observed": "Last val loss",
      "table.status": "Status",
      "table.curve": "Curve",
      "chart.kicker": "Observed training trajectories",
      "chart.title": "Validation loss by training step",
      "chart.scale": "Scale",
      "chart.full": "Full",
      "chart.zoom": "Zoom",
      "chart.tail": "Tail",
      "chart.emphasis": "Emphasis",
      "chart.all": "All",
      "chart.clear": "Clear",
      "chart.equal": "Equal",
      "chart.equal_title": "Show labels for every visible curve with equal visual weight",
      "chart.clear_title": "Clear emphasis and hide all curve labels",
      "chart.export": "Export",
      "chart.visible_png": "Visible PNG",
      "chart.visible_svg": "Visible SVG",
      "chart.visible_csv": "Visible CSV",
      "placeholder.kicker": "Protocol status",
      "placeholder.title": "Curated data not attached yet",
      "detail.kicker": "Run provenance",
      "detail.selected": "Selected run",
      "detail.note": "Reviewed source type and accessible evidence links.",
      "detail.no_run": "No run selected",
      "detail.no_run_body": "No curated run is available for this suite yet.",
      "detail.public_link": "Public run link available",
      "detail.local_artifact": "Local artifact retained",
      "detail.open_wandb": "Open WandB",
      "detail.open_source": "Open public source",
      "claims.kicker": "Evidence review",
      "claims.title": "Curated research claims",
      "claims.note": "Human-authored interpretations only.",
      "claims.method": "method",
      "claims.baseline": "baseline",
      "claims.supporting_runs": "supporting runs",
      "claims.baseline_runs": "baseline runs",
      "claims.caveats": "Caveats",
      "claims.sources": "Source links",
      "claims.empty": "No claim cards have been curated for this suite yet.",
      "health.kicker": "Data integrity",
      "health.title": "Snapshot coverage and checks",
      "health.summary": "Snapshot coverage",
      "footer.snapshot": "Source snapshot",
      "footer.meta": "Static · protocol-bound · source-traceable",
      "noscript": "JavaScript is required to inspect the experiment evidence.",
      "loading.snapshot": "Loading curated snapshot",
      "loading.suite": "Loading {title}",
      "status.catalog_loaded": "Curated catalog · suite loaded",
      "status.static_snapshot": "Curated static snapshot",
      "status.aggregate_fallback": "Curated static snapshot · aggregate fallback",
      "status.protocol_unchanged": "Curated snapshot · protocol unchanged"
    },
    zh: {
      "a11y.skip_workspace": "跳转到基准测试工作区",
      "a11y.home": "LLM 优化器基准首页",
      "a11y.portal_sections": "页面导航",
      "a11y.snapshot": "快照概览",
      "a11y.summary_metrics": "平台汇总指标",
      "a11y.scroll_workspace": "滚动到基准测试工作区",
      "a11y.benchmark_navigation": "基准测试选择",
      "a11y.experiment_suites": "实验基准",
      "a11y.protocol": "当前实验协议",
      "a11y.protocol_selector": "协议选择器",
      "a11y.chart_tools": "图表工具",
      "a11y.chart_scale": "图表尺度模式",
      "a11y.chart_focus": "图表重点重置",
      "a11y.chart_export": "图表导出工具",
      "a11y.selected_runs": "已选择的图表实验记录",
      "a11y.language": "界面语言",
      "a11y.expand_benchmarks": "展开基准测试导航",
      "a11y.collapse_benchmarks": "收起基准测试导航",
      "a11y.return_home": "从 {workspace} 返回平台首页",
      "brand.archive": "优化器实验档案",
      "brand.portal": "LLM 优化器评测平台",
      "nav.benchmarks": "基准测试",
      "nav.evidence": "研究证据",
      "status.snapshot": "审定实验快照",
      "status.active": "当前",
      "status.partial": "部分证据",
      "status.planned": "规划中",
      "status.view": "跨基准视图",
      "hero.kicker": "优化器实验档案",
      "hero.comparable": "可比结果。",
      "hero.traceable": "实验可追溯。",
      "hero.lede": "在模型、数据集、批大小和 Token 预算一致的协议内，审阅与比较优化器实验。",
      "hero.explore": "浏览基准测试",
      "hero.workspace": "研究工作区",
      "snapshot.model": "模型",
      "snapshot.data": "数据",
      "snapshot.batch": "批大小",
      "snapshot.budget": "预算",
      "overview.groups": "个基准组与独立视图",
      "overview.active": "个具备审定证据的活跃工作区",
      "overview.runs": "条来源可追溯的实验记录",
      "overview.claims": "条人工审定研究结论",
      "dock.kicker": "基准索引",
      "dock.title": "模型",
      "dock.protocol": "{count} 个协议",
      "dock.protocols": "{count} 个协议",
      "dock.single_view": "独立视图",
      "dock.runs": "{count} 条记录",
      "workspace.kicker": "当前协议工作区",
      "workspace.intro": "每个协议对应独立排行榜、曲线与可追溯实验记录。",
      "workspace.active_benchmark": "{status}基准 · {source}",
      "workspace.mapped_curves": "已映射 · {count} 条曲线",
      "coverage.label": "证据覆盖",
      "coverage.complete": "{complete}/{mapped} 条实验记录完成",
      "coverage.curves": "{count} 条曲线",
      "protocol.model": "模型",
      "protocol.source": "来源 / 数据集",
      "protocol.batch": "批大小 × 序列长度",
      "protocol.global_batch": "全局批大小 × 序列长度",
      "protocol.budget": "训练 Token 预算",
      "protocol.target": "目标",
      "protocol.evidence": "证据覆盖",
      "protocol.single": "单一协议",
      "protocol.fixed_architecture": "固定基准架构",
      "protocol.tokens_step": "每步 {count} Token",
      "protocol.metadata_unavailable": "协议元数据不可用",
      "protocol.metadata_inconsistent": "训练元数据缺失或不一致",
      "protocol.rank_target": "按达到目标所需步数排名",
      "protocol.isolated": "每个预算对应独立的排行榜和图表。",
      "protocol.unchanged": "协议未切换",
      "evidence.mapped": "已映射 {count}",
      "evidence.mapped_expected": "已映射 {mapped}/{expected}",
      "evidence.complete_partial": "完成 {complete} · 部分完成 {partial}",
      "evidence.nonfinite": "{nonfinite} 条非有限值 · {unresolved} 条待确认",
      "evidence.drawable": "{count} 条可绘制曲线",
      "runs.kicker": "实验记录选择",
      "runs.title": "优化器实验记录",
      "runs.rank_note": "{title} · 按 {metric} 排名",
      "runs.chart_selection": "曲线选择",
      "runs.plotted": "已绘制 {count}/{limit}",
      "runs.inspect_remove": "点击查看 · × 移除",
      "runs.curated": "审定默认",
      "runs.top": "前 {count}",
      "runs.clear": "清空",
      "runs.search": "搜索",
      "runs.search_placeholder": "搜索优化器或 run ID",
      "runs.showing": "显示 {visible}/{total}",
      "runs.reference": "正式参考记录",
      "runs.track3_official": "Track 3 官方历史",
      "runs.comparison": "审定对照记录",
      "runs.track3_ours": "自研代表记录",
      "runs.official_helper": "正式来源 · 具备排名资格",
      "runs.comparison_helper": "审定对照 · 具备排名资格",
      "runs.unranked": "非排名证据",
      "runs.excluded": "不参与排名",
      "runs.no_reference": "当前搜索没有匹配的正式参考记录。",
      "runs.no_comparison": "当前搜索没有匹配的审定对照记录。",
      "runs.no_unranked": "当前搜索没有匹配的非排名证据。",
      "runs.no_rows": "当前搜索没有匹配的实验记录。",
      "runs.table": "{title} 优化器实验结果",
      "runs.inspect": "查看 {name}",
      "runs.remove": "从图表中移除 {name}",
      "runs.chart_limit": "图表最多显示 {limit} 条实验记录，请先移除一条已选曲线。",
      "runs.restore_notice": "已恢复审定的默认曲线集合。",
      "runs.best_notice": "已按当前协议的排行榜指标选择排名最高且可绘制的实验记录。",
      "runs.clear_notice": "图表已清空，请从下方列表选择实验记录。",
      "runs.none_selected": "图表中尚未选择实验记录，请从下方列表添加。",
      "runs.plot": "绘制",
      "runs.on": "已选",
      "runs.curve_unavailable": "曲线不可用",
      "runs.toggle_curve": "切换该实验记录是否显示在图表中",
      "role.ours": "自研",
      "role.official": "官方参考",
      "table.plot": "绘图",
      "table.rank": "排名",
      "table.track_rank": "Track #",
      "table.run": "实验记录",
      "table.source": "来源",
      "table.run_type": "记录类型",
      "table.best": "最佳验证损失",
      "table.final": "最终验证损失",
      "table.last_observed": "末次验证损失",
      "table.status": "状态",
      "table.curve": "曲线",
      "chart.kicker": "已观测训练轨迹",
      "chart.title": "Validation loss by training step",
      "chart.scale": "尺度",
      "chart.full": "全程",
      "chart.zoom": "放大",
      "chart.tail": "尾段",
      "chart.emphasis": "重点",
      "chart.all": "全部等权",
      "chart.clear": "清除",
      "chart.equal": "等权",
      "chart.equal_title": "等权显示所有可见曲线及其末端名称",
      "chart.clear_title": "清除强调并隐藏所有曲线名称",
      "chart.export": "导出",
      "chart.visible_png": "可见 PNG",
      "chart.visible_svg": "可见 SVG",
      "chart.visible_csv": "可见 CSV",
      "placeholder.kicker": "协议状态",
      "placeholder.title": "尚无可展示的审定数据",
      "detail.kicker": "实验溯源",
      "detail.selected": "当前实验记录",
      "detail.note": "已核验的来源类型与可访问证据链接。",
      "detail.no_run": "尚未选择实验记录",
      "detail.no_run_body": "该基准协议尚无可用的审定实验记录。",
      "detail.public_link": "公开实验链接可用",
      "detail.local_artifact": "本地实验产物已保留",
      "detail.open_wandb": "打开 WandB",
      "detail.open_source": "打开公开来源",
      "claims.kicker": "研究证据审阅",
      "claims.title": "审定研究结论",
      "claims.note": "仅展示经人工审定的研究解读。",
      "claims.method": "方法",
      "claims.baseline": "基线",
      "claims.supporting_runs": "支持记录",
      "claims.baseline_runs": "基线记录",
      "claims.caveats": "适用边界",
      "claims.sources": "来源链接",
      "claims.empty": "该基准协议尚无审定研究结论。",
      "health.kicker": "数据质量",
      "health.title": "快照覆盖与完整性检查",
      "health.summary": "快照覆盖",
      "footer.snapshot": "来源快照",
      "footer.meta": "静态 · 协议隔离 · 来源可追溯",
      "noscript": "需要启用 JavaScript 才能审阅实验记录与研究证据。",
      "loading.snapshot": "正在加载审定实验快照",
      "loading.suite": "正在加载 {title}",
      "status.catalog_loaded": "审定快照 · 已加载",
      "status.static_snapshot": "审定静态快照",
      "status.aggregate_fallback": "审定静态快照 · 聚合回退模式",
      "status.protocol_unchanged": "审定快照 · 协议未切换"
    }
  };

  const listeners = new Set();
  const validLocale = (value) => value === "zh" || value === "en";
  const safeLocationUrl = () => {
    try {
      return global.location ? new URL(global.location.href) : null;
    } catch {
      return null;
    }
  };

  function storedLocale() {
    try {
      const value = global.localStorage?.getItem(STORAGE_KEY);
      return validLocale(value) ? value : null;
    } catch {
      return null;
    }
  }

  function resolveLocale() {
    const url = safeLocationUrl();
    const requested = url?.searchParams.get("lang");
    if (validLocale(requested)) return requested;
    return storedLocale() || DEFAULT_LOCALE;
  }

  let locale = resolveLocale();

  function t(key, variables = {}) {
    const template = dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : `{${name}}`
    );
  }

  function applyStatic(root = global.document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    const attributes = {
      "data-i18n-placeholder": "placeholder",
      "data-i18n-aria-label": "aria-label",
      "data-i18n-title": "title"
    };
    Object.entries(attributes).forEach(([dataAttribute, attribute]) => {
      root.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
        element.setAttribute(attribute, t(element.getAttribute(dataAttribute)));
      });
    });
    root.querySelectorAll("[data-locale-option]").forEach((button) => {
      const active = button.dataset.localeOption === locale;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function syncUrl() {
    const url = safeLocationUrl();
    if (!url || !global.history?.replaceState) return;
    if (locale === "zh") url.searchParams.set("lang", "zh");
    else url.searchParams.delete("lang");
    const next = `${url.pathname}${url.search}${url.hash}`;
    global.history.replaceState(null, "", next);
  }

  function setLocale(nextLocale, options = {}) {
    if (!validLocale(nextLocale)) return false;
    const previous = locale;
    locale = nextLocale;
    if (options.persist !== false) {
      try {
        global.localStorage?.setItem(STORAGE_KEY, locale);
      } catch {
        // Storage can be unavailable when opened from disk or in privacy modes.
      }
    }
    if (options.syncUrl !== false) syncUrl();
    if (global.document?.documentElement) {
      global.document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
      global.document.documentElement.dataset.locale = locale;
    }
    applyStatic(global.document);
    if (options.notify !== false && previous !== locale) {
      listeners.forEach((listener) => listener(locale, previous));
    }
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  global.PortalI18n = Object.freeze({
    STORAGE_KEY,
    dictionaries,
    resolveLocale,
    t,
    setLocale,
    applyStatic,
    subscribe,
    getLocale: () => locale
  });

  setLocale(locale, { persist: false, syncUrl: false, notify: false });
})(globalThis);
