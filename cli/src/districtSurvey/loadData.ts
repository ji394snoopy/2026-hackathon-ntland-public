import { readFileSync } from "node:fs";

function loadData(
  data?: Record<string, any> | string,
): Record<string, any> | undefined {
  if (data === undefined) return undefined;
  if (typeof data === "string") return JSON.parse(readFileSync(data, "utf-8"));
  return data;
}

export { loadData };
