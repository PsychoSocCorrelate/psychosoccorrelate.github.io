/* Predictor explorer: every predictor ranked by mean |SHAP| for one outcome, and its
 * SHAP dependence curve.
 *
 * Reads data/shap/<outcome>.json, the binned and smoothed aggregates the build
 * writes (no bin or level under ten people, no smoothed curve under twenty).
 * The outcome and the predictor live in the URL (#/explore?outcome=…&predictor=…).
 * Plotly is fetched the first time the explorer opens.
 */
(function () {
  "use strict";
  const { $, esc, getJSON, S, setParams } = window.Companion;
  const { num, OUTCOME_COLOR } = window.Charts;
  const cache = {};
  const COLOR = { FInoPsy_W1: OUTCOME_COLOR.frailty, FInoPsy_W1_adjusted: OUTCOME_COLOR.frailty, btactComp_W1: OUTCOME_COLOR.cognition,
    ALcomp_W1: OUTCOME_COLOR.al, phenoAge_res: OUTCOME_COLOR.epigenetic };
  const FONT = "'Libre Franklin', system-ui, sans-serif";
  const PLOTLY = { src: "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js",
    integrity: "sha384-cCVCZkAjYNxaYKbM8lsArLznDF/SvMFr1jcZrvOpSTCa0W40ZAdLzHCEulnUa5i7" };
  let plotly;

  function loadPlotly() {
    if (window.Plotly) return Promise.resolve(window.Plotly);
    plotly = plotly || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      Object.assign(s, { src: PLOTLY.src, integrity: PLOTLY.integrity, crossOrigin: "anonymous" });
      s.onload = () => resolve(window.Plotly);
      s.onerror = () => { plotly = null; reject(new Error("the plotting library could not be loaded")); };
      document.head.appendChild(s);
    });
    return plotly;
  }

  async function outcomeData(key) {
    cache[key] = cache[key] || await getJSON(`data/shap/${key}.json`);
    return cache[key];
  }

  function render(main, params) {
    const outcomes = S.outcomes;
    const okey = outcomes.some((o) => o.key === params.get("outcome")) ? params.get("outcome") : outcomes[0].key;
    main.innerHTML = `
      <div class="wrap">
        <header class="page-head narrow">
          <p class="kicker">Explorer</p>
          <h1>Predictor explorer</h1>
          <p class="dek">How each predictor relates to a model's predicted outcome across its observed range, with every other predictor in the model. Choose an outcome, then a predictor from the ranking.</p>
        </header>
        <div class="explorer">
          <div class="ex-controls">
            <label><span>Outcome</span><select id="exOutcome">${outcomes.map((o) => `<option value="${esc(o.key)}" ${o.key === okey ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
            <p class="ex-model small muted" id="exModel"></p>
          </div>
          <div class="ex-list">
            <label class="ex-search"><span>Find a predictor</span><input type="search" id="exSearch" placeholder="Name or code" autocomplete="off" value="${esc(params.get("q") || "")}"></label>
            <label class="check"><input type="checkbox" id="exStable" ${params.get("stable") ? "checked" : ""}><span>Only predictors in the top 20 of at least 60% of fits</span></label>
            <p class="small muted" id="exCount" aria-live="polite"></p>
            <ol class="rank-list" id="exRanks"></ol>
          </div>
          <div class="ex-detail" id="exDetail" aria-live="polite"><p class="muted">Loading…</p></div>
        </div>
      </div>`;
    const state = { outcome: okey, predictor: params.get("predictor") };
    $("#exOutcome").addEventListener("change", (e) => { state.outcome = e.target.value; setParams({ outcome: state.outcome }); load(state, true); });
    $("#exSearch").addEventListener("input", (e) => { setParams({ q: e.target.value }); list(state); });
    $("#exStable").addEventListener("change", (e) => { setParams({ stable: e.target.checked ? "1" : null }); list(state); });
    load(state, false);
  }

  async function load(state, outcomeChanged) {
    let d;
    try { d = await outcomeData(state.outcome); } catch (e) {
      $("#exDetail").innerHTML = `<p class="error">The data for this outcome could not be loaded (${esc(e.message)}).</p>`;
      return;
    }
    const o = S.outcomes.find((x) => x.key === state.outcome);
    $("#exModel").innerHTML = `${esc(o.blurb)} Cross-validated R² of the full model ${num(o.cv_r2.r2_mean, 3)} (SD over folds ${num(o.cv_r2.r2_std, 3)}).`;
    if (!state.predictor || !d.importance.some((v) => v.name === state.predictor)) {
      if (state.predictor && !outcomeChanged) $("#exDetail").dataset.notice = `“${state.predictor}” is not a predictor in this model; showing the top-ranked predictor instead.`;
      state.predictor = d.importance[0].name;
      setParams({ predictor: state.predictor });
    }
    list(state);
    draw(state);
  }

  function list(state) {
    const d = cache[state.outcome];
    if (!d) return;
    const q = ($("#exSearch").value || "").trim().toLowerCase();
    const stableOnly = $("#exStable").checked;
    const max = d.importance[0].mean_abs_shap;
    const rows = d.importance.map((v, i) => ({ v, rank: i + 1 }))
      .filter(({ v }) => (!q || `${v.name} ${v.display_label} ${v.domain || ""}`.toLowerCase().includes(q)) && (!stableOnly || v.top20_stability >= 0.6));
    $("#exCount").textContent = rows.length === d.importance.length ? `${rows.length} predictors, ranked by mean |SHAP|` : `${rows.length} of ${d.importance.length} predictors`;
    const col = COLOR[state.outcome];
    $("#exRanks").innerHTML = rows.length ? rows.map(({ v, rank }) => `<li><button type="button" data-name="${esc(v.name)}" aria-pressed="${v.name === state.predictor}">
        <span class="r">${rank}</span><span class="n">${esc(v.display_label)}${v.tier === 1 ? ' <span class="tag">Tier 1</span>' : ""}</span>
        <span class="b" aria-hidden="true"><i style="width:${(100 * v.mean_abs_shap / max).toFixed(1)}%;background:${col};opacity:${v.top20_stability >= 0.6 ? 1 : 0.4}"></i></span></button></li>`).join("")
      : `<li class="empty">No predictor matches${q ? ` “${esc(q)}”` : ""}${stableOnly ? " among the stable predictors" : ""}. <button type="button" class="link-button" id="exClear">Clear</button></li>`;
    $("#exRanks").querySelectorAll("button[data-name]").forEach((b) => b.addEventListener("click", () => {
      state.predictor = b.dataset.name;
      setParams({ predictor: state.predictor });
      $("#exRanks").querySelectorAll("button[data-name]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw(state);
      if (window.matchMedia("(max-width: 860px)").matches) $("#exDetail").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    const clear = $("#exClear");
    if (clear) clear.addEventListener("click", () => {
      $("#exSearch").value = ""; $("#exStable").checked = false; setParams({ q: null, stable: null }); list(state); $("#exSearch").focus();
    });
  }

  async function draw(state) {
    const d = cache[state.outcome];
    const o = S.outcomes.find((x) => x.key === state.outcome);
    const imp = d.importance.find((v) => v.name === state.predictor);
    const rank = d.importance.indexOf(imp) + 1;
    const dep = d.dependence[state.predictor];
    const host = $("#exDetail");
    const notice = host.dataset.notice;
    delete host.dataset.notice;
    const sd = imp.mean_abs_shap / d.outcome_sd;
    host.innerHTML = `
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
      <h2 class="ex-title">${esc(imp.display_label)} <span class="code">${esc(imp.name)}</span></h2>
      <p class="small muted">${imp.tier ? `Tier ${imp.tier}` : ""}${imp.domain ? ` · ${esc(imp.domain)}` : ""} · ranked ${rank} of ${d.importance.length} for ${esc(o.label.toLowerCase())}</p>
      <div class="plot" id="exPlot" role="img" aria-label="SHAP dependence of ${esc(o.label)} on ${esc(imp.display_label)}"></div>
      <dl class="facts tight">
        <div><dt>Mean |SHAP| [95% interval]</dt><dd><strong>${num(imp.mean_abs_shap, 4)}</strong><span>[${num(imp.ci_lower, 4)}, ${num(imp.ci_upper, 4)}]</span></dd></div>
        <div><dt>In SD units of the outcome</dt><dd><strong>${num(sd, 3)}</strong><span>a descriptive scale across outcomes</span></dd></div>
        <div><dt>Top-20 stability</dt><dd><strong>${Math.round(imp.top20_stability * 100)}%</strong><span>of bootstrap refits</span></dd></div>
        <div><dt>People summarized</dt><dd><strong>${dep ? dep.n.toLocaleString("en-US") : "NA"}</strong><span>${dep && dep.kind === "continuous" ? "within the 0.5th to 99.5th percentile" : ""}</span></dd></div>
      </dl>
      <details class="howto"><summary>How to read this plot</summary><p>The horizontal axis is the predictor's value; the vertical axis is its SHAP contribution, how far that value moves the predicted outcome above or below the model's average, in the outcome's age-adjusted units. Points are means within bins of at least ten people, with bars of one standard deviation; the curve is a smoothing spline with a bootstrap band. The dashed line is zero. The curve describes the fitted model, not a causal dose-response.</p></details>
      <p><a href="#/predictors/${encodeURIComponent(imp.name)}">${esc(imp.display_label)}: measurement, reliability and importance in every model →</a></p>`;
    const plot = $("#exPlot");
    if (!dep) {
      plot.innerHTML = `<p class="empty">No dependence curve is shown: every value group of this predictor holds fewer than ten people.</p>`;
      return;
    }
    plot.innerHTML = `<p class="muted small">Loading the plot…</p>`;
    let P;
    try { P = await loadPlotly(); } catch (e) {
      plot.innerHTML = `<p class="error">The plot could not be drawn: ${esc(e.message)}. The values above remain correct.</p>`;
      return;
    }
    if (state.predictor !== imp.name) return;
    const col = COLOR[state.outcome];
    const traces = [];
    if (dep.kind === "continuous") {
      if (dep.smooth) {
        traces.push({ x: dep.smooth.x.concat([...dep.smooth.x].reverse()), y: dep.smooth.ci_upper.concat([...dep.smooth.ci_lower].reverse()),
          fill: "toself", fillcolor: hexA(col, 0.14), line: { color: "rgba(0,0,0,0)" }, hoverinfo: "skip", showlegend: false, type: "scatter" });
        traces.push({ x: dep.smooth.x, y: dep.smooth.y, mode: "lines", line: { color: col, width: 2 }, hoverinfo: "skip", showlegend: false, type: "scatter" });
      }
      traces.push({ x: dep.bins.map((b) => b.x_center), y: dep.bins.map((b) => b.shap_mean),
        error_y: { type: "data", array: dep.bins.map((b) => b.shap_sd), visible: true, color: "#9a9a94", thickness: 1, width: 0 },
        mode: "markers", marker: { color: col, size: 8, line: { color: "#fff", width: 1.5 } },
        text: dep.bins.map((b) => `n = ${b.n}`), hovertemplate: "value %{x:.3g}<br>SHAP %{y:.4f}<br>%{text}<extra></extra>", showlegend: false, type: "scatter" });
    } else {
      traces.push({ x: dep.groups.map((g) => g.label), y: dep.groups.map((g) => g.shap_mean),
        error_y: { type: "data", array: dep.groups.map((g) => g.shap_sd), visible: true, color: "#9a9a94", thickness: 1, width: 4 },
        marker: { color: col }, text: dep.groups.map((g) => `n = ${g.n}`),
        hovertemplate: "%{x}<br>mean SHAP %{y:.4f}<br>%{text}<extra></extra>", type: "bar" });
    }
    plot.innerHTML = "";
    P.newPlot(plot, traces, {
      font: { family: FONT, size: 12, color: "#1d1d1b" }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 64, r: 12, t: 12, b: 64 }, hovermode: "closest", dragmode: false, bargap: 0.35,
      hoverlabel: { bgcolor: "#1d1d1b", bordercolor: "#1d1d1b", font: { family: FONT, color: "#fff" } },
      yaxis: { title: { text: `SHAP contribution to ${o.label.toLowerCase()}`, standoff: 8 }, gridcolor: "#ecebe6", zeroline: false, fixedrange: true },
      xaxis: { title: { text: imp.display_label, standoff: 8 }, gridcolor: "#ecebe6", fixedrange: true, automargin: true },
      shapes: [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#6b6b66", width: 1, dash: "dash" } }],
    }, { displayModeBar: false, responsive: true, scrollZoom: false });
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  window.Explorer = { render };
})();
