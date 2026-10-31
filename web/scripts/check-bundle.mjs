// Checks a production build (docs/UI.md P7, D117): the heavy viewer
// libraries stay out of the entry's static imports, so they load only
// where they are used; no chunk evaluates strings as code; and nothing of
// the mock backend ships.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const graph = JSON.parse(
  readFileSync(join(dist, ".vite", "chunks.json"), "utf8"),
);
const byFile = new Map(graph.map((chunk) => [chunk.file, chunk]));
const failures = [];

// Libraries that must load lazily: three.js, React Three Fiber, vtk.js,
// Plotly and React Flow.
const LAZY =
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(three|@react-three|@kitware\/vtk\.js|plotly\.js[^/]*|react-plotly\.js|@xyflow)\//;
const MOCK =
  /\/src\/mocks\/|node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?msw\//;

for (const entry of graph.filter((chunk) => chunk.isEntry)) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const imported of byFile.get(file)?.imports ?? []) visit(imported);
  };
  visit(entry.file);
  for (const file of seen) {
    const lazy = new Set(
      (byFile.get(file)?.modules ?? [])
        .map((id) => LAZY.exec(id)?.[1])
        .filter(Boolean),
    );
    for (const name of lazy) {
      failures.push(
        `${name} is in ${file}, statically imported by entry ${entry.file}`,
      );
    }
  }
  const bytes = [...seen].reduce(
    (n, file) => n + statSync(join(dist, file)).size,
    0,
  );
  console.log(
    `entry ${entry.file}: ${seen.size} chunks, ${(bytes / 1024).toFixed(0)} KiB`,
  );
}

for (const chunk of graph) {
  if (chunk.modules.some((id) => MOCK.test(id))) {
    failures.push(`${chunk.file} contains the mock backend`);
  }
}

// A strict CSP forbids evaluating strings (D117).
const assets = join(dist, "assets");
for (const file of readdirSync(assets).filter((f) => f.endsWith(".js"))) {
  const text = readFileSync(join(assets, file), "utf8");
  const found = /\bnew Function\s*\(|(?<![\w.$])eval\s*\(/.exec(text);
  if (found) failures.push(`assets/${file} calls ${found[0].trim()}`);
}

if (existsSync(join(dist, "mockServiceWorker.js"))) {
  failures.push("mockServiceWorker.js ships in the production build");
}

if (failures.length) {
  console.error(`Bundle check failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("Bundle check passed.");
