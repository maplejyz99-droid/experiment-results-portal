const SEARCH_DEBOUNCE_MS = 140;
const BENCHMARK_DRAWER_OPEN_INTENT_MS = 100;
const BENCHMARK_DRAWER_CLOSE_GRACE_MS = 160;
const PAGE_VIEW_HOME_HASH = "#home";
const PAGE_VIEW_WORKSPACE_HASH = "#workspace-start";
const PAGE_VIEW_DETAIL_HASH = "#detailBand";

const portalI18n = globalThis.PortalI18n || {
  getLocale: () => "en",
  resolveLocale: () => "en",
  t: (key) => key,
  setLocale: () => false,
  applyStatic: () => {},
  subscribe: () => () => {},
};

function uiText(key, variables = {}) {
  return portalI18n.t(key, variables);
}

function localizedSuiteStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  const key = {
    active: "status.active",
    partial: "status.partial",
    planned: "status.planned",
    view: "status.view",
  }[normalized];
  return key ? uiText(key) : status;
}

let portalData;
let portalCatalog;
let portalLoadMode = "aggregate";
let dataIndex;
let selectedSuiteId;
let selectedRunId;
let selectedChartRunIds = new Set();
let rankedRunGroupState = {};
let chartSelectionNotice = "";
let chartScaleMode = "full";
let focusedChartRunIds = new Set();
let chartLabelMode = "none";
let runFilterText = "";
let runSearchTimer = 0;
let chartResizeFrame = 0;
let chartResizeObserver;
let currentChartModel = null;
let activeSuiteShardId = null;
let pendingSuiteId = null;
let protocolSwitchError = "";
let suiteLoadGeneration = 0;
let revealControllerInstalled = false;
let entryControllerInstalled = false;
let initialEntryResolved = false;
let benchmarkDrawerOpen = false;
let benchmarkDrawerOpenTimer = 0;
let benchmarkDrawerCloseTimer = 0;
let benchmarkDrawerTrigger = null;
let benchmarkDrawerControllerInstalled = false;
let benchmarkDrawerPointerInside = false;
let benchmarkDrawerPointerDownInside = false;
let benchmarkDrawerKeyboardFocusInside = false;
let benchmarkDrawerLoadingHold = 0;
let benchmarkDrawerSuiteActivationHold = false;
let localeControllerInstalled = false;
let pageViewSyncFrame = 0;
let pageViewUrlSyncEnabled = false;
let pendingPageViewHash = "";

const suiteShardCache = new Map();
const suiteShardRequests = new Map();

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function normalizedPageViewHash(hash) {
  const value = String(hash || "");
  if (value === "#suiteLandingAnchor") return PAGE_VIEW_WORKSPACE_HASH;
  if ([PAGE_VIEW_HOME_HASH, PAGE_VIEW_WORKSPACE_HASH, PAGE_VIEW_DETAIL_HASH].includes(value)) {
    return value;
  }
  if (value.length > 1) return value;
  return "";
}

const initialDeepLinkState = (() => {
  if (!globalThis.location) {
    return {
      suite: false,
      hash: "",
      pageHash: "",
    };
  }
  try {
    const params = new URLSearchParams(globalThis.location.search || "");
    const suite = params.has("suite");
    const hash = globalThis.location.hash || "";
    return {
      suite,
      hash,
      pageHash: normalizedPageViewHash(hash),
    };
  } catch {
    return {
      suite: false,
      hash: "",
      pageHash: "",
    };
  }
})();
let activePageViewHash = initialDeepLinkState.pageHash;
let benchmarkWorkspaceEngaged = Boolean(
  activePageViewHash && activePageViewHash !== PAGE_VIEW_HOME_HASH
);

function byId(id) {
  return document.getElementById(id);
}

function prefersReducedMotion() {
  return Boolean(
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );
}

function pageViewHashFromViewport() {
  if (!globalThis.document) {
    return activePageViewHash || PAGE_VIEW_HOME_HASH;
  }
  const topbarHeight =
    globalThis.document.querySelector(".topbar")?.getBoundingClientRect?.().height || 0;
  const viewportHeight = Math.max(0, Number(globalThis.innerHeight) || 0);
  const probeLine = topbarHeight + Math.min(220, Math.max(96, viewportHeight * 0.25));
  const detail = byId("detailBand");
  if (
    detail &&
    !detail.hidden &&
    (detail.getBoundingClientRect?.().top ?? Number.POSITIVE_INFINITY) <= probeLine
  ) {
    return PAGE_VIEW_DETAIL_HASH;
  }
  const workspace = byId("workspace-start");
  if (
    workspace &&
    (workspace.getBoundingClientRect?.().top ?? Number.POSITIVE_INFINITY) <= probeLine
  ) {
    return PAGE_VIEW_WORKSPACE_HASH;
  }
  return PAGE_VIEW_HOME_HASH;
}

function writePageViewHash(hash, { push = false } = {}) {
  const normalized = normalizedPageViewHash(hash);
  if (!normalized) return false;
  activePageViewHash = normalized;
  if (!globalThis.location || !globalThis.history?.replaceState) return false;
  const url = new URL(globalThis.location.href);
  if (url.hash === normalized) return false;
  url.hash = normalized;
  const nextLocation = `${url.pathname}${url.search}${url.hash}`;
  if (push && typeof globalThis.history.pushState === "function") {
    globalThis.history.pushState(globalThis.history.state, "", nextLocation);
  } else {
    globalThis.history.replaceState(globalThis.history.state, "", nextLocation);
  }
  return true;
}

function syncPageViewHashFromViewport() {
  if (!pageViewUrlSyncEnabled) return false;
  const nextHash = pageViewHashFromViewport();
  if (pendingPageViewHash && nextHash !== pendingPageViewHash) return false;
  if (pendingPageViewHash === nextHash) pendingPageViewHash = "";
  return writePageViewHash(nextHash);
}

function schedulePageViewHashSync() {
  if (!pageViewUrlSyncEnabled || pageViewSyncFrame) return;
  const sync = () => {
    pageViewSyncFrame = 0;
    syncPageViewHashFromViewport();
  };
  if (typeof globalThis.requestAnimationFrame === "function") {
    pageViewSyncFrame = globalThis.requestAnimationFrame(sync);
  } else {
    sync();
  }
}

function cancelPendingPageViewNavigation() {
  pendingPageViewHash = "";
  schedulePageViewHashSync();
}

function revealDeepLinkTargets(elements) {
  const targets = new Set();
  const addClosestReveal = (element) => {
    const revealElement = element?.closest?.("[data-reveal]");
    if (revealElement && elements.includes(revealElement)) targets.add(revealElement);
  };

  if (initialDeepLinkState.hash.length > 1) {
    try {
      addClosestReveal(byId(decodeURIComponent(initialDeepLinkState.hash.slice(1))));
    } catch {
      // An invalid fragment should not prevent the rest of the portal from revealing.
    }
  }
  if (initialDeepLinkState.suite && initialDeepLinkState.hash !== "#home") {
    addClosestReveal(byId("suite-title"));
  }
  return targets;
}

function installRevealController() {
  if (revealControllerInstalled) return;
  revealControllerInstalled = true;

  const root = document.documentElement;
  const elements = Array.from(document.querySelectorAll("[data-reveal]"));
  const reveal = (element) => element.classList.add("is-revealed");

  if (!elements.length) {
    root.classList.add("reveal-ready");
    return;
  }

  if (
    prefersReducedMotion() ||
    typeof globalThis.IntersectionObserver !== "function"
  ) {
    elements.forEach(reveal);
    root.classList.add("reveal-ready");
    return;
  }

  const immediateTargets = revealDeepLinkTargets(elements);
  immediateTargets.forEach(reveal);

  const observer = new globalThis.IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        observer.unobserve(entry.target);
      });
    },
    {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08,
    }
  );

  elements.forEach((element) => {
    if (!immediateTargets.has(element)) observer.observe(element);
  });
  root.classList.add("reveal-ready");
}

function desktopBenchmarkDock() {
  return Boolean(globalThis.matchMedia?.("(min-width: 1120px)")?.matches);
}

function clearBenchmarkDrawerTimers() {
  clearTimeout(benchmarkDrawerOpenTimer);
  clearTimeout(benchmarkDrawerCloseTimer);
  benchmarkDrawerOpenTimer = 0;
  benchmarkDrawerCloseTimer = 0;
}

function setBenchmarkDrawerOpen(open, { restoreFocus = false } = {}) {
  const dock = byId("benchmarkDock");
  const toggle = byId("benchmarkDrawerToggle");
  const nextOpen = Boolean(open && desktopBenchmarkDock());
  const wasOpen = benchmarkDrawerOpen;
  benchmarkDrawerOpen = nextOpen;
  document.documentElement.classList.toggle("benchmark-drawer-open", nextOpen);
  dock?.setAttribute("data-drawer-open", String(nextOpen));
  toggle?.setAttribute("aria-expanded", String(nextOpen));
  toggle?.setAttribute(
    "aria-label",
    nextOpen
      ? uiText("a11y.collapse_benchmarks")
      : uiText("a11y.expand_benchmarks")
  );

  if (nextOpen) {
    clearBenchmarkDrawerTimers();
    if (!wasOpen) {
      const selected = dock?.querySelector(".suite-card[aria-pressed=\"true\"]");
      selected?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
    }
    return;
  }

  if (restoreFocus) {
    const focusTarget =
      benchmarkDrawerTrigger?.isConnected ? benchmarkDrawerTrigger : toggle;
    focusTarget?.focus({ preventScroll: true });
  }
}

function benchmarkPointerInsideDockBounds(event, dock = byId("benchmarkDock")) {
  if (!dock) return false;
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return dock.contains(event?.target);
  }
  const rect = dock.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function syncBenchmarkDrawerAvailability(available) {
  const dock = byId("benchmarkDock");
  if (!dock) return;
  const nextAvailable = Boolean(available);
  if (typeof dock.toggleAttribute === "function") {
    dock.toggleAttribute("inert", !nextAvailable);
  } else if (nextAvailable) {
    dock.removeAttribute?.("inert");
  } else {
    dock.setAttribute("inert", "");
  }
  dock.setAttribute("aria-hidden", String(!nextAvailable));
  if (nextAvailable) return;

  benchmarkDrawerPointerInside = false;
  benchmarkDrawerPointerDownInside = false;
  benchmarkDrawerSuiteActivationHold = false;
  benchmarkDrawerKeyboardFocusInside = false;
  benchmarkDrawerLoadingHold = 0;
  clearBenchmarkDrawerTimers();
  setBenchmarkDrawerOpen(false);
}

function benchmarkDrawerCloseBlocked() {
  return Boolean(
    benchmarkDrawerLoadingHold ||
      benchmarkDrawerSuiteActivationHold ||
      benchmarkDrawerPointerInside ||
      benchmarkDrawerKeyboardFocusInside
  );
}

