const DATASETS = {
  dobNowBuild: "w9ak-ipjd",
  dobNowPermits: "rbx6-tga4",
  dobNowCo: "pkdm-hqz6",
  legacyBisJobs: "ic3t-wcy2",
  buildingFootprints: "5zhs-2jue",
};

const BASE = "https://data.cityofnewyork.us/resource";
const state = {
  rows: [],
  permitRows: [],
  coRows: [],
  legacyRows: [],
  footprintRows: [],
  groups: {},
  links: [],
  sort: "job",
  resolved: {},
};

const $ = (id) => document.getElementById(id);

const JOB_TYPE_MAP = {
  NB: "New Building",
  "NEW BUILDING": "New Building",
  "ALT-CO": "Alteration CO",
  "ALTERATION CO": "Alteration CO",
  ALT: "Alteration",
  ALTERATION: "Alteration",
  LA: "Limited Alteration",
  LAA: "Limited Alteration",
  "LIMITED ALTERATION": "Limited Alteration",
  NW: "No Work",
  "NO WORK": "No Work",
  DM: "Full Demolition",
  DEMOLITION: "Full Demolition",
};

const WORK_TYPE_MAP = {
  GC: "General Construction",
  MS: "Mechanical Systems",
  PL: "Plumbing",
  PM: "Plumbing",
  FN: "Foundation",
  FO: "Foundation",
  EW: "Earthwork",
  EA: "Earthwork",
  ST: "Structural",
  SD: "Standpipe",
  SP: "Sprinkler",
  FA: "Fire Alarm",
  MH: "Mechanical/HVAC",
  OT: "Other",
};

document.addEventListener("DOMContentLoaded", () => {
  $("lookupForm").addEventListener("submit", (event) => {
    event.preventDefault();
    runLookup();
  });
  $("openOnePage").addEventListener("click", openOneStopLinkPage);
  $("openOnePage2").addEventListener("click", openOneStopLinkPage);
  $("openTabs").addEventListener("click", openAllLinks);
  $("openTabs2").addEventListener("click", openAllLinks);
  $("exportCsv").addEventListener("click", downloadCsv);
  $("clearBtn").addEventListener("click", clearAll);
  document.querySelectorAll(".sortBtn").forEach((button) => {
    button.addEventListener("click", () => {
      state.sort = button.dataset.sort;
      renderGroups();
      renderChart();
    });
  });
});

async function runLookup() {
  const raw = $("q").value.trim();
  if (!raw) {
    setStatus("Enter a BBL, BIN, DOB NOW job number, or address keyword.");
    return;
  }

  setStatus("Searching DOB NOW, CO, BIS legacy, permits, and building-footprint data...");
  hideResultCards();

  try {
    const type = detectType(raw, $("type").value);
    const limit = Number($("limit").value) || 500;
    const resolved = await resolveSearch(raw, type);
    state.resolved = resolved;

    const dobNowWhere = buildDobNowWhere(resolved, type, raw);
    state.rows = await fetchRows(DATASETS.dobNowBuild, { "$limit": limit, "$where": dobNowWhere });

    const searchContext = enrichContext(resolved, state.rows);
    const [permitRows, coRows, legacyRows, footprintRows] = await Promise.all([
      safeFetch(() => fetchPermits(searchContext, limit), "DOB NOW permits"),
      safeFetch(() => fetchCoRows(searchContext, limit), "DOB NOW CO"),
      safeFetch(() => fetchLegacyRows(searchContext, limit), "legacy BIS"),
      safeFetch(() => fetchFootprints(searchContext), "building footprints"),
    ]);

    state.permitRows = permitRows;
    state.coRows = coRows;
    state.legacyRows = legacyRows;
    state.footprintRows = footprintRows;
    state.groups = groupRows(state.rows);

    renderAll(searchContext);
    setStatus(`Loaded ${state.rows.length} DOB NOW row(s), ${state.coRows.length} CO row(s), and ${state.legacyRows.length} legacy BIS row(s).`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error));
  }
}

function detectType(value, selected) {
  if (selected !== "auto") return selected;
  const clean = value.trim();
  if (/^[1-5]\d{9}$/.test(clean)) return "bbl";
  if (/^\d{7}$/.test(clean)) return "bin";
  if (/^[A-Z]\d{8,}/i.test(clean) || /^[A-Z]\d{7,}-[A-Z]\d+$/i.test(clean)) return "job";
  return "address";
}

