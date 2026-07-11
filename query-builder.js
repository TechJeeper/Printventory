/**
 * Multi-value filters (AND/OR) and search query clauses for getModelsFiltered.
 */
(function () {
  const MULTI_KEYS = ["designer", "license", "parentModel", "tags"];

  function initState() {
    if (!window.multiFilterChips) {
      window.multiFilterChips = { designer: [], license: [], parentModel: [], tags: [] };
    }
    if (!window.multiFilterCombine) {
      window.multiFilterCombine = { designer: "OR", license: "OR", parentModel: "OR", tags: "AND" };
    }
  }

  function getCombine(kind) {
    initState();
    const el = document.querySelector(`input[name="${kind}-combine"]:checked`);
    return el && el.value === "AND" ? "AND" : "OR";
  }

  function setCombineUIRow(kind, visible) {
    const row = document.getElementById(`${kind}-combine-row`);
    if (row) row.hidden = !visible;
  }

  function renderChips(kind) {
    initState();
    const container = document.getElementById(`${kind}-filter-chips`);
    if (!container) return;
    const list = window.multiFilterChips[kind] || [];
    container.innerHTML = "";
    if (list.length === 0) {
      container.hidden = true;
      setCombineUIRow(kind, false);
      return;
    }
    container.hidden = false;
    setCombineUIRow(kind, list.length > 1);
    list.forEach((val) => {
      const chip = document.createElement("span");
      chip.className = "filter-value-chip";
      chip.dataset.kind = kind;
      chip.dataset.value = val;
      const label = val === "__none__" ? "(empty)" : val;
      chip.textContent = label;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "filter-chip-remove";
      x.setAttribute("aria-label", "Remove");
      x.textContent = "×";
      x.dataset.kind = kind;
      x.dataset.value = val;
      chip.appendChild(x);
      container.appendChild(chip);
    });
  }

  function addChip(kind, raw) {
    initState();
    const v = raw == null ? "" : String(raw).trim();
    if (!v) return;
    const list = window.multiFilterChips[kind];
    if (list.includes(v)) return;
    list.push(v);
    renderChips(kind);
  }

  function removeChip(kind, raw) {
    initState();
    const v = String(raw);
    window.multiFilterChips[kind] = (window.multiFilterChips[kind] || []).filter((x) => x !== v);
    renderChips(kind);
  }

  function clearChipsKind(kind) {
    initState();
    window.multiFilterChips[kind] = [];
    renderChips(kind);
  }

  function clearAllMultiChips() {
    MULTI_KEYS.forEach(clearChipsKind);
  }

  function effectiveScalarValues(kind, selectId) {
    initState();
    const chips = window.multiFilterChips[kind] || [];
    if (chips.length) {
      return { values: chips.slice(), combine: getCombine(kind) };
    }
    const sel = document.getElementById(selectId);
    const v = sel && sel.value ? String(sel.value).trim() : "";
    if (!v) return { values: [], combine: "OR" };
    return { values: [v], combine: "OR" };
  }

  function effectiveTagValues() {
    return effectiveScalarValues("tags", "tag-filter");
  }

  function wireMultiFilterUI() {
    document.querySelectorAll(".filter-multi-chips").forEach((container) => {
      container.replaceWith(container.cloneNode(false));
    });
    MULTI_KEYS.forEach((k) => renderChips(k));
    MULTI_KEYS.forEach((kind) => {
      const c = document.getElementById(`${kind}-filter-chips`);
      if (!c) return;
      c.addEventListener("click", async (e) => {
        const t = e.target;
        if (!t.classList || !t.classList.contains("filter-chip-remove")) return;
        const k = t.dataset.kind;
        const v = t.dataset.value;
        if (k != null && v != null) removeChip(k, v);
        if (typeof window.resetFilterSelectionAndDetails === "function") {
          window.resetFilterSelectionAndDetails();
        }
        if (typeof window.performCombinedSearch === "function") {
          await window.performCombinedSearch();
        }
      });
    });

    ["designer", "license", "parentModel", "tags"].forEach((kind) => {
      document.querySelectorAll(`input[name="${kind}-combine"]`).forEach((radio) => {
        radio.addEventListener("change", async () => {
          window.multiFilterCombine[kind] = getCombine(kind);
          if (typeof window.performCombinedSearch === "function") {
            await window.performCombinedSearch();
          }
        });
      });
    });
  }

  const SEARCH_FIELD_LABELS = {
    all: "All fields",
    fileName: "File name",
    designer: "Designer",
    parentModel: "Parent model",
    notes: "Notes",
    filePath: "Path",
    source: "Source",
    license: "License",
    tag: "Tag name",
  };

  /** @typedef {{ t: 'clause', field: string, value: string }} SearchClauseToken */
  /** @typedef {{ t: 'op', op: 'AND'|'OR' }} SearchOpToken */
  /** @typedef {{ t: 'not' }} SearchNotToken */
  /** @typedef {SearchClauseToken|SearchOpToken|SearchNotToken} SearchBoolToken */

  function initSearchClauseState() {
    if (!Array.isArray(window.searchBoolTokens)) window.searchBoolTokens = [];
    if (window.searchClauseList && window.searchClauseList.length && window.searchBoolTokens.length === 0) {
      const op = window.searchClauseOp === "OR" ? "OR" : "AND";
      window.searchClauseList.forEach((c, i) => {
        if (i > 0) window.searchBoolTokens.push({ t: "op", op });
        window.searchBoolTokens.push({
          t: "clause",
          field: (c && c.field) || "all",
          value: String((c && c.value) || "").trim(),
        });
      });
    }
    window.searchClauseList = [];
    window.searchClauseOp = "AND";
  }

  function setSearchQueryAwaiting(want) {
    window.searchQueryAwaitingClause = !!want;
    const hint = document.getElementById("search-boolean-hint");
    const section = document.querySelector(".filter-section");
    if (hint) hint.hidden = !want;
    if (section) section.classList.toggle("filter-section-awaiting-search", want);
  }

  function dismissSearchAwaiting() {
    setSearchQueryAwaiting(false);
  }

  /** @returns {SearchBoolToken[]} */
  function readSearchBoolTokens() {
    initSearchClauseState();
    return window.searchBoolTokens.map((x) => {
      if (x.t === "clause") {
        return {
          t: "clause",
          field: (x.field || "all").toString(),
          value: String(x.value || "").trim(),
        };
      }
      if (x.t === "op") return { t: "op", op: x.op === "OR" ? "OR" : "AND" };
      if (x.t === "not") return { t: "not" };
      if (x.t === "filter") {
        return {
          t: "filter",
          kind: String(x.kind || "").trim(),
          value: String(x.value != null ? x.value : "").trim(),
        };
      }
      if (x.t === "filterMulti") {
        const vals = Array.isArray(x.values) ? x.values.map((v) => String(v).trim()).filter(Boolean) : [];
        const combine = String(x.combine || "OR").toUpperCase() === "AND" ? "AND" : "OR";
        return { t: "filterMulti", kind: String(x.kind || "").trim(), values: vals, combine };
      }
      return { t: "not" };
    });
  }

  /** AND AND / OR OR is equivalent to one operator; collapse before compile / IPC. */
  function collapseAdjacentDuplicateBinaryOps(arr) {
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1];
      const b = arr[i];
      if (a.t === "op" && b.t === "op" && a.op === b.op) {
        arr.splice(i, 1);
        i--;
      }
    }
  }

  function normalizeTokensForIpc(tokens) {
    const out = tokens.filter((tok) => {
      if (tok.t === "clause") return !!String(tok.value || "").trim();
      if (tok.t === "op") return tok.op === "AND" || tok.op === "OR";
      if (tok.t === "not") return true;
      if (tok.t === "filter") {
        const k = String(tok.kind || "").trim();
        if (!k || !["designer", "license", "parentModel", "tag", "fileType", "printed", "isNew", "favorite", "rating", "ratingMin"].includes(k)) return false;
        const v = tok.value != null ? String(tok.value).trim() : "";
        if (k === "printed") return v === "printed" || v === "not-printed";
        if (k === "isNew") return v === "new" || v === "not-new";
        if (k === "favorite") return v === "favorited" || v === "not-favorited";
        if (k === "rating") return v === "unrated" || /^[1-5]$/.test(v);
        if (k === "ratingMin") return /^[1-5]$/.test(v);
        return !!v;
      }
      if (tok.t === "filterMulti") {
        const k = String(tok.kind || "").trim();
        if (!["designer", "license", "parentModel", "tag"].includes(k)) return false;
        return Array.isArray(tok.values) && tok.values.some((x) => String(x).trim());
      }
      return false;
    });
    collapseAdjacentDuplicateBinaryOps(out);
    while (out.length && out[out.length - 1].t === "op") out.pop();
    while (out.length && out[out.length - 1].t === "not") out.pop();
    return out;
  }

  function kindsEncodedInSearchTokens(norm) {
    const s = new Set();
    if (!norm || !norm.length) return s;
    for (const tok of norm) {
      if (tok.t === "filter") {
        const k = String(tok.kind || "").trim();
        if (k) s.add(k);
      }
      if (tok.t === "filterMulti") {
        const k = String(tok.kind || "").trim();
        if (k) s.add(k);
      }
    }
    return s;
  }

  function pruneFilterPayloadOverlappingTokens(filters, norm) {
    const enc = kindsEncodedInSearchTokens(norm);
    if (!enc.size) return;
    if (enc.has("designer")) {
      delete filters.designers;
      delete filters.designer;
    }
    if (enc.has("license")) {
      delete filters.licenses;
      delete filters.license;
    }
    if (enc.has("parentModel")) {
      delete filters.parentModels;
      delete filters.parentModel;
    }
    if (enc.has("tag")) {
      delete filters.tags;
      delete filters.tag;
    }
    if (enc.has("fileType")) delete filters.fileType;
    if (enc.has("printed")) delete filters.printed;
    if (enc.has("isNew")) delete filters.isNew;
    if (enc.has("favorite")) delete filters.favorite;
    if (enc.has("rating")) delete filters.rating;
    if (enc.has("ratingMin")) delete filters.ratingMin;
  }

  function readSearchClauses() {
    return readSearchBoolTokens()
      .filter((x) => x.t === "clause")
      .map((c) => ({ field: c.field, value: c.value }))
      .filter((c) => c.value);
  }

  function hasActiveSearchClauses() {
    return normalizeTokensForIpc(readSearchBoolTokens()).length > 0;
  }

  function isSearchOperand(tok) {
    return tok && (tok.t === "clause" || tok.t === "filter" || tok.t === "filterMulti");
  }

  function appendSearchClauseFromSidebar(field, rawValue) {
    initSearchClauseState();
    const v = String(rawValue || "").trim();
    if (!v) return false;
    const tok = window.searchBoolTokens;
    const last = tok.length ? tok[tok.length - 1] : null;
    if (last && isSearchOperand(last)) {
      tok.push({ t: "op", op: "AND" });
    }
    tok.push({ t: "clause", field: field || "all", value: v });
    collapseAdjacentDuplicateBinaryOps(tok);
    setSearchQueryAwaiting(false);
    return true;
  }

  function clearSearchClauseList() {
    window.searchBoolTokens = [];
    window.searchClauseList = [];
    window.searchClauseOp = "AND";
    setSearchQueryAwaiting(false);
  }

  function removeSearchTokenAt(index) {
    initSearchClauseState();
    const n = window.searchBoolTokens.length;
    if (index < 0 || index >= n) return;
    window.searchBoolTokens.splice(index, 1);
    setSearchQueryAwaiting(false);
  }

  function atomsFromActiveSidebarFilters() {
    const atoms = [];
    const printed = document.getElementById("printed-select")?.value || "all";
    if (printed !== "all") atoms.push({ t: "filter", kind: "printed", value: printed });
    const nnew = document.getElementById("new-select")?.value || "all";
    if (nnew !== "all") atoms.push({ t: "filter", kind: "isNew", value: nnew });
    const favorite = document.getElementById("favorite-select")?.value || "all";
    if (favorite !== "all") atoms.push({ t: "filter", kind: "favorite", value: favorite });
    const rating = document.getElementById("rating-select")?.value || "all";
    if (rating !== "all") atoms.push({ t: "filter", kind: "rating", value: rating });
    const ratingMin = document.getElementById("rating-min-select")?.value || "all";
    if (ratingMin !== "all") atoms.push({ t: "filter", kind: "ratingMin", value: ratingMin });
    const ft = document.getElementById("filetype-select")?.value?.trim();
    if (ft) atoms.push({ t: "filter", kind: "fileType", value: ft });

    function pushKind(kindKey, selId, kindProp) {
      const sc = effectiveScalarValues(kindKey, selId);
      if (!sc.values.length) return;
      if (sc.values.length === 1) atoms.push({ t: "filter", kind: kindProp, value: sc.values[0] });
      else atoms.push({ t: "filterMulti", kind: kindProp, values: sc.values.slice(), combine: sc.combine });
    }
    pushKind("designer", "designer-select", "designer");
    pushKind("license", "license-select", "license");
    pushKind("parentModel", "parent-select", "parentModel");

    const tg = effectiveTagValues();
    if (tg.values.length === 1) atoms.push({ t: "filter", kind: "tag", value: tg.values[0] });
    else if (tg.values.length > 1) atoms.push({ t: "filterMulti", kind: "tag", values: tg.values.slice(), combine: tg.combine });

    return atoms;
  }

  function tokenSequenceAndJoinAtoms(atoms) {
    if (!atoms.length) return [];
    const seq = [];
    for (let i = 0; i < atoms.length; i++) {
      if (i > 0) seq.push({ t: "op", op: "AND" });
      seq.push(atoms[i]);
    }
    return seq;
  }

  function kindsFromAtoms(atoms) {
    const s = new Set();
    for (const a of atoms || []) {
      if ((a.t === "filter" || a.t === "filterMulti") && a.kind) s.add(a.kind);
    }
    return s;
  }

  function clearSidebarFilterKinds(kindSet) {
    initState();
    if (!kindSet || kindSet.size === 0) return;
    if (kindSet.has("designer")) {
      const sel = document.getElementById("designer-select");
      if (sel) sel.value = "";
      window.multiFilterChips.designer = [];
      renderChips("designer");
    }
    if (kindSet.has("license")) {
      const sel = document.getElementById("license-select");
      if (sel) sel.value = "";
      window.multiFilterChips.license = [];
      renderChips("license");
    }
    if (kindSet.has("parentModel")) {
      const sel = document.getElementById("parent-select");
      if (sel) sel.value = "";
      window.multiFilterChips.parentModel = [];
      renderChips("parentModel");
    }
    if (kindSet.has("tag")) {
      const sel = document.getElementById("tag-filter");
      if (sel) sel.value = "";
      window.multiFilterChips.tags = [];
      renderChips("tags");
    }
    if (kindSet.has("fileType")) {
      const sel = document.getElementById("filetype-select");
      if (sel) sel.value = "";
    }
    if (kindSet.has("printed")) {
      const sel = document.getElementById("printed-select");
      if (sel) sel.value = "all";
    }
    if (kindSet.has("isNew")) {
      const sel = document.getElementById("new-select");
      if (sel) sel.value = "all";
    }
    if (kindSet.has("favorite")) {
      const sel = document.getElementById("favorite-select");
      if (sel) sel.value = "all";
    }
    if (kindSet.has("rating")) {
      const sel = document.getElementById("rating-select");
      if (sel) sel.value = "all";
    }
    if (kindSet.has("ratingMin")) {
      const sel = document.getElementById("rating-min-select");
      if (sel) sel.value = "all";
    }
  }

  function atomsFromSingleFilterChangeElement(elementId) {
    if (elementId === "printed-select") {
      const p = document.getElementById("printed-select")?.value || "all";
      return p !== "all" ? [{ t: "filter", kind: "printed", value: p }] : [];
    }
    if (elementId === "new-select") {
      const n = document.getElementById("new-select")?.value || "all";
      return n !== "all" ? [{ t: "filter", kind: "isNew", value: n }] : [];
    }
    if (elementId === "favorite-select") {
      const f = document.getElementById("favorite-select")?.value || "all";
      return f !== "all" ? [{ t: "filter", kind: "favorite", value: f }] : [];
    }
    if (elementId === "rating-select") {
      const r = document.getElementById("rating-select")?.value || "all";
      return r !== "all" ? [{ t: "filter", kind: "rating", value: r }] : [];
    }
    if (elementId === "rating-min-select") {
      const rm = document.getElementById("rating-min-select")?.value || "all";
      return rm !== "all" ? [{ t: "filter", kind: "ratingMin", value: rm }] : [];
    }
    if (elementId === "filetype-select") {
      const ft = document.getElementById("filetype-select")?.value?.trim();
      return ft ? [{ t: "filter", kind: "fileType", value: ft }] : [];
    }
    if (elementId === "designer-select") {
      const sc = effectiveScalarValues("designer", "designer-select");
      if (!sc.values.length) return [];
      if (sc.values.length === 1) return [{ t: "filter", kind: "designer", value: sc.values[0] }];
      return [{ t: "filterMulti", kind: "designer", values: sc.values.slice(), combine: sc.combine }];
    }
    if (elementId === "license-select") {
      const sc = effectiveScalarValues("license", "license-select");
      if (!sc.values.length) return [];
      if (sc.values.length === 1) return [{ t: "filter", kind: "license", value: sc.values[0] }];
      return [{ t: "filterMulti", kind: "license", values: sc.values.slice(), combine: sc.combine }];
    }
    if (elementId === "parent-select") {
      const sc = effectiveScalarValues("parentModel", "parent-select");
      if (!sc.values.length) return [];
      if (sc.values.length === 1) return [{ t: "filter", kind: "parentModel", value: sc.values[0] }];
      return [{ t: "filterMulti", kind: "parentModel", values: sc.values.slice(), combine: sc.combine }];
    }
    return [];
  }

  function materializeActiveSidebarFiltersIntoSearchTokensIfNeeded() {
    const atoms = atomsFromActiveSidebarFilters();
    if (!atoms.length) return false;
    const seq = tokenSequenceAndJoinAtoms(atoms);
    window.searchBoolTokens.splice(0, window.searchBoolTokens.length, ...seq);
    collapseAdjacentDuplicateBinaryOps(window.searchBoolTokens);
    clearSidebarFilterKinds(kindsFromAtoms(atoms));
    setSearchQueryAwaiting(false);
    return true;
  }

  /** True when sidebar pick should complete a dangling AND/OR/NOT from the toolbar. */
  function queryBuilderAwaitingSearchOperandSlot() {
    if (!window.searchQueryAwaitingClause) return false;
    const tok = window.searchBoolTokens;
    const last = tok.length ? tok[tok.length - 1] : null;
    return !!(last && (last.t === "op" || last.t === "not"));
  }

  function queryBuilderTryConsumeAwaitingFilterFromElement(elementId) {
    initSearchClauseState();
    if (!queryBuilderAwaitingSearchOperandSlot()) return false;
    const picked = atomsFromSingleFilterChangeElement(elementId);
    if (!picked.length) return false;
    picked.forEach((p) => window.searchBoolTokens.push(p));
    collapseAdjacentDuplicateBinaryOps(window.searchBoolTokens);
    clearSidebarFilterKinds(kindsFromAtoms(picked));
    setSearchQueryAwaiting(false);
    return true;
  }

  function queryBuilderTryConsumeAwaitingTagPick(rawTag) {
    initSearchClauseState();
    if (!queryBuilderAwaitingSearchOperandSlot()) return false;
    const v = String(rawTag || "").trim();
    if (!v) return false;
    window.searchBoolTokens.push({ t: "filter", kind: "tag", value: v });
    collapseAdjacentDuplicateBinaryOps(window.searchBoolTokens);
    clearSidebarFilterKinds(new Set(["tag"]));
    setSearchQueryAwaiting(false);
    return true;
  }

  function appendSearchBoolOp(op) {
    initSearchClauseState();
    const join = op === "OR" ? "OR" : "AND";
    const tok = window.searchBoolTokens;
    let last = tok.length ? tok[tok.length - 1] : null;
    if (!last) {
      materializeActiveSidebarFiltersIntoSearchTokensIfNeeded();
      last = tok.length ? tok[tok.length - 1] : null;
    }
    if (!last) return;
    if (last.t === "op") {
      last.op = join;
      setSearchQueryAwaiting(true);
      return;
    }
    if (last.t === "not") return;
    tok.push({ t: "op", op: join });
    setSearchQueryAwaiting(true);
  }

  function appendSearchBoolNot() {
    initSearchClauseState();
    const tok = window.searchBoolTokens;
    let last = tok.length ? tok[tok.length - 1] : null;
    if (!last) materializeActiveSidebarFiltersIntoSearchTokensIfNeeded();
    last = tok.length ? tok[tok.length - 1] : null;
    if (!last) {
      tok.push({ t: "not" });
      setSearchQueryAwaiting(true);
      return;
    }
    if (last.t === "clause" || last.t === "filter" || last.t === "filterMulti") {
      tok.push({ t: "op", op: "AND" });
      tok.push({ t: "not" });
      setSearchQueryAwaiting(true);
      return;
    }
    if (last.t === "op") {
      tok.push({ t: "not" });
      setSearchQueryAwaiting(true);
      return;
    }
    if (last.t === "not") {
      tok.push({ t: "not" });
      setSearchQueryAwaiting(true);
    }
  }

  /** @deprecated kept for callers; joiners removed from UI */
  function getSearchClauseOp() {
    initSearchClauseState();
    const t = readSearchBoolTokens();
    for (let i = 0; i < t.length; i++) {
      if (t[i].t === "op") return t[i].op;
    }
    return "AND";
  }

  function toggleSearchClauseOp() {
    initSearchClauseState();
    const tok = window.searchBoolTokens;
    for (let i = tok.length - 1; i >= 0; i--) {
      if (tok[i].t === "op") {
        tok[i].op = tok[i].op === "OR" ? "AND" : "OR";
        return;
      }
    }
  }

  function searchFieldLabel(field) {
    return SEARCH_FIELD_LABELS[field] || field || "All fields";
  }

  /** Legacy no-op (sidebar builder removed). */
  function syncSearchClauseRadios() {}

  function wireSearchQueryBuilder() {
    initSearchClauseState();
  }

  function appendExtendedFilterFields(filters) {
    const d = effectiveScalarValues("designer", "designer-select");
    if (d.values.length) {
      filters.designers = d.values;
      filters.designerCombine = d.combine;
    }
    const lic = effectiveScalarValues("license", "license-select");
    if (lic.values.length) {
      filters.licenses = lic.values;
      filters.licenseCombine = lic.combine;
    }
    const pm = effectiveScalarValues("parentModel", "parent-select");
    if (pm.values.length) {
      filters.parentModels = pm.values;
      filters.parentModelCombine = pm.combine;
    }
    const tg = effectiveTagValues();
    if (tg.values.length) {
      filters.tags = tg.values;
      filters.tagCombine = tg.combine;
    }

    const normalized = normalizeTokensForIpc(readSearchBoolTokens());
    const hasSearchExpr = normalized.some(
      (x) => x.t === "clause" || x.t === "filter" || x.t === "filterMulti"
    );
    if (hasSearchExpr) {
      filters.searchTokens = normalized;
      pruneFilterPayloadOverlappingTokens(filters, normalized);
    } else {
      // Search text only applies after you press search (tokens); draft input does not filter.
      filters.search = "";
    }
  }

  /** Plain-text summary for sidebar filter atoms embedded in query tokens (caller escapes for HTML). */
  function queryBuilderSidebarFilterTokenLabel(tok) {
    if (tok.t === "filterMulti") {
      const vs = tok.values.join(", ");
      const mode = tok.combine === "AND" ? "all" : "any";
      if (tok.kind === "designer") return `Designer: ${vs} (${mode})`;
      if (tok.kind === "license") return `License: ${vs} (${mode})`;
      if (tok.kind === "parentModel") return `Parent: ${vs} (${mode})`;
      if (tok.kind === "tag") return `Tag: ${vs} (${mode})`;
    }
    if (tok.t === "filter") {
      const vdisp = tok.value === "__none__" ? "(empty)" : String(tok.value);
      if (tok.kind === "designer") return `Designer: ${vdisp}`;
      if (tok.kind === "license") return `License: ${vdisp}`;
      if (tok.kind === "parentModel") return `Parent: ${vdisp}`;
      if (tok.kind === "tag") return `Tag: ${vdisp}`;
      if (tok.kind === "fileType") return `Type: ${vdisp}`;
      if (tok.kind === "printed") return tok.value === "printed" ? "Printed" : "Not printed";
      if (tok.kind === "isNew") return tok.value === "new" ? "New models only" : "Exclude new models";
      if (tok.kind === "favorite") return tok.value === "favorited" ? "Favorites" : "Not favorites";
      if (tok.kind === "rating") {
        if (tok.value === "unrated") return "Rating: Unrated";
        return `Rating: ${tok.value} star${tok.value === "1" ? "" : "s"}`;
      }
      if (tok.kind === "ratingMin") return `Min rating: ${tok.value}+`;
    }
    return "Filter";
  }

  function queryBuilderInvertedFilterKindsForAtom(tok) {
    if ((tok.t === "filter" || tok.t === "filterMulti") && tok.kind === "designer" && window.invertedFilters?.designer) return true;
    if ((tok.t === "filter" || tok.t === "filterMulti") && tok.kind === "license" && window.invertedFilters?.license) return true;
    if ((tok.t === "filter" || tok.t === "filterMulti") && tok.kind === "parentModel" && window.invertedFilters?.parentModel) return true;
    if ((tok.t === "filter" || tok.t === "filterMulti") && tok.kind === "tag" && window.invertedFilters?.tag) return true;
    return false;
  }

  function setTagMultiFilter(names) {
    initState();
    window.multiFilterChips.tags = (Array.isArray(names) ? names : []).map((n) => String(n).trim()).filter(Boolean);
    renderChips("tags");
  }

  window.queryBuilderInitState = function () {
    initState();
    initSearchClauseState();
  };
  window.queryBuilderWireMultiFilterUI = wireMultiFilterUI;
  window.queryBuilderWireSearchQueryBuilder = wireSearchQueryBuilder;
  window.queryBuilderAppendExtendedFilterFields = appendExtendedFilterFields;
  window.queryBuilderHasActiveSearchClauses = hasActiveSearchClauses;
  window.queryBuilderReadSearchClauses = readSearchClauses;
  window.queryBuilderClearAllMultiChips = clearAllMultiChips;
  window.queryBuilderRenderMultiChips = renderChips;
  window.queryBuilderSyncSearchClauseOpRow = syncSearchClauseRadios;
  window.clearSearchClauseList = clearSearchClauseList;
  window.appendSearchClauseFromSidebar = appendSearchClauseFromSidebar;
  window.removeSearchTokenAt = removeSearchTokenAt;
  window.appendSearchBoolOp = appendSearchBoolOp;
  window.appendSearchBoolNot = appendSearchBoolNot;
  window.queryBuilderReadSearchBoolTokens = readSearchBoolTokens;
  window.queryBuilderDismissSearchAwaiting = dismissSearchAwaiting;
  window.toggleSearchClauseOp = toggleSearchClauseOp;
  window.queryBuilderGetSearchClauseOp = getSearchClauseOp;
  window.queryBuilderSearchFieldLabel = searchFieldLabel;
  window.queryBuilderSidebarFilterTokenLabel = queryBuilderSidebarFilterTokenLabel;
  window.queryBuilderInvertedFilterKindsForAtom = queryBuilderInvertedFilterKindsForAtom;
  window.queryBuilderAwaitingSearchOperandSlot = queryBuilderAwaitingSearchOperandSlot;
  window.queryBuilderTryConsumeAwaitingFilterFromElement = queryBuilderTryConsumeAwaitingFilterFromElement;
  window.queryBuilderTryConsumeAwaitingTagPick = queryBuilderTryConsumeAwaitingTagPick;
  window.setTagMultiFilter = setTagMultiFilter;
  window.addMultiTagFilter = (name) => addChip("tags", name);
  window.queryBuilderRemoveMultiFilterChip = removeChip;
  window.queryBuilderHasActiveMultiFilters = function () {
    initState();
    return MULTI_KEYS.some((k) => (window.multiFilterChips[k] || []).length > 0);
  };
})();
