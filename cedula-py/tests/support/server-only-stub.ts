/**
 * `server-only` throws when it is imported outside a React Server Component
 * graph. Vitest aliases it here so server modules can be unit- and
 * integration-tested; the real package still guards the production bundle.
 */
export {};
