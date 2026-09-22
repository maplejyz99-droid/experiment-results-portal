/* Browser-owned experiments. Public snapshots are never written by this module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PortalLocalLibrary = api;
})(globalThis, function () {
  "use strict";
  const VERSION = 1;
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_POINTS = 50000;
  const KIND = "oplab-local-experiments";
  const bytes = (value) => new TextEncoder().encode(value).length;
  const fail = (message) => { throw new Error(message); };
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  function parseCsv(text) {
    if (typeof text !== "string" || bytes(text) > MAX_BYTES) fail("CSV exceeds 10 MiB / CSV 超过 10 MiB");
    const input = text.replace(/^\uFEFF/u, "");
    const rows = [];
    let cells = [], cell = "", quoted = false, closed = false, line = 1, rowLine = 1;
    const emit = () => {
      cells.push(cell);
      // Empty physical lines are separators, not observations.
      if (cells.some((value) => value.trim() !== "")) rows.push({ cells, line: rowLine });
      cells = []; cell = ""; closed = false;
      if (rows.length > MAX_POINTS + 1) fail("CSV exceeds 50,000 observations / 观测点超过 50,000");
    };
    for (let i = 0; i < input.length; i += 1) {
      const c = input[i];
      if (quoted) {
        if (c === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
        else if (c === '"') { quoted = false; closed = true; }
        else { cell += c; if (c === "\n") line += 1; }
      } else if (c === '"') {
        if (cell || closed) fail(`Line ${line}: invalid quote / 引号格式错误`);
        quoted = true;
      } else if (c === ",") { cells.push(cell); cell = ""; closed = false; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && input[i + 1] === "\n") i += 1;
        emit(); line += 1; rowLine = line;
      } else {
        if (closed) fail(`Line ${line}: unexpected text after quote / 引号后有多余字符`);
        cell += c;
      }
    }
    if (quoted) fail(`Line ${rowLine}: unclosed quote / 引号未闭合`);
    if (cell || cells.length || closed) emit();
    if (rows.length < 3) fail("At least two observations required / 至少需要两个观测点");
    const headers = rows.shift().cells.map((value) => value.trim());
    if (headers.some((value) => !value) || new Set(headers).size !== headers.length) fail("CSV headers must be nonempty and unique / 列名不能为空或重复");
    return { headers, rows };
  }
  function observations(parsed, columns = { step: "step", loss: "val_loss" }) {
    const stepIndex = parsed.headers.indexOf(columns.step);
    const lossIndex = parsed.headers.indexOf(columns.loss);
    if (stepIndex < 0 || lossIndex < 0 || stepIndex === lossIndex) fail("Select distinct step and loss columns / 请选择不同的 step 与 loss 列");
    let previous = -1;
    return parsed.rows.map(({ cells, line }) => {
      if (cells.length !== parsed.headers.length) fail(`Line ${line}: column count mismatch / 列数不匹配`);
      const a = cells[stepIndex].trim(), b = cells[lossIndex].trim();
      const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;
      if (!numeric.test(a) || !numeric.test(b)) fail(`Line ${line}: invalid number / 非法数值`);
      const step = Number(a), value = Number(b);
      if (!Number.isSafeInteger(step) || step < 0 || step <= previous) fail(`Line ${line}: step must be a strictly increasing nonnegative integer / step 必须为严格递增非负整数`);
      if (!Number.isFinite(value)) fail(`Line ${line}: loss must be finite / loss 必须为有限数值`);
      previous = step;
      return { step, value };
    });
  }
  function config(input) {
    let value = input;
    if (typeof input === "string") {
      if (bytes(input) > MAX_BYTES) fail("Configuration exceeds 10 MiB / 配置超过大小限制");
      try { value = JSON.parse(input); } catch { fail("Invalid configuration JSON / 配置 JSON 无效"); }
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== VERSION) fail("Configuration schema_version must be 1 / 配置版本必须为 1");
    const clean = { schema_version: VERSION };
    const stringKeys = ["name", "optimizer", "suite_id", "model", "model_params", "dataset", "status"];
    const numericKeys = ["seed", "batch_size_sequences", "sequence_length", "planned_tokens", "learning_rate", "weight_decay"];
    for (const key of Object.keys(value)) if (!["schema_version", ...stringKeys, ...numericKeys].includes(key)) fail(`Unknown configuration field: ${key} / 未知配置字段，请使用模板`);
    for (const key of stringKeys) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== "string" || value[key].length > 200) fail(`Invalid ${key} / 字段无效`);
        clean[key] = value[key].trim();
      }
    }
    for (const key of numericKeys) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
        if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 ||
          (["seed", "batch_size_sequences", "sequence_length", "planned_tokens"].includes(key) && !Number.isSafeInteger(value[key])) ||
          (["batch_size_sequences", "sequence_length", "planned_tokens"].includes(key) && value[key] === 0)) fail(`Invalid ${key} / 字段无效`);
        clean[key] = value[key];
      }
    }
    if (clean.status && !["unknown", "completed", "running", "stopped", "partial"].includes(clean.status)) fail("Invalid training status / 训练状态无效");
    return clean;
  }
  function protocol(data, suiteId) {
    const suite = data.suites.find((entry) => entry.suite_id === suiteId);
    if (!suite) return null;
    const sample = data.runs.find((run) => run.suite_id === suiteId && !run.local_experiment);
    const p = suite.protocol || {};
    return {
      suite_id: suiteId, title: suite.title, model: sample?.model?.type || "",
      model_params: sample?.model?.params || "",
      dataset: sample?.dataset?.name || p.dataset || "",
      batch_size_sequences: p.batch_size_sequences || (sample?.training?.global_batch_tokens / sample?.training?.sequence_length) || null,
      sequence_length: p.sequence_length || sample?.training?.sequence_length || null,
      planned_tokens: p.planned_tokens || null,
    };
  }
  function checkProtocol(confirmed, target) {
    if (!target || confirmed.suite_id !== target.suite_id) fail("Select a matching protocol / 请选择匹配的协议");
    for (const key of ["model", "model_params", "dataset", "batch_size_sequences", "sequence_length", "planned_tokens"]) {
      if (confirmed[key] !== undefined && target[key] !== null && target[key] !== "" && confirmed[key] !== target[key]) fail(`Protocol conflict: ${key} (${confirmed[key]} ≠ ${target[key]}) / 协议配置冲突`);
    }
  }
  function createRecord({ csv, configuration, columns, sourceName = "experiment.csv", originalConfig = "", id, createdAt }) {
    if (bytes(csv) + bytes(originalConfig) > MAX_BYTES) fail("Import exceeds 10 MiB / 导入总大小超过 10 MiB");
    const confirmed = config(configuration);
    if (!confirmed.name || !confirmed.optimizer || !confirmed.suite_id) fail("Name, optimizer and protocol required / 实验名、优化器和协议必填");
    const mapping = columns || { step: "step", loss: "val_loss" };
    const points = observations(parseCsv(csv), mapping);
    const identity = canonical({ configuration: confirmed, points });
    // Exact canonical equality, not a short hash, is the duplicate authority.
    const stableId = id || `browser-local-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    if (!/^browser-local-[a-zA-Z0-9-]{8,100}$/u.test(stableId)) fail("Invalid local ID / 本机 ID 无效");
    return { id: stableId, version: VERSION, createdAt: createdAt || new Date().toISOString(), sourceName: String(sourceName).slice(0, 200), csv, originalConfig, configuration: confirmed, columns: { step: mapping.step, loss: mapping.loss }, points, identity };
  }
  function revive(raw) {
    if (raw?.version !== VERSION) fail("Unsupported record version / 不支持的记录版本");
    return createRecord({ ...raw, configuration: raw.configuration });
  }
  function backup(records) {
    return JSON.stringify({ kind: KIND, schema_version: VERSION, exported_at: new Date().toISOString(), records: records.map(({ identity, points, ...raw }) => raw) }, null, 2);
  }
  function parseBackup(text) {
    if (bytes(text) > 100 * MAX_BYTES) fail("Backup exceeds 1 GiB / 备份过大");
    let value;
    try { value = JSON.parse(text); } catch { fail("Invalid backup JSON / 备份 JSON 无效"); }
    if (value.kind !== KIND || value.schema_version !== VERSION || !Array.isArray(value.records)) fail("Unsupported backup format/version / 不支持的备份格式或版本");
    return value.records.map(revive);
  }
  class Library {
    constructor({ indexedDB, protocol = globalThis.location?.protocol || "https:", hostname = globalThis.location?.hostname || "localhost", databaseName = "oplab-local-experiments" } = {}) {
      try { this.indexedDB = indexedDB === undefined ? globalThis.indexedDB : indexedDB; } catch { this.indexedDB = null; }
      this.databaseName = databaseName;
      this.sessionOnly = protocol !== "https:" && !(protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
      this.records = []; this.session = []; this.invalid = []; this.preferences = new Map(); this.error = ""; this.db = null;
    }
    async init() {
      if (this.sessionOnly) return;
      try {
        if (this.db) { this.db.close(); this.db = null; }
        if (!this.indexedDB) fail("IndexedDB unavailable / 浏览器存储不可用");
        this.db = await new Promise((resolve, reject) => {
          let expired = false;
          const timer = setTimeout(() => { expired = true; reject(new Error("Storage open timed out / 存储打开超时")); }, 4000);
          const request = this.indexedDB.open(this.databaseName, VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("experiments")) db.createObjectStore("experiments", { keyPath: "id" });
            if (!db.objectStoreNames.contains("preferences")) db.createObjectStore("preferences", { keyPath: "suiteId" });
          };
          request.onerror = () => { clearTimeout(timer); reject(request.error); };
          request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
        });
        this.db.onversionchange = () => { this.db.close(); this.db = null; this.error = "Storage changed; retry / 存储已更新，请重试"; };
        await this.reload(); this.error = "";
      } catch (error) { this.error = error.message; }
    }
    transaction(stores, mode, execute) {
      if (!this.db) return Promise.reject(new Error(this.error || "Storage unavailable / 存储不可用"));
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error("Storage transaction failed / 保存事务失败"));
        try { execute(tx, (value) => { result = value; }); } catch (error) { tx.abort(); reject(error); }
      });
    }
    async reload() {
      if (!this.db) return;
      const loaded = await this.transaction(["experiments", "preferences"], "readonly", (tx, done) => {
        const value = {}; const a = tx.objectStore("experiments").getAll(), b = tx.objectStore("preferences").getAll();
        a.onsuccess = () => { value.records = a.result; }; b.onsuccess = () => { value.prefs = b.result; }; done(value);
      });
      const valid = [], invalid = [];
      for (const raw of loaded.records) { try { valid.push(revive(raw)); } catch (error) { invalid.push({ ...raw, invalid: error.message }); } }
      this.records = valid; this.invalid = invalid;
      this.preferences = new Map(loaded.prefs.map((entry) => [entry.suiteId, entry.ids]));
    }
    list() { return [...this.records, ...this.session]; }
    async saveMany(records, { sessionOnly = false } = {}) {
      const validated = records.map(revive);
      const added = [], duplicate = [];
      const merge = (existing, add) => {
        const seen = [...existing];
        for (let record of validated) {
          const match = seen.find((entry) => entry.identity === record.identity);
          if (match) { duplicate.push(match); continue; }
          if (seen.some((entry) => entry.id === record.id)) record = createRecord({ ...record, id: undefined });
          add(record); seen.push(record); added.push(record);
        }
      };
      if (sessionOnly || this.sessionOnly) merge(this.list(), (record) => this.session.push(record));
      else {
        await this.transaction(["experiments"], "readwrite", (tx) => {
          const store = tx.objectStore("experiments"), request = store.getAll();
          request.onsuccess = () => {
            // Session data can be promoted to durable storage; retain its stable ID.
            for (let i = 0; i < validated.length; i += 1) {
              const trial = this.session.find((r) => r.identity === validated[i].identity);
              if (trial) validated[i] = trial;
            }
            merge(request.result, (record) => store.add(record));
          };
        });
        const persisted = new Set([...added, ...duplicate].map((r) => r.identity));
        this.session = this.session.filter((r) => !persisted.has(r.identity));
        await this.reload();
      }
      return { added, duplicate };
    }
    async remove(ids) {
      const persistentIds = ids.filter((id) => this.records.some((r) => r.id === id) || this.invalid.some((r) => r.id === id));
      if (persistentIds.length) await this.transaction(["experiments"], "readwrite", (tx) => persistentIds.forEach((id) => tx.objectStore("experiments").delete(id)));
      this.session = this.session.filter((r) => !ids.includes(r.id));
      if (this.db) await this.reload();
    }
    async savePlot(suiteId, ids) {
      if (canonical(this.preferences.get(suiteId)) === canonical(ids)) return;
      if (!this.sessionOnly) await this.transaction(["preferences"], "readwrite", (tx) => tx.objectStore("preferences").put({ suiteId, ids }));
      this.preferences.set(suiteId, [...ids]);
    }
  }
  function overlay(data, records) {
    const runs = [], metrics = [];
    for (const record of records) {
      const c = record.configuration, suite = data.suites.find((s) => s.suite_id === c.suite_id);
      if (!suite) continue;
      const target = protocol(data, c.suite_id);
      try { checkProtocol(c, target); } catch { continue; }
      const last = record.points.at(-1), best = record.points.reduce((a, b) => a.value <= b.value ? a : b);
      runs.push({ run_id: record.id, suite_id: c.suite_id, display_name: c.name, optimizer: { name: c.optimizer, family: "local", variant: null },
        optimizer_family: "local", run_role: "browser_local", status: c.status || "unknown", local_experiment: true,
        model: { type: c.model || target.model, params: c.model_params || target.model_params }, dataset: { name: c.dataset || target.dataset },
        training: { seed: c.seed ?? null, sequence_length: c.sequence_length || target.sequence_length, global_batch_tokens: (c.batch_size_sequences || target.batch_size_sequences) * (c.sequence_length || target.sequence_length), lr: c.learning_rate ?? null, weight_decay: c.weight_decay ?? null, train_steps: last.step },
        hardware: {}, source: { source_type: "browser_local", source_label: record.sourceName, notes: "Browser-local, unreviewed. Ranking uses last observation, not a completed-budget final summary." } });
      const add = (metric_name, value, step, metric_scope) => metrics.push({ metric_id: `${record.id}-${metric_name}-${step}`, run_id: record.id, metric_name, value, step, metric_scope });
      record.points.forEach((p) => add("val_loss", p.value, p.step, "point"));
      add("last_observed_val_loss", last.value, last.step, "summary");
      add("best_val_loss", best.value, best.step, "summary");
      if (suite.target?.metric_name === "val_loss") {
        const reached = record.points.find((p) => suite.target.direction === "above" ? p.value >= suite.target.value : p.value <= suite.target.value);
        if (reached) add(suite.primary_metric, reached.step, reached.step, "summary");
      }
    }
    return { ...data, runs: [...data.runs, ...runs], metrics: [...data.metrics, ...metrics] };
  }
  return { VERSION, MAX_BYTES, MAX_POINTS, parseCsv, observations, config, protocol, checkProtocol, createRecord, revive, backup, parseBackup, Library, overlay };
});
