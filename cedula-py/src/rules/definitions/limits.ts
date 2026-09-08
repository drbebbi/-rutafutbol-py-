/**
 * Structural limits for rule conditions (MVP).
 *
 * These are not stylistic preferences: an unbounded AST from the database is
 * an availability risk, and a rule nobody can read is a correctness risk.
 */
export const AST_MAX_DEPTH = 12;
export const AST_MAX_NODES = 128;
export const AST_MAX_BOOLEAN_CHILDREN = 32;
