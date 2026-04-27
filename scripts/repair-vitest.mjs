import fs from "node:fs";
import path from "node:path";

const distDir = path.join(process.cwd(), "node_modules", "@vitest", "utils", "dist");

const shims = [
  {
    file: "source-map.js",
    body: 'export * from "vite-node/source-map";\n',
  },
  {
    file: "chunk-_commonjsHelpers.js",
    body: `import { inspect as nodeInspect } from "node:util";

function getDefaultExportFromCjs(value) {
  return value && value.__esModule && "default" in value ? value.default : value;
}

function inspect(value, options) {
  return nodeInspect(value, options);
}

function stringify(value) {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return nodeInspect(value);
  }
}

function format(...args) {
  return args.map((arg) => (typeof arg === "string" ? arg : stringify(arg))).join(" ");
}

function objDisplay(value) {
  return inspect(value, { depth: 4, breakLength: 120 });
}

export {
  format as f,
  getDefaultExportFromCjs as g,
  inspect as i,
  objDisplay as o,
  stringify as s,
};
`,
  },
];

for (const shim of shims) {
  const target = path.join(distDir, shim.file);
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, shim.body, "utf8");
  }
}
