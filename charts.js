/* Result charts: plain SVG drawn from data/results.json and data/variables.json.
 *
 * Every chart sits in a card with a Chart / Table switch, so each value is also
 * readable as text, and marks carry a tooltip on hover and keyboard focus.
 * Colors follow the outcome, never its position: the same three hues as the
 * paper's figures, deepened to pass contrast on white.
 */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const OUTCOME_COLOR = { frailty: "#C8553A", cognition: "#1F6E9C", al: "#B98219", epigenetic: "#6B6B66",
    frailty_excl: "#C8553A" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const minus = (s) => String(s).replace(/^-/, "−").replace(/([\s([,])-/g, "$1−");
  const pct = (v, dp = 1) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "NA";
    const s = (Math.round(v * 100 * 10 ** dp) / 10 ** dp).toFixed(dp);
    return minus(Number(s) === 0 ? s.replace("-", "") : s) + "%";
  };
  const num = (v, dp = 3) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "NA";
    const s = Number(v).toFixed(dp).replace(/^(-?)0\./, "$1.");
    return minus(s);
  };
  const signed = (v, dp = 3) => (v > 0 ? "+" : "") + num(v, dp);

  function el(tag, attrs = {}, text) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  function ticks(lo, hi, n = 5) {
    const span = hi - lo;
    const step0 = span / n;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) out.push(Math.round(t / step) * step);
    return out;
  }

  // tooltip, shared by every chart
  let tip;
  function tooltip() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("role", "status");
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }
  function bindTips(root) {
    const t = tooltip();
    const show = (node, x, y) => {
      t.innerHTML = node.getAttribute("data-tip");
      t.hidden = false;
      const w = t.offsetWidth, h = t.offsetHeight;
      const left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14));
      const top = y - h - 12 < 8 ? y + 18 : y - h - 12;
      t.style.left = `${left + window.scrollX}px`;
      t.style.top = `${top + window.scrollY}px`;
    };
    root.addEventListener("pointermove", (e) => {
      const node = e.target.closest("[data-tip]");
      if (node && root.contains(node)) show(node, e.clientX, e.clientY);
      else t.hidden = true;
    });
    root.addEventListener("pointerleave", () => { t.hidden = true; });
    root.addEventListener("focusin", (e) => {
      const node = e.target.closest("[data-tip]");
      if (!node) return;
      const b = node.getBoundingClientRect();
      show(node, b.left + b.width / 2, b.top);
    });
    root.addEventListener("focusout", () => { t.hidden = true; });
  }

  function svgRoot(width, height, label) {
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": label, class: "chart-svg" });
    return svg;
  }

  function xAxis(svg, x, y0, values, fmt, label, opts = {}) {
    const g = el("g", { class: "axis" });
    for (const v of values) {
      const px = x(v);
      g.appendChild(el("line", { x1: px, x2: px, y1: opts.top ?? 0, y2: y0, class: v === 0 ? "zero" : "grid" }));
      g.appendChild(el("text", { x: px, y: y0 + 16, "text-anchor": "middle", class: "tick" }, fmt(v)));
    }
    if (label) g.appendChild(el("text", { x: opts.labelX ?? x(values[values.length - 1]), y: y0 + 34, "text-anchor": opts.labelAnchor ?? "end", class: "axis-label" }, label));
    svg.appendChild(g);
  }

  // card: title, controls, Chart/Table tabs, source line
  let cardSeq = 0;
  function card(host, spec) {
    const id = `chart${++cardSeq}`;
    host.innerHTML = `
      <figure class="chart-card" aria-labelledby="${id}-title">
        <div class="chart-head">
          <h2 class="chart-title" id="${id}-title">${esc(spec.title)}</h2>
          ${spec.subtitle ? `<p class="chart-sub">${esc(spec.subtitle)}</p>` : ""}
        </div>
        <div class="chart-controls" ${spec.controls ? "" : "hidden"}></div>
        <div class="tabs" role="tablist" aria-label="View">
          <button role="tab" id="${id}-tab-chart" aria-controls="${id}-chart" aria-selected="true" type="button">Chart</button>
          <button role="tab" id="${id}-tab-table" aria-controls="${id}-table" aria-selected="false" tabindex="-1" type="button">Table</button>
        </div>
        <div class="chart-body" id="${id}-chart" role="tabpanel" aria-labelledby="${id}-tab-chart"></div>
        <div class="chart-table" id="${id}-table" role="tabpanel" aria-labelledby="${id}-tab-table" hidden></div>
        ${spec.legend ? `<div class="chart-legend">${spec.legend}</div>` : ""}
        <figcaption class="chart-foot">${spec.source ? `<span><b>Source:</b> ${esc(spec.source)}</span>` : ""}</figcaption>
      </figure>`;
    const fig = host.querySelector("figure");
    const body = fig.querySelector(".chart-body");
    const tablePanel = fig.querySelector(".chart-table");
    const controls = fig.querySelector(".chart-controls");
    const tabs = [...fig.querySelectorAll('[role="tab"]')];
    const select = (i) => {
      tabs.forEach((t, j) => { t.setAttribute("aria-selected", String(i === j)); t.tabIndex = i === j ? 0 : -1; });
      body.hidden = i !== 0;
      tablePanel.hidden = i !== 1;
      if (i === 0) redraw();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(i));
      t.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const j = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
          select(j); tabs[j].focus(); e.preventDefault();
        }
      });
    });
    bindTips(body);
    let lastWidth = 0;
    function redraw(force) {
      if (body.hidden) return;
      const w = Math.max(280, Math.floor(body.clientWidth));
      if (!force && w === lastWidth && body.firstChild) return;
      lastWidth = w;
      body.innerHTML = "";
      spec.draw(body, w);
    }
    const api = {
      controls,
      update() { lastWidth = 0; redraw(true); tablePanel.innerHTML = spec.table(); },
    };
    if (spec.controls) spec.controls(controls, api);
    tablePanel.innerHTML = spec.table();
    requestAnimationFrame(() => redraw(true));
    const ro = new ResizeObserver(() => redraw());
    ro.observe(body);
    return api;
  }

  // segmented control, a radio group styled as buttons
  function segmented(host, name, label, options, value, onChange) {
    const wrap = document.createElement("fieldset");
    wrap.className = "seg";
    wrap.innerHTML = `<legend>${esc(label)}</legend>` + options.map((o) =>
      `<label><input type="radio" name="${esc(name)}" value="${esc(o.value)}" ${o.value === value ? "checked" : ""}><span>${esc(o.label)}</span></label>`).join("");
    wrap.addEventListener("change", (e) => onChange(e.target.value));
    host.appendChild(wrap);
    return wrap;
  }
  function checkbox(host, label, checked, onChange) {
    const l = document.createElement("label");
    l.className = "check";
    l.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}><span>${esc(label)}</span>`;
    l.querySelector("input").addEventListener("change", (e) => onChange(e.target.checked));
    host.appendChild(l);
  }

  const table = (head, rows, opts = {}) =>
    `<div class="table-scroll"><table class="data-table${opts.cls ? " " + opts.cls : ""}">` +
    (opts.caption ? `<caption>${esc(opts.caption)}</caption>` : "") +
    `<thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => r.section
      ? `<tr class="section"><th scope="rowgroup" colspan="${head.length}">${esc(r.section)}</th></tr>`
      : `<tr>${r.map((c, i) => i ? `<td class="num">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join("")}</tr>`).join("") +
    `</tbody></table></div>`;

  // ---------------------------------------------------------------- concurrent
  function concurrent(host, R) {
    const state = { excl: false };
    const rows = () => R.concurrent.filter((r) => r.key !== "frailty_excl" || state.excl);
    return card(host, {
      title: "Cross-validated R² for aging status at Wave 1",
      subtitle: "Background variables alone, and the gain from adding the Tier 2 block",
      legend: `<span class="key"><i class="sw tint"></i>Tier 1 background alone</span><span class="key"><i class="sw solid"></i>Added by Tier 2 (ΔR²)</span>`,
      source: "XGBoost, 5-fold cross-validation, age-adjusted outcomes; SI Table S18.",
      controls(c, api) {
        checkbox(c, "Also show frailty without the overlap-flagged predictors", false, (v) => { state.excl = v; api.update(); });
      },
      draw(body, W) {
        const data = rows();
        const narrow = W < 560;
        const labelW = narrow ? 0 : 190, rightW = narrow ? 0 : 150, rowH = narrow ? 64 : 46, top = 8;
        const H = top + data.length * rowH + 44;
        const svg = svgRoot(W, H, "Bar chart of R² by outcome, split into Tier 1 and the Tier 2 increment");
        const x = scale(0, 0.6, labelW, W - rightW - 8);
        xAxis(svg, x, H - 40, ticks(0, 0.6, narrow ? 3 : 6), (v) => `${Math.round(v * 100)}%`, "R², Wave 1 outcome", { top });
        data.forEach((d, i) => {
          const y = top + i * rowH + (narrow ? 22 : 10);
          const col = OUTCOME_COLOR[d.key];
          const g = el("g", { class: "row" });
          g.appendChild(el("text", { x: narrow ? labelW : labelW - 10, y: narrow ? y - 8 : y + 15, "text-anchor": narrow ? "start" : "end", class: "row-label" }, d.label));
          const t1 = Math.max(0, d.r2_t1), full = Math.max(0, d.r2_full);
          const bh = 22;
          const ci = d.ci ? ` [${pct(d.ci[0])}, ${pct(d.ci[1])}]` : "";
          g.appendChild(el("rect", { x: x(0), y, width: Math.max(0, x(t1) - x(0) - (full > t1 ? 1 : 0)), height: bh, fill: col, "fill-opacity": 0.28, rx: 2,
            "data-tip": `<b>${esc(d.label)}</b><br>Tier 1 alone: R² ${pct(d.r2_t1)}`, tabindex: 0 }));
          if (full > t1) {
            g.appendChild(el("rect", { x: x(t1) + 1, y, width: Math.max(1, x(full) - x(t1) - 1), height: bh, fill: col, rx: 2,
              "data-tip": `<b>${esc(d.label)}</b><br>Added by Tier 2: ΔR² ${pct(d.delta)}${ci}<br>Full model: R² ${pct(d.r2_full)}<br>n = ${d.n.toLocaleString("en-US")}`, tabindex: 0 }));
          }
          const endX = x(Math.max(full, t1)) + 6;
          if (narrow) {
            g.appendChild(el("text", { x: endX, y: y + 15, class: "val" }, `+${pct(d.delta)}`));
          } else {
            g.appendChild(el("text", { x: endX, y: y + 15, class: "val-muted" }, pct(d.r2_full)));
            g.appendChild(el("text", { x: W - rightW + 8, y: y + 11, class: "val" }, `+${pct(d.delta)}`));
            if (ci) g.appendChild(el("text", { x: W - rightW + 8, y: y + 27, class: "val-muted small" }, ci.trim()));
          }
          svg.appendChild(g);
        });
        if (!narrow) svg.appendChild(el("text", { x: W - rightW + 8, y: top - 0 + 0, class: "col-head", dy: "-0.1em" }, ""));
        body.appendChild(svg);
      },
      table() {
        return table(["Outcome", "n", "Tier 1 alone", "Full model", "ΔR² Tier 2", "Repeated-CV interval", "TabPFN, full model"],
          rows().map((d) => [d.label, d.n.toLocaleString("en-US"), pct(d.r2_t1), pct(d.r2_full), pct(d.delta),
            d.ci ? `${pct(d.ci[0])} to ${pct(d.ci[1])}` : "", d.tabpfn_full !== undefined ? pct(d.tabpfn_full) : ""]));
      },
    });
  }

  // ---------------------------------------------------------------- change
  function change(host, R) {
    const state = { w2: false };
    const w1 = R.change.wave1, w2 = R.change.wave2;
    return card(host, {
      title: "Prediction of the Wave 2 outcome with its Wave 1 value held",
      subtitle: "R² built up from Wave 1 status and Tier 1, and the Tier 2 increment magnified",
      legend: `<span class="key"><i class="sw tint"></i>Wave 1 outcome and Tier 1</span><span class="key"><i class="sw solid"></i>Added by Tier 2</span><span class="key"><i class="sw dot"></i>Tier 2 increment, Wave 1 predictors</span>` +
        `<span class="key" data-w2><i class="sw ring"></i>Wave 2 predictors (sensitivity)</span>`,
      source: "XGBoost, 5-fold cross-validation; intervals over 15 repeated fold assignments; SI Table S18.",
      controls(c, api) {
        checkbox(c, "Add the sensitivity analysis with Wave 2 predictors", false, (v) => { state.w2 = v; api.update(); });
      },
      draw(body, W) {
        const narrow = W < 640;
        const panelGap = 28;
        const leftW = narrow ? W : Math.round((W - panelGap) * 0.58);
        const rightW = narrow ? W : W - leftW - panelGap;
        const labelW = narrow ? 0 : 120, rowH = narrow ? 58 : 46, top = 24;
        const H = top + w1.length * rowH + 44;
        const wrap = document.createElement("div");
        wrap.className = narrow ? "panels stacked" : "panels";
        // left: R² of the Wave 2 outcome
        const a = svgRoot(leftW, H, "Bar chart of R² for the Wave 2 outcome by outcome");
        const xa = scale(0, 0.7, labelW, leftW - 54);
        xAxis(a, xa, H - 40, ticks(0, 0.7, narrow ? 4 : 7), (v) => `${Math.round(v * 100)}`, "R², Wave 2 outcome (%)", { top });
        a.appendChild(el("text", { x: labelW, y: 12, class: "panel-head" }, "Full model"));
        // right: the increment
        const lo = state.w2 ? -0.01 : -0.01, hi = state.w2 ? 0.1 : 0.04;
        const b = svgRoot(rightW, H, "Dot plot of the Tier 2 increment with its repeated cross-validation interval");
        const bl = narrow ? 0 : 0;
        const xb = scale(lo, hi, bl + 8, rightW - 12);
        xAxis(b, xb, H - 40, ticks(lo, hi, 5), (v) => (v === 0 ? "0" : `${minus((v * 100).toFixed(0))}`), "ΔR² Tier 2 (%), magnified", { top });
        b.appendChild(el("text", { x: bl + 8, y: 12, class: "panel-head" }, "Tier 2 increment"));
        w1.forEach((d, i) => {
          const y = top + i * rowH + (narrow ? 20 : 10);
          const col = OUTCOME_COLOR[d.key];
          a.appendChild(el("text", { x: narrow ? labelW : labelW - 10, y: narrow ? y - 6 : y + 15, "text-anchor": narrow ? "start" : "end", class: "row-label" }, d.label));
          a.appendChild(el("rect", { x: xa(0), y, width: xa(d.r2_yw1t1) - xa(0) - 1, height: 22, fill: col, "fill-opacity": 0.28, rx: 2, tabindex: 0,
            "data-tip": `<b>${esc(d.label)}</b><br>Wave 1 outcome alone: R² ${pct(d.r2_yw1)}<br>with Tier 1: R² ${pct(d.r2_yw1t1)}` }));
          a.appendChild(el("rect", { x: xa(d.r2_yw1t1) + 1, y, width: Math.max(2, xa(d.r2_full) - xa(d.r2_yw1t1) - 1), height: 22, fill: col, rx: 1, tabindex: 0,
            "data-tip": `<b>${esc(d.label)}</b><br>Added by Tier 2: ΔR² ${pct(d.delta)}<br>Full model: R² ${pct(d.r2_full)}<br>n = ${d.n.toLocaleString("en-US")}` }));
          a.appendChild(el("text", { x: xa(d.r2_full) + 6, y: y + 15, class: "val-muted" }, pct(d.r2_full)));
          // increment
          const cy = y + 11;
          if (narrow) b.appendChild(el("text", { x: 8, y: y - 6, class: "row-label" }, d.label));
          const series = [{ d, filled: true, name: "Wave 1 predictors" }];
          if (state.w2) series.push({ d: w2[i], filled: false, name: "Wave 2 predictors" });
          series.forEach((s, k) => {
            const yy = cy + (state.w2 ? (k ? 7 : -7) : 0);
            const v = s.d;
            if (v.ci) b.appendChild(el("line", { x1: xb(v.ci[0]), x2: xb(v.ci[1]), y1: yy, y2: yy, stroke: col, "stroke-width": 2, "stroke-linecap": "round" }));
            b.appendChild(el("circle", { cx: xb(v.delta), cy: yy, r: 5.5, fill: s.filled ? col : "#fff", stroke: s.filled ? "#fff" : col, "stroke-width": 2, tabindex: 0,
              "data-tip": `<b>${esc(d.label)}</b>, ${s.name}<br>ΔR² Tier 2 ${pct(v.delta)}${v.ci ? `<br>Repeated-CV interval ${pct(v.ci[0])} to ${pct(v.ci[1])}` : ""}<br>n = ${v.n.toLocaleString("en-US")}` }));
            b.appendChild(el("text", { x: xb(v.ci ? v.ci[1] : v.delta) + 8, y: yy + 4, class: k ? "val-muted small" : "val small" }, pct(v.delta)));
          });
        });
        wrap.appendChild(a); wrap.appendChild(b);
        body.appendChild(wrap);
        const key = body.closest("figure").querySelector("[data-w2]");
        if (key) key.hidden = !state.w2;
      },
      table() {
        const head = ["Specification and outcome", "n", "Wave 1 outcome only", "+ Tier 1", "+ Tier 2 (full)", "ΔR² Tier 2", "Repeated-CV interval", "ΔR² Tier 1"];
        const line = (d) => [d.label, d.n.toLocaleString("en-US"), pct(d.r2_yw1), pct(d.r2_yw1t1), pct(d.r2_full), pct(d.delta), d.ci ? `${pct(d.ci[0])} to ${pct(d.ci[1])}` : "", pct(d.delta_t1)];
        const rows = [{ section: "9-year change, Wave 1 predictors" }, ...w1.map(line),
          { section: "9-year change, Wave 2 predictors (sensitivity)" }, ...w2.map(line),
          { section: "9-year change, Wave 1 predictors, by cohort" }, ...R.change.by_cohort.map(line)];
        const ws = R.change.wave2_status;
        return table(head, rows) + `<p class="table-note">Wave 2 status from Wave 2 predictors, no Wave 1 outcome held: ΔR² Tier 2 = ` +
          ws.map((d) => `${esc(d.label.toLowerCase())} ${pct(d.delta)} (n = ${d.n.toLocaleString("en-US")})`).join("; ") + ".</p>";
      },
    });
  }

  // ---------------------------------------------------------------- importance
  const MODEL_LABEL = { cross_sectional: "Cross-sectional (Wave 1 status)", change: "9-year change" };
  function importance(host, R, variables, opts = {}) {
    const outcomes = R.outcomes.filter((o) => o.key !== "epigenetic");
    const state = { outcome: opts.outcome || "frailty", layer: "cross_sectional", n: 15 };
    const ranked = () => variables.map((v) => ({ v, m: v.importance.models[`${state.outcome}.${state.layer}`] || v.importance.models[state.outcome]?.[state.layer] }))
      .filter((r) => r.m).sort((a, b) => a.m.rank - b.m.rank);
    const C = R.concentration;
    return card(host, {
      title: "The predictors that carry the most attribution",
      subtitle: "Mean |SHAP| with 95% bootstrap interval, and top-20 stability across 200 resampled fits",
      source: "Bootstrap SHAP summaries; SI Table S17.",
      controls(c, api) {
        segmented(c, "imp-outcome", "Outcome", outcomes.map((o) => ({ value: o.key, label: o.label })), state.outcome, (v) => { state.outcome = v; api.update(); });
        segmented(c, "imp-layer", "Model", Object.entries(MODEL_LABEL).map(([value, label]) => ({ value, label })), state.layer, (v) => { state.layer = v; api.update(); });
        segmented(c, "imp-n", "Show", [{ value: "15", label: "Top 15" }, { value: "30", label: "Top 30" }], "15", (v) => { state.n = Number(v); api.update(); });
      },
      draw(body, W) {
        const rows = ranked().slice(0, state.n);
        const col = OUTCOME_COLOR[state.outcome];
        const tiles = document.createElement("div");
        tiles.className = "stat-tiles";
        const half = C.to_half[state.outcome][state.layer], eighty = C.to_80[state.outcome][state.layer], stable = C.top20_stable[state.outcome][state.layer], ever = C.top20_ever[state.outcome][state.layer];
        tiles.innerHTML = [
          [half, "Tier 2 predictors reach half of the summed mean |SHAP|"],
          [eighty, "reach 80 percent"],
          [ever, "predictors enter the top 20 in at least one fit"],
          [stable, "do so in at least 60 percent of fits"],
        ].map(([v, l]) => `<div class="tile"><strong>${v}</strong><span>${esc(l)}</span></div>`).join("");
        body.appendChild(tiles);
        const narrow = W < 560;
        const labelW = narrow ? 0 : Math.min(260, W * 0.36), rightW = 56, rowH = narrow ? 40 : 24, top = 20;
        const H = top + rows.length * rowH + 40;
        const maxV = Math.max(...rows.map((r) => r.m.ci[1])) * 1.05;
        const svg = svgRoot(W, H, `Ranked mean absolute SHAP for ${state.outcome}`);
        const x = scale(0, maxV, labelW + 4, W - rightW - 8);
        const tv = ticks(0, maxV, narrow ? 3 : 5);
        const dp = Math.max(0, -Math.floor(Math.log10(tv[1] - tv[0] || 1)) + ((tv[1] - tv[0]) / 10 ** Math.floor(Math.log10(tv[1] - tv[0])) % 1 ? 1 : 0));
        xAxis(svg, x, H - 36, tv, (v) => (v === 0 ? "0" : num(v, dp)), "Mean |SHAP|, outcome units", { top });
        svg.appendChild(el("text", { x: W - rightW + 6, y: 12, class: "panel-head" }, "Stability"));
        rows.forEach((r, i) => {
          const y = top + i * rowH + (narrow ? 18 : 4);
          const cy = y + 8;
          const a = el("a", { href: `#/predictors/${encodeURIComponent(r.v.name)}`, class: "row-link",
            "data-tip": `<b>${esc(r.v.display_label)}</b> (${esc(r.v.name)})<br>Rank ${r.m.rank} of 177<br>Mean |SHAP| ${num(r.m.mean_abs_shap, 4)} [${num(r.m.ci[0], 4)}, ${num(r.m.ci[1], 4)}]<br>Top-20 in ${Math.round(r.m.stability * 100)}% of fits<br>Tier ${r.v.tier}, ${esc(r.v.domain)}` });
          a.appendChild(el("text", { x: narrow ? 0 : labelW - 6, y: narrow ? y - 4 : cy + 4, "text-anchor": narrow ? "start" : "end", class: "row-label" + (r.v.tier === 1 ? " t1" : "") },
            `${r.m.rank}. ${r.v.display_label}${r.v.tier === 1 ? " (Tier 1)" : ""}`));
          a.appendChild(el("rect", { x: x(0), y: cy - 4, width: Math.max(1, x(r.m.mean_abs_shap) - x(0)), height: 8, fill: col, "fill-opacity": r.m.stability >= 0.6 ? 1 : 0.4, rx: 2 }));
          a.appendChild(el("line", { x1: x(r.m.ci[0]), x2: x(r.m.ci[1]), y1: cy, y2: cy, stroke: "#1d1d1b", "stroke-width": 1.25 }));
          a.appendChild(el("text", { x: W - rightW + 6, y: cy + 4, class: "val-muted small" }, `${Math.round(r.m.stability * 100)}%`));
          a.appendChild(el("rect", { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: "transparent" }));
          svg.appendChild(a);
        });
        body.appendChild(svg);
        const note = document.createElement("p");
        note.className = "chart-note";
        note.textContent = "Full bars: top-20 stability of at least 60 percent, the focal predictors of the within-family models. Faded bars fall below it. Select a predictor for its profile.";
        body.appendChild(note);
      },
      table() {
        return table(["Predictor", "Rank", "Mean |SHAP|", "95% interval", "Top-20 stability", "Tier"],
          ranked().map((r) => [r.v.display_label, r.m.rank, num(r.m.mean_abs_shap, 4), `${num(r.m.ci[0], 4)} to ${num(r.m.ci[1], 4)}`, `${Math.round(r.m.stability * 100)}%`, r.v.tier]),
          { caption: `${outcomes.find((o) => o.key === state.outcome).label}, ${MODEL_LABEL[state.layer].toLowerCase()}, all 177 predictors` });
      },
    });
  }

  // ---------------------------------------------------------------- transfer
  function transfer(host, R) {
    const outs = R.outcomes.filter((o) => o.key !== "epigenetic");
    const cell = (s, t) => R.transfer.find((d) => d.source === s && d.target === t);
    return card(host, {
      title: "Share of an outcome's own R² recovered by another outcome's top 20 predictors",
      subtitle: "Rows: the outcome whose top predictors are used. Columns: the outcome they predict.",
      source: "Cross-domain transfer, cross-sectional models; SI Table S3.",
      draw(body, W) {
        const narrow = W < 520;
        const labelW = narrow ? 92 : 170, top = 46, cellH = narrow ? 52 : 56;
        const cellW = Math.min(170, (W - labelW - 8) / outs.length);
        const H = top + outs.length * cellH + 8;
        const svg = svgRoot(labelW + cellW * outs.length + 8, H, "Matrix of transfer shares between outcomes");
        const shade = (v) => `rgba(31, 110, 156, ${0.12 + 0.78 * Math.max(0, Math.min(1, v))})`;
        svg.appendChild(el("text", { x: labelW, y: 14, class: "panel-head" }, "Predicted outcome"));
        svg.appendChild(el("text", { x: labelW - 10, y: top - 10, "text-anchor": "end", class: "panel-head" }, "Top 20 of"));
        outs.forEach((t, j) => svg.appendChild(el("text", { x: labelW + j * cellW + cellW / 2, y: top - 10, "text-anchor": "middle", class: "row-label" }, narrow ? t.label.replace("Allostatic load", "Allostatic") : t.label)));
        outs.forEach((s, i) => {
          const y = top + i * cellH;
          svg.appendChild(el("text", { x: labelW - 10, y: y + cellH / 2 + 4, "text-anchor": "end", class: "row-label" }, narrow ? s.label.replace("Allostatic load", "Allostatic") : s.label));
          outs.forEach((t, j) => {
            const x = labelW + j * cellW;
            if (s.key === t.key) {
              svg.appendChild(el("rect", { x: x + 1, y: y + 1, width: cellW - 2, height: cellH - 2, fill: "#f1f0ec" }));
              svg.appendChild(el("text", { x: x + cellW / 2, y: y + cellH / 2 + 4, "text-anchor": "middle", class: "val-muted small" }, "own model"));
              return;
            }
            const d = cell(s.key, t.key);
            svg.appendChild(el("rect", { x: x + 1, y: y + 1, width: cellW - 2, height: cellH - 2, fill: shade(d.share), tabindex: 0,
              "data-tip": `<b>${esc(s.label)}</b> top 20 predicting <b>${esc(t.label.toLowerCase())}</b><br>R² ${pct(d.cross_r2)} of the target's own ${pct(d.target_own_r2)}<br>Share recovered: ${pct(d.share, 0)}` }));
            svg.appendChild(el("text", { x: x + cellW / 2, y: y + cellH / 2 + 5, "text-anchor": "middle", class: d.share > 0.5 ? "cell-val inv" : "cell-val" }, pct(d.share, 0)));
          });
        });
        body.appendChild(svg);
      },
      table() {
        return table(["Top 20 of", "Predicting", "R² from those predictors", "Target's own R²", "Share recovered"],
          R.transfer.map((d) => [outs.find((o) => o.key === d.source).label, outs.find((o) => o.key === d.target).label, pct(d.cross_r2), pct(d.target_own_r2), pct(d.share, 0)]));
      },
    });
  }

  function recurring(host, R) {
    host.innerHTML = `<section class="recurring" aria-labelledby="rec-h"><h2 id="rec-h" class="chart-title">The ten recurring predictors</h2>
      <p class="chart-sub">In the top 20 of at least four of the six outcome-by-layer models (three outcomes, cross-sectional and change)</p>
      <ul class="rec-list">${R.recurring.map((r) => `<li><a href="#/predictors/${encodeURIComponent(r.name)}">${esc(r.label)}</a>` +
        `<span class="pips" aria-label="${r.lists} of 6 lists">${Array.from({ length: 6 }, (_, i) => `<i class="${i < r.lists ? "on" : ""}"></i>`).join("")}</span><span class="muted small">${r.lists} of 6</span></li>`).join("")}</ul>
      <p class="chart-foot"><b>Source:</b> SI Table S17 and SI Appendix, Cross-Domain Shared and Unique Predictors.</p></section>`;
  }

  // ---------------------------------------------------------------- within-family
  function withinFamily(host, R) {
    const outs = R.outcomes.filter((o) => o.key !== "epigenetic");
    const state = { outcome: "frailty", analysis: "concurrent", stratum: "All" };
    const sel = () => R.within_family.estimates.filter((e) => e.outcome === state.outcome && e.analysis === state.analysis && e.stratum === state.stratum)
      .sort((a, b) => b.beta_w_std - a.beta_w_std);
    return card(host, {
      title: "Within-pair associations of the focal predictors",
      subtitle: "Standardized βW with 95% pair-bootstrap interval",
      legend: `<span class="key"><i class="sw dot"></i>Survives FDR correction (q ≤ .05)</span><span class="key"><i class="sw ring"></i>Does not</span>`,
      source: "Mixed-effects between-within models in the twin subsample; SI Tables S4 to S10.",
      controls(c, api) {
        segmented(c, "wf-outcome", "Outcome", outs.map((o) => ({ value: o.key, label: o.label })), state.outcome, (v) => { state.outcome = v; api.update(); });
        segmented(c, "wf-analysis", "Analysis", [{ value: "concurrent", label: "Wave 1 status" }, { value: "change", label: "9-year change" }], state.analysis, (v) => { state.analysis = v; api.update(); });
        segmented(c, "wf-stratum", "Pairs", [{ value: "All", label: "All twin pairs" }, { value: "MZ", label: "MZ pairs only" }], state.stratum, (v) => { state.stratum = v; api.update(); });
      },
      draw(body, W) {
        const rows = sel();
        const col = OUTCOME_COLOR[state.outcome];
        const head = document.createElement("p");
        head.className = "chart-count";
        const n = rows.filter((r) => r.survives).length;
        const pairs = rows.length ? Math.max(...rows.map((r) => r.pairs)) : 0;
        head.innerHTML = rows.length
          ? `<strong>${n} of ${rows.length}</strong> focal predictors survive FDR correction · up to ${pairs} pairs`
          : "No focal predictors in this selection.";
        body.appendChild(head);
        if (!rows.length) return;
        const narrow = W < 560;
        const labelW = narrow ? 0 : Math.min(300, W * 0.4), rowH = narrow ? 38 : 24, top = 10;
        const H = top + rows.length * rowH + 40;
        const ext = Math.max(0.3, ...rows.map((r) => Math.max(Math.abs(r.ci[0]), Math.abs(r.ci[1])))) * 1.05;
        const svg = svgRoot(W, H, "Forest plot of standardized within-pair associations");
        const x = scale(-ext, ext, labelW + 8, W - 12);
        xAxis(svg, x, H - 36, ticks(-ext, ext, narrow ? 4 : 6), (v) => (v === 0 ? "0" : num(v, 1)), "Standardized βW", { top, labelX: W - 12 });
        rows.forEach((r, i) => {
          const y = top + i * rowH + (narrow ? 18 : 4), cy = y + 8;
          const g = el("g", { tabindex: 0, "data-tip": `<b>${esc(r.label)}</b><br>βW std ${signed(r.beta_w_std, 2)} [${num(r.ci[0], 2)}, ${num(r.ci[1], 2)}]<br>q = ${r.q < 0.001 ? r.q.toExponential(1) : num(r.q, 3)}${r.mde !== null ? `<br>Minimum detectable effect ${num(r.mde, 2)}` : ""}<br>${r.pairs} pairs` });
          g.appendChild(el("text", { x: narrow ? 8 : labelW - 6, y: narrow ? y - 4 : cy + 4, "text-anchor": narrow ? "start" : "end", class: "row-label" + (r.survives ? " strong" : "") }, r.label));
          g.appendChild(el("line", { x1: x(r.ci[0]), x2: x(r.ci[1]), y1: cy, y2: cy, stroke: col, "stroke-width": 2, "stroke-linecap": "round" }));
          g.appendChild(el("circle", { cx: x(r.beta_w_std), cy, r: 5, fill: r.survives ? col : "#fff", stroke: r.survives ? "#fff" : col, "stroke-width": 2 }));
          g.appendChild(el("rect", { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: "transparent" }));
          svg.appendChild(g);
        });
        body.appendChild(svg);
      },
      table() {
        const rows = sel();
        if (!rows.length) return `<p class="empty">No focal predictors in this selection.</p>`;
        return table(["Predictor", "Pairs", "βW std", "95% interval", "q", "Survives FDR", "MDE"],
          rows.map((r) => [r.label, r.pairs, signed(r.beta_w_std, 2), `${num(r.ci[0], 2)} to ${num(r.ci[1], 2)}`, r.q < 0.001 ? r.q.toExponential(1) : num(r.q, 3), r.survives ? "Yes" : "No", r.mde !== null ? num(r.mde, 2) : ""]));
      },
    });
  }

  // ---------------------------------------------------------------- profiles
  function profiles(host, R) {
    const outs = R.outcomes.filter((o) => o.key !== "epigenetic");
    const order = ["favorable", "neutral", "unfavorable"];
    return card(host, {
      title: "Model-predicted outcome under three profiles of six focal predictors",
      subtitle: "Age-residualized units, each outcome on its own scale; 95% bootstrap intervals",
      source: "Cross-sectional models refit on 200 bootstrap resamples; SI Table S16 and SI Fig. S7.",
      draw(body, W) {
        outs.forEach((o) => {
          const rows = order.map((p) => R.profiles.find((d) => d.outcome === o.key && d.profile === p));
          const lo = Math.min(...rows.map((r) => r.ci[0])), hi = Math.max(...rows.map((r) => r.ci[1]));
          const pad = (hi - lo) * 0.12;
          const narrow = W < 560;
          const labelW = narrow ? 92 : 120, H = 3 * 30 + 52;
          const svg = svgRoot(W, H, `${o.label}: predictions under favorable, neutral and unfavorable profiles`);
          const x = scale(lo - pad, hi + pad, labelW, W - 70);
          svg.appendChild(el("text", { x: 0, y: 14, class: "panel-head" }, o.label));
          xAxis(svg, x, H - 34, ticks(lo - pad, hi + pad, narrow ? 3 : 5), (v) => num(v, 2), "", { top: 24 });
          const col = OUTCOME_COLOR[o.key];
          rows.forEach((r, i) => {
            const cy = 34 + i * 30;
            svg.appendChild(el("text", { x: labelW - 10, y: cy + 4, "text-anchor": "end", class: "row-label" }, r.profile[0].toUpperCase() + r.profile.slice(1)));
            svg.appendChild(el("line", { x1: x(r.ci[0]), x2: x(r.ci[1]), y1: cy, y2: cy, stroke: col, "stroke-width": 2, "stroke-linecap": "round" }));
            svg.appendChild(el("circle", { cx: x(r.prediction), cy, r: 5.5, fill: r.profile === "neutral" ? "#fff" : col, stroke: r.profile === "neutral" ? col : "#fff", "stroke-width": 2, tabindex: 0,
              "data-tip": `<b>${esc(o.label)}, ${r.profile}</b><br>Predicted ${signed(r.prediction, 3)} [${signed(r.ci[0], 3)}, ${signed(r.ci[1], 3)}]<br>Sample percentile ${Math.round(r.percentile)}` }));
            svg.appendChild(el("text", { x: x(r.ci[1]) + 8, y: cy + 4, class: "val-muted small" }, `P${Math.round(r.percentile)}`));
          });
          body.appendChild(svg);
        });
      },
      table() {
        return table(["Outcome and profile", "Prediction", "95% interval", "Sample percentile"],
          R.profiles.map((r) => [`${r.label}, ${r.profile.replace(/_/g, " ")}`, signed(r.prediction, 3), `${signed(r.ci[0], 3)} to ${signed(r.ci[1], 3)}`, r.percentile === null ? "" : Math.round(r.percentile)]));
      },
    });
  }

  window.Charts = { concurrent, change, importance, transfer, recurring, withinFamily, profiles, pct, num, signed, esc, OUTCOME_COLOR, table };
})();
