/** Street line, city and postcode as one display string ("10 Downing St, London, SW1A 2AA"). */
export function formatAddress(parts: {
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
}): string {
  return [parts.address, parts.city, parts.postcode]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}