function scheduleBenchmarkDrawerClose() {
  clearTimeout(benchmarkDrawerCloseTimer);
  benchmarkDrawerCloseTimer = 0;
  if (benchmarkDrawerCloseBlocked()) return;
  benchmarkDrawerCloseTimer = globalThis.setTimeout(() => {
    benchmarkDrawerCloseTimer = 0;
    if (benchmarkDrawerCloseBlocked()) return;
    setBenchmarkDrawerOpen(false);
  }, BENCHMARK_DRAWER_CLOSE_GRACE_MS);
}

function scheduleBenchmarkDrawerOpen() {
  clearTimeout(benchmarkDrawerOpenTimer);
  benchmarkDrawerOpenTimer = 0;
  if (benchmarkDrawerOpen || !desktopBenchmarkDock()) return;
  benchmarkDrawerOpenTimer = globalThis.setTimeout(() => {
    benchmarkDrawerOpenTimer = 0;
    if (benchmarkDrawerPointerInside || benchmarkDrawerLoadingHold) {
      setBenchmarkDrawerOpen(true);
    }
  }, BENCHMARK_DRAWER_OPEN_INTENT_MS);
}

function holdBenchmarkDrawerForSuiteLoad(generation) {
  if (!desktopBenchmarkDock()) return;
  benchmarkDrawerLoadingHold = generation;
  setBenchmarkDrawerOpen(true);
}

function releaseBenchmarkDrawerSuiteLoad(generation, { failed = false } = {}) {
  if (benchmarkDrawerLoadingHold !== generation) return;
  benchmarkDrawerLoadingHold = 0;
  if (failed) {
    setBenchmarkDrawerOpen(true);
    return;
  }
  if (!benchmarkDrawerCloseBlocked()) {
    scheduleBenchmarkDrawerClose();
  }
}

function installBenchmarkDrawerController() {
  if (benchmarkDrawerControllerInstalled) return;
  benchmarkDrawerControllerInstalled = true;
  const dock = byId("benchmarkDock");
  const toggle = byId("benchmarkDrawerToggle");
  if (!dock || !toggle) return;

  toggle.addEventListener("click", () => {
    benchmarkDrawerTrigger = toggle;
    if (benchmarkDrawerOpen) benchmarkDrawerSuiteActivationHold = false;
    clearBenchmarkDrawerTimers();
    setBenchmarkDrawerOpen(!benchmarkDrawerOpen);
  });
  dock.addEventListener("pointerenter", () => {
    benchmarkDrawerPointerInside = true;
    clearTimeout(benchmarkDrawerCloseTimer);
    benchmarkDrawerCloseTimer = 0;
    scheduleBenchmarkDrawerOpen();
  });
  dock.addEventListener("pointerleave", (event) => {
    if (benchmarkPointerInsideDockBounds(event, dock)) {
      benchmarkDrawerPointerInside = true;
      return;
    }
    // Replacing the selected suite card can synthesize pointerleave even though
    // the physical pointer never left the fixed drawer.  A suite-card
    // activation therefore owns the open state until document-level
    // pointermove confirms a real coordinate outside the stable dock bounds.
    if (benchmarkDrawerSuiteActivationHold) return;
    benchmarkDrawerPointerInside = false;
    clearTimeout(benchmarkDrawerOpenTimer);
    benchmarkDrawerOpenTimer = 0;
    if (benchmarkDrawerOpen) scheduleBenchmarkDrawerClose();
  });
  dock.addEventListener("pointerdown", (event) => {
    benchmarkDrawerPointerDownInside = true;
    benchmarkDrawerKeyboardFocusInside = false;
    if (event.target.closest(".suite-card")) {
      benchmarkDrawerSuiteActivationHold = true;
      clearBenchmarkDrawerTimers();
      setBenchmarkDrawerOpen(true);
    }
  });
  const releasePointerDown = () => {
    if (!benchmarkDrawerPointerDownInside) return;
    globalThis.setTimeout(() => {
      benchmarkDrawerPointerDownInside = false;
    }, 0);
  };
  document.addEventListener("pointerup", releasePointerDown);
  document.addEventListener("pointercancel", releasePointerDown);
  document.addEventListener("pointermove", (event) => {
    if (!benchmarkDrawerSuiteActivationHold) return;
    if (benchmarkPointerInsideDockBounds(event, dock)) {
      benchmarkDrawerPointerInside = true;
      return;
    }
    benchmarkDrawerPointerInside = false;
    benchmarkDrawerSuiteActivationHold = false;
    if (benchmarkDrawerOpen) scheduleBenchmarkDrawerClose();
  });
  dock.addEventListener("focusin", () => {
    if (benchmarkDrawerPointerDownInside) return;
    benchmarkDrawerKeyboardFocusInside = true;
    clearBenchmarkDrawerTimers();
    setBenchmarkDrawerOpen(true);
  });
  dock.addEventListener("focusout", (event) => {
    if (dock.contains(event.relatedTarget)) return;
    const pointerOrigin = benchmarkDrawerPointerDownInside;
    globalThis.setTimeout(() => {
      benchmarkDrawerKeyboardFocusInside =
        !pointerOrigin &&
        !benchmarkDrawerPointerDownInside &&
        dock.contains(document.activeElement);
      if (!benchmarkDrawerKeyboardFocusInside && benchmarkDrawerOpen) {
        scheduleBenchmarkDrawerClose();
      }
    }, 0);
  });
  dock.addEventListener("keydown", (event) => {
    benchmarkDrawerPointerDownInside = false;
    if (event.key === "Escape" && benchmarkDrawerOpen) {
      event.preventDefault();
      benchmarkDrawerSuiteActivationHold = false;
      benchmarkDrawerKeyboardFocusInside = false;
      clearBenchmarkDrawerTimers();
      setBenchmarkDrawerOpen(false, { restoreFocus: true });
      return;
    }
    benchmarkDrawerKeyboardFocusInside = true;
    clearBenchmarkDrawerTimers();
    setBenchmarkDrawerOpen(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!benchmarkDrawerOpen || dock.contains(event.target)) return;
    benchmarkDrawerPointerDownInside = false;
    benchmarkDrawerSuiteActivationHold = false;
    benchmarkDrawerKeyboardFocusInside = false;
    clearBenchmarkDrawerTimers();
    setBenchmarkDrawerOpen(false);
  });
  globalThis.matchMedia?.("(min-width: 1120px)")?.addEventListener?.("change", () => {
    benchmarkDrawerPointerInside = false;
    benchmarkDrawerPointerDownInside = false;
    benchmarkDrawerSuiteActivationHold = false;
    benchmarkDrawerKeyboardFocusInside = false;
    benchmarkDrawerLoadingHold = 0;
    clearBenchmarkDrawerTimers();
    setBenchmarkDrawerOpen(false);
  });
}

function renderLocalizedInterface() {
  const pageScroll = {
    left: Number(globalThis.scrollX) || 0,
    top: Number(globalThis.scrollY) || 0,
  };
  const focusState = captureFocusState();
  captureRankedRunGroupScroll();
  const listScroll = captureRunListScroll();

  portalI18n.applyStatic(document);
  if (portalData) {
    const suite = activeSuite();
    renderOverview();
    renderSuiteCards();
    renderSuiteHeader(suite);
    renderProtocolContext(suite);
    renderDataHealth();
    if (suiteHasDetail(suite)) {
      renderLeaderboard();
      renderChartModeSwitch();
      renderChartEmphasisSwitch();
      renderRunDetail();
      renderClaims();
      restoreRunListScroll(listScroll);
      restoreRankedRunGroupScroll(suite.suite_id);
    } else {
      renderPlaceholder(suite);
    }
    const statusState = document.querySelector(".source-pill")?.dataset.state;
    if (pendingSuiteId) {
      setPortalStatus(
        uiText("loading.suite", {
          title: catalogSuiteById(pendingSuiteId)?.title || pendingSuiteId,
        }),
        "loading"
      );
    } else if (statusState !== "error") {
      setPortalStatus(
        portalLoadMode === "catalog"
          ? uiText("status.catalog_loaded")
          : uiText("status.static_snapshot"),
        "ready"
      );
    }
  }
  portalI18n.applyStatic(document);
  restoreFocusState(focusState);
  if (typeof globalThis.scrollTo === "function") {
    globalThis.scrollTo({ ...pageScroll, behavior: "auto" });
  }
  updateTopbarState();
}

function installLocaleController() {
  if (localeControllerInstalled) return;
  localeControllerInstalled = true;
  document.querySelectorAll("[data-locale-option]").forEach((button) => {
    button.addEventListener("click", () => {
      portalI18n.setLocale(button.dataset.localeOption);
    });
  });
  portalI18n.subscribe(() => renderLocalizedInterface());
  portalI18n.applyStatic(document);
}

function updateTopbarState() {
  const root = document.documentElement;
  const isScrolled = globalThis.scrollY > 24;
  root.classList.toggle("topbar-scrolled", isScrolled);
  const topbar = document.querySelector(".topbar");
  topbar?.classList.toggle("is-scrolled", isScrolled);
  const workspace = byId("workspace-start");
  if (!workspace) return;
  const workspaceTop = workspace.getBoundingClientRect().top;
  const workspaceVisible = workspaceTop < globalThis.innerHeight * 0.82;
  root.classList.toggle("workspace-visible", workspaceVisible);
  const workspaceMode =
    workspaceTop <= (topbar?.getBoundingClientRect().height || 82) + 12;
  const workspaceEnteredFromHero = workspaceVisible && isScrolled;
  if (workspaceMode || workspaceEnteredFromHero) {
    benchmarkWorkspaceEngaged = true;
  }
  const workspaceContextActive =
    workspaceMode || (benchmarkWorkspaceEngaged && workspaceEnteredFromHero);
  const benchmarkNavigationActive = Boolean(
    benchmarkDrawerLoadingHold || pendingSuiteId
  );
  const benchmarkDockAvailable =
    benchmarkWorkspaceEngaged && (workspaceVisible || benchmarkNavigationActive);
  root.classList.toggle("workspace-mode", workspaceContextActive);
  root.classList.toggle("benchmark-dock-available", benchmarkDockAvailable);
  syncBenchmarkDrawerAvailability(benchmarkDockAvailable);
  const identity = document.querySelector(".topbar-identity");
  identity?.setAttribute(
    "aria-label",
    workspaceContextActive
      ? uiText("a11y.return_home", {
          workspace:
            byId("workspaceTopbarTitle")?.textContent || "benchmark workspace",
        })
      : uiText("a11y.home")
  );
}

function installEntryController() {
  if (entryControllerInstalled) return;
  entryControllerInstalled = true;

  document.querySelectorAll('a[href="#workspace-start"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void navigateToPageView(PAGE_VIEW_WORKSPACE_HASH, {
        push: true,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
  });

  document.querySelectorAll('a[href="#home"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void navigateToPageView(PAGE_VIEW_HOME_HASH, {
        push: true,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
  });

  document.querySelectorAll('a[href="#detailBand"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void navigateToPageView(PAGE_VIEW_DETAIL_HASH, {
        push: true,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
  });

  globalThis.addEventListener?.("scroll", () => {
    updateTopbarState();
    schedulePageViewHashSync();
  }, { passive: true });
  globalThis.addEventListener?.("wheel", cancelPendingPageViewNavigation, {
    passive: true,
  });
  globalThis.addEventListener?.("touchstart", cancelPendingPageViewNavigation, {
    passive: true,
  });
  installLocaleController();
  installBenchmarkDrawerController();
  updateTopbarState();
}

