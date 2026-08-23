import { createHash } from "node:crypto";

export type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

export function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CANONICAL_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value as readonly CanonicalValue[];
    return `[${items.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: CanonicalValue };
  return `{${Object.keys(record).sort().map((key) => {
    const item = record[key];
    if (item === undefined) throw new Error("CANONICAL_VALUE_UNDEFINED");
    return `${JSON.stringify(key)}:${canonicalJson(item)}`;
  }).join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