async function resolveSearch(value, type) {
  if (type === "bbl") return { bbl: value.replace(/\D/g, "") };
  if (type === "bin") return { bin: value.replace(/\D/g, "") };
  if (type === "job") return { job: value.trim().toUpperCase(), parentJob: parentJob(value) };

  const geo = await fetchJson(`https://geosearch.planninglabs.nyc/v2/search?${new URLSearchParams({ text: value, size: "1" })}`);
  const feature = geo.features && geo.features[0];
  const properties = feature && feature.properties;
  const bbl = properties && properties.addendum && properties.addendum.pad && properties.addendum.pad.bbl;
  const bin = properties && properties.addendum && properties.addendum.pad && properties.addendum.pad.bin;
  if (!bbl && !bin) return { addressKeyword: value };
  return { bbl, bin, label: properties.label || value };
}

function buildDobNowWhere(resolved, type, raw) {
  if (resolved.bbl) return bblWhere(resolved.bbl);
  if (resolved.bin) return `bin='${resolved.bin}'`;
  if (resolved.parentJob) return `starts_with(job_filing_number,'${resolved.parentJob}')`;
  if (type === "address") {
    const escaped = raw.toUpperCase().replace(/'/g, "''");
    return `upper(street_name) like '%${escaped}%' OR upper(job_description) like '%${escaped}%'`;
  }
  return `$q='${raw.replace(/'/g, "''")}'`;
}

function enrichContext(resolved, rows) {
  const bbls = unique([resolved.bbl, ...rows.map((row) => row.bbl)].filter(Boolean).map(cleanDigits));
  const bins = unique([resolved.bin, ...rows.map((row) => row.bin)].filter(Boolean).map(cleanDigits));
  const jobs = unique([resolved.job, ...rows.map((row) => row.job_filing_number)].filter(Boolean).map((v) => String(v).trim().toUpperCase()));
  const addresses = unique(rows.map(rowAddress).filter(Boolean));
  return { ...resolved, bbls, bins, jobs, addresses };
}

async function fetchPermits(context, limit) {
  const clauses = [];
  if (context.bbls.length) clauses.push(...context.bbls.map((bbl) => `bbl='${bbl}'`));
  if (context.bins.length) clauses.push(...context.bins.map((bin) => `bin='${bin}'`));
  if (context.jobs.length) clauses.push(...context.jobs.map((job) => `starts_with(job_filing_number,'${parentJob(job)}')`));
  if (!clauses.length) return [];
  return fetchRows(DATASETS.dobNowPermits, { "$limit": limit, "$where": clauses.join(" OR "), "$order": "issued_date DESC" });
}

async function fetchCoRows(context, limit) {
  const clauses = [];
  if (context.bbls.length) clauses.push(...context.bbls.map((bbl) => `bbl='${bbl}'`));
  if (context.bins.length) clauses.push(...context.bins.map((bin) => `bin='${bin}'`));
  if (context.jobs.length) clauses.push(...context.jobs.map((job) => `starts_with(job_filing_name,'${parentJob(job)}')`));
  if (!clauses.length && context.addressKeyword) {
    clauses.push(`upper(street_name) like '%${context.addressKeyword.toUpperCase().replace(/'/g, "''")}%'`);
  }
  if (!clauses.length) return [];
  return fetchRows(DATASETS.dobNowCo, { "$limit": limit, "$where": clauses.join(" OR "), "$order": "c_of_o_issuance_date DESC" });
}

async function fetchLegacyRows(context, limit) {
  const clauses = [];
  for (const bbl of context.bbls) {
    const p = bblParts(bbl);
    clauses.push(`borough='${p.boroughName}' AND block='${Number(p.block)}' AND lot='${Number(p.lot)}'`);
  }
  if (context.bins.length) clauses.push(...context.bins.map((bin) => `bin__='${bin}'`));
  if (!clauses.length) return [];
  return fetchRows(DATASETS.legacyBisJobs, { "$limit": limit, "$where": clauses.join(" OR "), "$order": "latest_action_date DESC" });
}

async function fetchFootprints(context) {
  if (!context.bbls.length) return [];
  const clauses = context.bbls.map((bbl) => `base_bbl='${bbl}' OR base_bbl=${Number(bbl)}`);
  return fetchRows(DATASETS.buildingFootprints, { "$limit": 100, "$select": "bin,base_bbl", "$where": clauses.join(" OR ") });
}

async function fetchRows(dataset, params) {
  const url = `${BASE}/${dataset}.json?${new URLSearchParams(params)}`;
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || `Open Data request failed for ${dataset}`);
  return Array.isArray(payload) ? payload : [];
}

