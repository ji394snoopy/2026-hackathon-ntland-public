// Bedrock's strict-JSON tool call sometimes returns `distanceValue` (schema type "number" in
// tool.ts) with floating-point precision artifacts, e.g. 600.0000000000001 instead of 600 — the
// model's own intent is always a whole number of meters (see tool.ts's field description), so
// this resolves it locally rather than trusting the raw float, the same way applyQuantityDefaults
// resolves quantity locally instead of trusting the model. Walks the whole content tree rather
// than enumerating known fields, since distanceValue appears under multiple categories.

function roundDistanceValues<T>(content: T): T {
  walk(content);
  return content;
}

function walk(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === "distanceValue" && typeof obj[key] === "number") {
      obj[key] = Math.round(obj[key] as number);
    } else {
      walk(obj[key]);
    }
  }
}

export { roundDistanceValues };
