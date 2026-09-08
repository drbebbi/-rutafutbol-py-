import { err, ok, type Result } from "../../shared/result/result";
import type { BlockingIssue, BlockingIssueCode } from "../../domain/evaluation/issues";
import { blockingIssueCodeForPath, type RuleFactPath } from "../../rules/definitions/fact-paths";
import { compareStrings } from "../canonicalization/ordering";
import { engineInvariantViolation, type EngineError } from "../errors/engine-error";

/**
 * Something that is blocking a decision.
 *
 * Usually an indeterminate fact path, translated through the closed registry.
 * A product policy may also block directly on a code, because its condition
 * language has no fact paths - but it draws that code from the very same
 * closed registry, so there is still no route to a free-text "missing field".
 */
export type BlockingFactPath =
  | Readonly<{ path: RuleFactPath; slotFamily: string }>
  | Readonly<{ issueCode: BlockingIssueCode; slotFamily: string }>;

/**
 * Turns decision-relevant indeterminate fact paths into blocking issues.
 *
 * The translation goes through the closed fact-dependency policy registry.
 * A path with no mapping is an engine invariant violation, not an opportunity
 * to emit a generic "missing field" message.
 */
export function buildBlockingIssues(
  paths: readonly BlockingFactPath[],
): Result<readonly BlockingIssue[], EngineError> {
  const byKey = new Map<string, BlockingIssue>();
  for (const entry of paths) {
    if ("issueCode" in entry) {
      byKey.set(`${entry.issueCode}|${entry.slotFamily}`, {
        code: entry.issueCode,
        blockedSlotFamily: entry.slotFamily,
      });
      continue;
    }
    const code = blockingIssueCodeForPath(entry.path);
    if (code === null) {
      return err(
        engineInvariantViolation(
          "MISSING_BLOCKING_ISSUE_MAPPING",
          `fact path "${entry.path}" became decision-relevant but has no blocking issue code`,
        ),
      );
    }
    byKey.set(`${code}|${entry.slotFamily}`, { code, blockedSlotFamily: entry.slotFamily });
  }
  return ok(
    [...byKey.entries()].sort((a, b) => compareStrings(a[0], b[0])).map(([, issue]) => issue),
  );
}
