const $ = (selector) => document.querySelector(selector);
const state = { config: null, busy: false, last: null, sourceId: `crm-dashboard-${crypto.randomUUID()}` };

init();

async function init() {
  bindEvents();
  $("#sourceLabel").textContent = `Jev haalt de CRM-gegevens zelf uit de tekst · test ${state.sourceId.slice(-8)}`;
  try {
    state.config = await api("/api/crm/status");
    $("#tribeConfig").textContent = state.config.tribeConfigured ? "ingesteld" : "ontbreekt";
    $("#typeSafeConfig").textContent = state.config.typeSafeConfigured ? "ingesteld" : "ontbreekt";
    $("#writeConfig").textContent = state.config.writesEnabled ? "actief" : "veilig uit";
    $("#writeConfig").className = state.config.writesEnabled ? "warning-text" : "safe-text";
    $("#applyButton").disabled = !state.config.writesEnabled;
    setStatus(state.config.tribeConfigured ? "klaar voor controle" : "configuratie nodig", state.config.tribeConfigured ? "ok" : "error");
    if (!state.config.tribeConfigured) showNotice("Vul TRIBE_CLIENT_ID en TRIBE_CLIENT_SECRET in .env in en herstart de server.");
  } catch (error) {
    fail(error);
  }
}

function bindEvents() {
  $("#leadForm").addEventListener("submit", (event) => { event.preventDefault(); run(false); });
  $("#applyButton").addEventListener("click", () => run(true));
  $("#verifyButton").addEventListener("click", verify);
  $("#connectButton").addEventListener("click", testConnection);
}

async function testConnection() {
  await task("verbinding testen…", async () => {
    const data = await api("/api/crm/connectivity", { method: "POST" });
    showNotice(`Verbinding gelukt in ${data.latencyMs} ms. ${data.phaseCount} opportunity-fasen gevonden${data.qualificationPhase ? "; Qualification is beschikbaar." : "; let op: Qualification ontbreekt."}`, "success");
  });
}

async function run(apply) {
  const lead = formLead();
  await task(apply ? "schrijven en teruglezen…" : "dry-run maken…", async () => {
    const data = await api("/api/crm/run", {
      method: "POST",
      body: JSON.stringify({ lead, apply }),
    });
    state.last = data;
    render(data);
    showNotice(apply ? "Write voltooid. De resultaten hieronder zijn daarna opnieuw uit Tribe gelezen." : "Dry-run voltooid. Er is niets naar Tribe geschreven.", "success");
  });
}

async function verify() {
  const sourceId = state.sourceId;
  await task("CRM teruglezen…", async () => {
    const data = await api("/api/crm/verify", { method: "POST", body: JSON.stringify({ sourceId }) });
    state.last = { ...(state.last || {}), records: data.records, ranAt: data.checkedAt };
    render(state.last);
    showNotice("CRM-controle voltooid. Er is niets gewijzigd.", "success");
  });
}

function formLead() {
  return {
    sourceId: state.sourceId,
    message: $("#message").value.trim(),
  };
}

