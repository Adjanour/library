export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Error Type

export type ErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "VALIDATION"
  | "DATABASE"
  | "IO"
  | "UNAUTHORIZED"
  | "INTERNAL";

export interface AppError<C extends ErrorCode = ErrorCode> {
  code: C;
  message: string;
  cause?: unknown;
}

export function AppError<C extends ErrorCode>(
  code: C,
  message: string,
  cause?: unknown,
): AppError<C> {
  return { code, message, cause };
}

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Wrap a nullable value: null → Err, defined → Ok */
export function fromNullable<T>(
  value: T | null | undefined,
  error: AppError,
): Result<T, AppError> {
  return value != null ? Ok(value) : Err(error);
}

/** Wrap a sync function that might throw */
export function fromTryCatch<T>(fn: () => T): Result<T, AppError> {
  try {
    return Ok(fn());
  } catch (e) {
    return Err(AppError("INTERNAL", String(e), e));
  }
}

/** Wrap an async function that might reject */
export function fromPromise<T>(
  fn: () => Promise<T>,
): Promise<Result<T, AppError>> {
  return fn().then(Ok).catch((e) => Err(AppError("INTERNAL", String(e), e)));
}

/** Transform the value inside a Result */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? Ok(fn(result.value)) : result;
}

/** Chain operations that return Result */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Get the value or a default */
export function unwrapOr<T>(result: Result<T, unknown>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Get the value or throw */
export function unwrap<T>(result: Result<T, never>): T {
  if (!result.ok) throw new Error(String(result.error));
  return result.value;
}

/** Pattern match: provide functions for both cases */
export function match<T, U, E>(
  result: Result<T, E>,
  handlers: { ok: (value: T) => U; err: (error: E) => U },
): U {
  return result.ok ? handlers.ok(result.value) : handlers.err(result.error);
}

export function NotFound(
  entity: string,
  id?: number | string,
): AppError<"NOT_FOUND"> {
  const msg = id !== undefined
    ? `${entity} ${id} not found`
    : `${entity} not found`;
  return AppError("NOT_FOUND", msg);
}

export function DatabaseError(
  query: string,
  cause?: unknown,
): AppError<"DATABASE"> {
  return AppError("DATABASE", `Query failed: ${query}`, cause);
}

export function AlreadyExists(entity: string, detail?: string): AppError {
  return AppError("ALREADY_EXISTS", detail ?? `${entity} already exists`);
}

export function Validation(
  field: string,
  reason: string,
): AppError<"VALIDATION"> {
  return AppError("VALIDATION", `${field}: ${reason}`);
}
