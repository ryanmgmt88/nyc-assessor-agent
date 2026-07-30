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
  dobJobsCount: document.querySelector("#dobJobsCount"),
  coCount: document.querySelector("#coCount"),
  violationsCount: document.querySelector("#violationsCount"),
  plutoCount: document.querySelector("#plutoCount"),
  signals: document.querySelector("#signals"),
  nextSteps: document.querySelector("#nextSteps"),
  methodology: document.querySelector("#methodology"),
  externalLinks: document.querySelector("#externalLinks"),
  assessmentRecord: document.querySelector("#assessmentRecord"),
  salesRecords: document.querySelector("#salesRecords"),
  supplementalRecords: document.querySelector("#supplementalRecords"),
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
  const [assessmentRecords, salesRecords, dobNowJobs, dobCo, dobNowCo, dobViolations, dobEcbViolations, pluto] = await Promise.all([
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
    fetchJson(socrataUrl("w9ak-ipjd", {
      "$limit": "10",
      "$where": boroughBlockLotWhere(bbl),
      "$order": "filing_date DESC",
    })),
    fetchJson(socrataUrl("bs8b-p36w", {
      "$limit": "10",
      "$where": `bbl='${bbl.value}' OR ${boroughBlockLotWhere(bbl)}`,
      "$order": "c_o_issue_date DESC",
    })),
    fetchJson(socrataUrl("pkdm-hqz6", {
      "$limit": "10",
      "$where": `bbl='${bbl.value}' OR ${boroughBlockLotWhere(bbl)}`,
      "$order": "c_of_o_issuance_date DESC",
    })),
    fetchJson(socrataUrl("3h2n-5cm9", {
      "$limit": "10",
      "$where": `boro='${bbl.borough}' AND ${blockLotWhere(bbl)}`,
      "$order": "issue_date DESC",
    })),
    fetchJson(socrataUrl("6bgk-3dad", {
      "$limit": "10",
      "$where": `boro='${bbl.borough}' AND ${blockLotWhere(bbl)}`,
      "$order": "issue_date DESC",
    })),
    fetchJson(socrataUrl("64uk-42ks", {
      "$limit": "3",
      "$where": boroughBlockLotWhere(bbl),
    })),
  ]);
  const supplementalRecords = {
    dob_now_jobs: dobNowJobs,
    dob_co: dobCo,
    dob_now_co: dobNowCo,
    dob_violations: dobViolations,
    dob_ecb_violations: dobEcbViolations,
    pluto,
  };

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
    supplemental_records: supplementalRecords,
    signals: signalsFrom(assessmentRecords, salesRecords, supplementalRecords),
    next_steps: [
      "Verify final figures in NYC DOF property records before relying on them.",
      "Compare assessment trend against recent arms-length sales and nearby comparable parcels.",
      "Check BIS and DOB NOW together because DOB says public building records are split across both systems during the transition.",
      "Review ACRIS deeds and recorded documents for transfer, condo, easement, mortgage, and legal-description context.",
      "Check exemptions, abatements, building class, tax class, zoning, CO/legal use, and physical changes if evaluating an appeal.",
    ],
    methodology_notes: [
      "DOF determines market value every year, and the method varies by tax class.",
      "Class 1 valuation uses statistical modeling of comparable neighborhood sales from the prior three years.",
      "Class 2 co-ops, condos, and larger residential properties are valued as income-producing properties under state law.",
      "Class 4 commercial properties are generally valued from income earning potential and expenses, including RPIE data where applicable.",
      "Assessed value is market value multiplied by the assessment percentage, then caps, phase-ins, exemptions, and abatements can affect taxable value.",
    ],
    external_links: {
      "DOB BIS property profile": `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${bbl.borough}&block=${bbl.block}&lot=${bbl.lot}&go2=+GO+&requestid=0`,
      "DOB NOW public portal": "https://a810-dobnow.nyc.gov/publish/Index.html#!/",
      "DOB NOW certificate of occupancy search": "https://a810-dobnow.nyc.gov/publish/Index.html#!/",
      "ACRIS property records": "https://a836-acris.nyc.gov/CP/",
      "ZoLa zoning lot": `https://zola.planning.nyc.gov/l/lot/${bbl.borough}/${bbl.block}/${bbl.lot}`,
      "NYC Digital Tax Map": "https://propertyinformationportal.nyc.gov/",
      "DOF property tax bills": "https://www.nyc.gov/site/finance/property/property-tax-bills.page",
      "NYC Property Information Portal": "https://propertyinformationportal.nyc.gov/",
    },
    sources: {
      assessment: "https://data.cityofnewyork.us/d/8y4t-faws",
      sales: "https://data.cityofnewyork.us/d/w2pb-icbu",
      dob_now_jobs: "https://data.cityofnewyork.us/d/w9ak-ipjd",
      dob_co: "https://data.cityofnewyork.us/d/bs8b-p36w",
      dob_now_co: "https://data.cityofnewyork.us/d/pkdm-hqz6",
      dob_violations: "https://data.cityofnewyork.us/d/3h2n-5cm9",
      dob_ecb_violations: "https://data.cityofnewyork.us/d/6bgk-3dad",
      pluto: "https://data.cityofnewyork.us/d/64uk-42ks",
      geosearch: "https://geosearch.planninglabs.nyc/docs/",
      dof_market_value: "https://www.nyc.gov/site/finance/property/property-determining-your-market-value.page",
      dof_assessment_roll: "https://www.nyc.gov/site/finance/property/assessment-roll-explanation.page",
      dof_terms: "https://www.nyc.gov/site/finance/property/definitions-of-property-assessment-terms.page",
      dob_find_building_data: "https://www.nyc.gov/site/buildings/dob/find-building-data.page",
      dob_co_guidance: "https://www.nyc.gov/site/buildings/industry/obtain-a-co.page",
      acris: "https://www.nyc.gov/site/finance/property/acris.page",
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

function signalsFrom(assessmentRecords, salesRecords, supplementalRecords) {
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
  const counts = {
    "DOB NOW jobs": supplementalRecords.dob_now_jobs.length,
    "DOB certificates of occupancy": supplementalRecords.dob_co.length,
    "DOB NOW certificates of occupancy": supplementalRecords.dob_now_co.length,
    "DOB violations": supplementalRecords.dob_violations.length,
    "DOB ECB violations": supplementalRecords.dob_ecb_violations.length,
  };
  Object.entries(counts).forEach(([label, count]) => {
    if (count) signals.push(`${label}: ${count} record(s) returned.`);
  });
  return signals;
}

function boroughBlockLotWhere(bbl) {
  return `(borough='${bbl.borough}' OR upper(borough)='${bbl.boroughName.toUpperCase()}' OR upper(borough)='${boroughAbbrev(bbl.borough)}') AND ${blockLotWhere(bbl)}`;
}

function blockLotWhere(bbl) {
  const block5 = String(bbl.block).padStart(5, "0");
  const lot4 = String(bbl.lot).padStart(4, "0");
  const lot5 = String(bbl.lot).padStart(5, "0");
  return `(block='${bbl.block}' OR block='${block5}') AND (lot='${bbl.lot}' OR lot='${lot4}' OR lot='${lot5}')`;
}

function boroughAbbrev(borough) {
  return { 1: "MN", 2: "BX", 3: "BK", 4: "QN", 5: "SI" }[borough];
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
  const supplemental = brief.supplemental_records || {};
  els.dobJobsCount.textContent = String((supplemental.dob_now_jobs || []).length);
  els.coCount.textContent = String((supplemental.dob_co || []).length + (supplemental.dob_now_co || []).length);
  els.violationsCount.textContent = String((supplemental.dob_violations || []).length + (supplemental.dob_ecb_violations || []).length);
  els.plutoCount.textContent = String((supplemental.pluto || []).length);

  renderList(els.signals, brief.signals);
  renderList(els.nextSteps, brief.next_steps);
  renderList(els.methodology, brief.methodology_notes || []);
  renderLinks(els.externalLinks, brief.external_links || {}, "");
  els.assessmentRecord.textContent = JSON.stringify(brief.assessment_records[0] || {}, null, 2);
  els.salesRecords.textContent = JSON.stringify(brief.sales_records, null, 2);
  els.supplementalRecords.textContent = JSON.stringify(supplemental, null, 2);

  renderLinks(els.sources, brief.sources, " source");
}

function renderLinks(target, links, suffix) {
  target.innerHTML = "";
  Object.entries(links).forEach(([label, url]) => {
    const li = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = `${title(label)}${suffix}`;
    li.append(anchor);
    target.append(li);
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
