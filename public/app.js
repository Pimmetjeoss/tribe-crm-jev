const $ = (selector) => document.querySelector(selector);
const textArea = $("#leadText");
const results = $("#results");
const status = $("#status");
const notice = $("#notice");
let meta = [];
let groups = [];
let timer;
let inFlight = false;
let pendingText = "";
let previousAnswers = {};
let budget;

const labels = {
  sales: "sales", support: "support", supplier: "leverancier", partnership: "partnerschap", other: "overig",
  new_lead: "nieuwe lead", existing_customer: "bestaande klant", partner_or_supplier: "partner / leverancier", unknown: "onbekend",
  email: "e-mail", phone: "telefonisch", meeting: "afspraak / demo", unspecified: "niet opgegeven",
  create_opportunity: "opportunity maken", sales_follow_up: "sales opvolgen", support_route: "naar support", human_review: "menselijke controle", no_action: "geen actie",
};

init();

async function init() {
  try {
    const response = await fetch("/api/meta");
    const data = await response.json();
    meta = data.questions;
    groups = data.groups;
    budget = data.budget;
    renderSkeleton();
    renderBudget();
    if (!data.configured) {
      showNotice("TYPESAFE_API_KEY ontbreekt op de server. Voeg hem aan .env toe en herstart de demo.");
      setStatus("configuratie nodig", "error");
      return;
    }
    scheduleJudge();
  } catch (error) {
    showNotice(String(error));
    setStatus("offline", "error");
  }
}

textArea.addEventListener("input", scheduleJudge);
document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
  textArea.value = button.dataset.preset;
  scheduleJudge();
}));

function scheduleJudge() {
  clearTimeout(timer);
  pendingText = textArea.value.trim();
  if (!pendingText || budget?.exhausted) return;
  if (inFlight) {
    setStatus("Jev beoordeelt · nieuwste tekst staat klaar", "asking");
    return;
  }
  setStatus("wacht op typen…", "waiting");
  timer = setTimeout(judgeLatest, 80);
}

async function judgeLatest() {
  if (inFlight || !pendingText || budget?.exhausted) return;
  const judgedText = pendingText;
  pendingText = "";
  inFlight = true;
  setStatus("Jev beoordeelt…", "asking");
  const started = performance.now();
  try {
    const response = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: judgedText }),
    });
    const data = await readJson(response);
    if (!response.ok) throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), { budget: data?.budget });
    budget = data.budget;
    renderAnswers(data.answers);
    $("#model").textContent = `model ${data.model}`;
    $("#usage").textContent = `${data.usage.input_tokens}→${data.usage.output_tokens} tokens`;
    renderBudget();
    setStatus(`16 oordelen · ${Math.round(performance.now() - started)} ms`, "ok");
    notice.classList.add("hidden");
  } catch (error) {
    if (error.budget) budget = error.budget;
    renderBudget();
    showNotice(error.message);
    setStatus(budget?.exhausted ? "budget spent" : "fout", "error");
  } finally {
    inFlight = false;
    // While this call was running the user may have typed further. Keep the
    // completed result visible and immediately judge only the newest text.
    if (pendingText && pendingText !== judgedText && !budget?.exhausted) {
      timer = setTimeout(judgeLatest, 0);
    }
  }
}

function renderSkeleton() {
  results.innerHTML = groups.map((group) => `
    <section class="group">
      <div class="group-title"><h2>${escapeHtml(group.title)}</h2><span>${escapeHtml(group.blurb)}</span></div>
      <div class="cards">${meta.filter((item) => item.group === group.id).map((item) => card(item)).join("")}</div>
    </section>`).join("");
}

function card(item) {
  return `<article class="judgment" data-id="${item.id}">
    <div class="judgment-head"><h3>${escapeHtml(item.label)}</h3><strong class="answer">—</strong></div>
    <div class="track"><span></span></div>
    <p class="detail">wacht op Jev</p>
  </article>`;
}

function renderAnswers(answers) {
  for (const item of meta) {
    const answer = answers[item.id];
    const element = document.querySelector(`[data-id="${item.id}"]`);
    if (!answer || !element) continue;
    const view = answerView(answer, item);
    element.querySelector(".answer").textContent = view.value;
    element.querySelector(".track span").style.width = `${view.percent}%`;
    element.querySelector(".detail").textContent = view.detail;
    if (JSON.stringify(previousAnswers[item.id]) !== JSON.stringify(answer)) {
      element.classList.remove("flash");
      void element.offsetWidth;
      element.classList.add("flash");
    }
  }
  previousAnswers = answers;
}

function answerView(answer, item) {
  if (answer.type === "noul") {
    const pct = Math.round(answer.noul * 100);
    return { value: answer.noul >= 0.5 ? "ja" : "nee", percent: pct, detail: `${pct}% kans op ja` };
  }
  if (answer.type === "choice") {
    const confidence = Math.round(answer.confidence * 100);
    return { value: labels[answer.choice] || answer.choice.replaceAll("_", " "), percent: confidence, detail: `${confidence}% confidence` };
  }
  const max = item.max || 3;
  const percent = Math.round((answer.score / max) * 100);
  return { value: `${answer.score.toFixed(1)} / ${max}`, percent, detail: `${Math.round(answer.confidence * 100)}% confidence` };
}

function renderBudget() {
  if (!budget) return;
  $("#budget").textContent = `demo budget ${budget.calls}/${budget.maxCalls} calls · ${budget.inputTokens.toLocaleString("nl-NL")} input tokens`;
  if (budget.exhausted) showNotice(`Demo budget spent. ${budget.maxCalls} TypeSafe-calls zijn gebruikt; de laatste oordelen blijven zichtbaar.`);
}

function setStatus(text, state) {
  status.className = `status ${state}`;
  status.innerHTML = `<span></span>${escapeHtml(text)}`;
}

function showNotice(message) {
  notice.textContent = message;
  notice.classList.remove("hidden");
}

async function readJson(response) {
  const body = await response.text();
  try { return JSON.parse(body); } catch { return null; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}