function suiteLandingOffset() {
  const topbarHeight =
    document.querySelector(".topbar")?.getBoundingClientRect?.().height || 0;
  const benchmarkDock = byId("benchmarkDock");
  const mobilePickerHeight =
    !desktopBenchmarkDock() && benchmarkDock
      ? benchmarkDock.getBoundingClientRect?.().height || 0
      : 0;
  return Math.ceil(topbarHeight + mobilePickerHeight + 12);
}

function scrollToPortalHome({ behavior = "auto" } = {}) {
  benchmarkWorkspaceEngaged = false;
  document.documentElement.classList.remove("benchmark-dock-available");
  syncBenchmarkDrawerAvailability(false);

  return new Promise((resolve) => {
    const scroll = () => {
      if (typeof globalThis.scrollTo === "function") {
        globalThis.scrollTo({ left: 0, top: 0, behavior });
      } else {
        byId("home")?.scrollIntoView?.({ behavior, block: "start" });
      }
      updateTopbarState();
      resolve(true);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(scroll);
      });
    } else {
      scroll();
    }
  });
}

function scrollToSuiteLanding(
  { generation = suiteLoadGeneration, behavior = "auto" } = {}
) {
  return new Promise((resolve) => {
    const scroll = () => {
      if (generation !== suiteLoadGeneration) {
        resolve(false);
        return;
      }
      const target =
        byId("protocolContext") ||
        byId("suiteLandingAnchor") ||
        byId("workspace-start");
      if (!target) {
        resolve(false);
        return;
      }
      const top =
        (Number(globalThis.scrollY) || 0) +
        (target.getBoundingClientRect?.().top || 0) -
        suiteLandingOffset();
      if (typeof globalThis.scrollTo === "function") {
        globalThis.scrollTo({ top: Math.max(0, top), behavior });
      } else {
        target.scrollIntoView?.({ behavior, block: "start" });
      }
      if (globalThis.document?.documentElement) updateTopbarState();
      resolve(true);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(scroll);
      });
    } else {
      scroll();
    }
  });
}

function scrollToDetailLanding(
  { generation = suiteLoadGeneration, behavior = "auto" } = {}
) {
  return new Promise((resolve) => {
    const scroll = () => {
      if (generation !== suiteLoadGeneration) {
        resolve(false);
        return;
      }
      const target = byId("detailBand");
      if (!target || target.hidden) {
        resolve(false);
        return;
      }
      target.scrollIntoView?.({ behavior, block: "start" });
      updateTopbarState();
      resolve(true);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(scroll);
      });
    } else {
      scroll();
    }
  });
}

async function navigateToPageView(
  hash,
  {
    push = false,
    behavior = "auto",
    generation = suiteLoadGeneration,
  } = {}
) {
  const targetHash = normalizedPageViewHash(hash);
  if (!targetHash) {
    return resolveUnspecifiedPageView({ generation });
  }
  pendingPageViewHash = targetHash;
  writePageViewHash(targetHash, { push });

  let landed = false;
  if (targetHash === PAGE_VIEW_HOME_HASH) {
    landed = await scrollToPortalHome({ behavior });
  } else if (targetHash === PAGE_VIEW_WORKSPACE_HASH) {
    benchmarkWorkspaceEngaged = true;
    updateTopbarState();
    landed = await scrollToSuiteLanding({ generation, behavior });
  } else if (targetHash === PAGE_VIEW_DETAIL_HASH) {
    benchmarkWorkspaceEngaged = true;
    updateTopbarState();
    landed = await scrollToDetailLanding({ generation, behavior });
  } else {
    const target = byId(targetHash.slice(1));
    target?.scrollIntoView?.({ behavior, block: "start" });
    landed = Boolean(target);
  }

  pageViewUrlSyncEnabled = true;
  schedulePageViewHashSync();
  return landed;
}

function resolveUnspecifiedPageView({ generation = suiteLoadGeneration } = {}) {
  return new Promise((resolve) => {
    const resolveFromViewport = () => {
      if (generation !== suiteLoadGeneration) {
        resolve(false);
        return;
      }
      const restoredPageHash = pageViewHashFromViewport();
      pendingPageViewHash = "";
      writePageViewHash(restoredPageHash);
      benchmarkWorkspaceEngaged = restoredPageHash !== PAGE_VIEW_HOME_HASH;
      pageViewUrlSyncEnabled = true;
      if (globalThis.document) updateTopbarState();
      resolve(true);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(resolveFromViewport);
      });
    } else {
      resolveFromViewport();
    }
  });
}

function restoreViewportScroll(
  scrollState,
  { generation = suiteLoadGeneration } = {}
) {
  if (!scrollState) return Promise.resolve(false);
  return new Promise((resolve) => {
    const restore = () => {
      if (generation !== suiteLoadGeneration) {
        resolve(false);
        return;
      }
      if (typeof globalThis.scrollTo === "function") {
        globalThis.scrollTo({
          left: Math.max(0, Number(scrollState.left) || 0),
          top: Math.max(0, Number(scrollState.top) || 0),
          behavior: "auto",
        });
      }
      if (globalThis.document?.documentElement) updateTopbarState();
      resolve(true);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(restore);
    } else {
      restore();
    }
  });
}

function resolveInitialEntry() {
  if (initialEntryResolved) return;
  initialEntryResolved = true;
  void navigateToPageView(initialDeepLinkState.pageHash, {
    behavior: "auto",
  });
}

