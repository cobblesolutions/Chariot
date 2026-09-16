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
}

/**
 * Companies House company search, used to auto-fill the "Company Name" field
 * when creating a client. Fails closed (503) until COMPANIES_HOUSE_API_KEY is
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
        })),
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, "Companies House search failed");
    res.status(503).json({ error: "Companies House search is currently unavailable" });
  }
});

export default router;
