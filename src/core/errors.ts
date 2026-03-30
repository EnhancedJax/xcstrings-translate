export class XcstringsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "XcstringsError";
  }
}

export function assertNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new XcstringsError("INVALID_ARGUMENT", `${fieldName} must be non-empty.`);
  }
  return normalized;
}

export function assertPositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new XcstringsError("INVALID_ARGUMENT", `${fieldName} must be a positive integer.`);
  }
  return value;
}
