/* Companion site: routing and every view except the SHAP explorer (explorer.js).
 *
 * Reads only the static files the build writes (data/, tables/, files/) by
 * relative URL, so the site works from any path on any static host. Each view
 * keeps its state in the URL hash (#/predictors?tier=2&q=sleep), so a view can be
 * shared or bookmarked as it is.
 */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const C = window.Charts;
  const { esc, pct, num } = C;
  const getJSON = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  };
  const fmtInt = (v) => (v === null || v === undefined ? "NA" : Number(v).toLocaleString("en-US"));
  const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;

  const S = { evidence: null, results: null, variables: [], outcomes: [], tables: {} };
  window.Companion = { S, $, esc, getJSON, setParams, route: () => parseHash() };

  // ------------------------------------------------------------------ routing
  const LEGACY = { overview: "/", findings: "/findings/concurrent", shap: "/explore", variables: "/predictors", gallery: "/figures" };

  function parseHash() {
    let h = location.hash.replace(/^#/, "");
    if (LEGACY[h] !== undefined) h = LEGACY[h];
    if (!h.startsWith("/")) h = "/" + h;
    const [path, query = ""] = h.split("?");
    return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(query) };
  }

  function href(parts, params) {
    const q = params && [...params].length ? `?${params}` : "";
    return `#/${parts.map(encodeURIComponent).join("/")}${q}`;
  }

  // Change the current view's parameters without a full re-render or a history entry.
  function setParams(updates) {
    const { parts, params } = parseHash();
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === "") params.delete(k); else params.set(k, v);
    }
    history.replaceState(null, "", href(parts, params));
  }

  let lastPath = null;
  function render() {
    const { parts, params } = parseHash();
    const path = parts.join("/");
    const main = $("#main");
    const views = { "": home, findings: finding, explore: explore, predictors: predictors, figures: figures, about: about };
    const view = views[parts[0] || ""] || notFound;
    document.querySelectorAll(".site-nav a").forEach((a) => {
      const target = a.getAttribute("href").replace(/^#\//, "").split(/[/?]/)[0];
      a.toggleAttribute("aria-current", target === (parts[0] || ""));
      if (a.hasAttribute("aria-current")) a.setAttribute("aria-current", "page");
    });
    closeMenu();
    main.innerHTML = "";
    view(main, parts.slice(1), params);
    if (path !== lastPath) {
      window.scrollTo(0, 0);
      const h1 = main.querySelector("h1");
      if (h1 && lastPath !== null) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    }
    lastPath = path;
  }

  function notFound(main) {
    document.title = `Not found · ${S.evidence.short_title}`;
    main.innerHTML = `<div class="wrap narrow page-head"><h1>Page not found</h1><p class="dek">This address does not match a page of the companion. <a href="#/">Return to the overview</a>.</p></div>`;
  }

  const setTitle = (t) => { document.title = t ? `${t} · ${S.evidence.short_title}` : S.evidence.short_title; };
  const artifact = (id) => S.evidence.artifacts.find((a) => a.id === id);
  const term = (id) => S.evidence.glossary.find((g) => g.id === id);

  // ------------------------------------------------------------------ home
  function home(main) {
    const e = S.evidence, R = S.results;
    setTitle("");
    const cs = Object.fromEntries(R.concurrent.map((d) => [d.key, d]));
    const ch = Object.fromEntries(R.change.wave1.map((d) => [d.key, d]));
    const rows = R.outcomes.map((o) => {
      const a = cs[o.key], b = ch[o.key];
      return `<tr>
        <th scope="row"><span class="swatch" style="--c:${C.OUTCOME_COLOR[o.key]}"></span>${esc(o.label)}</th>
        <td><span class="big">+${pct(a.delta)}</span><span class="ctx">${a.ci ? `interval ${pct(a.ci[0])} to ${pct(a.ci[1])} · ` : ""}R² ${pct(a.r2_t1)} with background alone, ${pct(a.r2_full)} with Tier 2 · n = ${fmtInt(a.n)}</span></td>
        <td>${b ? `<span class="big">+${pct(b.delta)}</span><span class="ctx">interval ${pct(b.ci[0])} to ${pct(b.ci[1])} · R² ${pct(b.r2_yw1t1)} to ${pct(b.r2_full)} · n = ${fmtInt(b.n)}</span>`
          : `<span class="ctx">Examined at Wave 1 only, as a benchmark</span>`}</td></tr>`;
    }).join("");
    main.innerHTML = `
      <section class="hero"><div class="wrap">
        <p class="kicker">Research companion</p>
        <h1 class="hero-title">${esc(e.title)}</h1>
        <p class="byline">${esc(e.authors)}</p>
        <p class="status">${esc(e.status)}${e.paper_url ? ` <a href="${esc(e.paper_url)}">Read the paper</a>` : ""}</p>
      </div></section>
      <div class="wrap">
        <div class="intro">
          <p class="dek">${esc(e.home.question)}</p>
          <p class="lead">${esc(e.home.lead)}</p>
        </div>
        <dl class="design-strip">${e.home.design.map((d) => `<div><dt>${esc(d.label)}</dt><dd><strong>${esc(d.value)}</strong><span>${esc(d.note)}</span></dd></div>`).join("")}</dl>

        <section class="glance" aria-labelledby="glance-h">
          <div class="section-head"><h2 id="glance-h">Results at a glance</h2>
          <p>What the {161} Tier 2 predictors add to cross-validated R², for current status and for 9-year change. Each increment is read against its own baseline.</p></div>
          <div class="table-scroll"><table class="glance-table">
            <thead><tr><th scope="col">Outcome</th><th scope="col">Current status: Tier 2 adds, beyond background</th><th scope="col">9-year change: Tier 2 adds, beyond Wave 1 status and background</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <p class="note">Increments are ΔR² in percentage points of explained variance in age-adjusted outcomes. Intervals are repeated cross-validation intervals. The two columns differ in target, conditioning, and sample.</p>
          <p class="closing">${esc(e.home.closing)}</p>
        </section>

        <section class="explore-grid" aria-labelledby="ex-h">
          <div class="section-head"><h2 id="ex-h">Explore the findings</h2><p>Six views, one per analytic layer of the paper, each with its chart, data table, definitions, and limitations.</p></div>
          <ol class="finding-cards">${e.findings.map((f, i) => `<li><a href="#/findings/${f.id}"><span class="num">${i + 1}</span><span class="k">${esc(f.kicker)}</span><span class="t">${esc(f.title)}</span></a></li>`).join("")}</ol>
        </section>

        <section class="tools" aria-labelledby="tools-h">
          <div class="section-head"><h2 id="tools-h">Tools and reference</h2></div>
          <div class="tool-cards">
            <a href="#/explore"><strong>Predictor explorer</strong><span>Rank the ${fmtInt(e.facts.n_predictors)} predictors for each outcome and see how each relates to the model's prediction across its range.</span></a>
            <a href="#/predictors"><strong>Predictor inventory</strong><span>Every predictor's measurement, reliability, twin resemblance, missingness, and MIDUS source codes.</span></a>
            <a href="#/figures"><strong>Figures and tables</strong><span>The paper's figures and its main and supplementary tables, readable in the browser.</span></a>
            <a href="#/about"><strong>About the study</strong><span>Sample, outcomes, predictors, modeling, definitions, and limitations.</span></a>
          </div>
        </section>
      </div>`;
    main.querySelector(".glance .section-head p").innerHTML = main.querySelector(".glance .section-head p").innerHTML.replace("{161}", fmtInt(e.facts.n_tier2));
  }

  // ------------------------------------------------------------------ findings
  const CHARTS = {
    concurrent: (host) => C.concurrent(host, S.results),
    change: (host) => C.change(host, S.results),
    importance: (host) => C.importance(host, S.results, S.variables),
    transfer: (host) => { C.transfer(host, S.results); const r = document.createElement("div"); host.after(r); C.recurring(r, S.results); },
    "within-family": (host) => C.withinFamily(host, S.results),
    profiles: (host) => C.profiles(host, S.results),
  };

  function finding(main, rest) {
    const list = S.evidence.findings;
    const i = Math.max(0, list.findIndex((f) => f.id === rest[0]));
    if (rest[0] && list[i].id !== rest[0]) return notFound(main);
    const f = list[i];
    setTitle(f.nav);
    const prev = list[i - 1], next = list[i + 1];
    main.innerHTML = `
      <div class="wrap with-side">
        <nav class="side" aria-label="Findings">
          <p class="side-head">Findings</p>
          <ol>${list.map((g, j) => `<li><a href="#/findings/${g.id}" ${j === i ? 'aria-current="page"' : ""}><span class="num">${j + 1}</span>${esc(g.nav)}</a></li>`).join("")}</ol>
        </nav>
        <article class="article">
          <header class="page-head">
            <p class="kicker">${esc(f.kicker)}</p>
            <h1>${esc(f.title)}</h1>
            <p class="dek">${esc(f.lead)}</p>
          </header>
          <div class="chart-host"></div>
          <details class="howto" open><summary>How to read this chart</summary><p>${esc(f.read)}</p></details>
          <div class="prose">${f.body.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
          ${f.link ? `<p><a class="button" href="#/${esc(f.link.route)}">${esc(f.link.label)} →</a></p>` : ""}
          ${f.id === "within-family" ? `<div class="table1-host"></div>` : ""}
          <aside class="caveats" aria-labelledby="cav-h"><h2 id="cav-h">Keep in mind</h2><ul>${f.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></aside>
          <section class="defs" aria-labelledby="def-h"><h2 id="def-h">Definitions</h2><dl>${f.terms.map(term).filter(Boolean).map((t) => `<dt>${esc(t.term)}</dt><dd>${esc(t.definition)}</dd>`).join("")}</dl></section>
          <section class="in-paper" aria-labelledby="ip-h"><h2 id="ip-h">In the paper</h2><p>${esc(f.source)}</p>
            <ul class="artifact-links">${f.artifacts.map(artifact).filter(Boolean).map(artifactLink).join("")}</ul></section>
          <nav class="pager" aria-label="Previous and next finding">
            ${prev ? `<a class="prev" href="#/findings/${prev.id}"><span>Previous</span>${esc(prev.nav)}</a>` : "<span></span>"}
            ${next ? `<a class="next" href="#/findings/${next.id}"><span>Next</span>${esc(next.nav)}</a>` : `<a class="next" href="#/explore"><span>Next</span>Predictor explorer</a>`}
          </nav>
        </article>
      </div>`;
    CHARTS[f.chart]($(".chart-host", main));
    if (f.id === "within-family") table1($(".table1-host", main));
  }

  function artifactLink(a) {
    return `<li><a href="#/figures/${a.slug}">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : `<span class="tbl-icon" aria-hidden="true"></span>`}<span><b>${esc(a.id)}</b> ${esc(a.title)}</span></a></li>`;
  }

  function table1(host) {
    const rows = S.results.within_family.table1;
    const cols = Object.keys(rows[0]);
    host.innerHTML = `<figure class="t1"><figcaption><b>Table 1.</b> Between- and within-family decomposition</figcaption>
      <div class="table-scroll"><table class="data-table"><thead><tr>${cols.map((c, i) => `<th scope="col"${i ? ' class="num"' : ""}>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c, i) => i ? `<td class="num">${esc(r[c])}</td>` : `<th scope="row">${esc(r[c])}</th>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="table-note">Counts are pairs. βW columns give the within-family effects surviving FDR correction over the number tested in all pairs. ICC is the outcome intraclass correlation among MZ pairs. Change MDE is the median minimum detectable effect, in standardized βW units. <a href="#/figures/table-1">Full table and note</a>.</p></figure>`;
  }

  // ------------------------------------------------------------------ explore (explorer.js)
  function explore(main, rest, params) {
    setTitle("Predictor explorer");
    window.Explorer.render(main, params);
  }

  // ------------------------------------------------------------------ predictor inventory
  const TYPE_ORDER = ["continuous", "ordinal", "binary", "nominal"];
  const SORTS = {
    order: { label: "Table S1 order", key: (v) => v.order },
    name: { label: "Name", key: (v) => v.display_label.toLowerCase() },
    reliability: { label: "Test-retest reliability", key: (v) => v.reliability.value ?? -Infinity, desc: true },
    mz: { label: "MZ co-twin resemblance", key: (v) => v.mz_resemblance.value ?? -Infinity, desc: true },
    missing: { label: "Missing", key: (v) => v.missingness.pct_missing, desc: true },
    frailty: { label: "Importance for frailty", key: (v) => v.importance.models["frailty.cross_sectional"].rank },
    cognition: { label: "Importance for cognition", key: (v) => v.importance.models["cognition.cross_sectional"].rank },
    al: { label: "Importance for allostatic load", key: (v) => v.importance.models["al.cross_sectional"].rank },
  };
  const searchBlob = (v) => [v.name, v.display_label, v.domain, v.measurement_type, ...Object.values(v.source_codes), ...Object.values(v.notes), ...v.constituents].join(" ").toLowerCase();

  function predictors(main, rest, params) {
    if (rest[0]) return predictorProfile(main, rest[0]);
    setTitle("Predictor inventory");
    const domains = [...new Set(S.variables.map((v) => v.domain))];
    const opt = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
    main.innerHTML = `
      <div class="wrap">
        <header class="page-head narrow">
          <p class="kicker">Reference</p>
          <h1>Predictor inventory</h1>
          <p class="dek">The ${fmtInt(S.evidence.facts.n_predictors)} predictors as listed in SI Table S1, with measurement type, Wave 1 to Wave 2 reliability, co-twin resemblance, missingness, and descriptives on the baseline sample. Select a predictor for its profile.</p>
        </header>
        <form class="filters" role="search" aria-label="Filter predictors" onsubmit="return false">
          <label class="f-search"><span>Search</span><input type="search" name="q" value="${esc(params.get("q") || "")}" placeholder="Name, code, MIDUS item…" autocomplete="off"></label>
          <label><span>Tier</span><select name="tier">${opt([["1", "Tier 1, background"], ["2", "Tier 2, psychosocial and behavioral"]], params.get("tier"), "All tiers")}</select></label>
          <label><span>Subdomain</span><select name="domain">${opt(domains.map((d) => [d, d]), params.get("domain"), "All subdomains")}</select></label>
          <label><span>Type</span><select name="type">${opt(TYPE_ORDER.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), params.get("type"), "All types")}</select></label>
          <label><span>Sort by</span><select name="sort">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}" ${k === (params.get("sort") || "order") ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>
          <button type="button" class="link-button" data-clear>Clear filters</button>
        </form>
        <p class="result-count" aria-live="polite"></p>
        <div class="table-scroll inventory"><table class="data-table inv">
          <thead><tr><th scope="col">Predictor</th><th scope="col">Subdomain</th><th scope="col">Type</th><th scope="col" class="num">Test-retest</th><th scope="col" class="num">MZ co-twin</th><th scope="col" class="num">Missing</th><th scope="col">Distribution, baseline sample</th></tr></thead>
          <tbody></tbody></table></div>
        <p class="table-note">Test-retest reliability is Pearson r for continuous, Spearman ρ for ordinal, and Cohen's κ for binary and nominal predictors, among participants observed at both waves. MZ co-twin resemblance is the same statistic between monozygotic co-twins at Wave 1; <span class="flag">low variation</span> marks a value near zero because the predictor varies little among co-twins. Ranges are 1st to 99th percentiles; category levels held by fewer than ten people are not shown.</p>
      </div>`;
    const form = $(".filters", main);
    const update = () => {
      const fd = new FormData(form);
      const p = Object.fromEntries([...fd].map(([k, v]) => [k, v === "order" && k === "sort" ? "" : v]));
      setParams(p);
      drawInventory(main, p);
    };
    form.addEventListener("input", update);
    $("[data-clear]", main).addEventListener("click", () => {
      form.reset();
      form.querySelectorAll("input,select").forEach((x) => { x.value = x.name === "sort" ? "order" : ""; });
      update();
      $("input[name=q]", form).focus();
    });
    drawInventory(main, Object.fromEntries(params));
  }

  function drawInventory(main, p) {
    const q = (p.q || "").trim().toLowerCase();
    const sort = SORTS[p.sort] || SORTS.order;
    const rows = S.variables.filter((v) => (!p.tier || String(v.tier) === p.tier) && (!p.domain || v.domain === p.domain)
      && (!p.type || v.measurement_type === p.type) && (!q || searchBlob(v).includes(q)))
      .sort((a, b) => { const x = sort.key(a), y = sort.key(b); const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y)); return sort.desc ? -c : c; });
    const active = ["q", "tier", "domain", "type"].filter((k) => p[k]);
    $(".result-count", main).innerHTML = rows.length
      ? `Showing <b>${rows.length}</b> of ${S.variables.length} predictors${active.length ? " matching the filters" : ""}.`
      : "";
    $("[data-clear]", main).hidden = !active.length;
    $("tbody", main).innerHTML = rows.length ? rows.map((v) => `<tr>
        <th scope="row"><a href="#/predictors/${encodeURIComponent(v.name)}">${esc(v.display_label)}</a><span class="code">${esc(v.name)}</span></th>
        <td>${esc(v.domain)}${v.tier === 1 ? " (Tier 1)" : ""}</td>
        <td>${esc(v.measurement_type)}</td>
        <td class="num">${v.reliability.value !== null ? `${esc(v.reliability.metric)} ${num(v.reliability.value)}` : "NA"}</td>
        <td class="num">${v.mz_resemblance.value !== null ? `${num(v.mz_resemblance.value)}${v.mz_resemblance.low_variation_flag ? ` <span class="flag" title="${esc(v.mz_resemblance.low_variation_reason)}">low variation</span>` : ""}` : "NA"}</td>
        <td class="num">${v.missingness.pct_missing}%</td>
        <td>${distribution(v, true)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">No predictors match ${q ? `“${esc(p.q)}”` : "these filters"}${active.length > (q ? 1 : 0) ? " with the filters set" : ""}. <button type="button" class="link-button" data-clear2>Clear filters</button></td></tr>`;
    const c2 = $("[data-clear2]", main);
    if (c2) c2.addEventListener("click", () => $("[data-clear]", main).click());
  }

  function distribution(v, compact) {
    const d = v.descriptives;
    if (d) return `mean ${d.mean}, SD ${d.sd}${compact ? "" : `, median ${d.median}`}<br><span class="muted">P${d.inner_pct[0]} to P${d.inner_pct[1]}: ${d.p_lo} to ${d.p_hi}</span>`;
    const p = v.category_proportions || [];
    if (!p.length) return "NA";
    const shown = compact && p.length > 4 ? p.slice(0, 4) : p;
    return shown.map((x) => `${esc(x.label)} ${Number(x.pct).toFixed(1)}%`).join(compact ? "; " : "<br>") +
      (compact && p.length > 4 ? `; <span class="muted">${p.length - 4} more</span>` : "") +
      (v.suppressed_pct ? `<br><span class="muted">levels under ten people: ${v.suppressed_pct}%</span>` : "");
  }

  // ------------------------------------------------------------------ predictor profile
  function predictorProfile(main, code) {
    const i = S.variables.findIndex((v) => v.name === code);
    if (i < 0) return notFound(main);
    const v = S.variables[i];
    setTitle(v.display_label);
    const prev = S.variables[i - 1], next = S.variables[i + 1];
    const outs = S.results.outcomes.filter((o) => o.key !== "epigenetic");
    const explorerKey = { frailty: "FInoPsy_W1", cognition: "btactComp_W1", al: "ALcomp_W1" };
    const cell = (o, layer) => {
      const m = v.importance.models[`${o.key}.${layer}`];
      const pos = (m.rank - 1) / 176;
      return `<td><div class="rank"><strong>${ordinal(m.rank)}</strong><span class="muted"> of 177</span></div>
        <div class="rankbar" aria-hidden="true"><i style="left:${(pos * 100).toFixed(1)}%;background:${C.OUTCOME_COLOR[o.key]}"></i></div>
        <div class="small">mean |SHAP| ${num(m.mean_abs_shap, 4)} <span class="muted">[${num(m.ci[0], 4)}, ${num(m.ci[1], 4)}]</span></div>
        <div class="small">top 20 in ${Math.round(m.stability * 100)}% of fits${m.stability >= 0.6 ? " · focal" : ""}</div></td>`;
    };
    const r = v.reliability, mz = v.mz_resemblance;
    const codes = { midus2: "MIDUS 2", midusr: "Refresher, baseline", midus3: "MIDUS 3", mr2: "Refresher, follow-up" };
    main.innerHTML = `
      <div class="wrap narrow-wide">
        <p class="crumbs"><a href="#/predictors">Predictor inventory</a> / ${esc(v.domain)}</p>
        <header class="page-head">
          <p class="kicker">Tier ${v.tier} · ${esc(v.domain)} · ${esc(v.measurement_type)}</p>
          <h1>${esc(v.display_label)}</h1>
          <p class="code-line">Analysis code <code>${esc(v.name)}</code>${v.notes.source_label ? ` · MIDUS label “${esc(v.notes.source_label)}”` : ""}</p>
        </header>

        <section aria-labelledby="imp-h" class="profile-sec">
          <h2 id="imp-h">Importance in the predictive models</h2>
          <p class="sec-note">Rank by mean |SHAP| among the 177 predictors, with its 95% bootstrap interval and the share of 200 resampled fits placing it in the top 20. Ranks compare predictors within one model; magnitudes are in each outcome's own units.</p>
          <div class="table-scroll"><table class="data-table profile-imp"><thead><tr><th scope="col">Model</th>${outs.map((o) => `<th scope="col"><span class="swatch" style="--c:${C.OUTCOME_COLOR[o.key]}"></span>${esc(o.label)}</th>`).join("")}</tr></thead>
          <tbody><tr><th scope="row">Wave 1 status</th>${outs.map((o) => cell(o, "cross_sectional")).join("")}</tr>
          <tr><th scope="row">9-year change</th>${outs.map((o) => cell(o, "change")).join("")}</tr></tbody></table></div>
          <p class="explore-links">SHAP dependence: ${outs.map((o) => `<a href="#/explore?outcome=${explorerKey[o.key]}&amp;predictor=${encodeURIComponent(v.name)}">${esc(o.label.toLowerCase())}</a>`).join(" · ")}</p>
        </section>

        <section aria-labelledby="meas-h" class="profile-sec">
          <h2 id="meas-h">Measurement</h2>
          <dl class="facts">
            <div><dt>Test-retest, Wave 1 to Wave 2</dt><dd>${r.value !== null ? `<strong>${esc(r.metric)} = ${num(r.value)}</strong>` : "NA"}<span>${r.n ? `${fmtInt(r.n)} participants observed at both waves` : ""}${r.agreement_pct !== null ? `; ${r.agreement_pct}% same response` : ""}</span></dd></div>
            <div><dt>MZ co-twin resemblance</dt><dd>${mz.value !== null ? `<strong>${esc(mz.metric)} = ${num(mz.value)}</strong>` : "NA"}<span>${mz.pairs ? `${mz.pairs} monozygotic pairs at Wave 1` : ""}${mz.low_variation_flag ? `. ${esc(mz.low_variation_reason)}` : ""}</span></dd></div>
            <div><dt>Missing at baseline</dt><dd><strong>${v.missingness.pct_missing}%</strong><span>${fmtInt(v.missingness.n_missing)} of ${fmtInt(v.missingness.n_total)} participants; missing values are handled natively by the model, not imputed</span></dd></div>
            <div><dt>Distribution, baseline sample</dt><dd>${distribution(v, false)}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="src-h" class="profile-sec">
          <h2 id="src-h">MIDUS source</h2>
          ${v.constituents.length ? `<p>Composite of ${v.constituents.length} items: ${v.constituents.map((c) => `<code>${esc(c)}</code>`).join(" ")}</p>`
            : `<dl class="codes">${Object.entries(codes).map(([k, l]) => `<div><dt>${esc(l)}</dt><dd><code>${esc(v.source_codes[k] ?? "not available")}</code></dd></div>`).join("")}</dl>`}
          ${v.notes.recode ? `<p class="small"><b>Recode.</b> ${esc(v.notes.recode)}</p>` : ""}
          ${v.notes.longitudinal ? `<p class="small"><b>Across waves.</b> ${esc(v.notes.longitudinal)}</p>` : ""}
        </section>

        <nav class="pager" aria-label="Previous and next predictor">
          ${prev ? `<a class="prev" href="#/predictors/${encodeURIComponent(prev.name)}"><span>Previous in Table S1</span>${esc(prev.display_label)}</a>` : "<span></span>"}
          ${next ? `<a class="next" href="#/predictors/${encodeURIComponent(next.name)}"><span>Next in Table S1</span>${esc(next.display_label)}</a>` : "<span></span>"}
        </nav>
      </div>`;
  }

  // ------------------------------------------------------------------ figures and tables
  function figures(main, rest, params) {
    if (rest[0]) return artifactView(main, rest[0], params);
    setTitle("Figures and tables");
    const groups = S.evidence.gallery;
    main.innerHTML = `
      <div class="wrap">
        <header class="page-head narrow"><p class="kicker">Reference</p><h1>Figures and tables</h1>
          <p class="dek">The paper's figures and its main-text and supplementary tables, grouped by analysis. Tables open in the browser.</p></header>
        <nav class="chips" aria-label="Groups">${groups.map((g, i) => `<a href="#g${i}">${esc(g.title)}</a>`).join("")}</nav>
        ${groups.map((g, i) => `<section class="gallery-group" aria-labelledby="g${i}h"><h2 id="g${i}h"><span id="g${i}" class="anchor"></span>${esc(g.title)}</h2>
          <ul class="gallery">${g.ids.map(artifact).filter(Boolean).map((a) => `<li><a href="#/figures/${a.slug}">
            ${a.image ? `<span class="thumb"><img src="${esc(a.image)}" alt="" loading="lazy"></span>` : `<span class="thumb table-thumb" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`}
            <span class="cap"><b>${esc(a.id)}</b>${esc(a.title)}</span></a></li>`).join("")}</ul></section>`).join("")}
      </div>`;
    main.querySelectorAll(".chips a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById(a.getAttribute("href").slice(1)).scrollIntoView({ behavior: "smooth" });
    }));
  }

  function artifactView(main, slug, params) {
    const list = S.evidence.artifacts;
    const i = list.findIndex((a) => a.slug === slug);
    if (i < 0) return notFound(main);
    const a = list[i];
    setTitle(a.id);
    const prev = list[i - 1], next = list[i + 1];
    const used = a.used_in.map((id) => S.evidence.findings.find((f) => f.id === id)).filter(Boolean);
    main.innerHTML = `
      <div class="wrap ${a.image ? "" : "wide"}">
        <p class="crumbs"><a href="#/figures">Figures and tables</a> / ${esc(a.group)}</p>
        <header class="page-head"><p class="kicker">${a.kind === "figure" ? "Figure" : "Table"}</p><h1><span class="aid">${esc(a.id)}.</span> ${esc(a.title)}</h1></header>
        ${a.image ? `<figure class="artifact-figure"><a href="${esc(a.image)}" target="_blank" rel="noopener"><img src="${esc(a.image)}" alt="${esc(a.id)}: ${esc(a.title)}"></a>
            <figcaption>Select the image to open it at full resolution.</figcaption></figure>`
          : `<div class="artifact-table" aria-live="polite"><p class="muted">Loading the table…</p></div>`}
        <div class="artifact-meta">
          ${used.length ? `<p>Discussed in ${used.map((f) => `<a href="#/findings/${f.id}">${esc(f.nav)}</a>`).join(", ")}.</p>` : ""}
          ${a.download ? `<p><a href="${esc(a.download)}" download>Source workbook (.${esc(a.download.split(".").pop())})</a></p>` : ""}
        </div>
        <nav class="pager" aria-label="Previous and next item">
          ${prev ? `<a class="prev" href="#/figures/${prev.slug}"><span>Previous</span>${esc(prev.id)}</a>` : "<span></span>"}
          ${next ? `<a class="next" href="#/figures/${next.slug}"><span>Next</span>${esc(next.id)}</a>` : "<span></span>"}
        </nav>
      </div>`;
    if (!a.image) loadTable(a, $(".artifact-table", main), Number(params.get("sheet") || 0));
  }

  async function loadTable(a, host, sheet) {
    try {
      S.tables[a.table] = S.tables[a.table] || await getJSON(a.table);
      drawSheet(host, S.tables[a.table], Math.min(sheet, S.tables[a.table].sheets.length - 1));
    } catch (e) {
      host.innerHTML = `<p class="error">The table could not be loaded (${esc(e.message)}). Reload the page to try again.</p>`;
    }
  }

  // An APA sheet: title rows, spanner rows, a header row, body with section rows, notes.
  function drawSheet(host, t, index) {
    const sheet = t.sheets[index];
    const filled = (r) => r.filter((c) => String(c).trim() !== "").length;
    let rows = sheet.rows.map((r) => r.map((c) => String(c).trim())).filter((r) => filled(r));
    const width = Math.max(...rows.map((r) => { let n = r.length; while (n && !r[n - 1]) n--; return n; }));
    rows = rows.map((r) => r.slice(0, width));
    // Title rows: "Table S5", then its title, each alone in the first column. The page heading shows both.
    if (rows.length && filled(rows[0]) === 1 && /^Table\s/.test(rows[0][0])) {
      rows.shift();
      if (rows.length && filled(rows[0]) === 1) rows.shift();
    }
    const notes = [];
    while (rows.length && filled(rows[rows.length - 1]) === 1 && rows[rows.length - 1][0] && /^(Note|[ᵃᵇᶜᵈᵉ*†])/u.test(rows[rows.length - 1][0])) notes.unshift(rows.pop()[0]);
    let h = rows.findIndex((r) => r[0] && filled(r) >= 3);
    if (h < 0) h = 0;
    const head = rows.slice(0, h + 1), body = rows.slice(h + 1);
    const numeric = (c) => /^[\s−\-+.\d,%[\]()/<>=≤≥e]*$/.test(c) && /\d/.test(c);
    const spanRow = (r, last) => {
      const cells = [];
      for (let j = 0; j < width; j++) {
        if (!last && r[j]) {
          let k = j + 1; while (k < width && !r[k]) k++;
          cells.push(`<th scope="colgroup" colspan="${k - j}" class="span">${esc(r[j])}</th>`); j = k - 1;
        } else if (!last) cells.push("<td></td>");
        else cells.push(`<th scope="col"${j ? ' class="num"' : ""}>${esc(r[j] || "")}</th>`);
      }
      return `<tr>${cells.join("")}</tr>`;
    };
    host.innerHTML = (t.sheets.length > 1 ? `<label class="sheet-pick"><span>Sheet</span><select>${t.sheets.map((s, j) => `<option value="${j}" ${j === index ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>` : "") +
      `<div class="table-scroll apa"><table class="data-table apa-table"><thead>${head.map((r, j) => spanRow(r, j === head.length - 1)).join("")}</thead><tbody>` +
      body.map((r) => filled(r) === 1 && r[0]
        ? `<tr class="section"><th scope="rowgroup" colspan="${width}">${esc(r[0])}</th></tr>`
        : `<tr>${r.map((c, j) => j ? `<td class="${numeric(c) ? "num" : ""}">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join("")}</tr>`).join("") +
      `</tbody></table></div>` + notes.map((n) => `<p class="table-note">${esc(n)}</p>`).join("");
    const sel = $(".sheet-pick select", host);
    if (sel) sel.addEventListener("change", () => { setParams({ sheet: sel.value === "0" ? null : sel.value }); drawSheet(host, t, Number(sel.value)); });
  }

  // ------------------------------------------------------------------ about
  function about(main) {
    const e = S.evidence, A = e.about;
    setTitle("About the study");
    main.innerHTML = `
      <div class="wrap with-side">
        <nav class="side" aria-label="On this page"><p class="side-head">On this page</p><ol class="plain">
          ${[["sample", "Sample"], ["outcomes", "Outcomes"], ["predictors", "Predictors"], ["modeling", "Modeling"], ["limitations", "Limitations"], ["glossary", "Definitions"], ["privacy", "Data and privacy"], ["cite", "Citation"]]
            .map(([id, l]) => `<li><a href="#/about" data-jump="${id}">${l}</a></li>`).join("")}</ol></nav>
        <article class="article">
          <header class="page-head"><p class="kicker">About</p><h1>About the study</h1><p class="dek">${esc(e.home.question)}</p></header>
          <section id="sample" class="rich"><h2>Sample</h2><p>${esc(A.sample)}</p></section>
          <section id="outcomes"><h2>Outcomes</h2><dl class="outcome-defs">${A.outcomes.map((o) => `<div><dt><span class="swatch" style="--c:${C.OUTCOME_COLOR[o.key]}"></span>${esc(o.name)}</dt><dd>${esc(o.text)}</dd></div>`).join("")}</dl></section>
          <section id="predictors" class="rich"><h2>Predictors</h2><p>${esc(A.predictors)}</p><p><a href="#/predictors">Browse the predictor inventory →</a></p></section>
          <section id="modeling" class="rich"><h2>Modeling</h2><p>${esc(A.modeling)}</p></section>
          <section id="limitations" class="rich"><h2>Limitations</h2><ul>${A.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>
          <section id="glossary"><h2>Definitions</h2><dl class="glossary">${e.glossary.map((g) => `<dt id="term-${esc(g.id)}">${esc(g.term)}</dt><dd>${esc(g.definition)}</dd>`).join("")}</dl></section>
          <section id="privacy" class="rich"><h2>Data and privacy</h2><p>${esc(A.privacy)} <a href="${esc(A.data_url)}">MIDUS data documentation</a>.</p></section>
          <section id="cite"><h2>Citation</h2><p class="cite">${esc(e.authors)}. <i>${esc(e.title)}</i>. ${esc(e.status)}</p>
            <p class="small muted">Companion site built ${esc(e.built)}. Every result it states is checked at build time against the analysis outputs that produce the paper's numbers.</p></section>
        </article>
      </div>`;
    main.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const t = document.getElementById(a.dataset.jump);
      t.scrollIntoView({ behavior: "smooth" });
      t.querySelector("h2").tabIndex = -1; t.querySelector("h2").focus({ preventScroll: true });
    }));
  }

  // ------------------------------------------------------------------ chrome
  function closeMenu() {
    const b = $("#menuButton");
    if (b) { b.setAttribute("aria-expanded", "false"); $("#siteNav").classList.remove("open"); }
  }

  function frame() {
    const e = S.evidence;
    $("#brand").textContent = e.short_title;
    $("#footer").innerHTML = `<div class="foot-cols">
      <div><p class="foot-title">${esc(e.short_title)}</p><p>${esc(e.status)} ${esc(e.authors)}.</p></div>
      <div><p>Data: Midlife in the United States (MIDUS). Aggregates only; no individual-level data are published here. <a href="#/about" data-jump-privacy>Data and privacy</a>.</p>
      <p class="muted">Built ${esc(e.built)}.</p></div></div>`;
    $("#menuButton").addEventListener("click", () => {
      const open = $("#menuButton").getAttribute("aria-expanded") !== "true";
      $("#menuButton").setAttribute("aria-expanded", String(open));
      $("#siteNav").classList.toggle("open", open);
    });
  }

  async function load() {
    try {
      const [evidence, results, variables, outcomes] = await Promise.all([
        getJSON("data/evidence.json"), getJSON("data/results.json"), getJSON("data/variables.json"), getJSON("data/outcomes.json"),
      ]);
      Object.assign(S, { evidence, results, variables, outcomes });
      frame();
      window.addEventListener("hashchange", render);
      render();
    } catch (err) {
      $("#main").innerHTML = `<div class="wrap narrow page-head"><h1>The companion could not load</h1><p class="error">${esc(err.message)}</p><p>Reload the page. If the problem persists, the site may be updating; try again in a minute.</p></div>`;
    }
  }

  if (document.readyState !== "loading") load();
  else document.addEventListener("DOMContentLoaded", load);
})();
