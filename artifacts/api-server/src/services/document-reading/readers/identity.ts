import type { DocumentReader, DocumentRow } from "../types";
import {
  fillEmptyClientFields, findAddress, oneOf, splitAddress, str, toIsoDate,
} from "./shared";

export const IDENTITY_DOCUMENT_TYPES = ["passport", "driving_licence", "national_id", "residence_permit", "other"] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

/** What the proof-of-identity reader extracts from a passport, driving licence or ID card. */
export interface IdentityReading extends Record<string, unknown> {
  documentType: (typeof IDENTITY_DOCUMENT_TYPES)[number] | null;
  fullName: string | null;
  surname: string | null;
  givenNames: string | null;
  title: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingCountry: string | null;
  /** Driving licences carry the holder's address; passports do not. */
  address: string | null;
  city: string | null;
  postcode: string | null;
  confidence: (typeof CONFIDENCE)[number] | null;
  notes: string | null;
}

const EMPTY: IdentityReading = {
  documentType: null, fullName: null, surname: null, givenNames: null, title: null, dateOfBirth: null,
  nationality: null, gender: null, documentNumber: null, issueDate: null, expiryDate: null, issuingCountry: null,
  address: null, city: null, postcode: null, confidence: null, notes: null,
};

const SYSTEM_INSTRUCTION = `You read identity documents (UK and foreign passports, UK driving licences, national ID cards, biometric residence permits) for a mortgage broker's KYC file and return JSON only.
Return an object with exactly these keys:
{ "documentType", "fullName", "surname", "givenNames", "title", "dateOfBirth", "nationality", "gender", "documentNumber", "issueDate", "expiryDate", "issuingCountry", "address", "city", "postcode", "confidence", "notes" }
Rules: null for anything not on the document. "documentType" is one of ${IDENTITY_DOCUMENT_TYPES.map((t) => `"${t}"`).join(", ")}.
Dates are ISO YYYY-MM-DD (the MRZ on a passport is authoritative when the printed text is unclear). "nationality" is the demonym or country as printed ("British", "Polish"). "gender" is "M", "F" or "X". "title" is only what is printed (e.g. "Mr", "Mrs", "Dr"), else null.
"address", "city" and "postcode" come from a driving licence (field 8); leave null on a passport.
"confidence" is "high", "medium" or "low" for the identity fields as a whole. "notes" is one short sentence, or null.`;

const COUNTRY_DEMONYMS: Record<string, string> = {
  GBR: "British", IRL: "Irish", POL: "Polish", FRA: "French", DEU: "German", D: "German", ESP: "Spanish", ITA: "Italian",
  PRT: "Portuguese", ROU: "Romanian", IND: "Indian", PAK: "Pakistani", NGA: "Nigerian", USA: "American", AUS: "Australian",
  CAN: "Canadian", ZAF: "South African", LTU: "Lithuanian", NLD: "Dutch", BGR: "Bulgarian", HUN: "Hungarian", GRC: "Greek",
};

function normalise(raw: unknown): IdentityReading {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reading: IdentityReading = {
    documentType: oneOf(data.documentType, IDENTITY_DOCUMENT_TYPES),
    fullName: printedName(str(data.fullName)),
    surname: printedName(str(data.surname)),
    givenNames: printedName(str(data.givenNames)),
    title: str(data.title),
    dateOfBirth: toIsoDate(data.dateOfBirth),
    nationality: printedName(str(data.nationality)?.replace(/\s+(citizen|national|subject)$/i, "") ?? null),
    gender: str(data.gender)?.slice(0, 1).toUpperCase() ?? null,
    documentNumber: str(data.documentNumber),
    issueDate: toIsoDate(data.issueDate),
    expiryDate: toIsoDate(data.expiryDate),
    issuingCountry: str(data.issuingCountry),
    address: str(data.address),
    city: str(data.city),
    postcode: str(data.postcode),
    confidence: oneOf(data.confidence, CONFIDENCE),
    notes: str(data.notes),
  };
  if (!reading.fullName && (reading.givenNames || reading.surname)) {
    reading.fullName = [reading.givenNames, reading.surname].filter(Boolean).join(" ");
  }
  return reading;
}

/**
 * Passport MRZ (two 44-character lines) is machine-readable by design, so it
 * is the heuristic's best source; driving licences use the numbered EU fields.
 */
