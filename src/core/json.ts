const JSON_INDENT = "  ";

export function stringifyAppleJson(value: unknown, depth = 0): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const indent = JSON_INDENT.repeat(depth);
  const childIndent = JSON_INDENT.repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const lines = value.map((item) => `${childIndent}${stringifyAppleJson(item, depth + 1)}`);
    return `[` + `\n${lines.join(",\n")}\n${indent}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  if (entries.length === 0) {
    return "{}";
  }

  const lines = entries.map(
    ([key, item]) => `${childIndent}${JSON.stringify(key)} : ${stringifyAppleJson(item, depth + 1)}`,
  );
  return `{` + `\n${lines.join(",\n")}\n${indent}}`;
}