async function commitSuiteViewUpdate(
  commit,
  { generation, initial = false } = {}
) {
  const transitionDocument = globalThis.document;
  const startViewTransition = transitionDocument?.startViewTransition;
  let callbackStarted = false;
  let committed = false;
  const guardedCommit = () => {
    callbackStarted = true;
    if (generation !== suiteLoadGeneration) return;
    commit();
    committed = true;
  };

  if (
    initial ||
    prefersReducedMotion() ||
    typeof startViewTransition !== "function"
  ) {
    guardedCommit();
    return committed;
  }

  let transition;
  try {
    transition = startViewTransition.call(transitionDocument, guardedCommit);
  } catch {
    guardedCommit();
    return committed;
  }

  try {
    await transition.updateCallbackDone;
    return committed;
  } catch {
    if (!callbackStarted && generation === suiteLoadGeneration) {
      guardedCommit();
    }
    return committed;
  }
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

function navigationDrawerTitle(entry) {
  const title = navigationEntryTitle(entry);
  if (/modded-nanogpt.*track\s*3/iu.test(title)) return "TRACK3";
  return title;
}

function navigationShortLabel(entry) {
  const title = navigationEntryTitle(entry);
  if (/modded-nanogpt.*track\s*3/iu.test(title)) return "Track3";
  if (/memory\s*\/\s*speed/iu.test(title)) return "M·S";
  if (/mup\s+scaling/iu.test(title)) return "μP";
  const size = title.match(/\b(\d+(?:\.\d+)?\s*[mb])\b/iu);
  if (size) return size[1].replace(/\s+/gu, "").toUpperCase();
  return title
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.slice(0, 3))
    .join("·") || "View";
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

function defaultChartRunIds(suite) {
  const figure = figureForSuite(suite);
  return figure?.run_ids?.length ? figure.run_ids : suiteRuns(suite.suite_id).map((run) => run.run_id);
}

function initializeChartSelection(suite) {
  selectedChartRunIds = new Set(defaultChartRunIds(suite));
  focusedChartRunIds = new Set();
  chartLabelMode = "none";
  chartSelectionNotice = "";
}

function resetRunFilters() {
  runFilterText = "";
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

function chartFocusRunIds() {
  const suite = activeSuite();
  if (!suite) return [];
  const visibleRunIds = new Set(chartVisibleRuns(suite).map((entry) => entry.run_id));
  return Array.from(focusedChartRunIds).filter((runId) => {
    const run = runById(runId);
    return run?.suite_id === suite.suite_id &&
      selectedChartRunIds.has(runId) &&
      visibleRunIds.has(runId);
  });
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

function summaryMetricText(runId, metricName) {
  const metric = summaryMetric(runId, metricName);
  return metric ? formatMetricValue(metricName, metric.value) : "n/a";
}

function roleLabel(run) {
  if (run.run_role === "ours") return uiText("role.ours");
  if (run.run_role === "official_reference") return uiText("role.official");
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
  return selectedChartRuns(suite);
}

function chartFilterSummary() {
  return "";
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
    focusRunIds: chartFocusRunIds(),
    labelMode: chartLabelMode,
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
  focusedChartRunIds = new Set(
    Array.from(focusedChartRunIds).filter((runId) => selectedChartRunIds.has(runId))
  );
  if (!focusedChartRunIds.size && chartLabelMode === "focused") chartLabelMode = "none";
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
  const rankLabel = run.leaderboard_meta?.rank_label;
  const prefix = rankLabel && !/^R\d+\b/iu.test(run.display_name)
    ? `${rankLabel} `
    : "";
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
  return uiText(suite.family === "track3" ? "table.source" : "table.run_type");
}

function targetStatus(row, suite) {
  const primary = primaryMetricName(suite);
  if (!suite.target?.metric_name || !primary.includes("steps_to_target")) return null;
  return row.metrics[primary] ? "reached" : "not_reached";
}

function filteredRows(rows) {
  const needle = runFilterText.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => rowSearchText(row).includes(needle));
}

function sortedUnique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function unrankedEvidenceHelper(rows) {
  const priority = new Map([
    ["partial", 0],
    ["diverged", 1],
    ["stopped", 2],
  ]);
  const statuses = Array.from(new Set(rows.map((row) => row.run.status).filter(Boolean)))
    .sort((left, right) => {
      const leftPriority = priority.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priority.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority || left.localeCompare(right);
    })
    .map((status) => status.replaceAll("_", " "));
  return [...statuses, uiText("runs.excluded")].join(" · ");
}

function toggleChartRun(runId, shouldSelect) {
  const suite = activeSuite();
  const limit = chartSelectionLimit(suite);
  const run = runById(runId);
  if (!run || !curveAvailable(run, suite)) return;

  chartSelectionNotice = "";
  if (shouldSelect) {
    if (!selectedChartRunIds.has(runId) && chartSelectionCount(suite) >= limit) {
      chartSelectionNotice = uiText("runs.chart_limit", { limit });
      return;
    }
    selectedChartRunIds.add(runId);
    return;
  }

  selectedChartRunIds.delete(runId);
  focusedChartRunIds.delete(runId);
  if (!focusedChartRunIds.size && chartLabelMode === "focused") chartLabelMode = "none";
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
  const focusedIds = new Set(chartFocusRunIds());
  const hasFocusedRuns = focusedIds.size > 0;
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
  ];
  document.querySelectorAll(chartSelectors.join(",")).forEach((element) => {
    const focused = focusedIds.has(element.dataset.runId);
    element.classList.toggle("active", focused);
    element.setAttribute("aria-pressed", String(focused));
  });

  document.querySelectorAll("#lossChart [data-chart-run-id]").forEach((element) => {
    const runId = element.dataset.chartRunId;
    const focused = focusedIds.has(runId);
    const labeled = chartLabelMode === "all" ||
      (chartLabelMode === "focused" && focused);
    const opacity = focused
      ? element.dataset.focusOpacity
      : hasFocusedRuns
        ? element.dataset.contextOpacity
        : element.dataset.neutralOpacity;
    const strokeWidth = focused
      ? element.dataset.focusStrokeWidth
      : element.dataset.baseStrokeWidth;
    if (opacity) element.setAttribute("opacity", opacity);
    if (strokeWidth) element.setAttribute("stroke-width", strokeWidth);
    element.classList.toggle("selected", focused);
    element.classList.toggle("is-selected", focused);
    element.classList.toggle("is-context", hasFocusedRuns && !focused);
    if (element.classList.contains("series-end-label") || element.classList.contains("series-end-connector")) {
      element.classList.toggle("is-label-hidden", !labeled);
      element.setAttribute("visibility", labeled ? "visible" : "hidden");
      element.setAttribute("aria-hidden", String(!labeled));
    }
    element.setAttribute("aria-current", String(focused));
  });

  const curveLayer = document.querySelector("#lossChart [data-curve-layer=\"series\"]");
  if (curveLayer && hasFocusedRuns) {
    Array.from(curveLayer.children)
      .filter((element) => focusedIds.has(element.dataset.chartRunId))
      .forEach((element) => curveLayer.appendChild(element));
  }
}

function clearChartFocus({ updateUrl = true } = {}) {
  const changed = focusedChartRunIds.size > 0 || chartLabelMode !== "none";
  focusedChartRunIds = new Set();
  chartLabelMode = "none";
  if (byId("chartEmphasisSwitch")) renderChartEmphasisSwitch();
  updateSelectedRunVisuals();
  if (updateUrl) syncUrlState();
  return changed;
}

function showAllChartLabels({ updateUrl = true } = {}) {
  const changed = focusedChartRunIds.size > 0 || chartLabelMode !== "all";
  focusedChartRunIds = new Set();
  chartLabelMode = "all";
  if (byId("chartEmphasisSwitch")) renderChartEmphasisSwitch();
  updateSelectedRunVisuals();
  if (updateUrl) syncUrlState();
  return changed;
}

function toggleChartFocus(runId, { updateUrl = true } = {}) {
  const suite = activeSuite();
  const run = runById(runId);
  if (!run || !suite || run.suite_id !== suite.suite_id || !selectedChartRunIds.has(runId)) {
    return false;
  }
  if (focusedChartRunIds.has(runId)) focusedChartRunIds.delete(runId);
  else focusedChartRunIds.add(runId);
  chartLabelMode = focusedChartRunIds.size ? "focused" : "none";
  if (byId("chartEmphasisSwitch")) renderChartEmphasisSwitch();
  updateSelectedRunVisuals();
  if (updateUrl) syncUrlState();
  return true;
}

function selectRun(runId, { updateUrl = true, focusChart = false } = {}) {
  const run = runById(runId);
  const suite = activeSuite();
  if (!run || !suite || run.suite_id !== suite.suite_id) return false;
  selectedRunId = run.run_id;
  if (focusChart && selectedChartRunIds.has(run.run_id)) {
    toggleChartFocus(run.run_id, { updateUrl: false });
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
  runFilterText = params.get("q") || "";
  const requestedRun = runById(params.get("run"));
  selectedRunId = requestedRun?.suite_id === suite.suite_id
    ? requestedRun.run_id
    : firstChartRun(suite)?.run_id || null;
  const requestedFocusIds = params.getAll("focus").filter((runId) => {
    const run = runById(runId);
    return run?.suite_id === suite.suite_id && selectedChartRunIds.has(runId);
  });
  if (!requestedFocusIds.length && params.get("emphasis") === "selected" && selectedRunId) {
    requestedFocusIds.push(selectedRunId);
  }
  focusedChartRunIds = new Set(requestedFocusIds);
  chartLabelMode = focusedChartRunIds.size
    ? "focused"
    : params.get("labels") === "all"
      ? "all"
      : "none";
}

function syncUrlState({ push = false } = {}) {
  if (!globalThis.location || !globalThis.history?.replaceState || !selectedSuiteId) return;
  const url = new URL(globalThis.location.href);
  url.searchParams.set("suite", selectedSuiteId);
  if (selectedRunId) url.searchParams.set("run", selectedRunId);
  else url.searchParams.delete("run");
  url.searchParams.set("scale", chartScaleMode);
  url.searchParams.delete("focus");
  chartFocusRunIds().forEach((runId) => url.searchParams.append("focus", runId));
  if (chartLabelMode === "all") url.searchParams.set("labels", "all");
  else url.searchParams.delete("labels");
  url.searchParams.delete("emphasis");
  const search = runFilterText.trim();
  if (search) url.searchParams.set("q", search);
  else url.searchParams.delete("q");
  ["role", "family", "status", "target", "curve"].forEach((name) => {
    url.searchParams.delete(name);
  });
  if (portalI18n.getLocale() === "zh") url.searchParams.set("lang", "zh");
  else url.searchParams.delete("lang");
  if (activePageViewHash) url.hash = activePageViewHash;
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
    [String(totalSuites), uiText("overview.groups")],
    [String(activeSuites), uiText("overview.active")],
    [String(curatedRuns), uiText("overview.runs")],
    [String(claimCards), uiText("overview.claims")],
  ]
    .map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function updateWorkspaceTopbar(suite) {
  const entry = navigationEntryForSuite(suite.suite_id);
  const title = entry?.kind === "group" ? navigationEntryTitle(entry) : suite.title;
  const isTrack3 = suite.suite_id === "track3";
  const source = protocolSourceCoordinate(suite);
  const batch = protocolBatchCoordinate(suite);
  const budget = protocolBudgetCoordinate(suite);
  const evidence = suiteEvidenceSummary(suite);
  const expected = evidence.expected ?? evidence.mapped;
  const track3Coordinate = isTrack3 ? track3ProtocolCoordinate(suite) : null;
  const coordinates = isTrack3
    ? [
        "FineWeb10B",
        track3Coordinate
          ? `${track3Coordinate.globalBatchSequences} × ${track3Coordinate.sequenceLength}`
          : uiText("protocol.metadata_unavailable"),
        "Target ≤ 3.28",
      ]
    : [
        source.dataset,
        batch.label === "Not specified" ? "" : batch.label,
        budget.label === "Not specified" ? "" : budget.label,
      ].filter(Boolean);

  byId("workspaceTopbarKicker").textContent = uiText(
    "workspace.active_benchmark",
    {
      status: localizedSuiteStatus(suite.status),
      source: isTrack3 ? "Official Track 3" : source.label,
    }
  );
  byId("workspaceTopbarTitle").textContent =
    isTrack3
      ? "Track 3 Benchmark"
      : /\bbenchmark\b/iu.test(title)
        ? title
        : `${title} Benchmark`;
  byId("workspaceTopbarCoordinate").textContent = coordinates.join(" · ");
  byId("workspaceTopbarEvidence").innerHTML = `
    <strong>${escapeHtml(`${evidence.mapped}/${expected}`)}</strong>
    <span>${escapeHtml(uiText("workspace.mapped_curves", { count: evidence.drawable }))}</span>
  `;
}

function renderSuiteHeader(suite) {
  const navigationEntry = navigationEntryForSuite(suite.suite_id);
  const evidence = suiteEvidenceSummary(suite);
  const completed = evidence.complete;
  const mapped = evidence.mapped;
  const drawable = evidence.drawable;

  byId("suite-title").textContent =
    navigationEntry?.kind === "group"
      ? navigationEntryTitle(navigationEntry)
      : suite.title;
  updateWorkspaceTopbar(suite);
  byId("targetBox").innerHTML = `
    <span class="target-box-label">${escapeHtml(uiText("coverage.label"))}</span>
    <strong>${escapeHtml(uiText("coverage.complete", { complete: completed, mapped }))}</strong>
    <span class="target-box-value">${escapeHtml(uiText("coverage.curves", { count: drawable }))}</span>
    <span class="target-box-meta">${escapeHtml(localizedSuiteStatus(suite.status))} · ${escapeHtml(suite.family)} · static snapshot</span>
  `;
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
      const stackDepth = protocolCount > 1 ? Math.min(protocolCount, 3) : 0;
      const stackAttributes =
        stackDepth > 0
          ? ` data-stack-depth="${stackDepth}" data-protocol-count="${protocolCount}"`
          : "";
      const protocolCountLabel = protocolCount
        ? uiText(protocolCount === 1 ? "dock.protocol" : "dock.protocols", {
            count: protocolCount,
          })
        : uiText("dock.single_view");
      return `
        <button class="suite-card suite-rail-item ${stackDepth > 0 ? "suite-card-stacked" : ""} suite-status-${escapeHtml(status)} ${isSelected ? "selected" : ""} ${isPending ? "pending" : ""} ${status === "view" ? "view-card" : ""}" type="button" data-suite-id="${escapeHtml(targetSuiteId)}" data-benchmark-group-id="${escapeHtml(entry.id)}" data-suite-status="${escapeHtml(status)}"${stackAttributes} aria-label="${escapeHtml(navigationDrawerTitle(entry))}" aria-pressed="${isSelected}" aria-busy="${isPending}">
          <span class="benchmark-rail-abbr" aria-hidden="true">${escapeHtml(navigationShortLabel(entry))}</span>
          <span class="suite-rail-status" aria-hidden="true"></span>
          <span class="suite-rail-copy">
            <strong>${escapeHtml(navigationDrawerTitle(entry))}</strong>
            <span class="suite-rail-meta">
              <span>${escapeHtml(protocolCountLabel)}</span>
              <span>${escapeHtml(uiText("dock.runs", { count: evidence.mapped || 0 }))}</span>
            </span>
          </span>
        </button>
      `;
    })
    .join("");

  byId("suiteCards").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const benchmarkGroupId = button.dataset.benchmarkGroupId;
      const pointerActivated = event.detail > 0 || benchmarkDrawerPointerDownInside;
      if (desktopBenchmarkDock()) {
        benchmarkDrawerTrigger = button;
        setBenchmarkDrawerOpen(true);
      }
      if (button.getAttribute("aria-pressed") === "true" && !pendingSuiteId) {
        if (!pointerActivated) button.focus({ preventScroll: true });
        void navigateToPageView(PAGE_VIEW_WORKSPACE_HASH, {
          push: true,
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
        return;
      }
      await requestSuiteChange(button.dataset.suiteId, {
        push: true,
        focusGroupId: benchmarkGroupId,
        navigationIntent: "benchmark",
        restoreNavigationFocus: !pointerActivated,
      });
    });
  });
}