async function safeFetch(fn, label) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`${label} lookup skipped:`, error);
    return [];
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Lookup request failed");
  return payload;
}

function bblWhere(bbl) {
  const p = bblParts(bbl);
  return `bbl='${p.bbl}' OR (borough='${p.borough}' AND block='${Number(p.block)}' AND lot='${Number(p.lot)}')`;
}

function bblParts(bbl) {
  const clean = cleanDigits(bbl);
  const borough = clean.slice(0, 1);
  const block = clean.slice(1, 6);
  const lot = clean.slice(6, 10);
  const boroughNames = { 1: "MANHATTAN", 2: "BRONX", 3: "BROOKLYN", 4: "QUEENS", 5: "STATEN ISLAND" };
  return { bbl: clean, borough, block, lot, boroughName: boroughNames[borough] || borough };
}

function groupRows(rows) {
  return rows.reduce((groups, row) => {
    const key = parentJob(row.job_filing_number || "UNKNOWN");
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
    return groups;
  }, {});
}

function renderAll(context) {
  renderLinks(context);
  renderKpis(context);
  renderParcelSummary(context);
  renderCoRows();
  renderLegacyRows();
  renderGroups();
  renderChart();
  renderAssessmentSuggestions();
  renderRaw();
}

function renderLinks(context) {
  $("linkCard").classList.remove("hidden");
  $("linkSub").textContent = context.label || context.bbls[0] || context.bins[0] || context.jobs[0] || "Search context";
  const firstBbl = context.bbls[0];
  const firstBin = context.bins[0] || state.footprintRows.map((row) => row.bin).filter(Boolean)[0];
  const links = [];

  if (firstBbl) {
    const p = bblParts(firstBbl);
    const acrisBbl = `${p.borough}${p.block}${p.lot}`;
    links.push(group("Finance / Assessment", [
      ["DOF property tax bills", "https://www.nyc.gov/site/finance/property/property-tax-bills.page"],
      ["DOF market value", "https://www.nyc.gov/site/finance/property/property-determining-your-market-value.page"],
      ["ACRIS property records", `https://a836-acris.nyc.gov/CP/LookUp/Index?borough=${p.borough}&block=${Number(p.block)}&lot=${Number(p.lot)}`],
      ["Property Information Portal", "https://propertyinformationportal.nyc.gov/"],
    ]));
    links.push(group("Zoning / Land", [
      ["ZoLa zoning lot", `https://zola.planning.nyc.gov/l/lot/${p.borough}/${Number(p.block)}/${Number(p.lot)}`],
      ["Digital Tax Map", "https://propertyinformationportal.nyc.gov/"],
      ["ACRIS BBL reference", `https://a836-acris.nyc.gov/CP/CoverPage/MainMenu?bbl=${acrisBbl}`],
    ]));
    links.push(group("DOB / BIS", [
      ["BIS property profile", `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${p.borough}&block=${Number(p.block)}&lot=${Number(p.lot)}&go2=+GO+&requestid=0`],
      ["DOB NOW public portal", "https://a810-dobnow.nyc.gov/publish/Index.html#!/"],
      ["DOB NOW CO portal", "https://a810-dobnow.nyc.gov/publish/Index.html#!/"],
    ]));
  }

  if (firstBin) {
    links.push(group("BIN Direct", [
      ["BIS profile by BIN", `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${firstBin}&go4=+GO+&requestid=0`],
      ["BIS CO by BIN", `https://a810-bisweb.nyc.gov/bisweb/COsByLocationServlet?allbin=${firstBin}&requestid=0`],
    ]));
  }

  state.links = links.flatMap((item) => item.items.map((link) => link.url));
  $("links").innerHTML = links.map((item) => `
    <div class="linkGroup">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.note)}</p>
      ${item.items.map((link) => `<a class="btn ${link.green ? "green" : "ghost"}" target="_blank" rel="noreferrer" href="${link.url}">${esc(link.label)}</a>`).join("")}
    </div>
  `).join("") + `<div class="linkHint">Use DOB NOW and BIS together. DOB guidance says building records are split between both systems during the transition.</div>`;
}

function group(title, items) {
  return { title, note: "Direct assessor research links for the current parcel context.", items: items.map(([label, url], index) => ({ label, url, green: index === 0 })) };
}

