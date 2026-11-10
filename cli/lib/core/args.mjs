// Minimal argv parser: positionals, --flag, --key value, --key=value.
export function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { out[camel(a.slice(2, eq))] = a.slice(eq + 1); continue; }
    const key = camel(a.slice(2));
    const next = argv[i + 1];
    if (booleans.includes(key) || next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
