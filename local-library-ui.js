/* Local-only dialogs: no fetch, remote links, code execution, or upload endpoints. */
(function () {
  "use strict";
  const L = globalThis.PortalLocalLibrary;
  const trainingFields = ["model", "model_params", "dataset", "seed", "batch_size_sequences", "sequence_length", "planned_tokens", "learning_rate", "weight_decay"];
  const textFields = ["model", "model_params", "dataset"];
  const escape = (value) => String(value ?? "").replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const words = {
    import: ["Import experiment", "导入实验"], manage: ["Manage local experiments", "管理本机实验"], title: ["Local experiments", "本机实验"],
    close: ["Close", "关闭"], next: ["Continue", "继续"], back: ["Back", "返回"], preview: ["Preview", "预览"],
    privacy: ["Files stay in this browser. Nothing is uploaded. Browser profiles/devices and site origins do not share this library. Clearing site data, private browsing or eviction can remove it. Export a backup. Anyone using this browser profile shares this library.", "文件仅存于此浏览器，不上传服务器。不同电脑、浏览器用户配置及网址不互通；清除网站数据、无痕模式或自动清理可能导致丢失，请导出备份。同一浏览器配置的使用者共享此实验库。"],
    session: ["Session-only preview: these records will disappear when this page closes/reloads. Export a backup before leaving.", "本次会话试画：关闭或刷新此页面后记录会消失。离开前请导出备份。"],
    csv: ["Curve CSV (required, ≤10 MiB)", "曲线 CSV（必选，≤10 MiB）"], json: ["Configuration JSON (optional)", "配置 JSON（可选）"],
    template: ["Download templates", "下载模板"], name: ["Experiment name", "实验名称"], optimizer: ["Optimizer", "优化器"], suite: ["Target protocol", "目标协议"],
    mapping: ["Column mapping", "列映射"], step: ["Training step column", "训练步数列"], loss: ["Validation loss column", "验证 loss 列"],
    confirm: ["I confirm my experiment matches this benchmark's model, dataset, batch size, sequence length and budget (when specified).", "我确认实验的模型、数据集、批大小、序列长度及计划预算（若有）与该基准一致。"],
    save: ["Save to this browser", "保存到此浏览器"], trial: ["Use for this session only", "仅本次试画"],
    saved: ["Saved to this browser.", "已保存到此浏览器。"], duplicate: ["Identical experiment already exists; nothing overwritten.", "相同实验已存在，未覆盖任何记录。"],
    export: ["Export backup", "导出备份"], restore: ["Restore backup (merge)", "恢复备份（合并）"], delete: ["Delete", "删除"], clear: ["Delete all local experiments", "清空全部本机实验"],
    view: ["View", "查看"], empty: ["No local experiments yet. Import a CSV to compare it with existing curves.", "还没有本机实验。导入 CSV 后可与现有曲线同图对比。"],
    retry: ["Retry storage", "重试存储"], cancel: ["Cancel", "取消"], confirmDelete: ["Delete local records? Original files and public benchmarks will not change.", "删除以下本机记录？电脑原文件和公开基准不受影响。"],
    missing: ["Protocol unavailable — export or delete only", "协议已不可用——仍可导出或删除"],
    status: ["Training status", "训练状态"], unknown: ["Unknown", "未知"], completed: ["Completed", "完成"], running: ["Running", "训练中"], stopped: ["Stopped", "已停止"], partial: ["Partial", "部分完成"],
    summary: ["Last observation (not a completed-budget final summary)", "末次真实观测（不代表完成预算的 final summary）"],
    rank: ["Locally compared; not a reviewed public result.", "参与本机比较；不是经过审核的公开结果。"],
    restoreDone: ["Backup merged: added / skipped duplicates", "备份合并：新增 / 跳过重复"],
    filesTitle: ["Choose experiment files", "选择实验文件"], compareTitle: ["Confirm comparison", "确认对比位置"], previewTitle: ["Preview and save", "预览并保存"],
    shortPrivacy: ["Saved in this browser only. Nothing is uploaded.", "仅保存在此浏览器，不会上传。"], storageHelp: ["About storage and backups", "保存与备份说明"],
    csvHelp: ["Two columns are enough: training step and validation loss. Up to 50,000 observations; files ≤10 MiB combined.", "只需训练步数和验证 loss 两列。最多 50,000 个观测点，文件总大小不超过 10 MiB。"],
    configHelp: ["Have a configuration file? Attach it here. Otherwise, confirm the settings in the next step.", "有配置文件可以附加；没有也可以在下一步确认配置。"],
    target: ["Target benchmark", "目标基准"], targetNote: ["These are the benchmark's settings, not settings detected from your CSV.", "这是目标基准的配置，不是从 CSV 中识别出的实验配置。"],
    extra: ["Additional experiment settings (optional)", "补充实验配置（可选）"], extraHelp: ["Enter only settings you know. Missing protocol fields will use the target benchmark after your confirmation; other missing fields stay unknown.", "只填写已知的实际配置。缺失的协议字段会在你确认后采用目标基准配置；其他缺失项保持未知。"],
    fromJson: ["From configuration JSON", "来自配置 JSON"], fromFile: ["From filename · editable", "来自文件名，可修改"], manual: ["Manually entered", "手动填写"],
    observed: ["Observed in CSV", "CSV 实际观测"], points: ["Observations", "观测点数"], range: ["Observed step range", "实际步数范围"], budget: ["Benchmark token budget", "基准 Token 预算"], noBudget: ["No fixed token budget", "无固定 Token 预算"],
    model: ["Model architecture", "模型架构"], model_params: ["Model parameters", "模型参数量"], dataset: ["Dataset", "数据集"], seed: ["Random seed", "随机种子"], batch_size_sequences: ["Batch size (sequences)", "批大小（序列数）"], sequence_length: ["Sequence length", "序列长度"], planned_tokens: ["Planned token budget", "计划 Token 预算"], learning_rate: ["Learning rate", "学习率"], weight_decay: ["Weight decay", "权重衰减"],
  };
  const t = (key) => words[key]?.[globalThis.PortalI18n?.getLocale() === "zh" ? 1 : 0] || key;
  function download(name, text, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function install(api) {
    if (!L || document.getElementById("localLibraryDialog")) return;
    const dialog = document.createElement("dialog"); dialog.id = "localLibraryDialog"; dialog.className = "local-library-dialog";
    dialog.setAttribute("aria-labelledby", "localLibraryTitle"); document.body.append(dialog);
    let step = 1, csv = "", originalConfig = "", sourceName = "", draft = {}, parsed, record, busy = false, token = 0;
    let mapping = null, targetProtocol = null, previewSvg = "", fieldSources = {};
    const button = (key, action, extra = "") => `<button type="button" data-action="${escape(action)}" ${extra}>${escape(t(key))}</button>`;
    const input = (label, name, value, type = "text") => `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" ${type === "number" ? 'min="0" step="any"' : 'maxlength="200"'}></label>`;
    const storageNote = () => `${api.library.sessionOnly ? `<p class="local-library-notice">${escape(t("session"))}</p>` : `<p class="local-library-storage">${escape(t("shortPrivacy"))}</p><details class="local-library-help"><summary>${t("storageHelp")}</summary><p>${t("privacy")}</p></details>`}${api.library.error ? `<p class="local-library-error">${escape(api.library.error)}</p>${button("retry", "retry")}` : ""}`;
    const formatBudget = (value) => !value ? t("noBudget") : `${Number((value / 1e9).toPrecision(4))}B tokens`;
    const protocolSummary = (p) => `${escape(p.title)} · ${escape(p.dataset)} · Batch ${escape(p.batch_size_sequences)} × ${escape(p.sequence_length)} · ${formatBudget(p.planned_tokens)}`;
    const sourceHint = (key) => fieldSources[key] ? `<small class="local-library-source" data-source-for="${key}">${t(fieldSources[key])}</small>` : "";
    function captureDraft() {
      draft = { schema_version: 1 };
      for (const field of dialog.querySelectorAll(".local-library-fields input, .local-library-fields select")) {
        if (["step", "loss"].includes(field.name) || field.value === "") continue;
        draft[field.name] = field.type === "number" ? Number(field.value) : field.value;
      }
      mapping = { step: read("step"), loss: read("loss") };
    }
    function frame(title, body, footer = "") {
      dialog.innerHTML = `<header><h2 id="localLibraryTitle">${escape(title)}</h2>${button("close", "close", 'aria-label="' + escape(t("close")) + '"')}</header><div class="local-library-body">${body}<p id="localLibraryError" role="alert"></p><p id="localLibraryProgress" role="status"></p></div><footer>${footer}</footer>`;
      dialog.querySelector("input, select, button")?.focus();
    }
    const error = (e) => { const node = dialog.querySelector("#localLibraryError"); if (node) node.textContent = e.message || String(e); };
    const read = (name) => dialog.querySelector(`[name="${name}"]`)?.value;
    const targets = () => api.suites();
    function importView() {
      if (step === 1) frame(`${t("filesTitle")} · 1 / 3`, `<label class="local-library-file">${t("csv")}<input type="file" name="csv" accept=".csv,text/csv"></label><p class="local-library-caption">${t("csvHelp")}</p><details class="local-library-disclosure"><summary>${t("json")}</summary><p>${t("configHelp")}</p><label>${t("json")}<input type="file" name="config" accept=".json,application/json"></label></details>${button("template", "template")}${storageNote()}`, button("next", "files"));
      if (step === 2) {
        const options = parsed.headers.map((h) => `<option value="${escape(h)}">${escape(h)}</option>`).join("");
        const standard = parsed.headers.includes("step") && parsed.headers.includes("val_loss");
frame(`${t("compareTitle")} · 2 / 3`, `<div class="local-library-fields"><div>${input(t("name"), "name", draft.name || sourceName.replace(/\.csv$/iu, ""))}${sourceHint("name")}</div><div>${input(t("optimizer"), "optimizer", draft.optimizer || "")}${sourceHint("optimizer")}</div><label class="local-library-wide">${t("target")}<select name="suite_id">${targets().map((s) => `<option value="${escape(s.suite_id)}" ${s.suite_id === (draft.suite_id || api.currentSuite()) ? "selected" : ""}>${escape(s.title)}</option>`).join("")}</select></label></div><section class="local-library-target"><strong>${t("target")}</strong><p id="localProtocolHint"></p><p class="local-library-caption">${t("targetNote")}</p></section><details class="local-library-disclosure"><summary>${t("extra")}${originalConfig ? ` · ${t("fromJson")}` : ""}</summary><p class="local-library-caption">${t("extraHelp")}</p><div class="local-library-fields"><label>${t("status")}<select name="status">${["unknown", "completed", "running", "stopped", "partial"].map((s) => `<option value="${s}" ${s === draft.status ? "selected" : ""}>${t(s)}</option>`).join("")}</select></label>${trainingFields.map((k) => `<div>${input(t(k), k, draft[k] ?? "", textFields.includes(k) ? "text" : "number")}${sourceHint(k)}</div>`).join("")}</div></details><details class="local-library-disclosure" ${standard ? "" : "open"}><summary>${t("mapping")} · ${escape(mapping?.step || (standard ? "step" : parsed.headers[0]))} / ${escape(mapping?.loss || (standard ? "val_loss" : parsed.headers[1]))}</summary><div class="local-library-fields"><label>${t("step")}<select name="step">${options}</select></label><label>${t("loss")}<select name="loss">${options}</select></label></div></details><label class="local-library-check"><input type="checkbox" name="confirm">${t("confirm")}</label>`, button("back", "back") + button("preview", "preview"));
        dialog.querySelector('[name="step"]').value = mapping?.step || (parsed.headers.includes("step") ? "step" : parsed.headers[0]);
        dialog.querySelector('[name="loss"]').value = mapping?.loss || (parsed.headers.includes("val_loss") ? "val_loss" : parsed.headers[1]);
        void fillProtocol();
      }
      if (step === 3) {
        const last = record.points.at(-1);
        frame(`${t("previewTitle")} · 3 / 3`, `<strong>${escape(record.configuration.name)}</strong><p class="local-library-caption">${t("observed")} · ${escape(sourceName)}</p><div class="local-library-preview">${previewSvg}</div><dl class="local-library-summary"><div><dt>${t("points")}</dt><dd>${record.points.length}</dd></div><div><dt>${t("range")}</dt><dd>${record.points[0].step}–${last.step}</dd></div><div><dt>${t("summary")}</dt><dd>${last.value} @ ${last.step}</dd></div></dl><section class="local-library-target"><strong>${t("target")}</strong><p>${protocolSummary(targetProtocol)}</p></section><p class="local-library-caption">${t("rank")}</p>${storageNote()}`, button("back", "back") + (api.library.sessionOnly ? button("trial", "trial") : button("save", "save") + (api.library.error ? button("trial", "trial") : "")));
      }
    }
    async function fillProtocol() {
      const current = ++token, suiteId = read("suite_id");
      const previewButton = dialog.querySelector('[data-action="preview"]');
      if (previewButton) previewButton.disabled = true;
      try {
        const p = await api.protocol(suiteId);
        if (current !== token || step !== 2 || !dialog.open) return;
        targetProtocol = p;
        dialog.querySelector("#localProtocolHint").innerHTML = protocolSummary(p);
      } catch (e) { if (current === token) error(e); }
      finally { if (current === token && previewButton) previewButton.disabled = false; }
    }
    function manageView(notice = "") {
      const records = [...api.library.list(), ...api.library.invalid];
      frame(t("manage"), `${storageNote()}${notice ? `<p role="status">${escape(notice)}</p>` : ""}${records.length ? `<ul class="local-library-records">${records.map((r) => `<li><div><strong>${escape(r.configuration?.name || r.id)}</strong><small>${escape(r.configuration?.suite_id || "")} · ${escape(r.invalid || (api.library.session.includes(r) ? t("session") : r.createdAt))}</small></div><div class="local-library-actions">${!r.invalid && targets().some((s) => s.suite_id === r.configuration.suite_id) ? button("view", `view:${r.id}`) : `<small>${t("missing")}</small>`}${button("export", `export:${r.id}`)}${button("delete", `delete:${r.id}`)}</div></li>`).join("")}</ul>` : `<p>${t("empty")}</p>`}<label>${t("restore")}<input type="file" name="backup" accept=".json,application/json"></label><label class="local-library-check"><input type="checkbox" name="restoreSession" ${api.library.sessionOnly ? "checked disabled" : ""}>${t("trial")}</label>`, button("export", "export") + button("restore", "restore") + button("clear", "clear", records.length ? "" : "disabled"));
    }
    function openImport() { token += 1; step = 1; csv = ""; originalConfig = ""; draft = {}; mapping = null; targetProtocol = null; fieldSources = {}; previewSvg = ""; record = null; dialog.showModal(); importView(); }
    function openManage() { token += 1; step = 0; dialog.showModal(); manageView(); }
    function labels() {
      document.getElementById("localImportButton").textContent = t("import");
      document.getElementById("localManageButton").textContent = t("manage");
    }
    document.getElementById("localImportButton").addEventListener("click", openImport);
    document.getElementById("localManageButton").addEventListener("click", openManage);
    globalThis.PortalI18n?.subscribe(labels); labels();
    dialog.addEventListener("close", () => { token += 1; });
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    dialog.addEventListener("input", (event) => {
      if (step !== 2 || !event.target.name) return;
      fieldSources[event.target.name] = "manual";
      const hint = dialog.querySelector(`[data-source-for="${event.target.name}"]`);
      if (hint) hint.textContent = t("manual");
      if (trainingFields.includes(event.target.name)) dialog.querySelector('[name="confirm"]').checked = false;
    });
    dialog.addEventListener("change", (event) => {
      if (event.target.name === "suite_id") {
        dialog.querySelector('[name="confirm"]').checked = false;
        void fillProtocol();
      }
    });
    dialog.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action || busy) return;
      busy = true;
      dialog.setAttribute("aria-busy", "true");
      const disabledBefore = new Map([...dialog.querySelectorAll("button, input, select")].map((node) => [node, node.disabled]));
      disabledBefore.forEach((_disabled, node) => { node.disabled = true; });
      const progress = dialog.querySelector("#localLibraryProgress");
      if (progress) progress.textContent = globalThis.PortalI18n?.getLocale() === "zh" ? "正在处理…" : "Processing…";
      try {
        if (action === "close") { dialog.close(); return; }
        if (action === "retry") { await api.library.init(); await api.refresh(); if (step === 0) manageView(); else importView(); }
        if (action === "template") {
          download("experiment-template.csv", "step,val_loss\n0,10.5\n100,4.2\n200,3.7\n", "text/csv");
          const { title, ...protocol } = await api.protocol(api.currentSuite());
          download("experiment-config.json", JSON.stringify({ schema_version: 1, name: "My optimizer", optimizer: "My optimizer", ...protocol, seed: 0, status: "unknown" }, null, 2));
        }
        if (action === "files") {
          const file = dialog.querySelector('[name="csv"]').files[0], cfg = dialog.querySelector('[name="config"]').files[0];
          if (!file) throw new Error(t("csv"));
          if (file.size + (cfg?.size || 0) > L.MAX_BYTES) throw new Error("Import exceeds 10 MiB / 导入总大小超过 10 MiB");
          csv = await file.text(); sourceName = file.name; originalConfig = cfg ? await cfg.text() : "";
          draft = cfg ? L.config(originalConfig) : { schema_version: 1 };
          fieldSources = Object.fromEntries(Object.keys(draft).map((key) => [key, "fromJson"]));
          if (!draft.name) fieldSources.name = "fromFile";
          if (draft.suite_id && !targets().some((s) => s.suite_id === draft.suite_id)) throw new Error(t("missing"));
          parsed = L.parseCsv(csv); step = 2; importView();
        }
        if (action === "back") { if (step === 2) captureDraft(); step -= 1; importView(); }
        if (action === "preview") {
          if (!dialog.querySelector('[name="confirm"]').checked) throw new Error(t("confirm"));
          captureDraft();
          targetProtocol = await api.protocol(draft.suite_id);
          L.checkProtocol(draft, targetProtocol);
          const confirmed = { ...draft };
          for (const key of ["model", "model_params", "dataset", "batch_size_sequences", "sequence_length", "planned_tokens"]) {
            if (confirmed[key] === undefined && targetProtocol[key] !== null && targetProtocol[key] !== "") confirmed[key] = targetProtocol[key];
          }
          record = L.createRecord({ csv, configuration: confirmed, columns: mapping, sourceName, originalConfig });
          previewSvg = await api.preview(record);
          step = 3; importView();
        }
        if (action === "save" || action === "trial") {
          const result = await api.library.saveMany([record], { sessionOnly: action === "trial" });
          await api.saved(result.added[0] || result.duplicate[0]);
          step = 0; manageView(result.added.length ? (action === "trial" ? t("session") : t("saved")) : t("duplicate"));
        }
        if (action === "export" || action.startsWith("export:")) {
          const all = [...api.library.list(), ...api.library.invalid];
          download("oplab-local-experiments.json", L.backup(action.includes(":") ? all.filter((r) => r.id === action.slice(7)) : all));
        }
        if (action.startsWith("view:")) { await api.saved(api.library.list().find((r) => r.id === action.slice(5)), false); dialog.close(); }
        if (action === "restore") {
          const file = dialog.querySelector('[name="backup"]').files[0];
          if (!file) throw new Error(t("restore"));
          if (file.size > L.MAX_BYTES * 100) throw new Error("Backup exceeds 1 GiB");
          const records = L.parseBackup(await file.text());
          const result = await api.library.saveMany(records, { sessionOnly: dialog.querySelector('[name="restoreSession"]').checked });
          await api.refresh(); manageView(`${t("restoreDone")}: ${result.added.length} / ${result.duplicate.length}`);
        }
        if (action === "clear" || action.startsWith("delete:")) {
          const all = [...api.library.list(), ...api.library.invalid];
          const pending = action === "clear" ? all : all.filter((r) => r.id === action.slice(7));
          frame(t("confirmDelete"), `<p>${pending.length} ${t("title")}</p><ul>${pending.map((r) => `<li>${escape(r.configuration?.name || r.id)}</li>`).join("")}</ul>`, button("cancel", "cancelDelete") + button("delete", "confirmDelete"));
          dialog.querySelector('[data-action="confirmDelete"]')._localDeleteIds = pending.map((r) => r.id);
          dialog.querySelector('[data-action="cancelDelete"]').focus();
        }
        if (action === "cancelDelete") manageView();
        if (action === "confirmDelete") { await api.library.remove(event.target._localDeleteIds); await api.refresh(); manageView(); }
      } catch (e) {
        if ((action === "save") && step === 3) { api.library.error = e.message; importView(); }
        if (step === 2 && e.message?.startsWith("Protocol conflict:")) {
          dialog.querySelector("details.local-library-disclosure").open = true;
          const key = e.message.match(/^Protocol conflict: ([a-z_]+)/u)?.[1];
          if (key && trainingFields.includes(key)) dialog.querySelector(`[name="${key}"]`)?.focus();
        }
        error(e);
      } finally {
        busy = false; dialog.removeAttribute("aria-busy");
        disabledBefore.forEach((disabled, node) => { node.disabled = disabled; });
        const progress = dialog.querySelector("#localLibraryProgress"); if (progress) progress.textContent = "";
      }
    });
  }
  globalThis.PortalLocalLibraryUI = { install, t };
})();