function protocolEvidenceText(summary) {
  const coverage =
    summary.expected === null
      ? uiText("evidence.mapped", { count: summary.mapped })
      : uiText("evidence.mapped_expected", {
          mapped: summary.mapped,
          expected: summary.expected,
        });
  return {
    coverage,
    status: uiText("evidence.complete_partial", {
      complete: summary.complete,
      partial: summary.partial,
    }),
    caveat:
      summary.nonfinite || summary.unresolved
        ? uiText("evidence.nonfinite", {
            nonfinite: summary.nonfinite,
            unresolved: summary.unresolved,
          })
        : uiText("evidence.drawable", { count: summary.drawable }),
  };
}

function track3ProtocolCoordinate(suite) {
  const runs = suiteRuns(suite?.suite_id);
  if (!runs.length) return null;

  const coordinates = runs.map((run) => ({
    globalBatchTokens: Number(run?.training?.global_batch_tokens),
    sequenceLength: Number(run?.training?.sequence_length),
  }));
  const complete = coordinates.every(
    ({ globalBatchTokens, sequenceLength }) =>
      Number.isFinite(globalBatchTokens) &&
      globalBatchTokens > 0 &&
      Number.isFinite(sequenceLength) &&
      sequenceLength > 0
  );
  if (!complete) return null;

  const [{ globalBatchTokens, sequenceLength }] = coordinates;
  const consistent = coordinates.every(
    (coordinate) =>
      coordinate.globalBatchTokens === globalBatchTokens &&
      coordinate.sequenceLength === sequenceLength
  );
  const globalBatchSequences = globalBatchTokens / sequenceLength;
  if (!consistent || !Number.isInteger(globalBatchSequences) || globalBatchSequences <= 0) {
    return null;
  }

  return {
    globalBatchSequences,
    globalBatchTokens,
    sequenceLength,
  };
}

function renderProtocolEvidence(evidenceText) {
  return protocolSwitchError
    ? `<strong class="protocol-inline-error">${escapeHtml(uiText("protocol.unchanged"))}</strong>
       <small class="protocol-inline-error-detail" title="${escapeHtml(protocolSwitchError)}">${escapeHtml(protocolSwitchError)}</small>`
    : `<strong>${escapeHtml(evidenceText.coverage)}</strong>
       <small>${escapeHtml(evidenceText.status)}</small>
       <small>${escapeHtml(evidenceText.caveat)}</small>`;
}

function renderTrack3ProtocolContext(suite, evidenceText) {
  const coordinate = track3ProtocolCoordinate(suite);
  const batchValue = coordinate
    ? `${coordinate.globalBatchSequences} × ${coordinate.sequenceLength}`
    : uiText("protocol.metadata_unavailable");
  const batchDetail = coordinate
    ? uiText("protocol.tokens_step", {
        count: intFmt.format(coordinate.globalBatchTokens),
      })
    : uiText("protocol.metadata_inconsistent");

  return `
    <div class="protocol-ledger-grid protocol-ledger-grid-track3">
      <div class="protocol-ledger-cell protocol-model-cell">
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.model"))}</span>
        <span class="protocol-static-value" title="GPT-2 style · 124M">GPT-2 style · 124M</span>
        <small>${escapeHtml(uiText("protocol.fixed_architecture"))}</small>
      </div>
      <div class="protocol-ledger-cell protocol-source-cell">
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.source"))}</span>
        <span class="protocol-static-value" title="Official Track 3 · FineWeb10B">Official Track 3 · FineWeb10B</span>
        <small>GPT-2 tokenizer</small>
      </div>
      <div class="protocol-ledger-cell protocol-batch-cell">
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.global_batch"))}</span>
        <span class="protocol-static-value" title="${escapeHtml(batchValue)}">${escapeHtml(batchValue)}</span>
        <small title="${escapeHtml(batchDetail)}">${escapeHtml(batchDetail)}</small>
      </div>
      <div class="protocol-ledger-cell protocol-target-cell">
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.target"))}</span>
        <span class="protocol-static-value" title="Validation loss ≤ 3.28">Validation loss ≤ 3.28</span>
        <small>${escapeHtml(uiText("protocol.rank_target"))}</small>
      </div>
      <div class="protocol-ledger-cell protocol-evidence-cell" ${protocolSwitchError ? 'role="alert"' : 'aria-live="polite"'}>
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.evidence"))}</span>
        ${renderProtocolEvidence(evidenceText)}
      </div>
    </div>
  `;
}

function renderProtocolContext(suite) {
  const mount = byId("protocolSelector");
  if (!mount) return;
  const entry = navigationEntryForSuite(suite?.suite_id);
  const protocolSuites = sortedProtocolSuites(entry?.suites || []);
  const hasProtocolControls = Boolean(suite?.protocol && entry && protocolSuites.length);

  const currentSource = protocolSourceCoordinate(suite);
  const currentBatch = protocolBatchCoordinate(suite);
  const currentBudget = protocolBudgetCoordinate(suite);
  const sources = hasProtocolControls
    ? Array.from(
        new Map(
          protocolSuites.map((candidate) => {
            const coordinate = protocolSourceCoordinate(candidate);
            return [coordinate.key, coordinate];
          })
        ).values()
      )
    : [];
  const sourceSuites = hasProtocolControls
    ? protocolSuites.filter(
        (candidate) => protocolSourceCoordinate(candidate).key === currentSource.key
      )
    : [];
  const batches = hasProtocolControls
    ? Array.from(
        new Map(
          sourceSuites.map((candidate) => {
            const coordinate = protocolBatchCoordinate(candidate);
            return [coordinate.key, coordinate];
          })
        ).values()
      )
    : [];
  const budgetSuites = hasProtocolControls
    ? sourceSuites.filter(
        (candidate) => protocolBatchCoordinate(candidate).key === currentBatch.key
      )
    : [];
  const evidence = suiteEvidenceSummary(suite);
  const evidenceText = protocolEvidenceText(evidence);

  mount.hidden = false;
  mount.dataset.loading = pendingSuiteId ? "true" : "false";
  if (suite?.suite_id === "track3") {
    mount.innerHTML = renderTrack3ProtocolContext(suite, evidenceText);
    return;
  }

  const sourceControl =
    !hasProtocolControls
      ? `<span class="protocol-static-value" title="${escapeHtml(uiText("protocol.single"))}">${escapeHtml(uiText("protocol.single"))}</span>`
      : sources.length > 1
      ? `<div class="protocol-choice-row" role="group" aria-label="${escapeHtml(uiText("protocol.source"))}">
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
      : `<span class="protocol-static-value" title="${escapeHtml(currentSource.label)}">${escapeHtml(currentSource.label)}</span>`;

  const batchControl =
    batches.length > 1
      ? `<div class="protocol-choice-row" role="group" aria-label="${escapeHtml(uiText("protocol.global_batch"))}">
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
      : `<span class="protocol-static-value" title="${escapeHtml(currentBatch.label)}">${escapeHtml(currentBatch.label)}</span>`;

  const budgetControl =
    budgetSuites.length > 1
      ? `<div class="protocol-budget-row" role="group" aria-label="${escapeHtml(uiText("protocol.budget"))}">
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
        </div>`
      : `<span class="protocol-static-value" title="${escapeHtml(currentBudget.label)}">${escapeHtml(currentBudget.label)}</span>`;

  const tokensPerStep =
    currentBatch.tokensPerStep === null
      ? uiText("protocol.metadata_unavailable")
      : uiText("protocol.tokens_step", {
          count: intFmt.format(currentBatch.tokensPerStep),
        });
  const paper = suite?.protocol?.paper;
  const sourceNote = paper?.arxiv_id
    ? `${paper.arxiv_id}${paper.section ? ` · ${paper.section}` : ""}`
    : suite?.protocol?.source_kind === "current_curated"
      ? "Local curated benchmark"
      : hasProtocolControls
        ? "Curated static source"
        : "Single suite protocol";

  mount.innerHTML = `
    <div class="protocol-ledger-grid">
      <div class="protocol-ledger-cell protocol-source-cell" title="${escapeHtml(sourceNote)}">
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.source"))}</span>
        ${sourceControl}
        <small title="${escapeHtml(currentSource.dataset)}">${escapeHtml(currentSource.dataset)}</small>
      </div>
      <div class="protocol-ledger-cell protocol-batch-cell">
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.batch"))}</span>
        ${batchControl}
        <small title="${escapeHtml(tokensPerStep)}">${escapeHtml(tokensPerStep)}</small>
      </div>
      <div class="protocol-ledger-cell protocol-budget-cell">
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.budget"))}</span>
        ${budgetControl}
        <small title="${escapeHtml(uiText("protocol.isolated"))}">${escapeHtml(uiText("protocol.isolated"))}</small>
      </div>
      <div class="protocol-ledger-cell protocol-evidence-cell" ${protocolSwitchError ? 'role="alert"' : 'aria-live="polite"'}>
        <span class="protocol-ledger-label">${escapeHtml(uiText("protocol.evidence"))}</span>
        ${renderProtocolEvidence(evidenceText)}
      </div>
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
        navigationIntent: "protocol",
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
  byId("placeholder-status").textContent = localizedSuiteStatus(suite.status);
  byId("placeholderBody").innerHTML = `
    <div class="placeholder-grid">
      ${metricLine("suite_id", suite.suite_id)}
      ${metricLine("status", localizedSuiteStatus(suite.status))}
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
    return `<p class="muted wide-muted">${escapeHtml(uiText("runs.none_selected"))}</p>`;
  }
  return `
    <div class="selected-run-list">
      ${selected
        .map(
          (run) => `
            <div class="selected-run-item">
              <button class="selected-run-pill ${run.run_id === selectedRunId ? "active" : ""}" type="button" data-run-id="${escapeHtml(run.run_id)}" aria-pressed="${run.run_id === selectedRunId}" title="${escapeHtml(runChipLabel(run, suite))}">
                <span class="legend-swatch" style="background:${runColor(run)}"></span>
                <span class="selected-run-label">${escapeHtml(runChipLabel(run, suite))}</span>
              </button>
              <button class="remove-run" type="button" data-remove-run-id="${escapeHtml(run.run_id)}" aria-label="${escapeHtml(uiText("runs.remove", { name: run.display_name }))}">×</button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function plotCell(run, suite) {
  const checked = selectedChartRunIds.has(run.run_id);
  const disabled = !curveAvailable(run, suite);
  const reason = disabled ? uiText("runs.curve_unavailable") : uiText("runs.toggle_curve");
  const action = checked
    ? uiText("runs.remove", { name: run.display_name })
    : `${uiText("runs.plot")} ${run.display_name}`;
  return `
    <label class="plot-toggle ${disabled ? "disabled" : ""}" title="${escapeHtml(reason)}">
      <input type="checkbox" data-run-id="${escapeHtml(run.run_id)}" aria-label="${escapeHtml(`${action}${disabled ? `, ${uiText("runs.curve_unavailable")}` : ""}`)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span>${escapeHtml(uiText(checked ? "runs.on" : "runs.plot"))}</span>
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
  if (primary === "last_observed_val_loss") return uiText("table.last_observed");
  return primary.replaceAll("_", " ");
}

function metricValueWithOptionalStep(metricName, metric) {
  if (!metric) return "n/a";
  const value = formatMetricValue(metricName, metric.value);
  return Number.isFinite(metric.step) ? `${value} @ ${intFmt.format(metric.step)}` : value;
}

function tableColumnsForRows(suite, rows) {
  const isTrack3 = suite.suite_id === "track3";
  const primary = primaryMetricName(suite);
  const allowedStatuses = new Set(suite.leaderboard_eligibility?.allowed_status || []);
  const roles = sortedUnique(rows.map((row) => row.run.run_role));
  const columns = ["plot", "rank", "run", "primary"];
  if (isTrack3) {
    columns.push("curve");
  } else {
    columns.push("best");
    if (primary !== "last_observed_val_loss") columns.push("final");
  }
  if (roles.length > 1) columns.push("role");
  if (rows.some((row) => !allowedStatuses.has(row.run.status))) {
    columns.push("status");
  }
  return columns;
}

function tableHeader(column, suite) {
  const labels = {
    plot: uiText("table.plot"),
    rank: uiText(suite.suite_id === "track3" ? "table.track_rank" : "table.rank"),
    run: uiText("table.run"),
    role: roleFilterLabel(suite),
    primary: primaryColumnLabel(suite),
    best: uiText("table.best"),
    final: uiText("table.final"),
    status: uiText("table.status"),
    curve: uiText("table.curve"),
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
  const track3TableClass = suite.suite_id === "track3" ? "track3-table-wrap" : "";
  return `
    <div class="table-wrap ${tableClass} ${track3TableClass}">
      <table class="run-results-table ${suite.suite_id === "track3" ? "track3-run-results-table" : ""}" aria-label="${escapeHtml(uiText("runs.table", { title: suite.title }))}">
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
                <tr class="${run.run_id === selectedRunId ? "selected" : ""}" data-run-id="${escapeHtml(run.run_id)}" tabindex="0" aria-selected="${run.run_id === selectedRunId}" aria-label="${escapeHtml(uiText("runs.inspect", { name: run.display_name }))}">
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
      <button type="button" data-chart-action="default">${escapeHtml(uiText("runs.curated"))}</button>
      <button type="button" data-chart-action="best">${escapeHtml(uiText("runs.top", { count: Math.min(chartSelectionLimit(suite), selectableChartRuns(suite).length) }))}</button>
      <button type="button" data-chart-action="clear">${escapeHtml(uiText("runs.clear"))}</button>
    </div>
  `;
}

function renderRunFilters(rows, visibleCount) {
  return `
    <div class="run-filters run-search-only" aria-label="${escapeHtml(uiText("runs.search"))}">
      <label class="run-search">
        <span>${escapeHtml(uiText("runs.search"))}</span>
        <input id="runSearch" type="search" value="${escapeHtml(runFilterText)}" placeholder="${escapeHtml(uiText("runs.search_placeholder"))}" autocomplete="off" />
      </label>
      <span class="filter-summary" aria-live="polite">${escapeHtml(uiText("runs.showing", { visible: visibleCount, total: rows.length }))}</span>
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
        setChartSelection(suite, defaultChartRunIds(suite), uiText("runs.restore_notice"));
      } else if (action === "best") {
        setChartSelection(suite, bestChartRunIds(suite), uiText("runs.best_notice"));
      } else if (action === "clear") {
        setChartSelection(suite, [], uiText("runs.clear_notice"));
      }
      refreshRunViews();
    });
  });

  const search = byId("runSearch");
  if (search) {
    const refreshSearchResults = (focusState) => {
      renderLeaderboard({ preserveScroll: false });
      restoreFocusState(focusState);
      syncUrlState();
    };
    search.addEventListener("input", () => {
      runFilterText = search.value;
      const focusState = {
        id: "runSearch",
        selectionStart: search.selectionStart,
        selectionEnd: search.selectionEnd,
      };
      clearTimeout(runSearchTimer);
      runSearchTimer = setTimeout(() => {
        refreshSearchResults(focusState);
      }, SEARCH_DEBOUNCE_MS);
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        clearTimeout(runSearchTimer);
        runFilterText = "";
        search.value = "";
        refreshSearchResults({
          id: "runSearch",
          selectionStart: 0,
          selectionEnd: 0,
        });
        return;
      }
      if (event.key !== "Enter") return;
      clearTimeout(runSearchTimer);
      refreshSearchResults({
        id: "runSearch",
        selectionStart: search.selectionStart,
        selectionEnd: search.selectionEnd,
      });
    });
  }
}

