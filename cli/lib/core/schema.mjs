// Validator for the JSON Schema subset used in schemas/*.json:
// type (incl. arrays of types), required, properties, additionalProperties (bool|schema),
// items, enum, const, minimum, maximum, minLength, maxLength, minItems, maxItems, pattern,
// oneOf, anyOf, $ref to "#/$defs/<name>".
import { join } from "node:path";
import { ONEVIDEO_ROOT, readJson } from "./project.mjs";

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const typeMatches = (v, t) => t === typeOf(v) || (t === "number" && typeof v === "number");

export function validate(schema, value, root = schema, path = "$", errors = []) {
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const def = root.$defs?.[name];
    if (!def) { errors.push(`${path}: unresolved $ref ${schema.$ref}`); return errors; }
    return validate(def, value, root, path, errors);
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${path}: expected ${types.join("|")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(", ")} (got ${JSON.stringify(value)})`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be ≤ ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: does not match /${schema.pattern}/`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs ≥ ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: allows ≤ ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, root, `${path}[${i}]`, errors));
  }
  if (typeOf(value) === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: missing "${k}"`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validate(props[k], v, root, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown field "${k}"`);
      else if (typeof schema.additionalProperties === "object") validate(schema.additionalProperties, v, root, `${path}.${k}`, errors);
    }
  }
  for (const key of ["oneOf", "anyOf"]) {
    if (!schema[key]) continue;
    const results = schema[key].map((s) => validate(s, value, root, path, []));
    const ok = results.filter((r) => r.length === 0).length;
    if (key === "oneOf" ? ok !== 1 : ok === 0) {
      const best = results.reduce((a, b) => (b.length < a.length ? b : a));
      errors.push(`${path}: matches ${ok} of ${key} branches${best.length ? `; closest: ${best[0]}` : ""}`);
    }
  }
  return errors;
}

export function loadSchema(name) {
  return readJson(join(ONEVIDEO_ROOT, "schemas", `${name}.schema.json`));
}

export function validateNamed(name, value) {
  return validate(loadSchema(name), value);
}
