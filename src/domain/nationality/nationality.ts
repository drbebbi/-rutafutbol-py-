import type { CountryCode } from "../primitives/country";

/**
 * A single nationality may play several roles at once: the applicant can be a
 * German citizen travelling on a German passport, or a dual national who
 * entered on one passport and intends to run the procedure on another. The
 * roles are therefore a set, not an enum field.
 */
export type NationalityRole = "CITIZENSHIP" | "ENTRY_TRAVEL_DOCUMENT" | "PROCESS_TRAVEL_DOCUMENT";

export const NATIONALITY_ROLES: readonly NationalityRole[] = [
  "CITIZENSHIP",
  "ENTRY_TRAVEL_DOCUMENT",
  "PROCESS_TRAVEL_DOCUMENT",
];

export type NationalityFacts = Readonly<{
  countryCode: CountryCode;
  roles: readonly NationalityRole[];
}>;

export function hasRole(nationality: NationalityFacts, role: NationalityRole): boolean {
  return nationality.roles.includes(role);
}
