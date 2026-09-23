import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, "../catalog/recommended-skills.json");

test("recommended catalog contains grill-me source metadata", async () => {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const grillMe = catalog.skills.find((skill) => skill.name === "grill-me");

  assert.ok(grillMe);
  assert.equal(grillMe.type, "skill");
  assert.equal(grillMe.repository, "https://github.com/mattpocock/skills.git");
  assert.equal(grillMe.path, "skills/productivity/grill-me");
  assert.equal(grillMe.ref, "c55ee46073ed923f86ce59a5eb3b6d895095d1b7");
  assert.deepEqual(grillMe.clients, ["codex", "claude-code"]);
  assert.ok(grillMe.aliases.includes("grill me"));
});