function renderKpis(context) {
  $("kpis").classList.remove("hidden");
  const stats = parentStats(state.rows);
  const paaCount = state.rows.filter((row) => ["A", "P"].includes(jobSuffix(row.job_filing_number).letter)).length;
  $("kpis").innerHTML = [
    kpi("DOB NOW rows", state.rows.length),
    kpi("Parent jobs", Object.keys(state.groups).length),
    kpi("Approval cost", fmtMoney(stats.approval), "money"),
    kpi("Permit-est. cost", fmtMoney(sum(state.permitRows, "estimated_job_costs")), "money"),
    kpi("PAA / amendments", paaCount),
    kpi("CO issued rows", state.coRows.length),
    kpi("Legacy BIS rows", state.legacyRows.length),
    kpi("Unique BINs", unique([...context.bins, ...state.footprintRows.map((row) => row.bin)].filter(Boolean)).length),
  ].join("");
}

function kpi(label, value, cls = "") {
  return `<div class="kpi"><span class="muted">${esc(label)}</span><b class="${cls}">${esc(value)}</b></div>`;
}

function renderParcelSummary(context) {
  $("parcelCard").classList.remove("hidden");
  const bbls = unique(context.bbls);
  const bins = unique([...context.bins, ...state.footprintRows.map((row) => row.bin)].filter(Boolean));
  $("parcelSummary").innerHTML = `
    <div class="grid g2">
      <div class="kpi"><span class="muted">BBLs</span><b>${bbls.length || "-"}</b><p>${bbls.map(esc).join("<br>") || "None returned"}</p></div>
      <div class="kpi"><span class="muted">BINs</span><b>${bins.length || "-"}</b><p>${bins.map(esc).join("<br>") || "None returned"}</p></div>
    </div>`;
}

function renderCoRows() {
  if (!state.coRows.length) {
    $("coCard").classList.add("hidden");
    return;
  }
  $("coCard").classList.remove("hidden");
  const sorted = [...state.coRows].sort((a, b) => dateValue(b.c_of_o_issuance_date) - dateValue(a.c_of_o_issuance_date));
  $("coIssued").innerHTML = table(sorted, [
    ["CO #", "c_of_o_number"],
    ["Application", "application_number"],
    ["Job", "job_filing_name"],
    ["Status", "c_of_o_status"],
    ["Issued", "c_of_o_issuance_date"],
    ["Units", "number_of_dwelling_units"],
    ["BIN", "bin"],
    ["BBL", "bbl"],
  ]);
}

function renderLegacyRows() {
  if (!state.legacyRows.length) {
    $("legacyBisCard").classList.add("hidden");
    return;
  }
  $("legacyBisCard").classList.remove("hidden");
  $("legacyBis").innerHTML = table(state.legacyRows, [
    ["Job", "job__"],
    ["Doc", "doc__"],
    ["Type", "job_type"],
    ["Status", "job_status"],
    ["Date", "latest_action_date"],
    ["Cost", "initial_cost"],
    ["BIN", "bin__"],
    ["Address", (row) => `${row.house__ || ""} ${row.street_name || ""}`.trim()],
  ]);
}

function renderGroups() {
  if (!state.rows.length) {
    $("groupCard").classList.add("hidden");
    return;
  }
  $("groupCard").classList.remove("hidden");
  let groups = Object.entries(state.groups).map(([parent, rows]) => ({ parent, rows, stats: parentStats(rows) }));
  if (state.sort === "dateDesc") groups.sort((a, b) => b.stats.latestDate - a.stats.latestDate);
  else if (state.sort === "costDesc") groups.sort((a, b) => b.stats.approval - a.stats.approval);
  else groups.sort((a, b) => a.parent.localeCompare(b.parent));

  $("jobGroups").innerHTML = groups.map((groupItem) => {
    const sortedRows = [...groupItem.rows].sort(compareFiling);
    return `
      <details open>
        <summary class="expandSummary">
          <span class="parentJob">${esc(groupItem.parent)}</span>
          <span class="pill green">${sortedRows.length} filing(s)</span>
          <span class="pill amber">${fmtMoney(groupItem.stats.approval)}</span>
        </summary>
        <div class="detailBox tablewrap">
          <table>
            <thead><tr><th>Filing</th><th>Type</th><th>Work</th><th>Status</th><th>Dates</th><th>Approval cost</th><th>Permit-est. cost</th><th>Description</th></tr></thead>
            <tbody>${sortedRows.map(rowForGroup).join("")}</tbody>
          </table>
        </div>
      </details>`;
  }).join("");
}

