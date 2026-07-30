const state = {
  mode: "address",
};

const els = {
  form: document.querySelector("#searchForm"),
  query: document.querySelector("#query"),
  queryLabel: document.querySelector("#queryLabel"),
  status: document.querySelector("#status"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  bblValue: document.querySelector("#bblValue"),
  boroughValue: document.querySelector("#boroughValue"),
  assessmentCount: document.querySelector("#assessmentCount"),
  salesCount: document.querySelector("#salesCount"),
  signals: document.querySelector("#signals"),
  nextSteps: document.querySelector("#nextSteps"),
  assessmentRecord: document.querySelector("#assessmentRecord"),
  salesRecords: document.querySelector("#salesRecords"),
  sources: document.querySelector("#sources"),
};

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.mode = tab.dataset.mode;
    els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
    els.queryLabel.textContent = state.mode === "address" ? "Address" : "BBL";
    els.query.placeholder = state.mode === "address" ? "120 Broadway, Manhattan" : "1000477501";
    els.query.value = state.mode === "address" ? "120 Broadway, Manhattan" : "1000477501";
    els.query.focus();
  });
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = els.query.value.trim();
  if (!value) {
    setStatus("Enter a value", "error");
    return;
  }
  await loadBrief(value);
});

async function loadBrief(value) {
  setStatus("Searching", "loading");
  try {
    const payload = location.protocol === "file:" ? await directBrief(value) : await briefWithFallback(value);
    renderBrief(payload);
    setStatus("Loaded", "");
  } catch (error) {
    setStatus("Error", "error");
    els.signals.innerHTML = "";
    els.signals.append(item(error.message));
  }
}

async function briefWithFallback(value) {
  try {
    return await serverBrief(value);
  } catch (error) {
    if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
      return directBrief(value);
    }
    throw error;
  }
}

async function serverBrief(value) {
  const params = new URLSearchParams({ [state.mode]: value });
  const response = await fetch(`/api/brief?${params.toString()}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("No local API is available.");
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Search failed");
  }
  return payload;
}

async function directBrief(value) {
  const bbl = state.mode === "bbl" ? parseBbl(value) : await resolveAddress(value);
  const [assessmentRecords, salesRecords] = await Promise.all([
    fetchJson(socrataUrl("8y4t-faws", {
      "$limit": "8",
      "$where": `parid='${bbl.value}' OR (boro='${bbl.borough}' AND block='${bbl.block}' AND lot='${bbl.lot}')`,
      "$order": "year DESC, period DESC",
    })),
    fetchJson(socrataUrl("w2pb-icbu", {
      "$limit": "10",
      "$where": `bbl='${bbl.value}' OR (borough='${bbl.borough}' AND block='${bbl.block}' AND lot='${bbl.lot}')`,
      "$order": "sale_date DESC",
    })),
  ]);

  return {
    bbl: {
      borough: bbl.borough,
      block: Number(bbl.block),
      lot: Number(bbl.lot),
      value: bbl.value,
      borough_name: bbl.boroughName,
    },
    resolved_address: bbl.label || null,
    assessment_records: assessmentRecords,
    sales_records: salesRecords,
    signals: signalsFrom(assessmentRecords, salesRecords),
    next_steps: [
      "Verify final figures in NYC DOF property records before relying on them.",
      "Compare assessment trend against recent arms-length sales and nearby comparable parcels.",
      "Check exemptions, abatements, building class, tax class, and notice of property value if evaluating an appeal.",
    ],
    sources: {
      assessment: "https://data.cityofnewyork.us/d/8y4t-faws",
      sales: "https://data.cityofnewyork.us/d/w2pb-icbu",
      geosearch: "https://geosearch.planninglabs.nyc/docs/",
    },
  };
}

async function resolveAddress(address) {
  const url = `https://geosearch.planninglabs.nyc/v2/search?${new URLSearchParams({ text: address, size: "1" })}`;
  const data = await fetchJson(url);
  const feature = data.features && data.features[0];
  const properties = feature && feature.properties;
  const bbl = properties && properties.addendum && properties.addendum.pad && properties.addendum.pad.bbl;
  if (!bbl) {
    throw new Error(`Could not resolve address to a NYC BBL: ${address}`);
  }
  return { ...parseBbl(bbl), label: properties.label || address };
}

function parseBbl(raw) {
  const value = String(raw).trim().replace(/-/g, "");
  if (!/^[1-5]\d{9}$/.test(value)) {
    throw new Error("BBL must be a 10-digit value like 1000477501.");
  }
  const boroughNames = {
    1: "Manhattan",
    2: "Bronx",
    3: "Brooklyn",
    4: "Queens",
    5: "Staten Island",
  };
  return {
    value,
    borough: Number(value.slice(0, 1)),
    block: String(Number(value.slice(1, 6))),
    lot: String(Number(value.slice(6, 10))),
    boroughName: boroughNames[Number(value.slice(0, 1))],
  };
}

function signalsFrom(assessmentRecords, salesRecords) {
  const latest = assessmentRecords[0] || {};
  const fields = ["year", "period", "owner", "street_name", "curtaxclass", "fintaxclass", "bldg_class", "zoning", "curmkttot", "finmkttot", "curacttot", "finacttot", "curtrntot", "fintrntot"];
  const signals = fields
    .filter((field) => latest[field] !== undefined && latest[field] !== "")
    .map((field) => `${title(field.replaceAll("_", " "))}: ${latest[field]}`);
  if (!signals.length) {
    signals.push("No assessment rows were returned for this parcel from the assessment dataset.");
  }
  signals.push(
    salesRecords.length
      ? `Found ${salesRecords.length} matching sales record(s) in the annualized sales dataset.`
      : "No matching annualized sales records were returned for this BBL."
  );
  return signals;
}

function socrataUrl(dataset, params) {
  return `https://data.cityofnewyork.us/resource/${dataset}.json?${new URLSearchParams(params)}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }
  return payload;
}

function renderBrief(brief) {
  els.bblValue.textContent = brief.bbl.value;
  els.boroughValue.textContent = brief.bbl.borough_name;
  els.assessmentCount.textContent = String(brief.assessment_records.length);
  els.salesCount.textContent = String(brief.sales_records.length);

  renderList(els.signals, brief.signals);
  renderList(els.nextSteps, brief.next_steps);
  els.assessmentRecord.textContent = JSON.stringify(brief.assessment_records[0] || {}, null, 2);
  els.salesRecords.textContent = JSON.stringify(brief.sales_records, null, 2);

  els.sources.innerHTML = "";
  Object.entries(brief.sources).forEach(([label, url]) => {
    const li = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = `${title(label)} source`;
    li.append(anchor);
    els.sources.append(li);
  });
}

function renderList(target, values) {
  target.innerHTML = "";
  values.forEach((value) => target.append(item(value)));
}

function item(text) {
  const li = document.createElement("li");
  li.textContent = text;
  return li;
}

function setStatus(text, className) {
  els.status.textContent = text;
  els.status.className = `status ${className}`.trim();
}

function title(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

loadBrief(els.query.value);
