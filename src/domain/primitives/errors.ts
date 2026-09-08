/** Uniform failure shape for every validating primitive constructor. */
export type PrimitiveError = Readonly<{
  kind: "INVALID_PRIMITIVE";
  primitive: string;
  message: string;
}>;

export function primitiveError(primitive: string, message: string): PrimitiveError {
  return { kind: "INVALID_PRIMITIVE", primitive, message };
}