function rowForGroup(row) {
  const job = row.job_filing_number || "";
  const suffix = jobSuffix(job);
  const permitCost = sum(state.permitRows.filter((permit) => parentJob(permit.job_filing_number) === parentJob(job)), "estimated_job_costs");
  return `<tr>
    <td><div class="filingStack"><span class="${filingClass(suffix.letter)}">${esc(job)}</span><span class="jobMeta">Parent: ${esc(parentJob(job))}</span></div></td>
    <td>${esc(displayMapped(row.job_type, JOB_TYPE_MAP))}<div class="jobMeta">Job Type</div></td>
    <td>${workTypes(row).map((work) => `<span class="pill">${esc(work)}</span>`).join(" ") || "-"}</td>
    <td class="statusLine">${esc(row.filing_status || "-")}</td>
    <td class="small">Filed: ${fmtDate(row.filing_date)}<br>Approved: ${fmtDate(row.approved_date)}<br>Permit: ${fmtDate(row.first_permit_date)}</td>
    <td class="money">${fmtMoney(money(row.initial_cost))}</td>
    <td class="money">${fmtMoney(permitCost)}</td>
    <td>${esc(row.job_description || "")}</td>
  </tr>`;
}

function renderChart() {
  if (!state.rows.length) {
    $("chartCard").classList.add("hidden");
    return;
  }
  $("chartCard").classList.remove("hidden");
  const items = Object.entries(state.groups).map(([parent, rows]) => ({ parent, ...parentStats(rows) })).sort((a, b) => b.approval - a.approval).slice(0, 12);
  const max = Math.max(...items.map((item) => item.approval), 1);
  $("costChart").innerHTML = `<div class="chart">${items.map((item) => `
    <div class="chartrow">
      <div class="chartlabel" title="${esc(item.parent)}">${esc(item.parent)}</div>
      <div class="chartbar"><span style="width:${Math.max(2, Math.round(item.approval / max * 100))}%"></span></div>
      <div class="money small"><b>${fmtMoney(item.approval)}</b><br><span class="muted">${fmtDateValue(item.latestDate)}</span></div>
    </div>`).join("")}</div>`;
}

function renderAssessmentSuggestions() {
  if (!state.rows.length && !state.coRows.length) {
    $("assessmentCard").classList.add("hidden");
    return;
  }
  $("assessmentCard").classList.remove("hidden");
  const totalApproval = parentStats(state.rows).approval;
  const hasPaa = state.rows.some((row) => ["A", "P"].includes(jobSuffix(row.job_filing_number).letter));
  const hasCo = state.coRows.length > 0;
  const cards = [
    ["Progress assessment trigger", totalApproval >= 250000 ? "High declared cost found. Check physical percent complete and whether cost supports a new physical entry." : "Review scope even when cost is low; minor permits can still signal condition/status changes."],
    ["CO/TCO/LOC check", hasCo ? "CO-issued records were returned. Confirm readiness/occupancy date for taxable-status analysis." : "No DOB NOW CO records returned. Check BIS CO if the project looks complete."],
    ["PAA / amendment handling", hasPaa ? "PAA/amendment records exist. Compare revised scope against parent job and avoid double-counting estimated costs." : "No PAA-style suffix detected in returned DOB NOW rows."],
    ["Job Type vs Work Type", "Job Type is NB / Alteration / ALT-CO / No Work. Work Type is the trade/scope code such as GC, MS, PL, FN, EW, or ST."],
    ["External checks", "Use Finance for assessment/NOPV, ACRIS for ownership/transfers/mortgages, ZoLa for zoning, HPD for residential context, and BIS for older applications."],
    ["Field inspection note", "For an assessment memo: summarize scope, status/date, exterior/interior observations, CO/TCO/LOC, and whether a physical change is warranted."],
  ];
  $("assessmentSuggestions").innerHTML = cards.map(([title, body]) => `<div class="kpi"><span class="pill green">Assessment</span><b style="font-size:16px;margin-top:8px">${esc(title)}</b><p class="muted">${esc(body)}</p></div>`).join("");
}

function renderRaw() {
  if (!state.rows.length) {
    $("rawCard").classList.add("hidden");
    return;
  }
  $("rawCard").classList.remove("hidden");
  $("raw").innerHTML = `
    <details>
      <summary class="expandSummary">Show raw DOB NOW JSON</summary>
      <div class="detailBox"><pre>${esc(JSON.stringify(state.rows, null, 2))}</pre></div>
    </details>
    <div class="workLegend">
      ${Object.entries(WORK_TYPE_MAP).map(([code, label]) => `<span><b>${code}</b> ${esc(label)}</span>`).join("")}
    </div>`;
}

