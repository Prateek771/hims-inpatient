const fs = require("fs"), path = require("path");
const root = process.argv[2];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!e.isDirectory()) continue; const p = path.join(d, e.name); walk(p); if (e.name === "node_modules") fs.renameSync(p, path.join(d, "nm_")); } }
walk(root);
const server = path.join(root, "server.js");
const hook = `// Hostinger packaging drops every folder named node_modules, so the dependencies ship as nm_; link them back at start-up.
{
  const fs = require("fs");
  const nodePath = require("path");
  const found = [];
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = nodePath.join(dir, entry.name);
      if (entry.name === "nm_") found.push(full);
      scan(full);
    }
  };
  try {
    scan(__dirname);
    for (const dir of found) {
      const target = nodePath.join(nodePath.dirname(dir), "node_modules");
      if (!fs.existsSync(target)) fs.symlinkSync(dir, target, "dir");
    }
  } catch (error) {
    console.error("Could not link nm_ to node_modules; falling back to the CommonJS resolver only:", error?.code ?? error?.message);
  }
}
// Fallback for CommonJS when the links cannot be created.
{
  const Module = require("module");
  const nodePath = require("path");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    try {
      return resolve.call(this, request, parent, ...rest);
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND" || /^[./]/.test(request) || nodePath.isAbsolute(request)) throw error;
      for (let dir = nodePath.dirname(parent?.filename ?? nodePath.join(__dirname, "x")); ; dir = nodePath.dirname(dir)) {
        const found = Module._findPath(request, [nodePath.join(dir, "nm_")]);
        if (found) return found;
        if (nodePath.dirname(dir) === dir) throw error;
      }
    }
  };
}
`;
fs.writeFileSync(server, hook + fs.readFileSync(server, "utf8"));
