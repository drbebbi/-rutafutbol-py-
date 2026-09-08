import { resolve } from "node:path";
import { findBoundaryViolations } from "./lib/boundaries";

/**
 * Merge-blocking architecture gate.
 *
 * Runs the same rules the architecture test suite runs, so a violation fails
 * fast in CI even before the test suite starts.
 */
const root = resolve(import.meta.dirname, "..");
const violations = findBoundaryViolations(root);

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `[${violation.layer}] ${violation.file} imports "${violation.specifier}" - ${violation.reason}`,
    );
  }
  console.error(`\n${violations.length} architecture boundary violation(s).`);
  process.exit(1);
}

console.log("Architecture boundaries: OK");