function table(rows, columns) {
  return `<div class="tablewrap"><table><thead><tr>${columns.map(([label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([, field]) => `<td>${esc(typeof field === "function" ? field(row) : row[field] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function openOneStopLinkPage() {
  if (!state.links.length) {
    alert("Run a lookup first.");
    return;
  }
  const html = `<!doctype html><title>NYC Assessor Links</title><body style="font-family:Arial;padding:20px"><h1>NYC Assessor Links</h1><ol>${state.links.map((url) => `<li><a href="${url}" target="_blank" rel="noreferrer">${url}</a></li>`).join("")}</ol></body>`;
  const blob = new Blob([html], { type: "text/html" });
  window.open(URL.createObjectURL(blob), "_blank");
}

function openAllLinks() {
  if (!state.links.length) {
    alert("Run a lookup first.");
    return;
  }
  state.links.slice(0, 12).forEach((url) => window.open(url, "_blank", "noreferrer"));
}

function downloadCsv() {
  if (!state.rows.length) {
    alert("No DOB NOW rows to export.");
    return;
  }
  const columns = unique(state.rows.flatMap((row) => Object.keys(row)));
  const csv = [columns.join(",")].concat(state.rows.map((row) => columns.map((column) => `"${String(row[column] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "dob_now_assessor_lookup.csv";
  anchor.click();
}

function clearAll() {
  Object.assign(state, { rows: [], permitRows: [], coRows: [], legacyRows: [], footprintRows: [], groups: {}, links: [], resolved: {} });
  hideResultCards();
  setStatus("");
}

function hideResultCards() {
  ["linkCard", "kpis", "parcelCard", "coCard", "legacyBisCard", "groupCard", "chartCard", "assessmentCard", "rawCard"].forEach((id) => $(id).classList.add("hidden"));
}

function parentStats(rows) {
  const dates = rows.map(dateValue).filter(Boolean);
  return {
    approval: sum(rows, "initial_cost"),
    latestDate: dates.length ? Math.max(...dates) : 0,
  };
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + money(row[field]), 0);
}

function parentJob(job) {
  return String(job || "").trim().toUpperCase().replace(/-[A-Z]\d+$/i, "");
}

function jobSuffix(job) {
  const match = String(job || "").trim().toUpperCase().match(/-([A-Z])(\d+)$/);
  return { letter: match ? match[1] : "", seq: match ? Number(match[2]) : 0 };
}

function compareFiling(a, b) {
  const rank = { I: 1, S: 2, P: 3, A: 3 };
  const aa = jobSuffix(a.job_filing_number);
  const bb = jobSuffix(b.job_filing_number);
  return (rank[aa.letter] || 9) - (rank[bb.letter] || 9) || aa.seq - bb.seq || String(a.job_filing_number || "").localeCompare(String(b.job_filing_number || ""));
}

function filingClass(letter) {
  if (letter === "I") return "filingMain";
  if (letter === "S") return "filingSub";
  if (letter === "P" || letter === "A") return "filingPaa";
  return "filingPlain";
}

function workTypes(row) {
  const out = [];
  const direct = row.work_type || row.work_types || row.selected_work_types;
  if (direct) out.push(...String(direct).split(/[;,]/).map((v) => v.trim()).filter(Boolean));
  const flags = [
    ["GC", "general_construction_work_type_"],
    ["MS", "mechanical_systems_work_type_"],
    ["PL", "plumbing_work_type"],
    ["FN", "foundation_work_type_"],
    ["EW", "earth_work_work_type_"],
    ["ST", "structural_work_type_"],
    ["SP", "sprinkler_work_type"],
  ];
  for (const [code, field] of flags) {
    if (truthy(row[field])) out.push(code);
  }
  return unique(out).map((code) => displayMapped(code, WORK_TYPE_MAP));
}

function displayMapped(value, map) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  return map[upper] ? `${upper} ${map[upper]}` : raw;
}

function rowAddress(row) {
  return `${row.house_no || row.house_number || ""} ${row.street_name || row.street || ""}`.trim();
}

function money(value) {
  const parsed = Number(String(value || "0").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function dateValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtDate(value) {
  const parsed = dateValue(value);
  return parsed ? new Date(parsed).toLocaleDateString() : "-";
}

function fmtDateValue(value) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function truthy(value) {
  return ["yes", "y", "true", "1", "x"].includes(String(value || "").trim().toLowerCase());
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function setStatus(text) {
  $("status").textContent = text;
}
