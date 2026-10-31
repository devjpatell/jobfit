import { analyze } from "./src/analyzer.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TAG = { required: ["req", "required"], preferred: ["pref", "nice to have"], neutral: ["", ""] };

function chip(text, cls = "", small = "") {
  return `<span class="chip ${cls}">${esc(text)}${small ? `<small>${esc(small)}</small>` : ""}</span>`;
}

function render(r) {
  $("results").hidden = false;
  $("score").textContent = r.score;
  $("dialBar").style.strokeDashoffset = String(326.7 * (1 - r.score / 100));
  $("dial").setAttribute("aria-label", `Match score ${r.score} out of 100`);

  const reqMissing = r.missing.filter((m) => m.tag === "required").length;
  $("headline").textContent =
    r.matched.length + r.missing.length === 0 ? "No known skills found in this posting."
    : reqMissing === 0 ? "Your resume covers every required skill we found."
    : `${reqMissing} required skill${reqMissing > 1 ? "s" : ""} missing from your resume.`;
  $("breakdown").textContent = `Skills covered: ${r.skillScore}% (weighted, required count most) · Wording overlap: ${r.textScore}%`;

  const e = r.experience;
  $("experience").innerHTML = e.required === null
    ? `<span class="muted">The posting doesn't state a number of years.</span>`
    : `Asks for <b>${e.required}+ years</b>. Your dated roles add up to about <b>${e.found} years</b>` +
      (e.ranges ? "" : " (no date ranges like “Jan 2023 – Present” found)") +
      (e.meets ? "." : ". Internships, research and projects can still count, so mention them.");

  $("missingCount").textContent = r.missing.length ? `(${r.missing.length})` : "";
  $("missing").innerHTML = r.missing.length
    ? r.missing.map((m) => chip(m.name, TAG[m.tag][0], TAG[m.tag][1])).join("")
    : `<p class="muted">Nothing missing.</p>`;

  $("matchedCount").textContent = r.matched.length ? `(${r.matched.length})` : "";
  $("matched").innerHTML = r.matched.length ? r.matched.map((m) => chip(m.name, "ok")).join("") : `<p class="muted">No overlap yet.</p>`;
  $("extraWrap").hidden = !r.extraSkills.length;
  $("extra").innerHTML = r.extraSkills.map((s) => chip(s)).join("");

  $("checks").innerHTML = r.checks.map((c) =>
    `<li class="${c.ok ? "ok" : "fix"}"><span class="icon" aria-hidden="true">${c.ok ? "✓" : "!"}</span>` +
    `<div><b>${esc(c.title)}</b>${c.ok ? "" : `<span class="d">${esc(c.detail)}</span>`}</div></li>`).join("");

  $("kwCard").hidden = !r.keywords.length;
  $("keywords").innerHTML = r.keywords.map((k) => chip(k.term, "", `${k.count}×`)).join("");
  $("results").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function run() {
  const resume = $("resume").value.trim(), job = $("job").value.trim();
  $("status").textContent = "";
  if (!resume || !job) { $("status").textContent = "Paste both your resume and the job posting first."; return; }
  render(analyze(resume, job));
}

async function loadSample() {
  const [r, j] = await Promise.all([fetch("examples/sample-resume.txt"), fetch("examples/sample-job.txt")]);
  $("resume").value = await r.text();
  $("job").value = await j.text();
  run();
}

function readInto(input, target) {
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > 500_000) { $("status").textContent = "That file is too large. Paste the text instead."; return; }
    $(target).value = await f.text();
    input.value = "";
  });
}

$("run").addEventListener("click", run);
$("sample").addEventListener("click", loadSample);
$("clear").addEventListener("click", () => { $("resume").value = ""; $("job").value = ""; $("results").hidden = true; $("status").textContent = ""; });
readInto($("resumeFile"), "resume");
readInto($("jobFile"), "job");
