/**
 * Whether the controlled synthetic-knowledge fixture route may serve at all.
 *
 * Three independent conditions, none of which has a default:
 *
 *  - the build is not a production build;
 *  - the environment is one explicitly named as a test environment;
 *  - synthetic knowledge is switched on by name.
 *
 * The allowlist matters more than it looks. The previous form asked whether
 * the environment was "not PRODUCTION" and defaulted a missing value to LOCAL,
 * so an unset, misspelled or renamed environment - exactly the circumstances
 * in which you want a route serving invented rules switched off - was the
 * circumstance that switched it on.
 */
export const SYNTHETIC_KNOWLEDGE_ENVIRONMENTS: readonly string[] = ["LOCAL", "TEST", "CI"];

export type EnvironmentRecord = Readonly<Record<string, string | undefined>>;

export function syntheticKnowledgeEnabled(env: EnvironmentRecord): boolean {
  if (env["NODE_ENV"] === "production") {
    return false;
  }
  const environment = env["CEDULA_ENVIRONMENT"];
  if (environment === undefined || !SYNTHETIC_KNOWLEDGE_ENVIRONMENTS.includes(environment)) {
    return false;
  }
  return env["CEDULA_SYNTHETIC_KNOWLEDGE"] === "1";
}
