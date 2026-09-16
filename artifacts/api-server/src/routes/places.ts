import { Router, type IRouter } from "express";
import * as api from "@workspace/api-zod";
import { requireAuthenticated } from "../auth/session";
import { logger } from "../lib/logger";

const router: IRouter = Router();
// Portal clients edit property addresses too, so this is not staff-only.
router.use(requireAuthenticated);

const PLACES_API = "https://places.googleapis.com/v1";

/**
 * ISO region codes the suggestions are restricted to (comma separated).
 * Defaults to the UK, which is where the brokerage operates; set to an empty
 * string to search worldwide.
 */
function regionCodes(): string[] {
  const raw = process.env.GOOGLE_PLACES_REGION_CODES;
  if (raw === undefined) return ["gb"];
  return raw
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}

interface PlacePrediction {
  placeId: string;
  text?: { text?: string };
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
}

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlaceDetails {
  id: string;
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { latitude?: number; longitude?: number };
}

function component(
  components: AddressComponent[],
  type: string,
  field: "longText" | "shortText" = "longText",
): string | null {
  const match = components.find((item) => item.types?.includes(type));
  return match?.[field] ?? null;
}

/**
 * Google Places (New) address lookup, used to auto-fill address fields. Fails
 * closed (503) until GOOGLE_MAPS_API_KEY is configured — the UI falls back to
 * manual entry until then. The session token ties an autocomplete session and
 * its final details request together so Google bills them as one lookup.
 */
router.get("/places/autocomplete", async (req, res): Promise<void> => {
  const parsed = api.AutocompletePlacesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Address lookup is not configured yet" });
    return;
  }
  try {
    const regions = regionCodes();
    const response = await fetch(`${PLACES_API}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({
        input: parsed.data.q,
        sessionToken: parsed.data.sessionToken,
        ...(regions.length ? { includedRegionCodes: regions } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Places autocomplete failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      suggestions?: { placePrediction?: PlacePrediction }[];
    };
    res.json(
      api.AutocompletePlacesResponse.parse({
        results: (payload.suggestions ?? [])
          .map((item) => item.placePrediction)
          .filter((item): item is PlacePrediction => Boolean(item?.placeId))
          .map((item) => ({
            placeId: item.placeId,
            description: item.text?.text ?? "",
            mainText: item.structuredFormat?.mainText?.text ?? item.text?.text ?? "",
            secondaryText: item.structuredFormat?.secondaryText?.text ?? "",
          })),
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, "Places autocomplete failed");
    res.status(503).json({ error: "Address lookup is currently unavailable" });
  }
});

router.get("/places/details", async (req, res): Promise<void> => {
  const query = api.GetPlaceAddressQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Address lookup is not configured yet" });
    return;
  }
  try {
    const url = new URL(`${PLACES_API}/places/${encodeURIComponent(query.data.placeId)}`);
    if (query.data.sessionToken) {
      url.searchParams.set("sessionToken", query.data.sessionToken);
    }
    const response = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,formattedAddress,addressComponents,location",
      },
    });
    if (response.status === 404) {
      res.status(404).json({ error: "Place not found" });
      return;
    }
    if (!response.ok) {
      throw new Error(`Place details failed with status ${response.status}`);
    }
    const place = (await response.json()) as PlaceDetails;
    const components = place.addressComponents ?? [];
    const streetNumber = component(components, "street_number");
    const route = component(components, "route");
    const premise = component(components, "premise") ?? component(components, "subpremise");
    const street = [streetNumber, route].filter(Boolean).join(" ") || null;
    res.json(
      api.GetPlaceAddressResponse.parse({
        placeId: place.id,
        formattedAddress: place.formattedAddress ?? "",
        line1: premise && street ? premise : (street ?? premise),
        line2: premise && street ? street : null,
        city:
          component(components, "postal_town") ??
          component(components, "locality") ??
          null,
        county: component(components, "administrative_area_level_2"),
        postcode: component(components, "postal_code"),
        country: component(components, "country"),
        countryCode: component(components, "country", "shortText"),
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, "Place details lookup failed");
    res.status(503).json({ error: "Address lookup is currently unavailable" });
  }
});

export default router;