function heuristic(text: string, document: DocumentRow): IdentityReading {
  const reading = { ...EMPTY };
  const haystack = `${document.name}\n${text}`;
  const lower = haystack.toLowerCase();
  reading.documentType =
    /passport|p<[a-z]{3}/i.test(haystack) ? "passport"
    : /driving licence|driving license|dvla/.test(lower) ? "driving_licence"
    : /residence permit|biometric/.test(lower) ? "residence_permit"
    : /identity card|national id/.test(lower) ? "national_id"
    : null;

  const mrz = readMrz(haystack);
  if (mrz) {
    Object.assign(reading, mrz);
    reading.confidence = "medium";
    reading.notes = "Read from the passport's machine-readable zone.";
  }

  const field = (label: RegExp) => {
    const match = haystack.match(new RegExp(`${label.source}\\s*[:\\-]?\\s*([^\\n]{1,60})`, "i"));
    return match ? match[1]!.trim() : null;
  };
  reading.surname ??= titleCase(field(/(?:^|\n)\s*(?:1\.?\s*)?surname|family name/));
  reading.givenNames ??= titleCase(field(/(?:^|\n)\s*(?:2\.?\s*)?(?:given names?|forenames?|first names?)/));
  reading.dateOfBirth ??= toIsoDate(field(/(?:3\.?\s*)?date of birth|\bdob\b|born on/)?.match(/\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4}/)?.[0] ?? null);
  reading.expiryDate ??= toIsoDate(field(/(?:4b\.?\s*)?(?:date of )?expir[yi]a?t?i?o?n?|valid until|expires/)?.match(/\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4}/)?.[0] ?? null);
  reading.issueDate ??= toIsoDate(field(/(?:4a\.?\s*)?(?:date of )?issue/)?.match(/\d{1,2}[/.\- ][A-Za-z0-9]{1,9}[/.\- ]\d{2,4}/)?.[0] ?? null);
  reading.nationality ??= titleCase(field(/nationality/)?.replace(/[^A-Za-z ].*$/, "") ?? null);
  reading.documentNumber ??= field(/(?:5\.?\s*)?(?:passport|licence|document) (?:no|number)/)?.replace(/[^A-Z0-9]/gi, "") ?? null;
  const title = haystack.match(/\b(Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\b\.?\s+[A-Z]/);
  reading.title ??= title ? title[1]! : null;
  if (!reading.fullName && (reading.givenNames || reading.surname)) {
    reading.fullName = [reading.givenNames, reading.surname].filter(Boolean).join(" ");
  }
  if (reading.documentType === "driving_licence") {
    const address = findAddress(haystack, /(?:8\.?\s*)?address/) ?? findAddress(haystack);
    const parts = splitAddress(address);
    reading.address = parts.address;
    reading.city = parts.city;
    reading.postcode = parts.postcode;
  }
  if (!reading.confidence && (reading.dateOfBirth || reading.fullName)) reading.confidence = "low";
  return reading;
}

/** TD3 passport MRZ: `P<GBRSURNAME<<GIVEN<NAMES<<<…` then `NUMBER…GBRYYMMDDcSYYMMDDc…`. */
function readMrz(text: string): Partial<IdentityReading> | null {
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, "").toUpperCase());
  const first = lines.findIndex((line) => /^P[A-Z<][A-Z<]{3}[A-Z<]{5,}$/.test(line) && line.length >= 30);
  if (first < 0) return null;
  const line1 = lines[first]!;
  const line2 = lines.slice(first + 1, first + 3).find((line) => /^[A-Z0-9<]{9}[0-9<][A-Z<]{3}\d{6}[0-9<][MFX<]\d{6}/.test(line));
  if (!line2) return null;
  const names = line1.slice(5).split("<<");
  const surname = names[0]!.replace(/</g, " ").trim();
  const given = (names[1] ?? "").replace(/</g, " ").trim();
  const nationalityCode = line2.slice(10, 13).replace(/</g, "");
  return {
    documentType: "passport",
    surname: titleCase(surname),
    givenNames: titleCase(given),
    fullName: titleCase(`${given} ${surname}`.trim()),
    documentNumber: line2.slice(0, 9).replace(/</g, "") || null,
    issuingCountry: line1.slice(2, 5).replace(/</g, "") || null,
    nationality: COUNTRY_DEMONYMS[nationalityCode] ?? nationalityCode ?? null,
    dateOfBirth: toIsoDate(line2.slice(13, 19), "past"),
    gender: line2.slice(20, 21).replace("<", "") || null,
    expiryDate: toIsoDate(line2.slice(21, 27), "future"),
  };
}

/** Documents print names in capitals; the record wants "Jane Example". Mixed case is left alone. */
function printedName(value: string | null) {
  if (!value) return null;
  return value === value.toUpperCase() ? titleCase(value) : value;
}

function titleCase(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return cleaned.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

async function apply(document: DocumentRow, data: IdentityReading, actorName: string) {
  const summary = [
    data.documentType?.replace("_", " "),
    data.fullName,
    data.dateOfBirth ? `born ${data.dateOfBirth}` : null,
    data.expiryDate ? `expires ${data.expiryDate}` : null,
  ].filter(Boolean).join(", ");
  return fillEmptyClientFields(document, {
    title: data.title,
    dateOfBirth: data.dateOfBirth,
    nationality: data.nationality,
    currentAddress: data.address,
    currentAddressCity: data.city,
    currentAddressPostcode: data.postcode,
  }, actorName, "Document read: proof of identity", summary || "identity details");
}

function merge(primary: IdentityReading, fallback: IdentityReading): IdentityReading {
  const merged = { ...primary };
  for (const key of Object.keys(EMPTY) as Array<keyof IdentityReading>) {
    if (merged[key] == null && fallback[key] != null) merged[key] = fallback[key];
  }
  return merged;
}

export const identityReader: DocumentReader<IdentityReading> = {
  key: "identity",
  categories: ["identity"],
  systemInstruction: SYSTEM_INSTRUCTION,
  normalise,
  heuristic,
  merge,
  apply,
};
