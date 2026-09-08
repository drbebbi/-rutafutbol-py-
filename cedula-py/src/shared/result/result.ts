/**
 * Minimal, dependency-free `Result` type.
 *
 * The pure layers (domain, rules, case-engine) never throw for expected
 * outcomes - they return `Result`. Throwing is reserved for programmer errors
 * that indicate a broken invariant *inside* the process, never for business
 * outcomes such as NEEDS_USER_INFORMATION (Decision: normal outcomes are not
 * errors).
 */
export type Ok<T> = Readonly<{ ok: true; value: T }>;
export type Err<E> = Readonly<{ ok: false; error: E }>;
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Collects a list of results, failing on the first error (deterministic order). */
export function collectResults<T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Unwraps a result or throws. Only for test code and for genuinely
 * unrecoverable programmer errors - never as business control flow.
 */
export function unwrapOrThrow<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`unwrapOrThrow on Err: ${JSON.stringify(result.error)}`);
}
