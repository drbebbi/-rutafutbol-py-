/**
 * Nominal typing helper.
 *
 * A branded type is structurally a `string` (or `number`) at runtime but is not
 * assignable from a plain `string` at compile time. Every domain identifier in
 * Cedula PY is branded so that a `ProcedureId` can never be silently passed
 * where a `DocumentTypeId` is expected.
 */
declare const brandSymbol: unique symbol;

export type Brand<Base, Tag extends string> = Base & { readonly [brandSymbol]: Tag };

/**
 * Unsafe cast used *only* by validated constructors (`makeX`) and by fixture
 * builders that have already validated their input. Application code must go
 * through the validating constructor.
 */
export function unsafeBrand<Base, Tag extends string>(value: Base): Brand<Base, Tag> {
  return value as Brand<Base, Tag>;
}

/** Removes the brand, e.g. for serialization. */
export function unbrand<Base, Tag extends string>(value: Brand<Base, Tag>): Base {
  return value as Base;
}
