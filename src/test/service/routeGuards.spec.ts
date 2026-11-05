import { scanRoutes, type ScannedRoute } from '../routeGuardScan';

/**
 * Guard coverage (docs/access-gap-fixes.md, Phase 5). Fails when a new route is added without an
 * access check, so new features cannot quietly reopen the gaps closed in Phases 1–4.
 *
 * A route counts as guarded when its decorator or its controller names one of GUARDS. Routes
 * guarded some other way (in the service, or public on purpose) are listed below with the reason;
 * add new ones there only with a reason.
 */

const GUARDS =
  /\b(checkPermission|checkAnyPermission|requireRole|guardDocumentEdit|guardDocumentDelete|guardDocumentView|guardRegistrationEdit|guardEmployeeScope|guardEmployeeScopeIn|guardPlanRecord)\b/;

/** Controllers that may be reached without a login. */
const PUBLIC_CONTROLLERS: Record<string, string> = {
  '/auth': 'login, refresh-token and logout; /auth/me has deserializeUser on the route',
  '/pincode': 'address lookup by pincode, no business data',
  '/sse': 'notification stream; the token is verified from the query string',
};

/** Routes that change data and are guarded outside the route decorators. Key: "METHOD /path". */
const MUTATION_ALLOWLIST: Record<string, string> = {
  'POST /auth/login': 'public',
  'POST /auth/logout': 'public',
  'POST /auth/refresh-token': 'public; refuses inactive users',
  'PATCH /documents/update/:documentId': 'approval engine checks flow membership, stage, creator',
  'PATCH /documents/updatesecondlevel/:documentId': 'approval engine checks flow membership, stage, creator',
  'PATCH /documents/updatefirstlevel/:documentId': 'approval engine checks flow membership, stage, creator',
  'POST /delivery-confirmation/statuses': 'read-only lookup (POST for a list of ids)',
  'POST /delivery-confirmation/:dcId/undo': 'service: only an approver of the DC, never the confirming user',
  'POST /vehicleDispatches/statuses': 'read-only lookup (POST for a list of ids)',
  'POST /products/getproduct/byids': 'read-only lookup (POST for a list of ids)',
  'POST /varients/getvarients/byids': 'read-only lookup (POST for a list of ids)',
  'PUT /grns/amount-status/:id': 'legacy GRN status route; payments are recorded by Payment Managers only',
  'POST /grns/:id/payments': 'service: Payment Manager only',
  'PUT /grns/:id/payments/:paymentId': 'service: Payment Manager only',
  'POST /grns/:id/payments/:paymentId/void': 'service: Payment Manager only',
  'POST /grns/:id/payments/confirm-paid': 'service: Payment Manager only',
  'PUT /final-invoice/amount-status/:id': 'retired, always 410',
  'POST /final-invoice/:id/payments': 'service: Payment Manager only',
  'PUT /final-invoice/:id/payments/:paymentId': 'service: Payment Manager only',
  'POST /final-invoice/:id/payments/:paymentId/void': 'service: Payment Manager only',
  'PATCH /notification/mark-all-read': "the user's own notifications",
  'PATCH /procurement-target/:id/approve': 'service: direct manager in the reporting tree only',
  'PATCH /sales-target/:id/approve': 'service: direct manager in the reporting tree only',
  'POST /stock-correction/': 'retired module, always 410',
  'PATCH /stock-correction/:id/approve': 'retired module, always 410',
};

/** Bulk-data GET routes (exports, downloads, recycle bins) guarded elsewhere or harmless. */
const BULK_READ_ALLOWLIST: Record<string, string> = {
  'GET /files/download': 'attachment download used by every detail page; files are reached through guarded documents',
  'GET /excel/download/product/template': 'blank import template',
  'GET /excel/download/farmer/template': 'blank import template',
  'GET /excel/download/vendor/template': 'blank import template',
  'GET /excel/download/employee/template': 'blank import template',
  'GET /excel/download/customer/template': 'blank import template',
  'GET /notification/export-excel': "the user's own notifications",
  'GET /procurement-target/dashboard-summary/plan-in-brief/download': 'dashboard summary of the user and their team',
};

const key = (r: ScannedRoute) => `${r.method} ${r.controllerPath}${r.path}`.replace(/\/+$/, '/');
const isGuarded = (r: ScannedRoute) => GUARDS.test(r.routeArgs) || GUARDS.test(r.controllerArgs);
const describeRoute = (r: ScannedRoute) => `${key(r)}  (${r.file})`;

describe('route guard coverage', () => {
  const routes = scanRoutes();

  it('finds the controllers', () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it('requires a login on every controller except the public ones', () => {
    const open = [...new Set(routes.filter((r) => !/deserializeUser/.test(r.controllerArgs)).map((r) => r.controllerPath))];
    expect(open.filter((p) => !(p in PUBLIC_CONTROLLERS))).toEqual([]);
  });

  it('guards every route that changes data', () => {
    const missing = routes
      .filter((r) => r.method !== 'GET' && !isGuarded(r))
      .filter((r) => !(key(r) in MUTATION_ALLOWLIST) && !(key(r).replace(/\/$/, '') in MUTATION_ALLOWLIST))
      .map(describeRoute);
    expect(missing).toEqual([]);
  });

  it('guards every export, download and recycle-bin route', () => {
    const missing = routes
      .filter((r) => r.method === 'GET' && /export|excel|recycle|download/i.test(r.path) && !isGuarded(r))
      .filter((r) => !(key(r) in BULK_READ_ALLOWLIST))
      .map(describeRoute);
    expect(missing).toEqual([]);
  });

  it('keeps the allow-lists free of stale entries', () => {
    const present = new Set(routes.map(key));
    const stale = [...Object.keys(MUTATION_ALLOWLIST), ...Object.keys(BULK_READ_ALLOWLIST)].filter(
      (k) => !present.has(k) && !present.has(k + '/') && !present.has(k.replace(/\/$/, '')),
    );
    expect(stale).toEqual([]);
  });
});