function render(data) {
  const result = data.result;
  const records = data.records || [];
  const expectedKinds = result ? expectedRecordKinds(result.actions || []) : new Set(records.map((record) => record.kind));
  const relevantRecords = records.filter((record) => expectedKinds.has(record.kind));
  const linkedCount = result?.actions?.filter((action) => action.type === "link_existing").length || 0;
  $("#modeValue").textContent = result?.mode || "alleen lezen";
  $("#actionCount").textContent = result?.actions?.length ?? 0;
  $("#foundCount").textContent = `${relevantRecords.filter((item) => item.status === "found").length + linkedCount} / ${relevantRecords.length + linkedCount}`;
  $("#runMeta").textContent = `${new Date(data.ranAt || Date.now()).toLocaleString("nl-NL")}${data.latencyMs ? ` · ${data.latencyMs} ms` : ""}`;
  const plannedCall = result?.actions?.find((action) => action.type === "suggest_call");
  const extracted = [
    ["Persoon", result?.decisions?.extractedPersonName],
    ["Organisatie", result?.decisions?.extractedOrganizationName],
    ["E-mail", result?.facts?.emails?.[0]],
    ["Telefoon", result?.facts?.phoneNumbers?.[0]],
    ["Belafspraak", result?.decisions?.shouldCreateCall == null ? null : `${Math.round(result.decisions.shouldCreateCall * 100)}% kans`],
    ["Afspraakdatum", plannedCall?.startDate ? new Date(plannedCall.startDate).toLocaleString("nl-NL") : null],
  ];
  $("#extracted").innerHTML = extracted.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value || "niet gevonden")}</strong></div>`).join("");
  $("#actions").innerHTML = result?.actions?.length
    ? result.actions.map((action, index) => `<article class="action-row"><span>${index + 1}</span><div><strong>${escapeHtml(actionLabel(action.type))}</strong><pre>${escapeHtml(JSON.stringify(action.body || action, null, 2))}</pre></div></article>`).join("")
    : '<div class="empty-state">Geen write-plan in deze leescontrole.</div>';
  $("#records").innerHTML = relevantRecords.length ? relevantRecords.map((record) => `<article class="record ${record.status}">
    <span class="record-dot"></span><div><strong>${escapeHtml(recordLabel(record.kind))}</strong><code>${escapeHtml(record.importId)}</code></div>
    <span class="record-status">${record.status === "found" ? `gevonden · ${escapeHtml(record.matches[0]?.ID || "")}${record.matches[0]?.Notes?.length ? " · bericht opgeslagen" : ""}` : record.status === "conflict" ? `${record.matches.length} matches` : "niet gevonden"}</span>
  </article>`).join("") : '<div class="empty-state">Voor deze beoordeling zijn geen CRM-writes gepland.</div>';
  $("#rawJson").textContent = JSON.stringify(data, null, 2);
}

function expectedRecordKinds(actions) {
  const kinds = new Set();
  for (const action of actions) {
    if (action.type === "create_person") kinds.add("person");
    if (action.type === "create_organization") kinds.add("organization");
    if (action.type === "suggest_contact_link") kinds.add("contact");
    if (action.type === "suggest_lead_relationship") kinds.add("lead");
    if (action.type === "suggest_opportunity") kinds.add("opportunity");
    if (action.type === "suggest_call") kinds.add("call");
  }
  return kinds;
}

async function task(label, work) {
  if (state.busy) return;
  state.busy = true;
  setStatus(label, "asking");
  document.querySelectorAll("button").forEach((button) => button.disabled = true);
  try {
    await work();
    setStatus("controle gereed", "ok");
  } catch (error) {
    fail(error);
  } finally {
    state.busy = false;
    document.querySelectorAll("button").forEach((button) => button.disabled = false);
    if (!state.config?.writesEnabled) $("#applyButton").disabled = true;
  }
}

function setStatus(text, kind) {
  const element = $("#systemStatus");
  element.className = `status ${kind}`;
  element.innerHTML = `<span></span>${escapeHtml(text)}`;
}

function showNotice(message, kind = "warning") {
  const element = $("#crmNotice");
  element.textContent = message;
  element.className = `notice ${kind}`;
}

function fail(error) {
  showNotice(error.message || String(error));
  setStatus("fout", "error");
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.text();
  let data;
  try { data = body ? JSON.parse(body) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function actionLabel(type) {
  return ({ create_person: "Persoon aanmaken", create_organization: "Organisatie aanmaken", link_existing: "Bestaand record koppelen", suggest_contact_link: "Contactrelatie", suggest_lead_relationship: "Leadrelatie", suggest_opportunity: "Opportunity", suggest_call: "Belafspraak", review: "Menselijke controle" })[type] || type;
}

function recordLabel(kind) {
  return ({ person: "Persoon", organization: "Organisatie", contact: "Contactrelatie", lead: "Leadrelatie", opportunity: "Opportunity", call: "Belafspraak" })[kind] || kind;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char]);
}