function captureRunListScroll() {
  const viewport = byId("leaderboardContent")?.querySelector(".run-list-viewport");
  return viewport
    ? { top: viewport.scrollTop, left: viewport.scrollLeft }
    : null;
}

function restoreRunListScroll(scrollState) {
  if (!scrollState) return;
  const viewport = byId("leaderboardContent")?.querySelector(".run-list-viewport");
  if (!viewport) return;
  viewport.scrollTop = scrollState.top;
  viewport.scrollLeft = scrollState.left;
}

function rankedRunGroupStateForSuite(suiteId, initialActive = "local") {
  if (!rankedRunGroupState[suiteId]) {
    rankedRunGroupState[suiteId] = {
      active: initialActive,
      scroll: {
        official: { top: 0, left: 0 },
        local: { top: 0, left: 0 },
        unranked: { top: 0, left: 0 },
      },
    };
  }
  return rankedRunGroupState[suiteId];
}

function captureRankedRunGroupScroll() {
  const viewport = byId("leaderboardContent")?.querySelector(
    ".ranked-run-group-body-viewport[data-run-group]"
  );
  const stack = viewport?.closest?.(".ranked-run-group-stack[data-suite-id]");
  const group = viewport?.dataset.runGroup;
  const suiteId = stack?.dataset.suiteId;
  if (!viewport || !suiteId || !["official", "local", "unranked"].includes(group)) return;
  const state = rankedRunGroupStateForSuite(suiteId);
  state.scroll[group] = {
    top: viewport.scrollTop,
    left: viewport.scrollLeft,
  };
}

function restoreRankedRunGroupScroll(suiteId) {
  const state = rankedRunGroupStateForSuite(suiteId);
  const viewport = byId("leaderboardContent")?.querySelector(
    `.ranked-run-group-body-viewport[data-run-group="${state.active}"]`
  );
  if (!viewport) return;
  const scroll = state.scroll[state.active] || { top: 0, left: 0 };
  viewport.scrollTop = scroll.top;
  viewport.scrollLeft = scroll.left;
}

function rankedRunGroupCount(visibleCount, totalCount) {
  return runFilterText.trim()
    ? `${visibleCount}/${totalCount}`
    : String(totalCount);
}

function renderRankedRunGroup({ suite, group, label, helper, rows, totalCount, active }) {
  const toggleId = `ranked-run-group-${group}-toggle`;
  const panelId = `ranked-run-group-${group}-panel`;
  const emptyMessage = uiText(
    group === "official"
      ? "runs.no_reference"
      : group === "unranked"
        ? "runs.no_unranked"
        : "runs.no_comparison"
  );
  return `
    <section class="ranked-run-group-section ${active ? "is-active" : "is-inactive"}" data-run-group-section="${group}">
      <button
        id="${toggleId}"
        class="ranked-run-group-toggle"
        type="button"
        data-ranked-run-group="${group}"
        aria-expanded="${active}"
        aria-controls="${panelId}"
      >
        <span>${escapeHtml(label)} (${rankedRunGroupCount(rows.length, totalCount)})</span>
        <span class="muted">${escapeHtml(helper)}</span>
        <span class="ranked-run-group-indicator" aria-hidden="true">${active ? "−" : "+"}</span>
      </button>
      <div
        id="${panelId}"
        class="ranked-run-group-panel"
        role="region"
        aria-labelledby="${toggleId}"
        ${active ? "" : "hidden"}
      >
        ${active ? `
          <div class="ranked-run-group-body-viewport" data-run-group="${group}" tabindex="0">
            ${rows.length
              ? leaderboardTable(suite, rows, 1, "compact-table scroll-table")
              : `<p class="empty-table-note">${escapeHtml(emptyMessage)}</p>`}
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function referenceRunForSuite(suite, run) {
  if (run.run_role === "official_reference") return true;
  return suite?.protocol?.source_kind === "paper_main_benchmark" &&
    run.run_role === "baseline" &&
    run.source?.source_type === "wandb_archive";
}

function renderLeaderboard({ preserveScroll = true } = {}) {
  if (preserveScroll) captureRankedRunGroupScroll();
  const previousScroll = preserveScroll ? captureRunListScroll() : null;
  const suite = activeSuite();
  const rows = eligibleRows(suite).map((row, index) => ({
    ...row,
    displayRank: row.primaryMetric ? String(index + 1) : "—",
  }));
  const unranked = unrankedRows(suite).map((row) => ({
    ...row,
    displayRank: "—",
  }));
  const filterableRows = [...rows, ...unranked];
  const visibleRows = filteredRows(rows);
  const visibleUnranked = filteredRows(unranked);
  const referenceRows = visibleRows.filter((row) => referenceRunForSuite(suite, row.run));
  const localRows = visibleRows.filter((row) => !referenceRunForSuite(suite, row.run));
  const hasReferenceAndLocal =
    rows.some((row) => referenceRunForSuite(suite, row.run)) &&
    rows.some((row) => !referenceRunForSuite(suite, row.run));

  if (!selectedRunId && rows.length) selectedRunId = rows[0].run.run_id;

  const navigationEntry = navigationEntryForSuite(suite.suite_id);
  byId("leaderboard-title").textContent = uiText("runs.title");
  byId("leaderboardNote").textContent = uiText("runs.rank_note", {
    title: navigationEntryTitle(navigationEntry),
    metric: primaryColumnLabel(suite),
  });

  const selectionBlock = `
    <div class="selected-chart-box">
      <div class="mini-heading">
        <div>
          <strong>${escapeHtml(uiText("runs.chart_selection"))}</strong>
          <span>${escapeHtml(uiText("runs.plotted", { count: chartSelectionCount(suite), limit: chartSelectionLimit(suite) }))}</span>
        </div>
        <span class="muted">${escapeHtml(uiText("runs.inspect_remove"))}</span>
      </div>
      ${renderSelectedChartRows(suite)}
      ${renderSelectionActions(suite)}
      ${chartSelectionNotice ? `<p class="selection-notice">${escapeHtml(chartSelectionNotice)}</p>` : ""}
    </div>
    ${renderRunFilters(filterableRows, visibleRows.length + visibleUnranked.length)}
  `;
  const unrankedBlock = unranked.length
    ? `
      <details class="history-details unranked-evidence section-callout">
        <summary>
          <span>${escapeHtml(uiText("runs.unranked"))} (${visibleUnranked.length}/${unranked.length})</span>
          <span class="muted">${escapeHtml(unrankedEvidenceHelper(unranked))}</span>
        </summary>
        ${
          visibleUnranked.length
            ? leaderboardTable(
                suite,
                visibleUnranked,
                1,
                "compact-table scroll-table unranked-table"
              )
            : `<p class="empty-table-note">${escapeHtml(uiText("runs.no_unranked"))}</p>`
        }
      </details>
    `
    : "";

  if (hasReferenceAndLocal) {
    const referenceLabel = uiText(
      suite.suite_id === "track3" ? "runs.track3_official" : "runs.reference"
    );
    const localLabel = uiText(
      suite.suite_id === "track3" ? "runs.track3_ours" : "runs.comparison"
    );
    const referenceHelper = uiText("runs.official_helper");
    const localHelper = uiText("runs.comparison_helper");
    const hasPlottedUnranked = unranked.some((row) =>
      selectedChartRunIds.has(row.run.run_id)
    );
    const state = rankedRunGroupStateForSuite(
      suite.suite_id,
      hasPlottedUnranked ? "unranked" : "local"
    );
    if (!preserveScroll) {
      state.scroll[state.active] = { top: 0, left: 0 };
    }
    const allReferenceRows = rows.filter((row) => referenceRunForSuite(suite, row.run));
    const allLocalRows = rows.filter((row) => !referenceRunForSuite(suite, row.run));
    byId("leaderboardContent").innerHTML = `
      ${selectionBlock}
      <div class="run-list-viewport ranked-run-list-viewport" role="region" aria-label="${escapeHtml(uiText("runs.table", { title: navigationEntryTitle(navigationEntry) }))}">
        <div class="ranked-run-group-stack" data-suite-id="${escapeHtml(suite.suite_id)}">
          ${renderRankedRunGroup({
            suite,
            group: "official",
            label: referenceLabel,
            helper: referenceHelper,
            rows: referenceRows,
            totalCount: allReferenceRows.length,
            active: state.active === "official",
          })}
          ${renderRankedRunGroup({
            suite,
            group: "local",
            label: localLabel,
            helper: localHelper,
            rows: localRows,
            totalCount: allLocalRows.length,
            active: state.active === "local",
          })}
          ${unranked.length
            ? renderRankedRunGroup({
                suite,
                group: "unranked",
                label: uiText("runs.unranked"),
                helper: unrankedEvidenceHelper(unranked),
                rows: visibleUnranked,
                totalCount: unranked.length,
                active: state.active === "unranked",
              })
            : ""}
        </div>
      </div>
    `;
    byId("leaderboardContent")
      .querySelectorAll("[data-ranked-run-group]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const nextGroup = button.dataset.rankedRunGroup;
          const currentState = rankedRunGroupStateForSuite(suite.suite_id);
          if (nextGroup === currentState.active) return;
          captureRankedRunGroupScroll();
          currentState.active = nextGroup;
          const focusState = { id: `ranked-run-group-${nextGroup}-toggle` };
          renderLeaderboard();
          restoreFocusState(focusState);
        });
      });
    bindLeaderboardInteractions();
    restoreRankedRunGroupScroll(suite.suite_id);
    return;
  }

  byId("leaderboardContent").innerHTML = `
    ${selectionBlock}
    <div class="run-list-viewport" role="region" aria-label="${escapeHtml(uiText("runs.table", { title: navigationEntryTitle(navigationEntry) }))}" tabindex="0">
      <details class="history-details optimizer-details section-callout" open>
        <summary>
          <span>${escapeHtml(uiText("runs.title"))} (${visibleRows.length}/${rows.length})</span>
          <span class="muted">${escapeHtml(uiText("runs.rank_note", { title: "", metric: primaryColumnLabel(suite) }).replace(/^\s*·\s*/u, ""))}</span>
        </summary>
        ${visibleRows.length ? leaderboardTable(suite, visibleRows, 1, "compact-table scroll-table") : `<p class="empty-table-note">${escapeHtml(uiText("runs.no_rows"))}</p>`}
      </details>
      ${unrankedBlock}
    </div>
  `;
  bindLeaderboardInteractions();
  restoreRunListScroll(previousScroll);
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function applySvgAttributes(element, attrs = {}) {
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function bindChartPathInteractions(path) {
  if (path.dataset.chartInteractionBound === "true") return;
  path.dataset.chartInteractionBound = "true";
  path.addEventListener("click", () => {
    selectRun(path.dataset.chartRunId, { focusChart: true });
  });
  path.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectRun(path.dataset.chartRunId, { focusChart: true });
  });
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

