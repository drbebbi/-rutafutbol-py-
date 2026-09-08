import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/** Lower-case hex SHA-256 digest. */
export type Sha256Hex = Brand<string, "Sha256Hex">;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function makeSha256Hex(value: string): Result<Sha256Hex, PrimitiveError> {
  if (!SHA256_PATTERN.test(value)) {
    return err(
      primitiveError("Sha256Hex", `expected 64 lower-case hex characters, received "${value}"`),
    );
  }
  return ok(unsafeBrand<string, "Sha256Hex">(value));
}

export function sha256HexConstant(value: string): Sha256Hex {
  return unsafeBrand<string, "Sha256Hex">(value);
}
