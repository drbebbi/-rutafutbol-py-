import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../shared/serialization/canonical-json";
import { sha256HexConstant, type Sha256Hex } from "../../domain/primitives/hash";

/**
 * Server-side hashing.
 *
 * Uses `node:crypto` for speed; `tests/unit` cross-checks it against the pure
 * implementation in `shared/hashing`, which is what the browser and the pure
 * layers use. If the two ever disagreed, every stored content hash would be
 * meaningless.
 */
export function sha256HexOfUtf8(input: string): Sha256Hex {
  return sha256HexConstant(createHash("sha256").update(input, "utf8").digest("hex"));
}

export function canonicalContentHash(value: unknown): Sha256Hex {
  return sha256HexOfUtf8(canonicalJsonStringify(value));
}
