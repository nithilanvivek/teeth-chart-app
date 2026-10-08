(() => {
  "use strict";

  const STORAGE_KEY = "teeth.chart.app.charts.v1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TOOTH_STATUSES = ["permanent", "milk", "wisdom", "empty", "not_yet_erupted", "fake_tooth"];
  const SPACE_STATUSES = ["fulfilled", "tooth", "empty"];
  const STATUS_COLORS = {
    permanent: "#ffffff",
    milk: "#72c9ee",
    wisdom: "#e496df",
    empty: "#ff604f",
    not_yet_erupted: "#fff184",
    fake_tooth: "#ff9f0a",
    fulfilled: "#7ee18c",
    tooth: "#d2f7fb",
    unmarked: "#d7dce1"
  };
  const STATUS_LABELS = {
    permanent: "Permanent",
    milk: "Milk",
    wisdom: "Wisdom",
    empty: "Empty",
    not_yet_erupted: "Not Yet Erupted",
    fake_tooth: "Fake Tooth",
    fulfilled: "Fulfilled",
    tooth: "Tooth"
  };
  const SHORT_STATUS = {
    permanent: "P", milk: "M", wisdom: "W", empty: "E",
    not_yet_erupted: "NYE", fake_tooth: "FT", fulfilled: "F", tooth: "T"
  };
  const PERM_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const PERM_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const PRIMARY_UPPER = [null, null, null, 55, 54, 53, 52, 51, 61, 62, 63, 64, 65, null, null, null];
  const PRIMARY_LOWER = [null, null, null, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75, null, null, null];

  const $ = selector => document.querySelector(selector);
  const chartNameInput = $("[data-chart-name]");
  const savedChartsSelect = $("[data-saved-charts]");
  const chartSvg = $("[data-tooth-chart]");
  const statusElement = $("[data-status]");
  const currentChartElement = $("[data-current-chart]");
  const markCountElement = $("[data-mark-count]");
  const selectionDetail = $("[data-selection-detail]");
  const toothFieldset = $("[data-tooth-options]");
  const spaceFieldset = $("[data-space-options]");
  const importInput = $("[data-import-file]");
  const folderStatus = $("[data-folder-status]");
  const dialog = $("[data-dialog]");
  const dialogTitle = $("[data-dialog-title]");
  const dialogBody = $("[data-dialog-body]");
  const dialogActions = $("[data-dialog-actions]");

  const folderState = {
    connected: false,
    filenames: new Map()
  };

  function postFolderMessage(action, values = {}) {
    const bridge = window.webkit?.messageHandlers?.dataFolder;
    if (bridge) {
      bridge.postMessage({ action, ...values });
      return true;
    }
    if (window.AndroidBridge?.postDataFolderMessage) {
      window.AndroidBridge.postDataFolderMessage(JSON.stringify({ action, ...values }));
      return true;
    }
    return false;
  }

  function safeChartName(name) {
    return String(name).replace(/[^\p{L}\p{N}_ -]/gu, "_").trim().replace(/\s+/g, "_") || "teeth_chart";
  }

  function chartFilePayload(name, annotations) {
    return { chart_name: name, annotations: copy(annotations) };
  }

  function writeChartToFolder(name, chart) {
    if (!folderState.connected || !chart) return;
    const filename = folderState.filenames.get(name) || `${safeChartName(name)}.json`;
    folderState.filenames.set(name, filename);
    const payload = chartFilePayload(name, chart.annotations || {});
    postFolderMessage("write", { filename, text: JSON.stringify(payload, null, 2) });
  }

  function syncChartsFromFolder(files) {
    const beforeSync = { ...state.charts };
    const namesInFolder = new Set();
    let imported = 0;
    (Array.isArray(files) ? files : []).forEach(file => {
      try {
        const payload = JSON.parse(file.text);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
        const fallbackName = String(file.filename || "teeth_chart").replace(/\.json$/i, "");
        const name = String(payload.chart_name || fallbackName).trim() || fallbackName;
        const existing = state.charts[name];
        state.charts[name] = {
          annotations: cleanImportedAnnotations(payload.annotations),
          history: Array.isArray(existing?.history) ? existing.history : [],
          created_at: existing?.created_at || new Date().toISOString()
        };
        folderState.filenames.set(name, file.filename);
        namesInFolder.add(name);
        imported += 1;
      } catch {
        // Ignore unrelated or malformed JSON without preventing valid charts from loading.
      }
    });
    Object.entries(beforeSync).forEach(([name, chart]) => {
      if (!namesInFolder.has(name)) writeChartToFolder(name, chart);
    });
    writeCharts();
    const chart = ensureChart(state.currentName);
    state.annotations = copy(chart.annotations);
    refreshChartPicker();
    renderChart();
    setStatus(`Files folder synced: ${imported} chart file${imported === 1 ? "" : "s"} loaded.`);
  }

  window.nativeFolderStorage = {
    receive(payload) {
      if (!payload || typeof payload !== "object") return;
      if (payload.event === "status") {
        folderState.connected = Boolean(payload.available);
        folderStatus.textContent = folderState.connected ? `Files: ${payload.folderName}` : "Private storage";
        if (folderState.connected) postFolderMessage("list");
      } else if (payload.event === "files") {
        syncChartsFromFolder(payload.files);
      } else if (payload.event === "error") {
        setStatus(`Files folder error: ${payload.message}`);
      }
    }
  };

  const state = {
    charts: readCharts(),
    currentName: "default_chart",
    annotations: {},
    selectedType: "tooth",
    toothStatus: "permanent",
    spaceStatus: "fulfilled",
    flags: { wobbly: false, filled: false, cavity: false, painful: false },
    selectedKey: null,
    previewingHistory: false
  };

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readCharts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeCharts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.charts));
  }

  function ensureChart(name) {
    if (!state.charts[name]) {
      state.charts[name] = { annotations: {}, history: [], created_at: new Date().toISOString() };
      writeCharts();
    }
    if (!Array.isArray(state.charts[name].history)) state.charts[name].history = [];
    if (!state.charts[name].annotations || typeof state.charts[name].annotations !== "object") state.charts[name].annotations = {};
    return state.charts[name];
  }

  function setStatus(message) {
    statusElement.textContent = message;
  }

  function refreshChartPicker() {
    const names = Object.keys(state.charts).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    savedChartsSelect.replaceChildren();
    names.forEach(name => savedChartsSelect.add(new Option(name, name)));
    savedChartsSelect.value = names.includes(state.currentName) ? state.currentName : names[0] || "";
    chartNameInput.value = state.currentName;
    currentChartElement.textContent = state.currentName;
  }

  function useChart(name, message = "Using chart") {
    const cleaned = String(name || "").trim();
    if (!cleaned) {
      alertDialog("Chart name required", "Enter a chart name first.");
      return false;
    }
    const chart = ensureChart(cleaned);
    state.currentName = cleaned;
    state.annotations = copy(chart.annotations);
    state.previewingHistory = false;
    state.selectedKey = null;
    refreshChartPicker();
    renderChart();
    setStatus(`${message}: ${cleaned}. Auto-save is ON.`);
    return true;
  }

  function autosave(action) {
    const chart = ensureChart(state.currentName);
    chart.annotations = copy(state.annotations);
    chart.history.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      edited_at: new Date().toISOString(),
      action_label: action,
      snapshot: copy(state.annotations)
    });
    chart.history = chart.history.slice(0, 500);
    state.previewingHistory = false;
    writeCharts();
    writeChartToFolder(state.currentName, chart);
    renderChart();
  }

  function titleStatus(status) {
    return STATUS_LABELS[status] || String(status).replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function permanentToothName(code) {
    const quadrant = Math.floor(code / 10);
    const number = code % 10;
    const arch = quadrant === 1 || quadrant === 2 ? "Upper" : "Lower";
    const side = quadrant === 1 || quadrant === 4 ? "right" : "left";
    const names = [null, "central incisor", "lateral incisor", "canine", "first premolar", "second premolar", "first molar", "second molar", "third molar"];
    return `${arch} ${side} ${names[number]}`;
  }

  function primaryToothName(code) {
    const quadrant = Math.floor(code / 10);
    const number = code % 10;
    const arch = quadrant === 5 || quadrant === 6 ? "Upper" : "Lower";
    const side = quadrant === 5 || quadrant === 8 ? "right" : "left";
    const names = [null, "central incisor", "lateral incisor", "canine", "first molar", "second molar"];
    return `${arch} ${side} primary ${names[number]}`;
  }

  function itemInfo(key) {
    const match = /^(upper|lower)_(tooth|space)_(\d+)$/.exec(key);
    if (!match) return null;
    const [, arch, type, indexText] = match;
    const index = Number(indexText) - 1;
    const upper = arch === "upper";
    const permanent = (upper ? PERM_UPPER : PERM_LOWER)[index];
    const primary = (upper ? PRIMARY_UPPER : PRIMARY_LOWER)[index];
    const label = `${upper ? "U" : "L"}${type === "space" ? "G" : ""}${index + 1}`;
    return {
      key, arch, type, index, label, permanent, primary,
      permanentName: permanentToothName(permanent),
      primaryName: primary ? primaryToothName(primary) : null,
      gumWord: upper ? "above" : "below"
    };
  }

  function selectedFlags() {
    const flags = [];
    if (state.flags.wobbly) flags.push("Wobbly");
    if (state.flags.filled) flags.push("Filled");
    if (state.flags.cavity) flags.push("Cavity");
    if (state.flags.painful) flags.push("Painful / Sensitive");
    return flags;
  }

  function descriptionFor(info, oldAnnotation, annotation) {
    if (!oldAnnotation && annotation) {
      const extras = selectedFlags().map(label => ` (+${label})`).join("");
      return `${info.label}: added (${titleStatus(annotation.status)})${extras}`;
    }
    if (oldAnnotation && !annotation) return `${info.label}: removed`;
    let text = `${info.label}: ${titleStatus(oldAnnotation.status)} → ${titleStatus(annotation.status)}`;
    for (const [key, label] of [["wobbly", "Wobbly"], ["filled", "Filled"], ["cavity", "Cavity"], ["painful", "Painful/Sensitive"]]) {
      if (Boolean(oldAnnotation[key]) !== Boolean(annotation[key])) text += annotation[key] ? ` (+${label})` : ` (-${label})`;
    }
    if ((oldAnnotation.note || "").trim() !== (annotation.note || "").trim()) text += annotation.note ? " (note changed)" : " (note removed)";
    return text;
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function addChartText(text, x, y, className, parent = chartSvg) {
    const element = svgElement("text", { x, y, class: className });
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function pointOnArch(arch, type, index) {
    const upper = arch === "upper";
    const centerY = upper ? 285 : 600;
    const radiusY = type === "space" ? 220 : 150;
    const start = upper ? 200 : 20;
    const end = upper ? 340 : 160;
    const angle = (start + (end - start) * index / 15) * Math.PI / 180;
    return { x: 620 + 500 * Math.cos(angle), y: centerY + radiusY * Math.sin(angle) };
  }

  function annotationAria(info, annotation) {
    const parts = [info.label, info.type === "tooth" ? info.permanentName : `gum space ${info.gumWord} permanent tooth ${info.permanent}`];
    parts.push(annotation ? titleStatus(annotation.status) : "Unmarked");
    if (annotation?.note) parts.push(`Note: ${annotation.note}`);
    return parts.join(", ");
  }

  function renderChart() {
    chartSvg.replaceChildren();
    addChartText("Upper jaw", 70, 54, "arch-title");
    addChartText("Rectangles = gum spaces, Ovals = teeth", 70, 82, "arch-note");
    addChartText("Left", 80, 450, "side-label");
    addChartText("Right", 1110, 450, "side-label");
    addChartText("Lower jaw", 70, 525, "arch-title");

    for (const arch of ["upper", "lower"]) {
      // Draw ovals first so rectangular gum spaces stay tappable where the
      // generous touch targets overlap at the ends of each arch.
      for (const type of ["tooth", "space"]) {
        for (let index = 0; index < 16; index += 1) {
          const key = `${arch}_${type}_${index + 1}`;
          const info = itemInfo(key);
          const point = pointOnArch(arch, type, index);
          const annotation = state.annotations[key];
          const group = svgElement("g", {
            class: `chart-item${state.selectedKey === key ? " selected" : ""}`,
            tabindex: "0",
            role: "button",
            "aria-label": annotationAria(info, annotation),
            "data-item-key": key
          });
          const shape = type === "tooth"
            ? svgElement("ellipse", { class: "shape", cx: point.x, cy: point.y, rx: 23, ry: 33, fill: STATUS_COLORS[annotation?.status || "unmarked"] })
            : svgElement("rect", { class: "shape", x: point.x - 21, y: point.y - 13, width: 42, height: 26, rx: 2, fill: STATUS_COLORS[annotation?.status || "unmarked"] });
          group.append(shape);
          addChartText(info.label, point.x, point.y - (annotation ? 5 : 0), "", group);
          if (annotation) {
            const markers = [];
            if (annotation.wobbly) markers.push("W");
            if (annotation.filled) markers.push("F");
            if (annotation.cavity) markers.push("C");
            if (annotation.painful) markers.push("PoS");
            const detail = `${SHORT_STATUS[annotation.status] || "?"}${markers.length ? ` + ${markers.join("/")}` : ""}`;
            addChartText(detail, point.x, point.y + 10, "marker", group);
          }
          group.addEventListener("click", () => openAnnotationEditor(key));
          group.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openAnnotationEditor(key);
            }
          });
          group.addEventListener("contextmenu", event => {
            event.preventDefault();
            removeAnnotation(key, true);
          });
          chartSvg.append(group);
        }
      }
    }
    currentChartElement.textContent = state.currentName;
    const count = Object.keys(state.annotations).length;
    markCountElement.textContent = `${count} marked item${count === 1 ? "" : "s"}`;
    updateSelectionDetail();
  }

  function updateSelectionDetail() {
    if (!state.selectedKey) {
      selectionDetail.innerHTML = "<strong>No item selected</strong><span>Tap any oval tooth or rectangular gum space.</span>";
      return;
    }
    const info = itemInfo(state.selectedKey);
    const annotation = state.annotations[state.selectedKey];
    const details = info.type === "tooth"
      ? `FDI permanent ${info.permanent} — ${info.permanentName}${info.primary ? ` · FDI milk ${info.primary} — ${info.primaryName}` : ""}`
      : `Gum space ${info.gumWord} permanent tooth ${info.permanent}${info.primary ? ` and milk tooth ${info.primary}` : ""}`;
    selectionDetail.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = `${info.label}${annotation ? ` · ${titleStatus(annotation.status)}` : " · Unmarked"}`;
    const span = document.createElement("span");
    span.textContent = details;
    selectionDetail.append(strong, span);
  }

  async function openAnnotationEditor(key) {
    const info = itemInfo(key);
    state.selectedKey = key;
    renderChart();
    if (info.type !== state.selectedType) {
      setStatus(`That item is a ${info.type === "space" ? "gum space" : "tooth"}. Switch the selection on the left first.`);
      return;
    }
    const oldAnnotation = state.annotations[key] ? copy(state.annotations[key]) : null;
    const status = info.type === "tooth" ? state.toothStatus : state.spaceStatus;
    const result = await showDialog({
      title: `Annotate ${info.label}`,
      buildBody(body) {
        const card = document.createElement("div");
        card.className = "info-card";
        card.textContent = info.type === "tooth"
          ? `FDI permanent: ${info.permanent} — ${info.permanentName}${info.primary ? `\nFDI milk: ${info.primary} — ${info.primaryName}` : ""}`
          : `Gum space ${info.gumWord} permanent tooth ${info.permanent}${info.primary ? ` and milk tooth ${info.primary}` : ""}`;
        card.style.whiteSpace = "pre-line";
        const choice = document.createElement("div");
        choice.className = "info-card";
        choice.textContent = `Selected marking: ${titleStatus(status)}${info.type === "tooth" && selectedFlags().length ? ` · ${selectedFlags().join(", ")}` : ""}`;
        const label = document.createElement("label");
        label.textContent = `Note for ${info.label} (optional)`;
        const textarea = document.createElement("textarea");
        textarea.id = "annotation-note";
        textarea.value = oldAnnotation?.note || "";
        label.append(textarea);
        body.append(card, choice, label);
      },
      actions: [
        ...(oldAnnotation ? [{ label: "Remove Marking", value: "remove", danger: true }] : []),
        { label: "Cancel", value: "cancel" },
        { label: "Save", value: "save", primary: true }
      ]
    });
    if (result === "remove") {
      removeAnnotation(key, false);
      return;
    }
    if (result !== "save") return;
    const annotation = {
      item_type: info.type,
      status,
      wobbly: info.type === "tooth" && state.flags.wobbly,
      filled: info.type === "tooth" && state.flags.filled,
      cavity: info.type === "tooth" && state.flags.cavity,
      painful: info.type === "tooth" && state.flags.painful,
      note: ($("#annotation-note")?.value || "").trim()
    };
    state.annotations[key] = annotation;
    const action = descriptionFor(info, oldAnnotation, annotation);
    autosave(action);
    setStatus(`${action}. Auto-saved.`);
  }

  async function removeAnnotation(key, confirmFirst) {
    if (!state.annotations[key]) return;
    const info = itemInfo(key);
    if (confirmFirst && !(await confirmDialog("Remove marking", `Remove the marking from ${info.label}?`))) return;
    const old = state.annotations[key];
    delete state.annotations[key];
    const action = descriptionFor(info, old, null);
    autosave(action);
    setStatus(`${action}. Auto-saved.`);
  }

  function buildOptions() {
    const createRows = (container, statuses, name) => {
      statuses.forEach((status, index) => {
        const label = document.createElement("label");
        label.className = "option-row";
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = STATUS_COLORS[status];
        const radioLabel = document.createElement("span");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = name;
        radio.value = status;
        radio.checked = index === 0;
        radio.addEventListener("change", () => {
          if (name === "tooth-status") state.toothStatus = status;
          else state.spaceStatus = status;
        });
        radioLabel.append(radio, ` ${titleStatus(status)}`);
        label.append(swatch, radioLabel);
        container.append(label);
      });
    };
    createRows($("[data-tooth-statuses]"), TOOTH_STATUSES, "tooth-status");
    createRows($("[data-space-statuses]"), SPACE_STATUSES, "space-status");
  }

  function updateMode() {
    state.selectedType = document.querySelector('input[name="item-type"]:checked').value;
    toothFieldset.disabled = state.selectedType !== "tooth";
    spaceFieldset.disabled = state.selectedType !== "space";
    setStatus(`Marking ${state.selectedType === "tooth" ? "teeth" : "gum spaces"}. Auto-save is ON.`);
  }

  async function clearCurrentChart() {
    if (!(await confirmDialog("Clear current chart", `Remove all markings from '${state.currentName}'?`))) return;
    state.annotations = {};
    state.selectedKey = null;
    autosave("Cleared current chart");
    setStatus("Cleared current chart. Auto-saved.");
  }

  function reloadCurrentChart() {
    const chart = ensureChart(state.currentName);
    state.annotations = copy(chart.annotations);
    state.previewingHistory = false;
    renderChart();
    setStatus(`Loaded ${Object.keys(state.annotations).length} marked item(s).`);
  }

  async function showHistory() {
    const entries = ensureChart(state.currentName).history;
    let selectedId = entries[0]?.id || null;
    const result = await showDialog({
      title: `History — ${state.currentName}`,
      buildBody(body) {
        if (!entries.length) {
          body.textContent = "No history entries yet.";
          return;
        }
        const list = document.createElement("div");
        list.className = "history-list";
        entries.forEach((entry, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `history-row${index === 0 ? " selected" : ""}`;
          const when = document.createElement("span");
          when.textContent = new Date(entry.edited_at).toLocaleString();
          const action = document.createElement("span");
          action.textContent = entry.action_label || "Edited chart";
          const count = document.createElement("span");
          count.textContent = `${Object.keys(entry.snapshot || {}).length} marked`;
          button.append(when, action, count);
          button.addEventListener("click", () => {
            selectedId = entry.id;
            list.querySelectorAll("button").forEach(row => row.classList.toggle("selected", row === button));
          });
          list.append(button);
        });
        body.append(list);
      },
      actions: [
        { label: "Close", value: "cancel" },
        ...(entries.length ? [{ label: "Preview Selected", value: "preview" }, { label: "Restore Selected", value: "restore", primary: true }] : [])
      ]
    });
    const entry = entries.find(item => item.id === selectedId);
    if (!entry || result === "cancel") return;
    if (result === "preview") {
      state.annotations = copy(entry.snapshot || {});
      state.previewingHistory = true;
      renderChart();
      setStatus("Previewed selected history snapshot. Tap Load to return to the saved current chart.");
    } else if (result === "restore") {
      state.annotations = copy(entry.snapshot || {});
      autosave("Restored from history");
      setStatus("Restored selected history snapshot. Auto-saved.");
    }
  }

  function exportJSON() {
    const payload = chartFilePayload(state.currentName, state.annotations);
    const safeName = safeChartName(state.currentName);
    const message = { filename: `${safeName}.json`, text: JSON.stringify(payload, null, 2) };
    if (window.webkit?.messageHandlers?.exportFile) {
      window.webkit.messageHandlers.exportFile.postMessage(message);
    } else if (window.AndroidBridge?.exportFile) {
      window.AndroidBridge.exportFile(JSON.stringify(message));
    } else {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([message.text], { type: "application/json" }));
      link.download = message.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    setStatus(`Exported JSON for '${state.currentName}'.`);
  }

  function validKey(key, type) {
    const match = /^(upper|lower)_(tooth|space)_(\d+)$/.exec(key);
    return Boolean(match && match[2] === type && Number(match[3]) >= 1 && Number(match[3]) <= 16);
  }

  function cleanImportedAnnotations(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON does not contain a valid 'annotations' object.");
    const cleaned = {};
    Object.entries(value).forEach(([key, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const type = item.item_type;
      const statuses = type === "tooth" ? TOOTH_STATUSES : type === "space" ? SPACE_STATUSES : [];
      if (!validKey(key, type) || !statuses.includes(item.status)) return;
      cleaned[key] = {
        item_type: type,
        status: item.status,
        wobbly: type === "tooth" && Boolean(item.wobbly),
        filled: type === "tooth" && Boolean(item.filled),
        cavity: type === "tooth" && Boolean(item.cavity),
        painful: type === "tooth" && Boolean(item.painful),
        note: item.note == null ? "" : String(item.note)
      };
    });
    return cleaned;
  }

  async function importJSON(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("JSON file format is invalid.");
      const name = chartNameInput.value.trim();
      if (!name) throw new Error("Type a chart name first. Imported data is saved into that chart.");
      state.currentName = name;
      state.annotations = cleanImportedAnnotations(payload.annotations);
      ensureChart(name);
      autosave("Imported chart from JSON");
      refreshChartPicker();
      setStatus(`Imported ${Object.keys(state.annotations).length} item(s) into chart '${name}'.`);
      await alertDialog("Import complete", `Chart imported and saved locally into '${name}'.`);
    } catch (error) {
      await alertDialog("Import failed", error.message || "Could not read JSON file.");
    } finally {
      importInput.value = "";
    }
  }

  function showDialog({ title, buildBody, actions }) {
    if (dialog.open) dialog.close("cancel");
    dialogTitle.textContent = title;
    dialogBody.replaceChildren();
    dialogActions.replaceChildren();
    buildBody(dialogBody);
    actions.forEach(action => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      if (action.primary) button.classList.add("primary");
      if (action.danger) button.classList.add("danger");
      button.addEventListener("click", () => dialog.close(action.value));
      dialogActions.append(button);
    });
    return new Promise(resolve => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue || "cancel"), { once: true });
      dialog.showModal();
    });
  }

  async function confirmDialog(title, message) {
    return await showDialog({
      title,
      buildBody(body) { body.textContent = message; },
      actions: [{ label: "Cancel", value: "cancel" }, { label: "Confirm", value: "confirm", primary: true }]
    }) === "confirm";
  }

  function alertDialog(title, message) {
    return showDialog({
      title,
      buildBody(body) { body.textContent = message; },
      actions: [{ label: "OK", value: "cancel", primary: true }]
    });
  }

  document.querySelectorAll('input[name="item-type"]').forEach(input => input.addEventListener("change", updateMode));
  document.querySelectorAll("[data-flag]").forEach(input => input.addEventListener("change", () => {
    state.flags[input.dataset.flag] = input.checked;
  }));
  $("[data-action='use-chart']").addEventListener("click", () => useChart(chartNameInput.value));
  $("[data-action='load-chart']").addEventListener("click", () => useChart(savedChartsSelect.value, "Loaded chart"));
  $("[data-action='reload']").addEventListener("click", reloadCurrentChart);
  $("[data-action='history']").addEventListener("click", showHistory);
  $("[data-action='clear']").addEventListener("click", clearCurrentChart);
  $("[data-action='export']").addEventListener("click", exportJSON);
  $("[data-action='import']").addEventListener("click", () => importInput.click());
  $("[data-action='choose-data-folder']").addEventListener("click", () => {
    if (!postFolderMessage("choose")) setStatus("Folder storage is available in the mobile app.");
  });
  importInput.addEventListener("change", () => { if (importInput.files?.[0]) importJSON(importInput.files[0]); });

  window.teethChartApp = {
    annotate(key, values = {}) {
      const info = itemInfo(key);
      if (!info) throw new Error("Unknown chart item");
      const status = values.status || (info.type === "tooth" ? "permanent" : "fulfilled");
      if (!(info.type === "tooth" ? TOOTH_STATUSES : SPACE_STATUSES).includes(status)) throw new Error("Invalid status");
      state.annotations[key] = {
        item_type: info.type,
        status,
        wobbly: info.type === "tooth" && Boolean(values.wobbly),
        filled: info.type === "tooth" && Boolean(values.filled),
        cavity: info.type === "tooth" && Boolean(values.cavity),
        painful: info.type === "tooth" && Boolean(values.painful),
        note: values.note || ""
      };
      autosave(`${info.label}: test annotation`);
    },
    importPayload(payload, name = payload.chart_name || state.currentName) {
      state.currentName = name;
      state.annotations = cleanImportedAnnotations(payload.annotations);
      ensureChart(name);
      autosave("Imported chart from JSON");
      refreshChartPicker();
    },
    exportPayload: () => ({ chart_name: state.currentName, annotations: copy(state.annotations) }),
    snapshot: () => ({
      currentName: state.currentName,
      markedItems: Object.keys(state.annotations).length,
      historyEntries: ensureChart(state.currentName).history.length,
      selectedType: state.selectedType,
      previewingHistory: state.previewingHistory,
      annotations: copy(state.annotations)
    })
  };

  buildOptions();
  ensureChart("default_chart");
  useChart("default_chart", "Ready. Using chart");
  postFolderMessage("status");
})();
