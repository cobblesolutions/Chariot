import { Router, type IRouter } from "express";
import * as api from "@workspace/api-zod";
import { requireStaff } from "../auth/session";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireStaff);

interface CompaniesHouseApiItem {
  company_number: string;
  title: string;
  company_status?: string;
  address_snippet?: string;
  address?: {
    premises?: string;
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
  };
}

/** Split the registered office into the line/city/postcode shape our address fields use. */
function toRegisteredAddress(address: CompaniesHouseApiItem["address"]) {
  if (!address) return null;
  const line1 = [address.premises, address.address_line_1, address.address_line_2]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  const city = address.locality?.trim() || address.region?.trim() || "";
  const postcode = address.postal_code?.trim() || "";
  if (!line1 && !city && !postcode) return null;
  return { line1, city, postcode };
}

/**
 * Companies House company search, used to auto-fill the company name, number
 * and registered address when creating a client. Fails closed (503) until COMPANIES_HOUSE_API_KEY is
 * configured — the UI falls back to manual entry until then.
 */
router.get("/companies-house/search", async (req, res): Promise<void> => {
  const parsed = api.SearchCompaniesHouseQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Companies House search is not configured yet" });
    return;
  }
  try {
    const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(parsed.data.q)}&items_per_page=10`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Companies House search failed with status ${response.status}`);
    }
    const payload = (await response.json()) as { items?: CompaniesHouseApiItem[] };
    res.json(
      api.SearchCompaniesHouseResponse.parse({
        results: (payload.items ?? []).map((item) => ({
          companyNumber: item.company_number,
          name: item.title,
          status: item.company_status ?? "unknown",
          address: item.address_snippet ?? null,
          registeredAddress: toRegisteredAddress(item.address),
        })),
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, "Companies House search failed");
    res.status(503).json({ error: "Companies House search is currently unavailable" });
  }
});

export default router;
