"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const destination = path.join(root, "src/renderer/vendor/leaflet");
fs.mkdirSync(destination, { recursive: true });
for (const filename of ["leaflet.js", "leaflet.css", "LICENSE"]) {
  const origin =
    filename === "LICENSE"
      ? path.join(root, "node_modules/leaflet/LICENSE")
      : path.join(root, "node_modules/leaflet/dist", filename);
  fs.copyFileSync(origin, path.join(destination, filename));
}
fs.cpSync(
  path.join(root, "node_modules/leaflet/dist/images"),
  path.join(destination, "images"),
  { recursive: true },
);
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"),
    "-i",
    "src/renderer/tailwind.input.css",
    "-o",
    "src/renderer/tailwind.css",
    "--minify",
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
