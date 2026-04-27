const PAGE = document.body.dataset.page;
const dataUrl = "./data/dashboard.json";

function fmtDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pillClass(value) {
  return String(value ?? "").toLowerCase().replaceAll(" ", "_");
}

function humanize(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function pointHref(point) {
  const value = typeof point === "string" ? point : point.value;
  return value.includes("@") ? `mailto:${value}` : value;
}

function pointLabel(point) {
  if (typeof point === "string") return point;
  return point.label || point.value;
}

function renderReachPoints(points) {
  if (!points?.length) return "None yet";
  return points
    .map((point) => `<a href="${pointHref(point)}" target="_blank" rel="noreferrer">${escapeHtml(pointLabel(point))}</a>`)
    .join("<br>");
}

function setMeta(data) {
  const sync = document.querySelector("[data-sync-meta]");
  if (!sync) return;
  const sheetLink = data.sheet?.url ? ` · <a href="${data.sheet.url}" target="_blank" rel="noreferrer">Sheets mirror</a>` : "";
  sync.innerHTML = `Last export ${fmtDate(data.generatedAt)}${sheetLink}`;
}

function renderStats(data) {
  const host = document.querySelector("[data-stats]");
  if (!host) return;
  const stats = [
    ["Tracked companies", data.summary.companies],
    ["Direct contactable", data.summary.directContacts],
    ["Active jobs", data.summary.activeJobs],
    ["Sent outreach", data.summary.sentEmails],
    ["Applications", data.summary.applications],
    ["Talking", data.summary.talking],
  ];
  host.innerHTML = stats
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </article>
      `,
    )
    .join("");
}

function renderOverview(data) {
  const host = document.querySelector("[data-overview]");
  if (!host) return;
  const topCompanies = data.companies.slice(0, 6);
  const topJobs = data.activeJobs.slice(0, 5);
  const latestOutreach = data.outreach.slice(0, 5);
  host.innerHTML = `
    <section class="overview-grid">
      <article class="panel">
        <div class="section-head">
          <h2>Top companies</h2>
          <a href="./companies.html">See all</a>
        </div>
        <div class="card-list">
          ${topCompanies
            .map(
              (company) => `
              <div class="item-card">
                <div class="item-top">
                  <div>
                    <h3>${escapeHtml(company.name)}</h3>
                    <p>${escapeHtml(company.stage || "No stage")} · ${escapeHtml(company.location || "Berlin")}</p>
                  </div>
                  <span class="pill ${pillClass(company.category)}">${escapeHtml(humanize(company.category))}</span>
                </div>
                <p>${escapeHtml(company.recommendationReason || company.description || "")}</p>
              </div>
            `,
            )
            .join("")}
        </div>
      </article>
      <article class="panel">
        <div class="section-head">
          <h2>Active jobs</h2>
          <a href="./jobs.html">See all</a>
        </div>
        <div class="card-list">
          ${topJobs
            .map(
              (job) => `
              <div class="item-card">
                <div class="item-top">
                  <div>
                    <h3>${escapeHtml(job.title)}</h3>
                    <p>${escapeHtml(job.companyName)}</p>
                  </div>
                  <span class="pill ${pillClass(job.category)}">${escapeHtml(humanize(job.category))}</span>
                </div>
                <p class="muted">${escapeHtml(job.location || "Berlin")} · ${escapeHtml(humanize(job.source || "source"))}</p>
              </div>
            `,
            )
            .join("")}
        </div>
      </article>
      <article class="panel">
        <div class="section-head">
          <h2>Recent outreach</h2>
          <a href="./outreach.html">See all</a>
        </div>
        <div class="card-list">
          ${latestOutreach
            .map(
              (item) => `
              <div class="item-card">
                <div class="item-top">
                  <div>
                    <h3>${escapeHtml(item.companyName || "Unknown company")}</h3>
                    <p>${escapeHtml(item.jobTitle || humanize(item.type))}</p>
                  </div>
                  <span class="pill ${pillClass(item.type)}">${escapeHtml(humanize(item.type))}</span>
                </div>
                <p>${escapeHtml(item.note || item.target || "")}</p>
                <p class="muted">${escapeHtml(fmtDate(item.timestamp))}</p>
              </div>
            `,
            )
            .join("")}
        </div>
      </article>
    </section>
  `;
}

function attachFilters(items, render) {
  const search = document.querySelector("[data-search]");
  const filter = document.querySelector("[data-filter]");
  const refresh = () => {
    const needle = (search?.value || "").trim().toLowerCase();
    const tag = filter?.value || "all";
    const filtered = items.filter((item) => {
      const haystack = JSON.stringify(item).toLowerCase();
      const searchMatch = !needle || haystack.includes(needle);
      const tagMatch = tag === "all" || Object.values(item).some((value) => String(value).toLowerCase() === tag);
      return searchMatch && tagMatch;
    });
    render(filtered);
  };
  search?.addEventListener("input", refresh);
  filter?.addEventListener("change", refresh);
  refresh();
}

function renderCompanies(data) {
  const host = document.querySelector("[data-list]");
  const render = (companies) => {
    host.innerHTML = companies.length
      ? companies
          .map(
            (company) => `
          <article class="item-card">
            <div class="item-top">
              <div>
                <h3>${escapeHtml(company.name)}</h3>
                <p>${escapeHtml(company.stage || "No stage")} · ${escapeHtml(company.location || "Berlin")}</p>
              </div>
              <div class="item-meta">
                <span class="pill ${pillClass(company.priority)}">${escapeHtml(humanize(company.priority))}</span>
                <span class="pill ${pillClass(company.category)}">${escapeHtml(humanize(company.category))}</span>
              </div>
            </div>
            <p>${escapeHtml(company.recommendationReason || company.description || "")}</p>
            <div class="subgrid">
              <div class="mini"><strong>Best contact</strong>${company.bestContact ? `<a href="${company.bestContact.includes("@") ? `mailto:${company.bestContact}` : company.bestContact}" target="_blank" rel="noreferrer">${escapeHtml(company.bestContact.includes("@") ? company.bestContact : "Open")}</a>` : "None yet"}</div>
              <div class="mini"><strong>Reach points</strong>${renderReachPoints(company.reachPoints)}</div>
              <div class="mini"><strong>Route</strong>${escapeHtml(humanize(company.route))}</div>
              <div class="mini"><strong>Pitch angle</strong>${escapeHtml(company.pitchAngle || "Not set")}</div>
            </div>
          </article>
        `,
          )
          .join("")
      : '<div class="empty">No companies match this filter.</div>';
  };
  attachFilters(data.companies, render);
}

function renderJobs(data) {
  const host = document.querySelector("[data-list]");
  const render = (jobs) => {
    host.innerHTML = jobs.length
      ? jobs
          .map(
            (job) => `
          <article class="item-card">
            <div class="item-top">
              <div>
                <h3>${escapeHtml(job.title)}</h3>
                <p>${escapeHtml(job.companyName)} · ${escapeHtml(job.location || "Berlin")}</p>
              </div>
              <div class="item-meta">
                <span class="pill ${pillClass(job.category)}">${escapeHtml(humanize(job.category))}</span>
                <span class="pill ${pillClass(job.pipelineStatus)}">${escapeHtml(humanize(job.pipelineStatus))}</span>
              </div>
            </div>
            <div class="subgrid">
              <div class="mini"><strong>Route</strong>${escapeHtml(humanize(job.route))}</div>
              <div class="mini"><strong>Source</strong>${escapeHtml(humanize(job.source || job.sourceType))}</div>
              <div class="mini"><strong>Best contact</strong>${job.bestContact ? `<a href="${job.bestContact.includes("@") ? `mailto:${job.bestContact}` : job.bestContact}" target="_blank" rel="noreferrer">${escapeHtml(job.bestContact.includes("@") ? job.bestContact : "Open")}</a>` : "None yet"}</div>
              <div class="mini"><strong>Links</strong><a href="${job.url}" target="_blank" rel="noreferrer">Listing</a><br><a href="${job.applyUrl}" target="_blank" rel="noreferrer">Apply</a></div>
            </div>
          </article>
        `,
          )
          .join("")
      : '<div class="empty">No jobs match this filter.</div>';
  };
  attachFilters(data.activeJobs, render);
}

function renderOutreach(data) {
  const host = document.querySelector("[data-list]");
  const render = (items) => {
    host.innerHTML = items.length
      ? items
          .map(
            (item) => `
          <article class="item-card">
            <div class="item-top">
              <div>
                <h3>${escapeHtml(item.companyName || "Unknown company")}</h3>
                <p>${escapeHtml(item.jobTitle || humanize(item.type))}</p>
              </div>
              <div class="item-meta">
                <span class="pill ${pillClass(item.type)}">${escapeHtml(humanize(item.type))}</span>
                <span class="pill ${pillClass(item.status)}">${escapeHtml(humanize(item.status))}</span>
              </div>
            </div>
            <p>${escapeHtml(item.note || item.target || "")}</p>
            <div class="subgrid">
              <div class="mini"><strong>Route</strong>${escapeHtml(humanize(item.route))}</div>
              <div class="mini"><strong>Target</strong>${item.target ? `<a href="${item.target.startsWith("http") ? item.target : `mailto:${item.target}`}" target="_blank" rel="noreferrer">${escapeHtml(item.target)}</a>` : "None"}</div>
              <div class="mini"><strong>When</strong>${escapeHtml(fmtDate(item.timestamp))}</div>
            </div>
          </article>
        `,
          )
          .join("")
      : '<div class="empty">No outreach records yet.</div>';
  };
  attachFilters(data.outreach, render);
}

function renderPipeline(data) {
  const host = document.querySelector("[data-list]");
  const render = (items) => {
    if (!items.length) {
      host.innerHTML = '<div class="empty">No pipeline records yet.</div>';
      return;
    }
    const buckets = ["talking", "applied", "contacted", "rejected"];
    host.innerHTML = `
      <section class="bucket-grid">
        ${buckets
          .map((stage) => {
            const stageItems = items.filter((item) => item.stage === stage);
            return `
              <article class="panel">
                <div class="section-head">
                  <h2>${escapeHtml(humanize(stage))}</h2>
                  <span class="pill ${pillClass(stage)}">${stageItems.length}</span>
                </div>
                <div class="card-list">
                  ${
                    stageItems.length
                      ? stageItems
                          .map(
                            (item) => `
                            <div class="item-card">
                              <h4>${escapeHtml(item.companyName)}</h4>
                              <p>${escapeHtml(item.jobTitle || "")}</p>
                              <p class="muted">${escapeHtml(item.detail || "")}</p>
                              <p class="muted">${escapeHtml(fmtDate(item.timestamp))}</p>
                            </div>
                          `,
                          )
                          .join("")
                      : '<div class="empty">None yet.</div>'
                  }
                </div>
              </article>
            `;
          })
          .join("")}
      </section>
    `;
  };
  attachFilters(data.pipeline, render);
}

async function main() {
  const response = await fetch(dataUrl, { cache: "no-store" });
  const data = await response.json();
  setMeta(data);
  renderStats(data);

  if (PAGE === "overview") renderOverview(data);
  if (PAGE === "companies") renderCompanies(data);
  if (PAGE === "jobs") renderJobs(data);
  if (PAGE === "outreach") renderOutreach(data);
  if (PAGE === "pipeline") renderPipeline(data);
}

main().catch((error) => {
  const host = document.querySelector("[data-error]");
  if (host) {
    host.innerHTML = `<div class="empty">Dashboard data failed to load: ${escapeHtml(error.message || String(error))}</div>`;
  }
});
