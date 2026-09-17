import { eq } from "drizzle-orm";
import { casesTable, db, lendersTable, requirementsTable } from "@workspace/db";

export const portfolioRequirementLabel = "Required portfolio sent";

export async function reconcileCasePortfolioRequirement(caseId: number, lenderId: number | null) {
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(requirementsTable).where(eq(requirementsTable.caseId, caseId));
    const portfolioRows = existing.filter((item) => item.label === portfolioRequirementLabel);
    if (!lenderId) {
      for (const row of portfolioRows) {
        await tx.delete(requirementsTable).where(eq(requirementsTable.id, row.id));
      }
      return;
    }
    const [lender] = await tx.select({ portfolioStage: lendersTable.portfolioStage })
      .from(lendersTable).where(eq(lendersTable.id, lenderId));
    if (!lender) throw new Error("Lender not found");
    if (lender.portfolioStage !== "submission" && lender.portfolioStage !== "underwriting") {
      for (const row of portfolioRows) {
        await tx.delete(requirementsTable).where(eq(requirementsTable.id, row.id));
      }
      return;
    }
    const stageIndex = lender.portfolioStage === "underwriting" ? 3 : 2;
    const [primary, ...duplicates] = portfolioRows;
    if (primary) {
      await tx.update(requirementsTable).set({ stageIndex })
        .where(eq(requirementsTable.id, primary.id));
      for (const duplicate of duplicates) {
        await tx.delete(requirementsTable).where(eq(requirementsTable.id, duplicate.id));
      }
      return;
    }
    await tx.insert(requirementsTable).values({
      caseId,
      stageIndex,
      label: portfolioRequirementLabel,
      round: 1,
    }).onConflictDoUpdate({
      target: [requirementsTable.caseId, requirementsTable.submissionId, requirementsTable.label, requirementsTable.round],
      set: { stageIndex },
    });
  });
}

export async function reconcileLenderPortfolioRequirements(lenderId: number) {
  const cases = await db.select({ id: casesTable.id }).from(casesTable)
    .where(eq(casesTable.lenderId, lenderId));
  await Promise.all(cases.map((item) => reconcileCasePortfolioRequirement(item.id, lenderId)));
}