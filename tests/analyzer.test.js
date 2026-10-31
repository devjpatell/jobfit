import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findSkills, jobSkills, sectionize, requiredYears, resumeYears, resumeChecks, similarity, analyze } from "../src/analyzer.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const RESUME = read("../examples/sample-resume.txt");
const JOB = read("../examples/sample-job.txt");
const TODAY = new Date(2026, 9, 30); // fixed date so "Present" is stable

test("symbols in skill names match exactly", () => {
  const s = findSkills("Built APIs in C#, C++ and .NET; also Node.js and Next.js");
  for (const k of ["C#", "C++", ".NET", "Node.js", "Next.js"]) assert.ok(s.has(k), k);
  assert.ok(!s.has("C"), "plain C should not match inside C# or C++");
});

test("Java does not match JavaScript, SQL does not match inside MySQL", () => {
  const s = findSkills("JavaScript and MySQL");
  assert.ok(s.has("JavaScript") && s.has("MySQL"));
  assert.ok(!s.has("Java") && !s.has("SQL"));
});

test("everyday words only count with tech capitalization", () => {
  assert.ok(!findSkills("I spent the rest of spring learning to excel at go-karts").has("REST APIs"));
  assert.ok(!findSkills("excel at teamwork").has("Excel"));
  assert.ok(findSkills("Designed REST APIs").has("REST APIs"));
  assert.ok(findSkills("Built services in Go").has("Go"));
  assert.ok(!findSkills("Let's go").has("Go"));
});

test("aliases map to one canonical skill", () => {
  const s = findSkills("Deployed on k8s with Postgres and sklearn models");
  assert.ok(s.has("Kubernetes") && s.has("PostgreSQL") && s.has("scikit-learn"));
});

test("sections: requirements vs nice to have", () => {
  const tags = Object.fromEntries(sectionize(JOB).filter((x) => x.line).map((x) => [x.line, x.tag]));
  assert.equal(tags["- Experience with Docker and Kubernetes"], "required");
  assert.equal(tags["- Terraform"], "preferred");
  const js = jobSkills(JOB);
  assert.ok(js.get("Kubernetes").weight > js.get("Terraform").weight);
});

test("required years", () => {
  assert.equal(requiredYears("2+ years of experience"), 2);
  assert.equal(requiredYears("3-5 years building APIs; minimum of 4 years"), 3);
  assert.equal(requiredYears("no number here"), null);
});

test("resume years merge overlapping ranges", () => {
  const r = resumeYears("Jan 2020 – Dec 2021\nJun 2021 - Dec 2022", TODAY);
  assert.equal(r.years, 3); // Jan 2020 .. Dec 2022 = 36 months
  assert.equal(resumeYears("2023 - Present", TODAY).years >= 3, true);
});

test("checks catch weak phrases and count quantified bullets", () => {
  const checks = resumeChecks(RESUME);
  const weak = checks.find((c) => c.title.startsWith("Weak phrases"));
  assert.ok(weak && !weak.ok && weak.title.includes("responsible for"));
  assert.ok(checks.some((c) => /% of bullets include a number/.test(c.title)));
});

test("similarity is 1 for identical text and 0 for unrelated", () => {
  assert.ok(Math.abs(similarity("python docker kubernetes", "python docker kubernetes") - 1) < 1e-9);
  assert.equal(similarity("python docker", "watercolor painting"), 0);
});

test("end to end on the sample files", () => {
  const r = analyze(RESUME, JOB, TODAY);
  const missing = r.missing.map((m) => m.name);
  const matched = r.matched.map((m) => m.name);
  assert.ok(missing.includes("Kubernetes") && missing.includes("Kafka"));
  assert.ok(matched.includes("Python") && matched.includes("PostgreSQL") && matched.includes("Docker"));
  assert.ok(missing.indexOf("Kubernetes") < missing.indexOf("Kafka"), "required skills are listed first");
  assert.equal(r.experience.required, 2);
  assert.ok(r.experience.meets);
  assert.ok(r.score > 30 && r.score < 95, `score ${r.score}`);
});
