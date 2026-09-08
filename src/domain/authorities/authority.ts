import type { AuthorityId, OfficeId, OfficeRevisionId } from "../identifiers/identifiers";
import type { CountryCode } from "../primitives/country";
import type { PublicationStatus } from "../rules/publication";
import type { LocalDate } from "../primitives/local-date";

export type Authority = Readonly<{
  authorityId: AuthorityId;
  countryCode: CountryCode;
  label: string;
}>;

export type Office = Readonly<{
  officeId: OfficeId;
  authorityId: AuthorityId;
}>;

/**
 * Office details change often (addresses, opening hours), so they are
 * revisioned like every other piece of published knowledge.
 */
export type OfficeRevision = Readonly<{
  officeRevisionId: OfficeRevisionId;
  officeId: OfficeId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  label: string;
  city: string | null;
}>;
