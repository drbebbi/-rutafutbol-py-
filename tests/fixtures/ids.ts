import { identifierConstant } from "../../src/domain/identifiers/identifiers";

/**
 * Deterministic identifiers for tests.
 *
 * Never random: a fixture that changes its ids between runs cannot be used to
 * assert that derived keys and content hashes are stable.
 */
export function testUuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export function id<Tag extends string>(value: string) {
  return identifierConstant<Tag>(value);
}
