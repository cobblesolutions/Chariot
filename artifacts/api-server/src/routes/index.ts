import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import operationsRouter from "./operations";
import operationsExtraRouter from "./operations-extra";
import tasksRouter from "./tasks";
import clientsCrmRouter from "./clients-crm";
import portalRouter from "./portal";
import documentsRouter from "./documents";
import billingRenewalsRouter from "./billing-renewals";
import conversationsRouter from "./conversations";
import chatExtrasRouter from "./chat-extras";
import chatInboxRouter from "./chat-inbox";
import companiesHouseRouter from "./companies-house";
import placesRouter from "./places";
import enquiryInboundRouter from "./enquiry-inbound";
import approvalsPublicRouter from "./approvals-public";
import caseAdviceRouter from "./case-advice";
import termsOfBusinessRouter from "./terms-of-business";
import searchRouter from "./search";
import usersRouter from "./users";
import assistantRouter from "./assistant";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// Forward-in enquiries authenticate with a shared secret, not a session, so
// this sits ahead of every router that applies session middleware.
router.use(enquiryInboundRouter);
// One-click Approve / Confirm links from client emails: token is the credential.
router.use(approvalsPublicRouter);
// portalRouter must be registered before the staff-only routers below.
// Those routers apply `router.use(requireStaff)` unconditionally within
// their own router instance — in Express, that runs for ANY request that
// reaches the router, even one matching none of its own routes, before
// falling through to the next router. Since all these routers are mounted
// with no path prefix, a client's /api/portal/* request would otherwise be
// rejected with "Staff access required" by the first staff-only router in
// the chain, never reaching portalRouter's own (correctly client-scoped)
// route handlers.
router.use(portalRouter);
// Places is open to signed-in clients as well (portal property addresses),
// so it sits with portalRouter ahead of the staff-only routers.
router.use(placesRouter);
router.use(operationsRouter);
router.use(caseAdviceRouter);
router.use(termsOfBusinessRouter);
router.use(operationsExtraRouter);
router.use(tasksRouter);
router.use(clientsCrmRouter);
router.use(documentsRouter);
router.use(billingRenewalsRouter);
router.use(conversationsRouter);
router.use(chatExtrasRouter);
router.use(chatInboxRouter);
router.use(companiesHouseRouter);
router.use(searchRouter);
router.use(usersRouter);
router.use(assistantRouter);

export default router;