function chartRunChipLabel(run, suite) {
  if (suite?.suite_id !== "track3") return shortRunLabel(run);
  const rank = run.leaderboard_meta?.official_rank;
  const label = Number.isInteger(rank)
    ? `R${String(rank).padStart(2, "0")} ${run.optimizer?.name || run.display_name}`
    : run.display_name;
  return compactTooltipText(label, 24);
}

function renderChartModeSwitch() {
  const modeSwitch = byId("chartModeSwitch");
  const tailDomain = tailStepDomain(activeSuite());
  modeSwitch.innerHTML = `
    <span class="chart-mode-label">${escapeHtml(uiText("chart.scale"))}</span>
    <button type="button" class="${chartScaleMode === "full" ? "active" : ""}" data-scale-mode="full" aria-pressed="${chartScaleMode === "full"}">
      <span class="mode-icon">F</span>
      <span>${escapeHtml(uiText("chart.full"))}</span>
    </button>
    <button type="button" class="${chartScaleMode === "zoom" ? "active" : ""}" data-scale-mode="zoom" aria-pressed="${chartScaleMode === "zoom"}">
      <span class="mode-icon"><=5</span>
      <span>${escapeHtml(uiText("chart.zoom"))}</span>
    </button>
    ${tailDomain ? `
      <button type="button" class="${chartScaleMode === "tail" ? "active" : ""}" data-scale-mode="tail" aria-pressed="${chartScaleMode === "tail"}">
        <span class="mode-icon">${escapeHtml(tailDomain.min)}</span>
        <span>${escapeHtml(uiText("chart.tail"))}</span>
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
  emphasisSwitch.innerHTML = `
    <span class="chart-mode-label">${escapeHtml(uiText("chart.emphasis"))}</span>
    <button
      type="button"
      class="${chartLabelMode === "all" ? "active" : ""}"
      data-chart-focus-action="all"
      aria-pressed="${chartLabelMode === "all"}"
      title="${escapeHtml(uiText("chart.equal_title"))}"
    >
      <span>${escapeHtml(uiText("chart.all"))}</span>
    </button>
    <button
      type="button"
      class="${chartLabelMode === "none" ? "active" : ""}"
      data-chart-focus-action="clear"
      aria-pressed="${chartLabelMode === "none"}"
      title="${escapeHtml(uiText("chart.clear_title"))}"
    >
      <span>${escapeHtml(uiText("chart.clear"))}</span>
    </button>
  `;
  emphasisSwitch.querySelector("[data-chart-focus-action=\"all\"]")?.addEventListener("click", () => {
    const focusState = captureFocusState();
    showAllChartLabels();
    restoreFocusState(focusState);
  });
  emphasisSwitch.querySelector("[data-chart-focus-action=\"clear\"]")?.addEventListener("click", () => {
    const focusState = captureFocusState();
    clearChartFocus();
    restoreFocusState(focusState);
  });
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
    model?.selection?.focusRunIds?.length
      ? `focused-${model.selection.focusRunIds.length}`
      : `labels-${model?.selection?.labelMode || "none"}`,
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
  { maxDistance = 24, preferredRunId = null, preferredRunIds = [] } = {}
) {
  let best = null;
  const tieTolerance = 0.25;
  const preferredIds = new Set(preferredRunIds);
  if (preferredRunId) preferredIds.add(preferredRunId);

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
      const candidatePreferred = preferredIds.has(series.entry?.runId);
      const bestPreferred = preferredIds.has(best?.entry?.runId);
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
  const reusableSeriesPaths = new Map(
    Array.from(svg.querySelectorAll("path.series-path[data-chart-run-id]"))
      .map((path) => [path.dataset.chartRunId, path])
  );
  svg.innerHTML = "";

  const suite = activeSuite();
  normalizeChartScaleMode(suite);
  const yMetric = curveMetricName(suite);
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
  const runs = (model?.series || []).map((entry) => runById(entry.runId)).filter(Boolean);
  const seriesByRun = new Map((model?.series || []).map((entry) => [entry.runId, entry]));
  const focusedRunIds = new Set(chartFocusRunIds());
  const hasFocusedRuns = focusedRunIds.size > 0;

  byId("chartMeta").textContent = model
    ? `${model.axes.y.label} by ${model.axes.x.label}${model.target ? ` · ${model.target.label}` : ""}`
    : `${yMetric} by step`;

  byId("chartSelectionChips").innerHTML = runs.length
    ? runs
        .map(
          (run) => {
            const entry = seriesByRun.get(run.run_id);
            const metricText = summaryMetricText(run.run_id, primaryMetricName(suite));
            const chipLabel = chartRunChipLabel(run, suite);
            const accessibleLabel = `${run.display_name} · ${metricText}`;
            return `
            <button
              type="button"
              class="${focusedRunIds.has(run.run_id) ? "active" : ""}"
              data-run-id="${escapeHtml(run.run_id)}"
              data-series-family="${escapeHtml(entry?.style?.family || "other")}"
              data-series-method-group="${escapeHtml(entry?.methodGroup || "unknown")}"
              title="${escapeHtml(accessibleLabel)}"
              aria-label="${escapeHtml(accessibleLabel)}"
              aria-pressed="${focusedRunIds.has(run.run_id)}"
            >
              ${seriesKeyHtml(entry?.style, entry?.role)}
              <span class="chart-chip-name">${escapeHtml(chipLabel)}</span>
              <span class="chart-chip-metric">· ${escapeHtml(metricText)}</span>
            </button>
          `;
          }
        )
        .join("")
    : "<span class=\"muted\">No selected runs have drawable curves.</span>";
  byId("chartSelectionChips").querySelectorAll("button[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectRun(button.dataset.runId, { focusChart: true });
    });
  });

  if (!model?.series?.length || !model.stats.points) {
    byId("chartToolbarMeta").textContent = `${runs.length}/${chartSelectionLimit(suite)} visible`;
    const empty = svgEl("text", { x: 24, y: 48, class: "chart-label" });
    empty.textContent = "Select a run with an available curve.";
    svg.appendChild(empty);
    return;
  }

  byId("chartToolbarMeta").textContent = [
    `${model.stats.visibleRuns}/${chartSelectionLimit(suite)} visible`,
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
    const path = reusableSeriesPaths.get(entry.runId) || svgEl("path");
    applySvgAttributes(path, {
      d: interactivePathData(model, entry.segments),
      class: [
        "curve",
        "series-path",
        ...entry.style.classes,
        entry.role === "ours" ? "ours" : "",
        entry.status !== "completed" ? "partial" : "",
        selected ? "is-selected selected" : hasFocusedRuns ? "is-context" : "",
      ].filter(Boolean).join(" "),
      stroke: entry.style.color,
      opacity: selected ? "1" : hasFocusedRuns ? defaultOpacity : neutralOpacity,
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
    bindChartPathInteractions(path);
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
    const labeled = label.visible;
    const connector = svgEl("line", {
      x1: label.connector.x1,
      y1: label.connector.y1,
      x2: label.connector.x2,
      y2: label.connector.y2,
      class: `series-end-connector ${selected ? "is-selected selected" : ""} ${labeled ? "" : "is-label-hidden"}`,
      color: entry.style.color,
      opacity: selected ? "0.82" : hasFocusedRuns ? "0.42" : "0.7",
      visibility: labeled ? "visible" : "hidden",
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
      class: `series-end-label ${selected ? "is-selected selected" : ""} ${labeled ? "" : "is-label-hidden"}`,
      fill: entry.style.color,
      opacity: selected ? "1" : hasFocusedRuns ? "0.76" : "0.9",
      visibility: labeled ? "visible" : "hidden",
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
        preferredRunIds: chartFocusRunIds(),
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
  const safeLinks = (links || [])
    .map((link) => safeExternalUrl(link))
    .filter(Boolean);
  if (!safeLinks.length) {
    return `<li><span class="source-retained">${escapeHtml(uiText("detail.local_artifact"))}</span></li>`;
  }
  return safeLinks
    .map(
      (link, index) =>
        `<li><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(uiText("detail.open_source"))}${safeLinks.length > 1 ? ` ${index + 1}` : ""}</a></li>`
    )
    .join("");
}

function renderRunDetail() {
  const suite = activeSuite();
  const rows = eligibleRows(suite);
  const run = runById(selectedRunId) || rows[0]?.run || suiteRuns(suite.suite_id)[0];

  if (!run) {
    byId("detail-title").textContent = uiText("detail.no_run");
    byId("runDetail").innerHTML = `<p class="muted wide-muted">${escapeHtml(uiText("detail.no_run_body"))}</p>`;
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
      ${metricLine("source_access", wandbUrl ? uiText("detail.public_link") : uiText("detail.local_artifact"))}
      ${meta.description ? metricLine("description", meta.description) : ""}
    </div>
    <div class="source-actions">
      ${
        wandbUrl
          ? `<a href="${escapeHtml(wandbUrl)}" target="_blank" rel="noreferrer">${escapeHtml(uiText("detail.open_wandb"))}</a>`
          : `<span class="source-retained">${escapeHtml(uiText("detail.local_artifact"))}</span>`
      }
    </div>
  `;
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
                <div><dt>${escapeHtml(uiText("claims.method"))}</dt><dd>${escapeHtml(claim.comparison.method_label || "n/a")}</dd></div>
                <div><dt>${escapeHtml(uiText("claims.baseline"))}</dt><dd>${escapeHtml(claim.comparison.baseline_label || "n/a")}</dd></div>
                <div><dt>${escapeHtml(uiText("claims.supporting_runs"))}</dt><dd>${escapeHtml(listRuns(claim.supporting_run_ids))}</dd></div>
                <div><dt>${escapeHtml(uiText("claims.baseline_runs"))}</dt><dd>${escapeHtml(listRuns(claim.baseline_run_ids))}</dd></div>
              </dl>
              <div class="claim-notes">
                <strong>${escapeHtml(uiText("claims.caveats"))}</strong>
                <ul>${(claim.caveats || []).map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join("") || "<li>n/a</li>"}</ul>
              </div>
              <details class="claim-sources">
                <summary>${escapeHtml(uiText("claims.sources"))}</summary>
                <ul>${sourceList(claim.source_links)}</ul>
              </details>
            </article>
          `
        )
        .join("")
    : `<p class="muted wide-muted">${escapeHtml(uiText("claims.empty"))}</p>`;
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
  renderProtocolContext(suite);
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
  label.removeAttribute("data-i18n");
  label.textContent = message;
}

function setLoadingState(isLoading) {
  const main = document.querySelector("main");
  if (main) main.setAttribute("aria-busy", String(isLoading));
  if (isLoading) {
    byId("portalLoadError")?.remove();
    setPortalStatus(uiText("loading.snapshot"), "loading");
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
      portalI18n.setLocale(portalI18n.resolveLocale(), {
        persist: true,
        syncUrl: false,
      });
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
  focusedChartRunIds = new Set();
  chartLabelMode = "none";
  currentChartModel = null;
  initializeChartSelection(suite);
  selectedRunId = firstChartRun(suite)?.run_id || null;
}

function focusSuiteChangeControl({
  focusGroupId = "",
  focusProtocolSuiteId = "",
  revealInRail = false,
  restoreFocus = true,
} = {}) {
  if (!restoreFocus) return;
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
  if (revealInRail) {
    const selectedEntry = navigationEntryForSuite(selectedSuiteId);
    const activeRailItem = Array.from(
      byId("suiteCards")?.querySelectorAll("[data-benchmark-group-id]") || []
    ).find((candidate) => candidate.dataset.benchmarkGroupId === selectedEntry?.id);
    activeRailItem?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }
  control?.focus({ preventScroll: true });
}

async function requestSuiteChange(
  targetSuiteId,
  {
    push = false,
    restoreUrl = false,
    initial = false,
    navigationIntent = "protocol",
    focusGroupId = "",
    focusProtocolSuiteId = "",
    restoreNavigationFocus = true,
  } = {}
) {
  const targetCatalogSuite = catalogSuiteById(targetSuiteId);
  if (!targetCatalogSuite) return false;
  const generation = ++suiteLoadGeneration;
  const shouldLandAfterCommit = navigationIntent === "benchmark";
  if (shouldLandAfterCommit) {
    activePageViewHash = PAGE_VIEW_WORKSPACE_HASH;
    pendingPageViewHash = PAGE_VIEW_WORKSPACE_HASH;
    holdBenchmarkDrawerForSuiteLoad(generation);
  } else if (benchmarkDrawerLoadingHold) {
    benchmarkDrawerLoadingHold = 0;
    scheduleBenchmarkDrawerClose();
  }
  const preservedProtocolScroll =
    navigationIntent === "protocol"
      ? {
          left: Number(globalThis.scrollX) || 0,
          top: Number(globalThis.scrollY) || 0,
        }
      : null;

  if (
    targetSuiteId === selectedSuiteId &&
    (portalLoadMode === "aggregate" ||
      !suiteNeedsShard(targetCatalogSuite) ||
      activeSuiteShardId === targetSuiteId)
  ) {
    pendingSuiteId = null;
    protocolSwitchError = "";
    if (restoreUrl) {
      const committed = await commitSuiteViewUpdate(
        () => {
          applyUrlState();
          renderSuiteView();
        },
        { generation, initial }
      );
      if (!committed || generation !== suiteLoadGeneration) return false;
    } else if (portalData) {
      renderSuiteCards();
      renderProtocolContext(activeSuite());
      setPortalStatus(
        portalLoadMode === "catalog"
          ? uiText("status.catalog_loaded")
          : uiText("status.static_snapshot"),
        "ready"
      );
    }
    focusSuiteChangeControl({
      focusGroupId,
      focusProtocolSuiteId,
      revealInRail: !restoreUrl && !initial,
      restoreFocus: restoreNavigationFocus,
    });
    if (shouldLandAfterCommit) {
      await navigateToPageView(PAGE_VIEW_WORKSPACE_HASH, { generation });
    } else if (preservedProtocolScroll) {
      await restoreViewportScroll(preservedProtocolScroll, { generation });
    }
    releaseBenchmarkDrawerSuiteLoad(generation);
    return true;
  }

  pendingSuiteId = targetSuiteId;
  protocolSwitchError = "";
  if (!initial && portalData) {
    renderSuiteCards();
    renderProtocolContext(activeSuite());
  }
  setPortalStatus(
    uiText("loading.suite", { title: targetCatalogSuite.title || targetSuiteId }),
    "loading"
  );

  try {
    const nextPortalData = await portalDataForSuite(targetCatalogSuite);
    if (generation !== suiteLoadGeneration) return false;

    const committed = await commitSuiteViewUpdate(
      () => {
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
        setPortalStatus(uiText("status.static_snapshot"), "ready");
      },
      { generation, initial }
    );
    if (!committed || generation !== suiteLoadGeneration) return false;
    focusSuiteChangeControl({
      focusGroupId,
      focusProtocolSuiteId,
      revealInRail: !restoreUrl && !initial,
      restoreFocus: restoreNavigationFocus,
    });
    if (shouldLandAfterCommit) {
      await navigateToPageView(PAGE_VIEW_WORKSPACE_HASH, { generation });
      if (generation !== suiteLoadGeneration) return false;
    } else if (preservedProtocolScroll) {
      await restoreViewportScroll(preservedProtocolScroll, { generation });
      if (generation !== suiteLoadGeneration) return false;
    }
    releaseBenchmarkDrawerSuiteLoad(generation);
    return true;
  } catch (error) {
    if (generation !== suiteLoadGeneration) return false;
    pendingSuiteId = null;
    protocolSwitchError = `Could not load ${targetCatalogSuite.title || targetSuiteId}. ${error?.message || String(error)}`;
    if (initial) throw error;
    renderSuiteCards();
    renderProtocolContext(activeSuite());
    setPortalStatus(uiText("status.protocol_unchanged"), "ready");
    if (restoreUrl) syncUrlState();
    if (preservedProtocolScroll) {
      await restoreViewportScroll(preservedProtocolScroll, { generation });
    }
    releaseBenchmarkDrawerSuiteLoad(generation, { failed: true });
    return false;
  }
}

async function restoreSuiteFromLocation() {
  if (!portalData || !globalThis.location) return;
  const params = new URLSearchParams(globalThis.location.search);
  const requestedSuiteId = params.get("suite");
  const targetSuiteId = catalogSuiteById(requestedSuiteId)
    ? requestedSuiteId
    : selectedSuiteId;
  const targetPageHash = normalizedPageViewHash(globalThis.location.hash);
  pageViewUrlSyncEnabled = false;
  activePageViewHash = targetPageHash;
  pendingPageViewHash = targetPageHash;
  await requestSuiteChange(targetSuiteId, {
    restoreUrl: true,
    navigationIntent: "history",
  });
  await navigateToPageView(targetPageHash);
}

async function start() {
  installLocaleController();
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
      await requestSuiteChange(selectedSuiteId, {
        restoreUrl: true,
        initial: true,
        navigationIntent: "initial",
      });
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
        ? uiText("status.aggregate_fallback")
        : portalLoadMode === "catalog"
          ? uiText("status.catalog_loaded")
          : uiText("status.static_snapshot"),
      "ready"
    );
    installEntryController();
    installRevealController();
    resolveInitialEntry();
    updateTopbarState();
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
      focusedChartRunIds = new Set();
      chartLabelMode = "none";
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
      if (focusChart && selectedChartRunIds.has(runId)) {
        if (focusedChartRunIds.has(runId)) focusedChartRunIds.delete(runId);
        else focusedChartRunIds.add(runId);
        chartLabelMode = focusedChartRunIds.size ? "focused" : "none";
      }
      return true;
    },
    clearChartFocus() {
      const changed = focusedChartRunIds.size > 0 || chartLabelMode !== "none";
      focusedChartRunIds = new Set();
      chartLabelMode = "none";
      return changed;
    },
    showAllChartLabels() {
      const changed = focusedChartRunIds.size > 0 || chartLabelMode !== "all";
      focusedChartRunIds = new Set();
      chartLabelMode = "all";
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
        focusedChartRunIds: chartFocusRunIds(),
        chartLabelMode,
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
