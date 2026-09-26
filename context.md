# PrimeFresh ERP Backend: Project Context

> This is the single reference for the PrimeFresh ERP backend (`PFL_Backend`). It covers the business domain, architecture, modules, API contracts, data model, configuration, Docker/Nginx setup, and known pitfalls.
>
> It was written by reading the source code and reflects the code as it is, including its defects. Where the code and its intent differ, this file says what the code actually does. Paths are relative to the repo root.

---

## Table of Contents

1. [Business Domain](#1-business-domain)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout & Module Pattern](#3-repository-layout--module-pattern)
4. [Application Bootstrap & Request Pipeline](#4-application-bootstrap--request-pipeline)
5. [Configuration & Environment Variables](#5-configuration--environment-variables)
6. [Database Layer (PostgreSQL + TypeORM)](#6-database-layer-postgresql--typeorm)
7. [Caching (Redis)](#7-caching-redis)
8. [Authentication](#8-authentication)
9. [Authorization (Roles, Departments, Document Permissions)](#9-authorization-roles-departments-document-permissions)
10. [Approval Workflow Engine](#10-approval-workflow-engine)
11. [End-to-End Business Flows](#11-end-to-end-business-flows)
12. [Module Reference](#12-module-reference) (endpoints, entities, business logic)
13. [Inventory & Stock Engine](#13-inventory--stock-engine)
14. [Dashboards & Reports](#14-dashboards--reports)
15. [Cross-cutting Frameworks](#15-cross-cutting-frameworks) (list filters, Excel import/export, PDF, uploads, notifications/SSE, cron, logging and audit)
16. [Docker, Nginx & Deployment](#16-docker-nginx--deployment)
17. [Scripts, Tests & Tooling](#17-scripts-tests--tooling)
18. [Known Issues, Risks & Gotchas](#18-known-issues-risks--gotchas)
19. [Conventions for Contributors](#19-conventions-for-contributors)

---

## 1. Business Domain

**PrimeFresh** is a group of Indian fresh fruit and vegetable ("F&V") companies. This ERP digitises its whole supply chain, as described in the subsections below.

### Group companies
The group companies are seeded from `src/data/company.json`. Each one has its own GST number, FSSAI number and bank:
- Prime Fresh Limited (GST 27AAECP2124P1Z7)
- Florens Farming Private Limited
- Florens Fresh Supply Solutions Pvt. Ltd.
- Prime Fresh Retail (I) Pvt. Ltd.
- Vyanktesh Prime Fresh Farmer Producer Company Ltd.

### Supply-chain stages
| Stage | What happens | Main documents |
|---|---|---|
| **Sourcing / Procurement** | Buy produce from **Farmers** and **Vendors**. | RFPA (Request For Purchase Approval), Deal Slip, GRN (Goods Received Note), Payment Request, vouchers |
| **Operations / Warehouse** | Receive, quality-check, store, dump, correct and report stock per location. | Inward Register, AQR (Arrival Quality Report), Dump Register, EOD (End-Of-Day) Stock, Stock Correction, Vehicle Dispatch Register |
| **Sales / Dispatch** | Sell to **Customers** (B2B: retailers, modern trade, HoReCa, exporters). | Sale Order, Delivery Challans (Customer / Stock Transfer / Other), Final Invoice, Second Sale (sale of lower-grade stock), Return By Customer, Return To Vendor |
| **Finance** | Pay out cash and other payments. | Multi Cash Voucher, Labour Payment Voucher, Transport Payment Voucher, Packing Material Payment Voucher |
| **Planning** | Monthly targets with weekly breakdowns, and achievement tracking. | Procurement Targets, Sales Targets, Weekly Business Plan dashboard |
| **HR / Labour** | Manage employees, labour and attendance. | Employees, workflow (reporting) hierarchy, Labour master, labour register, labour attendance |

### Organisation model
- **Locations:** **Branches** (warehouses/depots; `location-branches`) and **Offices** (`location-offices`).
- **Employees** have departments, roles, a joining location, a current work location and access locations.

### Approvals
Almost every transactional document goes through the configurable **multi-level approval engine** (§10).
- A document is created in status `hold`.
- Approvers act on it until it reaches `COMPLETE` or `REJECT`.
- Stock movement is applied when the document completes (§13).

---

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js, TypeScript 4.9 (`target es2016`, `commonjs`, decorators enabled, `strict`). Runs through `ts-node-dev --transpile-only` (no type-check at runtime). |
| HTTP | Express 4, with **inversify-express-utils** for decorator controllers (`@controller`, `@httpGet` …) |
| DI | **InversifyJS 6** (`src/inversify.config.ts`, about 1,360 lines; symbols in `src/types.ts`) |
| ORM / DB | **TypeORM 0.3.20** on **PostgreSQL 17** |
| Cache | **Redis 7** through `redis@4` (`src/global/cache.service.ts`) |
| Auth | JWT **RS256** (`jsonwebtoken`), bcrypt/bcryptjs |
| Validation | Mostly none at runtime. DTOs are TypeScript interfaces. **Zod** is used by `middleware/validate.ts` (vendor-category only) and by the filter framework. class-validator is not installed. |
| Files | multer + multer-s3 to **DigitalOcean Spaces** (S3 API, region `sgp1`) |
| Excel | ExcelJS (streaming writer and import), `xlsx` (legacy parsing) |
| PDF | EJS templates (`src/templates/*.ejs`) rendered by **Puppeteer** into A4 PDFs, uploaded to Spaces |
| Realtime | Server-Sent Events (in-memory `SSEService`) |
| Scheduling | `node-cron` (in-process) |
| Email | nodemailer (SMTP) |
| Logging | winston: `logs/error.log`, `logs/combined.log`, `logs/user-activity.log` |
| Dates | moment-timezone, date-fns, date-fns-tz. The business time zone is **Asia/Kolkata (IST)**. |
| Tests | Jest + ts-jest (`isolatedModules`, diagnostics off) |
| Infra | docker-compose (Postgres, Redis, pgAdmin, Nginx). The app itself runs on the host. |

---

## 3. Repository Layout & Module Pattern

```
PFL_Backend/
├── config/                 # node-config: default.ts (+ default-0/1.ts per-instance overrides)
├── docs/                   # filter/export/import API docs, weekly business plan API, Postman collection
├── nginx/                  # nginx.conf, conf.d/default.conf (port 8004), ssl.conf (commented), nginx-minimal.conf
├── postgres/init/          # docker-entrypoint-initdb.d scripts (currently empty)
├── reports/                # sample generated xlsx reports (legacy local output)
├── logs/                   # winston output (combined.log is tracked by git; it shouldn't be)
├── docker-compose.yml
├── run-migrations.ts       # AppDataSource.runMigrations()
├── fix-enum.sql            # manual SQL: drop 'draft' from sales/procurement target status enums
├── load-test-login.js      # k6 load test for /auth/login
├── jest.config.js, tsconfig.json, .env.example, .prettierrc
└── src/
    ├── app.ts              # bootstrap
    ├── inversify.config.ts # DI container (all bindings)
    ├── types.ts            # DI symbols (TYPES.*)
    ├── swagger.ts          # swagger-jsdoc setup (NOT mounted)
    ├── <module>/           # feature modules (see below)
    ├── global/             # base entity, cache service, filters framework, query optimizer, overdue deletion
    ├── excel/              # Excel import/export engine
    ├── middleware/         # auth, uploads, timezone, logging, cache, validate, …
    ├── utils/              # data-source, jwt, logger, pagination/buildQuery, pdfGenerator, enums, helpers
    ├── cron/cronJob.ts     # scheduled jobs
    ├── seed.ts, seed/      # admin, companies, document definitions
    ├── data/               # company.json, documentDefination.json (seed data)
    ├── templates/          # EJS: invoiceTemplate, deliveryChallan, multiCashVoucher
    ├── views/              # EJS reset-password pages (legacy, unused)
    ├── migrations/, migration/  # TypeORM migrations (few; schema is mostly synchronize-driven)
    ├── scripts/            # maintenance and doc-generation scripts
    └── test/service/       # Jest specs
```

### Feature module convention
Every business module follows the same layered layout:

```
src/<module>/
├── controller/  <x>.controller.ts   # @controller('/base', deserializeUser, requireUser); thin HTTP layer
├── service/     <x>.service.ts      # @injectable business logic; transactions, cache, notifications, approval hooks
├── repository/  <x>.repository.ts   # class XRepository extends Repository<Entity> (bound via toDynamicValue in request scope)
├── entity/      <x>.entity.ts       # TypeORM entities; extend global/model.entity.ts `Model`
├── dto/         <x>.dto.ts          # TypeScript interfaces/classes (request & response shapes), usually no runtime validation
└── excel/       <x>.export.ts / <x>.columns.ts   # ExportDefinition / import column map for the Excel engine
```

**DI wiring** is in `src/inversify.config.ts`:
- `DataSource` is bound as a constant (`TYPES.DataSource → AppDataSource`).
- Repositories use `toDynamicValue(ctx => new XRepository(Entity, dataSource.createEntityManager()))` with `.inRequestScope()`.
- Services and controllers are bound `.inSingletonScope()`.
- To add a module you must:
  1. add symbols to `types.ts`;
  2. add bindings in `inversify.config.ts`;
  3. make sure the controller file is imported through the config, which is what registers the decorators.

---

## 4. Application Bootstrap & Request Pipeline

### Startup sequence (`src/app.ts`)
1. `dotenv.config()`, `reflect-metadata`, `@aws-sdk/crc64-nvme-crt`.
2. Register `process.on('unhandledRejection' | 'uncaughtException')`. Both log the error and call **`process.exit(1)`**, relying on a supervisor such as PM2 or Docker to restart.
3. `AppDataSource.initialize()`. Because **`synchronize: true`** is set, the schema is auto-altered on boot.
4. Run the seeds:
   - `seedAdmin()`
   - `seedDatabase()` (companies and bank details, only if the table is empty)
   - `seedDocumentDefDatabase()` (upsert by `uniqueKey`)
5. `import './cron/cronJob'` registers the cron jobs.
6. Build an `InversifyExpressServer(container)` and listen on `0.0.0.0:${PORT || 4000}`.

### Global middleware (in order, from `setConfig`)
1. Strip any existing CORS headers.
2. `express.json()` (default 100 kb limit).
3. `cookieParser()`.
4. `compression()`, skipped for `/sse` paths and `Accept: text/event-stream`.
5. **CORS**:
   - A hard-coded origin allowlist (localhost:5173/3000/8004, LAN IPs, `https://prime-fresh-erp.vercel.app`, `http://139.59.83.235`, an ngrok URL).
   - Origins are compared normalised (no trailing slash, lower-case).
   - An allowed origin is echoed back with `Access-Control-Allow-Credentials: true`, and `Vary: Origin` is set.
   - Allowed methods: `GET, POST, PATCH, DELETE, OPTIONS, PUT`.
   - `OPTIONS` requests get a 204.
   - `ADDITIONAL_ORIGINS` in `.env.example` is **not read** by the code.
6. `/sse/notifications`: sets the SSE headers (`text/event-stream`, `no-cache`, `keep-alive`, `X-Accel-Buffering: no`) and calls `flushHeaders()`.
7. `pagination` from `typeorm-pagination`.
8. `captureUserInfo`: sets `req.systemInfo` (IP, user-agent browser/device; the OS fields are the *server's* OS).
9. `captureUser`: sets `res.locals.updatedBy`. It runs before the auth middleware, so it looks up an undefined id (see §18).
10. `timezoneMiddleware`: wraps `res.json` and converts every `Date` instance to an **IST string `DD-MM-YYYY hh:mm A`**.
11. `TransformResponseMiddleware.transform`: applies `classToPlain` when the whole body is an entity or an array of entities.
12. `logRequestMiddleware`: sets `req.clientIp` and logs the method and URL.
13. `GET /` returns `"Hello World!....."`.

Controller-level middleware is usually `deserializeUser, requireUser`, and occasionally upload middlewares or `checkPermission`.

**Disabled:**
- Helmet and rate limiting (`authRateLimit`, `apiRateLimit`) are defined but commented out.
- Swagger (`src/swagger.ts`) is never mounted.

### Error handling
- `AppError(statusCode, message)` is in `src/utils/appError.ts`. `status` is `'fail'` for 4xx and `'error'` otherwise.
- The global error handler returns `{ status, message }` with the AppError's status code. Any other error returns 500 `{ status: 'error', message: 'Internal Server Error' }`.
- Many controllers catch errors themselves and return ad-hoc 400/404/500 JSON.

### Response conventions (de-facto)
| Kind | Shape |
|---|---|
| List | `{ status: 'success', data: [...], allRecords, totalPages, page }`, sometimes `{ data, meta: { total, page, pages } }` |
| Single | `{ status: 'success', data }` |
| Create | 201 `{ status, message, data?: id }` |
| Delete | `{ status, message }` |
| Bulk delete | `{ status, message, affected }` or `{ success[], failed[], message }` |
| Excel export (newer engine) | Streamed `.xlsx` with headers `Content-Disposition`, `X-Export-Record-Count`, `Cache-Control: no-store`. Older masters return `{ data: { downloadUrl, fileName } }` pointing at Spaces. |

**Dates in responses:**
- Date objects come out as IST `DD-MM-YYYY hh:mm A` (timezone middleware).
- Many list rows also carry `createdDate: 'YYYY-MM-DD'` and `createdTime: 'hh:mm A'`.
- Payloads served from the Redis cache contain ISO strings instead, because they are not Date instances.

---

## 5. Configuration & Environment Variables

### `config/default.ts` (node-config)
| Key | Value / source |
|---|---|
| `origin` | `http://localhost:8002` |
| `accessTokenExpiresIn` | `480` (minutes = 8 h) |
| `refreshTokenExpiresIn` | `1440` (minutes = 24 h) |
| `redisCacheExpiresIn` | `60` |
| `port` | `PORT` |
| `accessTokenPrivateKey` / `accessTokenPublicKey` | `JWT_ACCESS_TOKEN_PRIVATE_KEY` / `…_PUBLIC_KEY` (**base64-encoded PEM**) |
| `refreshTokenPrivateKey` / `refreshTokenPublicKey` | `JWT_REFRESH_TOKEN_PRIVATE_KEY` / `…_PUBLIC_KEY` |
| `postgresConfig` | `{ host: POSTGRES_HOST, port: POSTGRES_PORT, username: POSTGRES_USER, password: POSTGRES_PASSWORD, database: POSTGRES_DB }` |
| `smtp` | `{ host: EMAIL_HOST, port: EMAIL_PORT, user: EMAIL_USER, pass: EMAIL_PASS }` |

`config/default-0.ts` and `default-1.ts` re-export the defaults as per-instance overrides for `NODE_APP_INSTANCE`, which is useful under PM2 cluster mode.

### Environment variables used by the code
| Variable | Used by |
|---|---|
| `PORT` (default 4000), `NODE_ENV` (non-production adds console logging) | app, logger |
| `POSTGRES_HOST/PORT/USER/PASSWORD/DB` | data source |
| `JWT_ACCESS_TOKEN_PRIVATE_KEY`, `JWT_ACCESS_TOKEN_PUBLIC_KEY`, `JWT_REFRESH_TOKEN_PRIVATE_KEY`, `JWT_REFRESH_TOKEN_PUBLIC_KEY` | `utils/jwt.ts` (RS256; values are base64 of the PEM) |
| `REDIS_URL` (default `redis://localhost:6379`), `REDIS_PASSWORD` (or the password inside the URL) | `CacheService` |
| `EMAIL_HOST/PORT/USER/PASS` | `utils/sendEmail.ts` |
| `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_BUCKET` (`DO_SPACES_REGION` is not used; the endpoint is hard-coded to `sgp1`) | uploads, PDF, Excel exports |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_PHONE` | `seed.ts` |
| `LOG_DIR`, `LOG_LEVEL` | logger |
| `APP_BASE_URL`, `ADDITIONAL_ORIGINS` | in `.env.example` but **not read** |
| `AUTH_EMAIL`, `AUTH_PASS`, `REGION`, `BUCKET_NAME`, `ACCESS_KEY`, `ACCESS_SECRET` | only in `utils/validateEnv.ts`, which is **never called**. The legacy AWS S3 variables are unused. |

For docker-compose local development, set `POSTGRES_HOST=localhost`, `POSTGRES_PORT=6500`, `POSTGRES_USER=admin`, `POSTGRES_PASSWORD=password123`, `POSTGRES_DB=node_typeorm` and `REDIS_URL=redis://:redis123@localhost:6379`.

### Generating the JWT keys
```bash
openssl genrsa -out access_private.pem 2048 && openssl rsa -in access_private.pem -pubout -out access_public.pem
base64 -w0 access_private.pem   # → JWT_ACCESS_TOKEN_PRIVATE_KEY
base64 -w0 access_public.pem    # → JWT_ACCESS_TOKEN_PUBLIC_KEY
# repeat for the refresh pair
```

---

## 6. Database Layer (PostgreSQL + TypeORM)

### DataSource (`src/utils/data-source.ts`)
```ts
new DataSource({
  type: 'postgres', ...postgresConfig,
  synchronize: true,                 // "Temporary for enum fix" – schema auto-sync on every boot
  poolSize: 20, maxQueryExecutionTime: 5000,   // queries slower than 5s are logged
  extra: { connectionLimit: 20, acquireTimeout: 60000, timeout: 60000, reconnect: true }, // mysql-style keys, ignored by pg
  entities: ['src/**/*.entity{.ts,.js}'],
  migrations: ['src/migrations/**/*{.ts,.js}'],
  subscribers: ['src/subscribers/**/*{.ts,.js}'],  // folder does not exist
  cache: { type: 'database', duration: 30000 },   // TypeORM query-result cache table "query-result-cache"
});
```
- The entity globs point at `src/`, so a compiled `build/` would not find the entities. **The app is designed to run through ts-node.**
- **Migrations:** only a few exist.
  - `src/migrations/1726127663000-UpdateSalesTargetStatusEnum.ts` and `1726127664000-UpdateProcurementTargetStatusEnum.ts` remove `draft` from the target status enums, mapping it to `pending`.
  - `src/migration/1699473823470-ReplaceEmbeddedWithFK.ts.ts` (legacy folder, not in the glob) replaced the embedded approval-stage columns on `documents_approve_by_whom` with FKs to `approval_stage_info`.
  - `fix-enum.sql` is the manual SQL equivalent of the target-enum migrations.
- Run migrations with `npm run typeorm:migrate` or `ts-node run-migrations.ts`.

### Base entity: `src/global/model.entity.ts` (`abstract class Model extends BaseEntity`)
Every entity inherits these columns:

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK (`@PrimaryGeneratedColumn('uuid')`) | |
| `createdAt` | timestamp (`@CreateDateColumn`, Date transformer) | |
| `updatedAt` | timestamp (`@UpdateDateColumn`) | |
| `deletion_scheduled_at` (`deletionScheduledAt`) | timestamp null | Set by single-record DELETE endpoints to **now + 6 months at midnight** ("scheduled deletion") |
| `isDeleted` | boolean default false | Recycle-bin flag, used by bulk delete and super-admin soft delete |
| `deletedAt` | timestamp null (`@DeleteDateColumn`) | TypeORM soft delete. Default `find*` excludes these rows. |

> **Three deletion mechanisms coexist:**
> 1. Single DELETE sets `deletionScheduledAt`, and the row stays visible.
> 2. Bulk delete sets `isDeleted = true`, sometimes together with `softDelete`.
> 3. Super-admin permanent delete does a hard delete.
>
> Lists usually filter on `isDeleted = false AND deletedAt IS NULL`.

### Shared enums (`src/utils/status.enum.ts`)
| Enum | Values |
|---|---|
| `Status` | `pending, approved, notapproved, active, incomplete, draft`. Used by master data (vendor, farmer, customer, product). |
| `ApprovalStatus` | `pending, approved, notApproved` |
| `Department` | `admin, hr, operations, sale, procurement, it, business_development, exports, branding_&_marketing, farming, quality_checking, other` |
| `CompanyName` | the 4 legal entity names (lower-case) |
| `Source` | `vendor, farmer` (GRN/RFPA source type) |
| `ammountStatus` | `paid, unpaid` |
| `FileType` | `image, pdf` |

### Code/number generation (general pattern)
Most documents generate a human-readable number in the service: a prefix, the date, and a serial derived from the last or count of matching rows. Examples:
- Farmer / customer codes: `FARM|CUST + YYYYMMDD + NNNN`, from `utils/codeGeneration.ts generateIncrementalCode`.
- Vendor: `VENDOR<YYYY><NNNN>`.
- Vehicle dispatch: `VDR<yyyyMMdd><NNNNN>`.
- Employees: `PF00NNNN`.

There are no DB sequences and no unique constraints on most of these numbers, so **concurrent creates can collide** (§18). The per-module details are in §12.

### Table catalogue
The per-module tables are listed in §12. The key cross-module tables are:
- `employees`, `document_permissions`, `document_definitions`
- `approval_flows`, `approval_levels`, `approver_blocks`, `finalizer_blocks`, `documents`, `documents_approve_by_whom`, `approval_stage_info`
- `workflow_hierarchy`
- `notifications`, `audit_logs`, `user_activity_logs`, `system_log`, `active_sessions`, `blacklisted_token`
- `inventory_stock` and its movement tables (§13)
- `company`, `bank_details`, branches, offices, `address`

---

## 7. Caching (Redis)

`src/global/cache.service.ts` (`CacheService`, a singleton):
- Connects with `createClient({ url: REDIS_URL, password })`. The reconnect strategy backs off `min(retries*500, 3000)` ms and gives up after 5 retries.
- **Fails open.** If Redis is down, `get` returns null and `set` returns false, so the app keeps working without cache.
- API: `get<T>(key)`, `set(key, value, ttl = 3600)` (JSON through `SETEX`), `del`, and `invalidatePattern(pattern)`.
  - `invalidatePattern` uses `KEYS`, which is blocking. It is acceptable at the current scale but should be replaced with `SCAN` if the keyspace grows.
- Services build their own keys. Common conventions:
  - `<module>:list:<userId>:<md5(queryOptions)>` (TTL 180 s)
  - `<module>:id:<id>`, `<module>:view:<id>`, `<module>:update:<id>` (TTL 180–300 s)
  - `<module>:dropdown:*`
  - `auth:user:<uid>` (300 s), `auth:blacklist:<sha256(token)>` (3600 s)
  - `approvalFlow:*` (180 s)
  - `doc:byid:<docId>` (30 s), `singledoc:view:<docId>:<userId>` (30 s)
  - `user:list:*` (300 s)
- Create, update and delete invalidate by pattern (for example `rfpa:*`). The approval engines also bust the per-document-type prefixes when a status changes.
- `middleware/cache.middleware.ts` provides a generic GET cache (`api:<url>:<query>`, `X-Cache` header, presets short/medium/long). It is **not used**, and its keys are not user-scoped, so do not apply it to per-user lists.
- Redis is used **only as a cache**. The token blacklist is persisted in Postgres (`blacklisted_token`), and Redis only caches the lookup.
- TypeORM also has its own `query-result-cache` table (DB cache, 30 s) for queries that opt in with `.cache()`.

---

## 8. Authentication

**Files:** `src/auth/controller/auth.controller.ts`, `src/middleware/deserializeUser.ts`, `src/utils/jwt.ts`, `src/employee/service/user.service.ts`

### Tokens
- Both tokens are signed with `signJwt(payload, key, opts)`, **RS256**, using base64-decoded PEM keys. The payload is only `{ sub: user.id }`.
- Access token lifetime is `480m`; refresh token lifetime is `1440m`.
- **Cookies:**
  - `access_token` and `refresh_token` are `httpOnly`, `secure`, `sameSite: 'strict'`, `path: '/'`.
  - `logged_in=true` is set with `httpOnly: false`.
- **Token extraction** (`deserializeUser`): the `Authorization: Bearer <token>` header first, then the `access_token` cookie.

### Endpoints (`/auth`, no auth middleware)
| Method & Path | Body | Response / behaviour |
|---|---|---|
| `POST /auth/login` | `{ uid, password }` | `uid` can be a username, `workEmail`, or `primaryMobNo`. The type is auto-detected: an email regex match means `workEmail`, `/^[+\d][\d\s]+$/` means mobile, anything else is a username. See the login steps below this table. **200** `{ status, access_token, refresh_token, id, userName, roles, currentWorkLocation (branchId), employeeId, permissions: [{ documentDefinition: {id,name,uniqueKey}, canCreate, canView, canEdit, canDelete, canDownload }], hasChild }`. `hasChild` is true when the user has subordinates in `workflow_hierarchy`. |
| `POST /auth/refresh-token` | `{ refreshToken }` (body only, not read from the cookie) | Checks the blacklist (Redis `auth:blacklist:<sha256>`, falling back to the DB), verifies the token with the refresh public key, and issues a **new access token only**; the refresh token is not rotated. Returns `{ status, access_token }`. 403 if invalid, 401 if blacklisted. |
| `POST /auth/logout` | `{ refresh_token, access_token }` (both required) | Sets `isOnline = false`, blacklists both tokens in `blacklisted_token`, deactivates `active_sessions`, writes a LOGOUT activity log, clears cookies, and sends an SSE "Logout successfully" message. Returns `{ status, message }`. |

**Login steps:**
1. Load the user, cached at `auth:user:<uid>` for 300 s. Not found → 404.
2. If `status === 'INACTIVE'` → 403. Only `INACTIVE` is blocked.
3. Check the password with bcrypt → 401 if wrong.
4. Upsert the `active_sessions` row.
5. Save a `system_log` row with IP, browser, and device.
6. Set the cookies and send a "Login successfully" SSE notification.
7. Write a `user_activity_logs` LOGIN entry. Admins are skipped.

### `deserializeUser` / `requireUser`
- **`deserializeUser`**:
  - Verifies the access token. Missing or invalid → 401 "You are not logged in".
  - Checks `blacklisted_token` in the DB on **every request**. A match → 401.
  - Loads the `User` (no relations) into `res.locals.user`.
  - It does **not** check `status`.
- **`requireUser`** returns **400** if `res.locals.user` is missing.
- SSE is authenticated with `GET /sse/notifications?token=<accessToken>` (`utils/helperSSE.getUserIdFromToken`). This checks the signature only, not the blacklist.

### Passwords
- `User.@BeforeInsert` hashes `tempPlainPassword` with bcryptjs at cost 12.
- `createUser` always generates a random 10-character password into `tempPlainPassword`.
- **That plaintext is stored and returned by `GET /employee`**; it is meant for the admin to hand over to the employee.
- There is no change-password or reset endpoint wired up. `resetPasswordLink` and the `views/*.ejs` reset pages are unused.

### Sessions, rate limits
- `active_sessions` (`user_id`, `username`, `login_time`, `is_active`) is informational only. Concurrent logins are allowed.
- `blacklisted_token` (`id` serial, `token`, `createdAt`, `expiresAt`) has no index on `token` and is never purged.
- Rate limiters (`authRateLimit` 5/15 min, `apiRateLimit` 1000/15 min, `uploadRateLimit` 50/h) exist in `middleware/performance.middleware.ts` but are **not applied**. Nginx applies `10 r/s` when traffic goes through it.

---

## 9. Authorization (Roles, Departments, Document Permissions)

### Roles
- `employees.roles` is a Postgres enum array: `admin | employee | verifier | approver | finalizer`, default `['employee']`. `employee` is always merged in.
- **No middleware enforces roles.** Roles are used for:
  - master-data approval (vendor, farmer, customer, product): an `admin` or `verifier` who creates a record gets it auto-approved, and only a `verifier` can approve or reject;
  - `NotificationService.createNotiForRole`;
  - skipping activity logging for admins;
  - the login response, for the frontend's use.

### Departments
- `employees.department` is a `simple-array` of `Department` enum values.
- The workflow hierarchy uses a wider `DepartmentEnum`: `procurement, sale, operations, quality_checking, business_development, Branding_&_Marketing, exports, farming, accounts, finance, hr, it, admin, superAdmin`. It also has alias normalisation, e.g. `purchase` → `procurement`, `sales` → `sale`.

### Document permissions (`document_permissions`)
- **Columns:** `employeeId` → `employees`, `document_definition_id` → `document_definitions`, and five flags defaulting to false: `canCreate`, `canView`, `canEdit`, `canDelete`, `canDownload`.
- **How permissions are created:**
  - cascading from `POST`/`PUT /employee` with `permissions[]`;
  - employee Excel upload (a `name|type|c|v|e|d|dl;…` cell);
  - `POST /document-permission`.
- **`checkPermission(uniqueKey, 'create'|'view'|'edit'|'delete'|'download')`** (`middleware/checkPermission.ts`):
  - 404 if the definition is missing.
  - 403 if the permission row is missing or the flag is false.
  - There is no admin bypass.
  - ⚠️ **It is only applied to RFPA create, edit and delete.** Every other module checks authentication only. The frontend is expected to hide actions using the `permissions` returned at login.

### Document definitions (`document_definitions`: `uniqueKey` UNIQUE, `name`, `documentType`)
Seeded from `src/data/documentDefination.json`:

| uniqueKey | documentType | name |
|---|---|---|
| rfpa | Procurement | Request For Purchase Approval |
| deal-slip | Procurement | Deal Slip |
| grn | Procurement | Good Received Note |
| multi-cash-voucher / labor-payment-voucher / transport-payment-voucher / packaging-material-voucher | Procurement | vouchers |
| deliveryChallan-Customer | DC_TYPE_CUSTOMER | Customer Delivery Challan |
| deliveryChallan-Stock-Transfer | DC_TYPE_STOCK_TRANSFER | Stock Transfer DC |
| deliveryChallan-Other | Sale | Other Delivery Challan |
| inward-register, aqr, dump-register, vehicle-dispatch-register, return-by-customer, return-by-vendor (i.e. Return To Vendor), eod-report, Inventory | Operation | … |
| second-sale, final-invoice | Sale | … |

### Visibility scoping
Most document lists are **not** filtered by branch. Visibility comes from the approval engine: a user sees the documents they created or are an approver on (§10.5). Master data such as vendors, farmers and customers uses role-based visibility:
- A plain employee sees only their own records.
- A verifier sees every record that is not a draft.
- An admin sees non-drafts plus their own drafts.

---

## 10. Approval Workflow Engine

**Files:** `src/approvalFlow/**`, `src/inventoryStock/service/inventoryMovement.service.ts`

Every transactional business document, such as a GRN or a DC, has a companion row in the generic **`documents`** table (entity `Documentb`). The approval state lives there, **not** on the business row. Business rows sometimes carry their own `status` or `approvalStatus` columns; these are mostly stale or unused.

### 10.1 Configuration entities
| Table | Purpose / columns |
|---|---|
| `approval_flows` | One flow per **(creator user, category)**. `creator_id` → employee (the person whose documents this flow governs). `type` is the category: `Procurement \| Sale \| Operation \| …` (documentDef `DocumentTypeEnum`). `verifiers`: M2M users (`approval_flow_verifiers`). `approval_level_id` → `approval_levels`. `finalizer_block_id` → `finalizer_blocks`. |
| `approval_levels` | Six OneToOne `approver_blocks`: `first_approver_block_id` … `sixth_approver_block_id`. |
| `approver_blocks` | `hierarchy` int, `minAmtCanApprove` / `maxAmtCanApprove` decimal (the amount band), `users` M2M (`approver_block_users`). |
| `finalizer_blocks` | `firstFinalizers` and `secondFinalizers`, both M2M users. |

**Mapping from document to category** (the `docDef` passed to `createDocument`):

| Category | Documents |
|---|---|
| **Procurement** | RFPA, Deal Slip, GRN, Multi Cash Voucher, Labour Payment Voucher, Transport Payment Voucher, Packing Material Voucher |
| **Operation** | AQR, Inward Register, Dump Register, EOD Report, Vehicle Dispatch, Stock Transfer DC, Other DC, Return By Customer, Return To Vendor |
| **Sale** | Customer DC, Final Invoice, Second Sale |

A flow is resolved by `(creator = logged-in user, type = category)`. If none exists, most create endpoints fail fast with **400 "Approval flow not configured for user…"** (`checkApprovalFlowExists`). There is no unique constraint on `(creator, type)`.

### 10.2 Runtime entities
| Table | Purpose / columns |
|---|---|
| `documents` (`Documentb`) | `type`: the approvalFlow `DocumentTypeEnum`, one of `grn, rfpa, deal-slip, inward-register, aqr, dump-register, vehicle-dispatch-register, return-by-customer, return-to-vendor, second-sale, eod-report, proforma-invoice, final-invoice, multi-cash-voucher, labor-payment-voucher, transport-payment-voucher, packaging-material-voucher, DC_TYPE_CUSTOMER, DC_TYPE_STOCK_TRANSFER, DC_TYPE_OTHER`. `document_type_id`: **the id of the business row**. `totalAmt` decimal (drives the approver amount band). `status` (`DocumentStatus`). `remarks`. `last_action_by`: **the creator**. `approval_flow_id`, `approval_info_id`. `inventoryProcessed` bool (idempotency guard for stock movement). |
| `documents_approve_by_whom` | Six OneToOne `approval_stage_info` rows: `verified`, `firstApproved`, `secondApproved`, `thirdApproved`, `firstFinalized`, `secondFinalized`. |
| `approval_stage_info` | `userId`, `userName`, `status` (`ApproverStatus`: `hold, approved, reject, verified, unverified, FINALIZING`), `reason`, `statusChangedAt`. |

`DocumentStatus` values are `hold, query, approved, disapproved, FINALIZING, FINALIZED, COMPLETE, REJECT, VERIFIED`. The ones actually used are **`hold`, `VERIFIED`, `approved`, `FINALIZING`, `COMPLETE`, `REJECT`**.

**Legacy or unused:** `document_approvals`, `hierarchy`, `departmentsForApprove`, `requests` (in `sse/`), and `ApprovalLevelService`.

### 10.3 Document lifecycle
1. The business service saves the business row. This is sometimes done in a transaction.
2. `DocumentbService.createDocument({ type, docDef, totalAmt, status: 'hold', remarks, lastActionBy: {id}, document_type_id })` creates the `documents` row and links the flow.
3. `startApprovalFlow(documentId)` **only sends notifications** ("You have been assigned as …"):
   - GRN and vouchers notify the verifiers.
   - Otherwise it notifies the first matching amount band, or L1 (and L2 for double-level types).
   - If no band matches it throws "No approver found for this document amount", **after** the business row has been committed.
4. Approvers act through one of **three engines**, chosen by document type.

All three engines take the body `{ status: 'approved' | 'reject' | 'query', reason? }` and return `{ message: 'Document <status> successfully' }`. Errors return **500 `{message}`**.

### 10.4 The three engines (`/documents` controller)
| Engine | Endpoint | Document types | Rules |
|---|---|---|---|
| **A. Single level** (`DocSingalApproverService`) | `PATCH /documents/updatefirstlevel/:documentId` | RFPA, Deal Slip, AQR, Inward Register, Vehicle Dispatch | Only users in the **first approver block** may act. **Any one of them** decides. `approved` runs an inventory pre-flight (`assertMovementIsApplicable`), then `COMPLETE`, and applies stock in the same transaction (`completeDocumentWithInventory`). `reject` sets `REJECT`. Notifies the creator and the other L1 users. |
| **B. Double level** (`DocDoubleApproverService`) | `PATCH /documents/updatesecondlevel/:documentId` | Customer, Stock Transfer and Other DC; the four vouchers; Dump Register; Final Invoice; Return To Vendor; Return By Customer; Second Sale; EOD Report | The user must be in approver block 1 or 2. **L1 and L2 approve in parallel, in either order.** Status stays `hold` until **both** approve, then becomes `COMPLETE` and inventory is applied. Any `reject` sets `REJECT`. `query` is rejected as invalid. |
| **C. Multi level with verifier and finalizers** (`DocumentbService.approveDocumentStep`) | `PATCH /documents/update/:documentId` | **GRN and the four vouchers** | See the stages after this table. **No inventory movement is applied in this engine.** |

**Engine C stages:**
1. **Verifier.** Only `flow.verifiers` may act. Approve sets `VERIFIED` and notifies the approvers; reject sets `REJECT`. If the flow has no verifiers, the document can never progress.
2. **Approvers by amount band.** A block is required when it has users and `min ≤ totalAmt ≤ max` (null min is treated as 0, null max as ∞):
   - band 1 needs L1;
   - band 2 needs L1 and L2;
   - band 3 needs L1, L2 and L3.
   Each level acts once, in any order. When all required levels have approved, the status becomes `approved` and the first finalizers are notified. Any rejection sets `REJECT`.
3. **Finalizer 1** approves → `FINALIZING`.
4. **Finalizer 2** approves → `COMPLETE`.

Terminal states for all engines are **`COMPLETE`** and **`REJECT`**. Once a document reaches one of them, further actions fail with "already approved/rejected". Approver blocks 4–6 exist in the schema but are **never used** by any engine.

### 10.5 Listing and viewing (called by each business module)
- **`DocumentbService.getAllDocumentByUserId(userId, type, queryOptions, skipPagination?, includeDeleted?)`** returns the documents the user may see:
  - Creator: any status.
  - Verifier: `hold`, `VERIFIED`, `approved`, `FINALIZING`, `COMPLETE`, `REJECT`.
  - Approver L1–L6: `VERIFIED` and later.
  - Finalizer 1: `approved`, `FINALIZING` before the first finalization, or terminal.
  - Finalizer 2: `FINALIZING` after the first finalization, or terminal.

  The shared document filters (§15.1) are applied in SQL.
- **`DocSingalApproverService.getAllSingleApprovalDocumentsByUserId` / `getSingleApprovalDocumentById(docId, userId)`**: visible to the creator or an L1 user. Returns `null` otherwise, which controllers map to 403.
- **`DocDoubleApproverService.getAllDocumentByUserIdForDoubleApprover` / `getDocumentById`**: visible to the creator or an L1/L2 user.
- **`DocumentbService.getDocumentById(docId)`**: full `approvalSummary` with `{ createdBy, verified, firstApproved, secondApproved, thirdApproved, firstFinalized, secondFinalized }`, each holding `{userId, userName, status, reason, statusChangedAt}`. Cached `doc:byid:<id>` for 30 s.

**Business module conventions:**
- List endpoints return business rows merged with `documentId`, `overAllStatus` (= `documents.status`), `createdBy`, `createdDate`, `createdTime`.
- **`GET /<module>/:id/view` usually takes the `documents.id`.**
- **`GET /<module>/:id/update` takes the business row id.**

### 10.6 Approval-flow administration (`/approval-flow`)
| Method & Path | Contract |
|---|---|
| `POST /approval-flow` | `{ creator: userId, type: 'Procurement'\|'Sale'\|'Operation', verifiers: [userId], approvers: { firstApprover..sixthApprover: { hierarchy, minAmtCanApprove, maxAmtCanApprove, users: [userId] } \| null }, finalizers: { firstFinalizers: [userId], secondFinalizers: [userId] } }` → 201 `{ status, data: flowId, message }`. `finalizers` is required: a missing object throws. |
| `GET /approval-flow?type=&page=&limit=` | `{ data: [{ id, type, creator: "First Last", verifiers: [names], approvers: { first..fifth: { id, hierarchy, min, max, users: [names] } }, finalizers }], allRecords, totalPages, page, limit }`. Returns 404 when empty. |
| `GET /approval-flow/:id/view` | Same shape with names, including the sixth block. |
| `GET /approval-flow/:id` | Form shape with ids. |
| `PATCH /approval-flow/:id` | Partial update: replaces verifiers, updates **existing** blocks passed with their `id`, fully replaces finalizers. It cannot add a block to an empty slot. |
| `POST /approval-flow/replace/user` | `{ oldUserId, newUserId }`. Swaps a user across every junction table and `creator_id` in one transaction. Use this when an employee leaves. |
| `GET /approval-flow/user/:userId/:department` | That user's flow: `{ id, type, verifiers:[{id,name}], approvers:{firstApprover:[{id,name}]…}, finalizers }`. |

### 10.7 Recycle bin (`/super-admin`, auth only; **no role check**)
- `PATCH /super-admin/soft-delete/:docId`: sets `isDeleted` on the document and on the business row, by type.
- `PATCH /super-admin/restore/:docId`
- `DELETE /super-admin/permanent/:docId`: hard delete.
- **Not supported:** the DC types and return-to-vendor.
- Restore likely fails, because `deletedAt` is a `@DeleteDateColumn`, so the soft-deleted row is hidden from the lookup.

---

## 11. End-to-End Business Flows

### 11.1 Procure-to-Stock (farm/vendor → warehouse)
```
[Procurement Target] monthly plan per buyer (manager approves via workflow_hierarchy)
        │
1. RFPA  (buyer; party = vendor|farmer; lines qty×price; payment terms)   → engine A (L1 any-of) → COMPLETE
2. Deal Slip (1 per RFPA; lotNo, loadingLocation)                         → engine A → COMPLETE
3. GRN (goods received at purchaseLocation; weights, revised qty/rate, bill, payment info)
        → engine C: verifier → amount-band approvers → finalizer1 → finalizer2 → COMPLETE
        → edits after approval reset the document to HOLD; qty/rate edits are versioned in grn_product_history
        → achievement for Procurement Targets = Σ netWeight of COMPLETE GRNs
4. AQR (quality check: arrived vs sampled qty, good/bad/average %)        → engine A
5. Inward Register (type=purchase, grn_id)                               → engine A → COMPLETE ⇒ inventory_stock += netWeight / +unitPrice×qty
6. Payment: Payment Request (grn_id) and/or vouchers (MCV/LPV/TPV/PMPV, grn_id) → engine C
        GRN.ammountStatus toggled paid/unpaid via PUT /grns/amount-status/:id
7. Exceptions: Return To Vendor (grn_id)  → engine B → COMPLETE ⇒ stock −netWeight
               Dump Register (purchase)  → engine B → COMPLETE ⇒ stock −qty, dumpQty +qty
```
**Note:** a GRN does not move stock by itself. Stock enters **only through the Inward Register**.

### 11.2 Order-to-Cash (warehouse → customer)
```
[Sales Target] monthly plan per salesperson/customer/product (manager approves)
1. Customer DC (fromLocation; stock availability validated at create)   → engine B (L1 & L2, either order) → COMPLETE ⇒ stock −netWeight
2. Vehicle Dispatch Register (delivery_challan_id; logistics & client GRN feedback) → engine A
3. Return By Customer (1 per DC): returned + rejected qty; writes acceptedQty back to DC items → engine B
      └─ Dump Register (returned-by-customer) → engine B → stock −qty
4. Final Invoice (1 per DC): bills acceptedQty × unitPrice + tax/freight/other − discount → engine B
      PDF via /final-invoice/pdf/download; paid/unpaid via /final-invoice/amount-status/:id
5. Second Sale: distress sale of leftover/lower grade to ad-hoc buyer (optional DC link) → engine B
```

### 11.3 Inter-branch transfer
```
Stock Transfer DC (cc-dc | dc-dc | dc-cc | cc-cc; from → to) → engine B → COMPLETE ⇒ stock −netWeight at FROM
Inward Register (type=transferred, deliveryChallanNo, fromLocation) at TO → engine A → COMPLETE ⇒ stock +netWeight at TO
(AQR with aqrFor=transfer can quality-check the arrival)
```

### 11.4 Stock control
- **EOD Stock:** a physical closing-stock declaration. It is approved but causes **no** stock change.
- **Stock Correction:** submitted, then approved, and **then** changes `inventory_stock` directly.
- **`/inventoryStock/endoftheday/eod-report`:** a live aggregate of the day's activity.

### 11.5 Master-data onboarding (Vendor / Farmer / Customer)
```
create (draft | submit) → pending → verifier approves (approved) / rejects (notapproved)
   * creator with admin/verifier role ⇒ auto-approved
   * list visibility: employee → own; verifier → all non-drafts; admin → non-drafts + own drafts
   * Excel bulk import creates rows as pending; duplicates skipped
```

### 11.6 Employee onboarding
```
POST /employee (DRAFT, random password) → PATCH /employee/submit/:id (INACTIVE) → PATCH /employee/status/:id?status=ACTIVE
   + approval flows configured per (employee, category) in /approval-flow
   + reporting lines in /workflow (closure table) for target approvals & team dashboards
   + document permissions (canCreate/View/Edit/Delete/Download per document definition)
```

---

## 12. Module Reference

**Conventions that hold for every module unless a module says otherwise:**
- All controllers apply `deserializeUser, requireUser`.
- There is no global route prefix; the `@controller` path is the URL root.
- Most document modules follow the same pattern:
  1. `checkApprovalFlowExists`
  2. save the business row (in a transaction)
  3. `createDocument`
  4. commit
  5. `startApprovalFlow`
  6. invalidate the cache
  7. send the "X created successfully" notification and write a `user_activity_logs` entry
- Updates call `AuditLogService.logChange`.
- List endpoints accept `page`, `limit`, `search` (an in-memory deep substring match), `sort=field:ASC|DESC`, plus the shared document filters (§15.1).
- `/export/excel` streams an .xlsx built from the module's `excel/*.export.ts`. It contains a header sheet, a lines sheet and an approvals sheet.
- Delete endpoints come in two forms:
  - `DELETE /:id` schedules deletion 6 months out.
  - `DELETE /delete/multiple` takes `{ids}` and sets `isDeleted` (and sometimes `softDelete`) on both the business row and its `documents` row.
- Recycle-bin lists read `isDeleted = true`.
- `:docid` in a route means `documents.id`. `:id` usually means the business row id.

### 12.1 Procurement

```
ProcurementTarget (monthly/weekly qty plan per buyer & product)
      │ achievement = Σ netWeight of COMPLETE GRN lines by that buyer
Farmer / Vendor (party masters, own draft→pending→approved flow)
      │ source = 'vendor' | 'farmer'
RFPA ──(1:1, rfpa.isDealSlipCreated)──► Deal Slip ──(grns.deal_slip_id)──► GRN
                                                                           ├─ PaymentRequest (grn_id)
                                                                           ├─ Inward Register (grn_id) → on COMPLETE: stock IN
                                                                           ├─ Return To Vendor (grn_id) → on COMPLETE: stock OUT
                                                                           └─ Vouchers (MCV/LPV/TPV/PMPV grn_id)
AQR (quality check) – linked to a purchase DC / product / party, NOT to GRN
```

GRN has a set of "downstream created" flags:
- `isAQRCreated`, `isInwardCreated`, `isDumpCreated`, `isDCForCustomerCreated`
- `isMCVoucherCreated`, `isTPVoucherCreated`, `isPMPVoucherCreated`, `isLPVoucherCreated`

They filter the GRN-number dropdown, but **nothing ever sets them to true**. The same applies to `DealSlip.isGrnCreated`.

#### RFPA: Request For Purchase Approval (`/rfpa`, `src/rfpa/`)
**Purpose:** a purchase request raised by procurement. It records the party (vendor or farmer), the company, the purchase location, the "for sales" location, the product lines, and the payment terms.
- Approval: engine A (single level), category `Procurement`.
- No stock effect.

| Method | Path | Notes |
|---|---|---|
| POST | `/rfpa` | Requires `checkPermission('rfpa','create')`. See the body below this table. The controller sets `createdBy`/`requestingDepartment` from the user and maps `selectedParty` to `selectedVendor` or `selectedFarmer`. Returns 201 `{status, message, data: RFPA}`. |
| PATCH | `/rfpa/:id` | Requires `checkPermission('rfpa','edit')`. Partial update. `rfpaProducts`, if sent, **replaces all lines**. `paymentInfo: null` removes the payment row. Dates may be sent as `dd-MM-yyyy`. Approval is **not** reset. |
| DELETE | `/rfpa/:id` | Requires `checkPermission('rfpa','delete')`. Schedules deletion. |
| GET | `/rfpa` | List. Filters: `source`, department, company, vendor, farmer, locations, `isDealSlipCreated`. The business date is `createdAt`. |
| GET | `/rfpa/view/:docid` | Full view with `approvalSummary`, party details, payment info and products. Returns `data: null` if the user has no access. |
| GET | `/rfpa/:id/update` | Form DTO with ids. |
| GET | `/rfpa/rfpanumbers/getAllRfpaNo` | Dropdown for the Deal Slip form. Query `isDealSlipCreated`, `overAllStatus`, `employeeBaseHirechey`, `page`, `limit`, `search`. Returns `[{id, rfpaId, documentId}]`. |
| GET | `/rfpa/recyclebin`, `/rfpa/export/excel` | Recycle bin and export. |
| DELETE | `/rfpa/delete/multiple` | Bulk delete. |
| PATCH | `/rfpa/approve/:rfpaId`, GET `/rfpa/rfpas/approved` | **Stubs**: they return hard-coded `10`. |

**POST `/rfpa` body:**
```jsonc
{ "source": "vendor|farmer", "selectedParty": "<vendorId|farmerId>", "companyName": "<id>",
  "purchaseLocation": "<branchId>", "purchaseForSalesLocation": "<branchId>", "otherPurchaseLoc": "", "otherPurchaseForSalesLoc": "",
  "deliveryReceivingPerson": "", "packingInstruction": "", "specialReq": "", "remark": "",
  "paymentInfo": { "paymentMode": "", "paymentDate": "", "advancePaidAmt": 0, "paymentTerms": 0, "dueDate": "", "creditPeriod": 0, "validityOfQuote": "" }, // REQUIRED
  "rfpaProducts": [{ "productName": "<productId>", "variant": "<variantId>", "uom": "<uomId>", "grade": "", "quantity": 10, "unitPrice": 25.5,
                     "amount": 255, "count": "", "size": "", "origin": "", "variety": "",
                     "purchaseDate": "", "expectedHarvestDate": "", "dispatchDate": "", "deliveryDate": "" }] }
```

**Tables:**
- **`rfpa`**:
  - `rfpaId` (the business number, not unique), `requestingDepartment`
  - `company_id`, `purchaselocation_id`, `purchaseforwhich_id` (branches)
  - `otherPurchaseLoc*`, `delivery_receiving_person`, `packing_instruction`
  - `vendor_id` / `farmer_id`, `source`, `special_request`
  - `payment_info_id` (1:1), `remark`
  - `isDealSlipCreated` (default false)
  - `created_by` (**never populated**)
- **`rfpa_product`**: `product_id`, `varient_id`, `uom_id`, `grade`, `quantity` (**int**), `unit_price` numeric(10,2), `count`, `size`, `origin`, `variety`, `total_value` (`amount`), the four dates, `rfpa_id`.
- **`payment_info_for_rfpa`**: `payment_mode` (NOT NULL), `payment_date`, `advance_paid_amount`, `payment_terms` numeric, `payment_dute_date`, `credite_period`, `validity_of_quote`.

**Logic:**
- **Number format:** `RFPA{yyyyMMdd}{5-digit}`, computed as MAX + 1 for the day.
- **Amounts** come from the client; the server calculates nothing.
- **Cache:** `rfpa:*`, TTL 180 s.
- **`employeeBaseHirechey` filter** on the numbers dropdown works out the caller's level in the creator's Procurement flow:
  - 1 creator, 2 verifier, 3–5 approvers, 6–7 finalizers
  - Level 0 is excluded.
  - Because `createdBy` is never set, this filter drops every record.

#### Deal Slip (`/dealSlip`, `src/dealSlip/`)
**Purpose:** confirms the lot for an RFPA, with `lotNo`, `loadingLocation` and `specialRequest`.
- **Only one deal slip may exist per RFPA.** A second one returns 409 when `rfpa.isDealSlipCreated` is already true.
- Approval: engine A, category `Procurement`.
- Deleting a deal slip does **not** reset the RFPA flag.

| Method | Path | Notes |
|---|---|---|
| POST | `/dealSlip` | Body `{ rfpa: <rfpaId>, lotNo, loadingLocation, specialRequest, remark?, approvalNote? }`. `lotNo`, `loadingLocation` and `specialRequest` are NOT NULL. Returns 200 `{status, data}`. |
| PATCH | `/dealSlip/:id` | Uses `captureUser`. Applies a raw `Object.assign`. |
| PATCH | `/dealSlip/approve/:id` | Legacy stand-alone approval: `{approvalStatus: 'approved'\|'notapproved', approvalNote}` sets `dealSlipApprovedAt`. No role check. |
| GET | `/dealSlip` | List. Filters: `approvalStatus`, `dealSlipNo`, `lotNo`, `loadingLocation`, `rfpaNo`, party, `isGrnCreated`. Returns rows `{documentId, overAllStatus, createdBy, createdDate, createdTime, id, rfpa, lotNo, loadingLocation, remark, specialRequest, dealSlipNo}`. |
| GET | `/dealSlip/view/:docid` | View; 403 if no access. |
| GET | `/dealSlip/:id/update` | Form DTO. |
| GET | `/dealSlip/dealslipno/getAlldealslipNo` | GRN-form dropdown `[{id, dealSlipNo, documentId, rfpaId}]`. Returns 404 when empty. |
| GET / DELETE | `recyclebin`, `export/excel`, `:id`, `delete/multiple` | Standard. |

**Table `deal_slips`:** `rfpa_id`, `lotNo`, `approvalNote`, `loadingLocation`, `remark`, `specialRequest`, `requestingDepartment`, `approval_status` (Status, default pending), `dealSlipCreatedAt`, `dealSlipApprovedAt`, `dealSlipNo`, `isGrnCreated`, `created_by`.

**Number format:** `DL{yyyyMMdd}{5-digit}`.

#### GRN: Goods Received Note (`/grns`, `src/grn/`)
**Purpose:** records goods physically received from a vendor or farmer (purchase) or from another branch (transfer). It captures:
- product lines with ordered and revised quantity/rate, gross/packing/net weight, and an RTV flag
- the bill number and bill image
- subtotal, freight, other charges, total, and amount in words
- vehicle number, time in, crates in
- payment info and a paid/unpaid flag

Approval runs through **engine C** (verifier → amount-banded approvers → 2 finalizers), category `Procurement`. `totalAmt` selects the amount band.

| Method | Path | Notes |
|---|---|---|
| POST | `/grns` | `uploadSingle.single('billImage')`, multipart. Returns 201 `{status, message}`. |
| PUT | `/grns/:id` | `uploadSingle.single('billImage')`, `captureUser`. The body is the JSON string field `grn` or plain fields. See "Update logic" below. ⚠️ A new bill image is lost: the handler reads `req.file.path` instead of `location`. |
| GET | `/grns` | List. Filters: `grnType`, `purchaseType`, `locationType`, `source`, `paymentStatus`, department, company, `dealSlipNo`, `rfpaNo`, party, locations, `vehicleNo`, `billNo`, min/max `totalAmt`. |
| GET | `/grns/view/:docid` | Full view with names and approval summary. ⚠️ No per-user access check. |
| GET | `/grns/update/:id` | `:id` is the **document id**. Form DTO. |
| GET | `/grns/grnnumbers/getAllgrnNo` | Dropdown `[{id, grnNo, documentId}]`. Filters: `is*Created` flags, `overAllStatus`, `employeeBaseHirechey`. |
| GET | `/grns/product-history/:id` | Quantity/rate edit history: `[{grnProductId, productName, variantName, version, oldQuantity, newQuantity, oldRate, newRate, modifiedBy, modifiedDate, modifiedTime}]`. |
| PUT | `/grns/amount-status/:id` | `{ammountStatus: 'paid'\|'unpaid'}`. Works on soft-deleted rows too. |
| GET / DELETE | `/grns/recycle-bin`, `/grns/export/excel`, `/grns/:id`, `/grns/delete/multiple` | Standard. |

**POST `/grns` body** (multipart):
- Header: `companyName`, `purchaseInstructionsBy` (user), `locationType` (`cc|dc`), `grnType` (`transfer|purchase`), `purchaseType` (`fixed price sales | consignment sales / bikri | mgp sales`)
- Links: `dealSlipId`, `rfpaId`
- Locations: **`purchaseLocation` (a branch id, required because it drives numbering)**, `purchaseForSalesLocation`, `otherPurchaseLoc*`
- Party: `source` + `selectedParty` (400 if a vendor/farmer source is given without a party)
- Amounts: `billNo`, `subTotalAmt`, `freight`, `otherCharges`, `totalAmt`, `amtWords`
- Logistics: `purchasedBy`, `approvalNote`, `receivedThrough`, `vehicleNo`, `timeIn` (`HH:mm` or `h:mm am/pm`), `cratesIn`, `deliveryReceivingPerson`, `baseLocation`, `remark`, `purchaseBy` (user), `securityPerson`, `specialReq`
- `paymentInfo {paymentMode, paymentDate, advancePaidAmt, remainingAmt, paymentTerms, dueDate, creditPeriod}`
- `grnProducts[] {productName, variant, uom, quantity, unitPrice, amount, rtv, netWeight, grossWeight, packingMaterialWeight, revisedRate, revisedQuantity, purchaseDate, dispatchDate, deliveryDate, expectedHarvestDate}`

**Tables:**
- **`grns`**:
  - Header: `company_id`, `purchaseInstructionsBy_id`, `requestingDepartment`, `grnNo`, `locationType`, `grnType`, `purchaseType`
  - Links: `deal_slip_id`, `rfpa_id` (never set, because the DTO key is `rfpaId`)
  - Locations: `purchaselocation_id`, `purchaseforwhich_id`, `branch_id` (never set)
  - Party: `source`, `vendor_id`, `farmer_id`
  - Amounts: `billNo`, `billImage`, `subTotalAmt`/`freight`/`otherCharges` decimal(12,2) default 0, `totalAmt`, `amtWords`
  - Logistics: `timeIn` (timestamp; the transformer shows it as IST `HH:mm`), `cratesIn`, `vehicleNo`, `rmn`, `baseLocation`
  - People: `purchase_id`, `createdby_id`, `current_level_id` (Levels)
  - Payment: `payment_info_id`, `ammountStatus` (`paid|unpaid`, default unpaid)
  - The 8 `is*Created` flags
- **`grn_products`**: `grn_id`, `product_id`, `varient_id`, `uom_id`, `quantity`/`revisedQuantity`/`unitPrice`/`revisedRate` decimal(10,2), `amount` decimal(12,2), `grossWeight`/`packingMaterialWeight`/`netWeight` decimal(100,3), `rtv`, the 4 dates.
- **`grn_product_history`**: `grn_id`, `grn_product_id`, `product_id`, `variant_id`, `modified_by_id`, `version`, `oldQuantity`, `newQuantity`, `oldRate`, `newRate`, `modifiedAt`.
- **`payment_info_for_grn`**: `payment_mode`, `payment_date`, `advance_paid_amount`, `remaining_amount`, `payment_terms` (text), `payment_dute_date`, `credite_period`.

**Logic:**
- **Number format:** `{branch.prefix}-{count+1:5}`. It is count-based, so numbers can collide.
- **No GST/tax fields exist, and there is no server-side calculation** of amounts or net weight.
- **Update logic:** runs in a transaction.
  1. For each product line whose quantity or unit price changed, write a history row with `version = MAX + 1`.
  2. Lines with an id are updated. Lines without an id are inserted. Omitted lines are orphaned.
  3. `paymentInfo` is upserted.
  4. **If the linked document is VERIFIED, APPROVED, FINALIZING, FINALIZED or COMPLETE, it is reset to `hold`**, `approvalInfo` is cleared, and `startApprovalFlow` runs again after commit.
  5. The TypeORM query cache and Redis `grn:*` keys are cleared.
- **Cache:** `grn:all|recycle|numbers:<md5>`, `grn:view|update:<docId>`, TTL 180 s.

#### Payment Request (`/paymentRequest`, `src/paymentReq/`)
**Purpose:** a request to pay a party against a GRN. It is **not** an approval document, has no number, and is not cached.

| Method | Path | Notes |
|---|---|---|
| GET | `/paymentRequest` | Returns all rows, unpaginated, including rows scheduled for deletion. |
| GET | `/paymentRequest/:id` | One row. |
| POST | `/paymentRequest/:grnId` | **`:id` is the GRN id.** Body is the entity fields. `requestedBy` is set to the user. Returns 201. |
| PATCH | `/paymentRequest/:id` | Uses `captureUser`. Raw `repository.update`. |
| DELETE | `/paymentRequest/:id` | Schedules deletion. |

**Table `payment_request`:**
- `paymentDate` (CreateDateColumn of type date)
- `partyName`, `amount` numeric(15,2), `bankAccNo`(20), `ifscCode`(11), `paymentMode`, `typesOfTransaction` (all NOT NULL)
- `otherTransaction`, `vehicleNo`, `placeOfPurchase`
- `contactpersonRec`, `contactpersonSen`, `costCenter` (NOT NULL)
- `kycByEmail`, `remark`
- `grn_id`, `requested_by_employee_id`

Creating a payment request does not update the GRN's `ammountStatus`.

#### Inward Register (`/inwardRegister`, `src/inwardRegister/`)
**Purpose:** the warehouse stock-in register at a branch. `inwardType` is one of:
- `purchase`: against a GRN, from a vendor or farmer
- `transferred`: against a purchase DC from `fromLocation`
- `returned-by-customer`: against an RBC and a customer

Approval: engine A, category `Operation`.

**On COMPLETE, stock goes IN.** For each line, at (company, location, product, variant):
- quantity `+ netWeight`
- value `+ unitPrice × quantity`

| Method | Path | Notes |
|---|---|---|
| POST | `/inwardRegister` | Body `{ inwardType*, grnNo?, deliveryChallanNo?, rbcNo?, companyName*, location* (branch), fromLocation?, date, batchNo, source, selectedParty, customerName, purchasedBy, inwardBy, incomingGrossQty, incomingNetQty, inwardGrossQty, inwardNetQty, inwardCost, totalWeightInKg, remarks, inwardProducts[]{productName, variant, uom, packingMaterialWeight, quantity, weight, unitPrice, amount, netWeight, grossWeight} }`. Returns 201. |
| PATCH | `/inwardRegister/:id` | Raw `Object.assign`. Approval is **not** reset, even after stock was applied. |
| GET | `/inwardRegister` | List. Filters: `inwardType`, `source`, `batchNo`, `grnNo`, `deliveryChallanNo`, `rbcNo`, company, location, `fromLocation`, party, min/max `inwardCost`. The business date is `date`. |
| GET | `/inwardRegister/view/:docid` | View; 403 if no access. |
| GET | `/inwardRegister/update/:id` | Form DTO. |
| GET / DELETE | `recyclebin`, `export/excel`, `:id`, `delete/multiple` | Standard. |

**Tables:**
- **`inward_register`**:
  - Links: `grn_id`, `delivery_challan_id`, `rbc_id`
  - `inwardType` (`purchase|transferred|returned-by-customer`), `inwardNo`
  - Locations: `company_id`, `branch_id` (location), `fromlocation_branch_id`
  - `date`, `batchNo`
  - Party: `vendor_id`, `farmer_id`, `customer_id`, `source`
  - Quantities: `incomingGrossQty`/`incomingNetQty`/`inwardGrossQty`/`inwardNetQty`/`inwardCost`/`totalWeightInKg` decimal(100,3)
  - `remarks`, `purchase_id`, `user_id` (inwardBy)
- **`inwardProduct`**: product, variant, uom, `packingMaterialWeight`, `quantity`, `weight`, `unitPrice`, `amount`, `netWeight`, `grossWeight` (decimal(100,3)), `inwardRegisterId`.

**Number format:** `IWD{yyyyMMdd}{count+1:4}`. **Cache:** `iwr:*`.

#### AQR: Arrival Quality Report (`/aqr`, `src/aqr/`)
**Purpose:** a quality check on arriving produce, covering one product/variant per AQR. It records:
- `arrivedQty` and `samplingQty` (varchar)
- quality `parameters[]`, each with type good/bad/average, a quantity and a percentage
- the people who purchased, received, QC-checked and verified

`aqrFor` is `purchase` or `transfer` (the latter against a purchase DC from `fromLocation`).

Approval: engine A, category `Operation`. No stock effect.

| Method | Path | Notes |
|---|---|---|
| POST | `/aqr` | Relations are sent as `{id}` objects: `{ aqrFor, companyName{id}, location{id}, source, selectedParty{id}, deliveryChallanNo{id}?, fromLocation{id}?, product{id}, variant{id}?, arrivalDate, arrivedQty, samplingQty, purchaseBy/receivedBy/qcCheckBy/verifiedBy{id}, totalQty, totalpercent, remark, parameters[]{qualityParameterId, qualityParameterName, qualityParameterType: 'good'\|'bad'\|'average', quantity, percentage} }`. |
| PATCH | `/aqr/:id` | ⚠️ `selectedParty` is ignored on update, and the audit `updatedBy` is undefined because `captureUser` is missing. |
| GET | `/aqr` | List. Filters: `aqrFor`, `source`, DC, company, location, `fromLocation`, party, `supplierName`, `arrivalDate`. The business date is `arrivalDate`. |
| GET | `/aqr/view/:docid`, `/aqr/update/:id`, `/aqr/recycle-bin`, `/aqr/export/excel` | Standard. |
| DELETE | `/aqr/:id`, `/aqr/delete/multiple` | Standard. |

**Tables:**
- **`aqr`**: `aqrFor`, `company_id`, `branch_id`, `source`, `delivery_challan_id`, `vendor_id`, `farmer_id`, `fromlocation_id`, `product_id`, `varient_id`, `arrivedQty` (varchar), `arrivalDate`, `samplingQty` (varchar), `aqrNo`, `purchase_id`, `received_id`, `qccheck_id`, `verified_id`, `totalQty`, `totalpercent`, `remark`.
- **`aqr_parameter`**: `qualityParameterId` (a free string, not an FK), `qualityParameterName`, `qualityParameterType` enum, `quantity`, `percentage`, `aqrId`.

**Number format:** `AQR{yyyyMMdd}{5-digit}`. The server does not check that the parameter percentages add up to 100.

#### Return To Vendor (`/return-to-vendor`, `src/returnToVendor/`)
**Purpose:** returns goods received on a GRN back to the vendor.
- Approval: **engine B (double level)**, category `Operation`.
- **On COMPLETE, stock goes OUT** at `rtv.location`: quantity `− netWeight`, value `− unitPrice × quantity`. Availability is not validated.

| Method | Path | Notes |
|---|---|---|
| POST | `/return-to-vendor` | `{ grnNo* (GRN id), companyName, location, selectedVendor, returnedGrossWeight, returnedNetWeight, totalAmt, returnDate, amtWords, remark, rtvProducts[]{productName, variant, uom, quantity, unitPrice, netWeight, grossWeight, amount, packingMaterialWeight, reason} }`. Returns 201 `{status, data: id, message}`. |
| GET | `/return-to-vendor` | List. Returns `{data, totalRecords, totalPages, page}` (note: `totalRecords`, not `allRecords`). |
| GET | `/return-to-vendor/:id`, `/view/:docid`, `/update/:id` | `update` crashes if a relation is null. |
| PUT | `/return-to-vendor/:id` | Guard against editing after inventory never fires, because `rtv.document` is never set. |
| DELETE | `/return-to-vendor/:id`, `/delete/multiple` | `softDelete` + `isDeleted` + `deletedAtNew`. The `documents` rows are **not** deleted. |

**Tables:**
- **`return_to_vendor`**: `createdBy_id`, `document_id` (never set), `documentDef_id`, `grn_id`, `company_id`, `branch_id`, `vendor_id`, `returnedGrossWeight`, `returnedNetWeight`, `totalAmt`, `returnDate`, `amtWords`, `rtvNo`, `remark`, and a second soft-delete column `deleted_at_new`.
- **`return_to_vendor_product`**: product, variant, uom, `quantity`, `unitPrice`, `amount`, `grossWeight`, `packingMaterialWeight`, `netWeight`, `rtv`, dates, `deliveryLocation`, `reason`.

**Number format:** `RTV{yyyyMMdd}{5-digit}`.

#### Farmer master (`/farmers`, `src/farmer/`)
**Purpose:** the master record for farmer suppliers. It holds:
- personal details
- residential and farm addresses
- land data: holding status, land status, total and cultivation area
- 7/12 land record number and copy, ID proof number and copy
- farmer and farm photos
- `crops[]`, each linked to a product, with variety, number of plants, pruning date, expected harvest date and expected tonnes

It has its own approval status (below). Farmers are the party on RFPA, GRN, Inward and AQR.

| Method | Path | Notes |
|---|---|---|
| POST | `/farmers` | `upload.fields([farmPhoto, farmerPhoto, idProofCopy, sevenTwelveCopy])`, multipart. If `id` is present the request is treated as a draft upsert. Returns 201 `{data: farmerId}`. |
| PUT | `/farmers/:id` | Uses `captureUser` and uploads. Replaced files are deleted from Spaces. Crops are reconciled: update the ones sent with an id, create new ones, delete the missing ones. |
| PATCH | `/farmers/submit/:id` | Submits a draft. |
| PATCH | `/farmers/approve/:id?status=approved\|notapproved` | Only a user with the **verifier** role may call it, and only while the farmer is `pending`. |
| GET | `/farmers` | Role-scoped list (see below). |
| GET | `/farmers/filterFarmer/all` | Unscoped list. |
| GET | `/farmers/filterFarmer/:id`, `/farmers/filterFarmer/search/withfilter?search=` | Dropdown and search helpers. |
| GET | `/farmers/view/:id`, `/farmers/update/:id` | View and form DTOs. |
| GET | `/farmers/:id/download/id-proof\|seven-twelve\|farmer-photo\|farm-photo` | 302 redirect to `/files/download?url=…`. |
| POST | `/farmers/upload-farmer` | Excel import. |
| GET | `/farmers/export/excel`, `/farmers/download/template` | Return a Spaces `downloadUrl`. |
| DELETE | `/farmers/:id` | Schedules deletion and nulls `farmerCode`. |
| DELETE | `/farmers/delete/multiple` | Nulls the code, then `softDelete`. |

**Status rules:**
- Created by an admin or verifier: `approved`. Created by anyone else: `pending`. An explicit `draft` stays `draft`.
- An update by an admin forces `approved`.

**List scope:**
- Employees see only their own farmers.
- Verifiers see everything except drafts.
- Admins see everything except drafts, plus their own drafts.

**Tables:**
- **`farmer`**: `farmerfName`, `farmermName`, `farmerlName`, `primaryMobileNo`, `secondaryMobileNo`, `email`, `gender`, `dob`, `residensialAddressId`, `farmAddressId`, `landHoldingStatus`, `landStatus`, `totalLandArea` decimal(100,6), `cultivationArea`, `farmerCode`, `farmerGrading`, `sevenTwelveNo`/`Copy`, `idProofNo`/`Copy`, `howDoYouSell`, `farmerPhoto`, `farmPhoto`, `dateOfVisit`, `status` (default pending), `created_by`, `approved_by`. **No uniqueness** on mobile number or code.
- **`crop`**: `crops` (a product id), `variety`, `noOfPlants`, `pruningDate`, `expectedHarvestDate`, `expectedQuantityInTonnes`, `farmerId`.

**Farmer code:** `FARM{yyyy}{4-digit}` (MAX + 1). Deleting a farmer can free its number for reuse.

**Excel import:**
- Required columns: First Name, Primary Mobile No.
- Duplicate mobile numbers are skipped.
- Crop groups are matched to products by name.

#### Procurement Target (`/procurement-target`, `src/procurementTarget/`)
**Purpose:** a monthly buying plan per buyer: quantity per product per week, up to 5 weeks, each with a date range.
- **Approval:**
  - A plan the buyer creates for themselves is `pending` and must be approved by their **depth-1 manager in `workflow_hierarchy`** (department procurement).
  - A plan created for someone else is auto-`approved`.
- **Month is 0-based** for procurement (January = 0) and 1-based for sales. Always convert through `utils/planMonth.ts` (`toPlanMonth`, `fromPlanMonth`).

| Method | Path | Notes |
|---|---|---|
| POST | `/procurement-target/create/monthly-plan` | `{ employee?, month (0-based), year, procurementMonthlyTotalTargetQty, procurementTargetPlan[]{ product, weeklyTargetsTotalQty, remark, weeklyTargets[]{weekNo 1-5, qty, startDate, endDate} } }`. Σ weekly qty must **equal** `weeklyTargetsTotalQty`, otherwise it throws. There is a unique index on (employee, month, year). |
| GET | `/procurement-target/getAll` | Query `page`, `limit`, `employeeId`, `month`, `year`, `fromMonth/Year`, `toMonth/Year`. Returns the targets of the caller's hierarchy descendants, including the caller: `[{id, employeeName, month, monthName, year, week1Total..week5Total, totalTarget, status}]`. |
| GET | `/procurement-target/monthly-plan-view?employee&month&year` | Plan view. |
| GET | `/procurement-target/monthly-plan-view/:id` | Plan view by id. |
| GET | `/procurement-target/monthly-plan-update/:id` | Structured view and edit form. |
| GET | `/procurement-target/performance/:employeeId/:month(1-12)/:year?productId=` | `[{Period: weekNo, targetAssigned, targetAchieved, percentage, variance}]`. |
| GET | `/procurement-target/procurement-per-product/:employeeId/:month/:year` | Per-product target vs achieved. |
| PATCH | `/procurement-target/:id/approve` | `{action: 'approved'\|'rejected'}`. The caller must be the employee's depth-1 ancestor. |
| GET | `/procurement-target/manager/pending-approval` | Pending plans for the caller to approve. |
| GET | `/procurement-target/excel/monthly-plan/:id`, `/dashboard-summary/plan-in-brief/download` | Write xlsx files to the **local disk** (`exports/…`) and return the path. |

**Tables:**
- **`procurement_targets`**: `employee_id`, `workflow_team_id`, `month`, `year`, `status` (`pending|approved|rejected`), `week1TotalQty`..`week5TotalQty`, `monthlyTotalQty`, `createdby_id`. Unique on (employee, month, year).
- **`procurement_target_products`**: `target_id`, `product_id`, `weekly_total_qty`, `remark`.
- **`procurement_target_weeks`**: `product_target_id`, `weekNo`, `qty`, `weekStartDate`, `weekEndDate`.
- **`procurement_achievements`**: never written.

**Achievement:**
- Computed with raw SQL: Σ `grn_products.netWeight` for the buyer's GRNs whose document is `COMPLETE`, bucketed by week date range.
- `percentage = achieved / assigned × 100`.
- `variance = (achieved − assigned) / assigned × 100`.
- Status bands:
  - ≥ 100: exceeded
  - ≥ 80: on track
  - ≥ 50: below target
  - otherwise: critical

### 12.2 Sales, Dispatch & Returns

```
Customer master ─┐
                 ▼
Customer Delivery Challan (DC_TYPE_CUSTOMER, Sale, engine B)
   │  stock availability CHECKED at create (inventory_stock.inwardQty ≥ line netWeight)
   │  stock OUT at fromLocation on COMPLETE
   ├──► Return By Customer (1 per DC) ──writes returned/rejected/accepted qty back onto DC items
   │        └──► Dump Register (dumpType 'returned-by-customer')
   ├──► Final Invoice (1 per DC; bills acceptedQty = qty − returned − rejected)
   ├──► Second Sale (optional DC link; free-text buyer)
   └──► Vehicle Dispatch Register (delivery_challan_id)
Stock Transfer DC (branch→branch; stock OUT at from-location on COMPLETE; receipt via Inward Register 'transferred')
Other DC (free-text party; NO stock movement)
Sale Order (legacy standalone PO, not linked to anything)
Sales Target (monthly plan per salesperson → customer → product → weekly ₹ amounts)
```

All sales and dispatch documents (Customer, Stock Transfer and Other DC, Final Invoice, Second Sale, Return By Customer, Dump Register) use **engine B (double approver)**. The engine-B view endpoints call `docDoubleApproverService.getDocumentById` with a **document id**.

#### Delivery Challan base: single-table inheritance (`src/deliveryChallans/deliverychllan/`)
All challans are stored in **one table, `delivery_challan_purchase`**. The discriminator column `type` takes one of three values:
- `customer_delivery_challan`
- `stock-transfer-delivery-challan`
- `other-delivery-challan`

Invoices, Returns, Second Sales, Dump Registers, AQR, Inward and Vehicle Dispatch all hold an FK `delivery_challan_id` into this table.

**Base columns:**
| Group | Columns |
|---|---|
| References | `company_id`, `office_id`, `grn_id`, `challanNo` (not unique), `transitInsuranceNo`, `isReturned` |
| Totals (decimal(20,4)) | `totalProductAmount`, `netProductWeight`, `netPackagingMaterialWeight`, `totalPackagingMaterialAmount` |
| Transport | `"amount in words"` (the column name contains spaces), `driverName`, `contactNo`, `altContactNo`, `vehicleNo`, `licenseNo`, `receiverName`, `rmn` |
| Other | `anyAttachment` (simple-array), `approval_status` (legacy), `requestingDepartment`, `remark`, `created_by` |

**Line table `item`:**
| Group | Columns |
|---|---|
| Product | `product_id`, `varient_id`, `uom_id`, `saleuom_id` |
| Quantities | `quantity` decimal(20,3), `acceptedQty`, `rejectedQty`, `returnedQty` (written back by Return By Customer) |
| Money and weight (decimal(20,4)) | `amount`, `unitPrice`, `grossWeight`, `packingMaterialWeight`, `netWeight`, `changedQty`, `changedPrice` |
| Packaging | `packing_material_id`, `packingMaterialQuantity`, `packagingMaterialUoMId`, and `packagingMaterialQuantity/UnitPrice/Amount/TotalWeight`. ⚠️ These four are **integer** columns. |
| Parent | `"deliveryChallanId"` |

**Endpoint:** `GET /deliveryChallan/dc-type/numbers?dcType=customer|stock-transfer|other&isReturnByCustomerCreated=&overAllStatus=&search=&page=&limit=` is the challan-number dropdown. It returns `[{id, challanNo, documentId, overAllStatus}]`.

**Challan number:** `CN<yyyyMMdd><C|S|O><count+1:5>`. The count covers every date, so the serial never resets.

#### Customer Delivery Challan (`/customer-delivery-challan`)
**Purpose:** a sales dispatch from a branch to a customer.
- **Child columns:** `customer_id`, `poNumber`, `branch_id` (fromLocation), `billingAddres_id`, `deliveryAddres_id`, `currentshippingAddres_id`, `isInvoiceCreated`, `isReturnByCustomerCreated`.
- Category: `Sale`.

| Method | Path | Notes |
|---|---|---|
| POST | `/` | Uses `uploadAttachments`. See the body below. Returns 201 `{status, message, data}`. |
| GET | `/` | Filters: challan base, customer, `fromLocation`, `poNumber`, `isInvoiceCreated`, `isReturnByCustomerCreated`. Returns 404 when the list is empty. |
| GET | `/view/:docid` | View. Returns names and `approvalSummary`. |
| GET | `/update/:id` | Edit form. Returns ids. |
| GET | `/export/excel` | Excel export. |
| PATCH | `/:id` | Uses `captureUser`, `uploadAttachments`. Does a raw `Object.assign`. ⚠️ There is no status guard, and items and stock are not touched. |
| DELETE | `/?id=` | ⚠️ **Hard delete.** The `documents` row is left orphaned. |
| DELETE | `/delete/multiple` | Soft-deletes the challan and its document. |

**POST body** (`CreateCustomerDeliveryChallanDto`):
- `partyName` (customer id), `companyName`, `offices`, `fromLocation`, `grnNo`
- `poNumber`, `transitInsuranceNo`, driver and vehicle fields, `rmn`
- `billingAddress`, `deliveryAddress`, `currentShippingAddress`; alternatively `billingDetails`/`deliveryDetails`
- totals, `requestingDepartment`, `remark`, `type`
- `deliveryChallanProducts[] {productName, variant, uom, saleUoM, quantity, unitPrice, amount, netWeight, grossWeight, packingMaterialWeight, packagingMaterial, packagingMaterialUoM, packagingMaterialQuantity, packagingMaterialUnitPrice, packagingMaterialAmount, packagingMaterialTotalWeight}`

**Create logic:**
1. Addresses default to the customer master's billing and delivery addresses unless the request supplies them.
2. **Stock is validated per line.** The service loads `inventory_stock` for (company, fromLocation, product, variant). If the row is missing or `inwardQty < netWeight`, it returns 400 "Insufficient stock…".
3. Totals come from the client.
4. Stock is only deducted when the document reaches COMPLETE, and it is not re-validated at that point.

**Cache keys:** `cdc:list|view|update:*`. `invalidateCDCCache(id)` is public and is also called by Return By Customer.

#### Stock Transfer DC (`/tranfer-delivery-challan`; the path is misspelt in the code)
**Purpose:** an internal transfer between branches.
- **Child columns:** `stockTransferType` (NOT NULL; `cc-dc | dc-dc | dc-cc | cc-cc stock transfer`, where CC = collection centre and DC = distribution centre), `from_location_id`, `to_location_id`.
- Category: `Operation`.
- On COMPLETE, stock goes **OUT at `fromLocation`**. The receiving branch books the stock separately through an **Inward Register (`transferred`)**.
- ⚠️ There is no stock validation, so balances can go negative.

**Endpoints:**
- `POST /`, `GET /`, `GET /view/:docid`, `GET /update/:id`, `GET /export/excel`, `PATCH /:id`, `DELETE /?id=` (hard delete), `DELETE /delete/multiple`.
- The list response shape here is `{status, data, meta: {total, page, totalPages}}`, which differs from the other lists.
- Extra list filters: `stockTransferType`, `fromLocation`/`toLocation`, `sourceLocation*`, `destinationLocation*`.

#### Other DC (`/other-delivery-challan`)
**Purpose:** dispatches to ad-hoc parties such as samples, free issue or third parties.
- **Child columns:** `other_from_location_id_for_other`, `other_customer_name`, `other_customer_contact_no`, `other_customer_email`, `customer_address_for_other`.
- Category: `Operation`. **No stock effect.**
- `customerAddress` may be sent as an object, in which case a new address row is inserted.
- **Updates** notify every verifier and approver ("requires re-approval"), but the document status is **not** reset.
- Errors are rethrown with the misleading message "Failed to create GRN".
- **Endpoints:** `POST /`, `GET /`, `GET /view/:docid`, `GET /update/:id`, `GET /export/excel`, `PATCH /:id` (accepts a multipart JSON field `otherDeliveryChallan`), `DELETE /:id` (soft), `DELETE /delete/multiple`.

#### Final Invoice (`/final-invoice`, `src/invoice/`)
**Purpose:** the tax invoice raised **from exactly one Customer DC**.
- Category: `Sale`. No stock effect.
- Tracks whether it is paid.

**Endpoints:**
| Method | Path | Notes |
|---|---|---|
| POST | `/final-invoice/:deliveryChallanId` | Body `{ invoiceDate?, cgst, sgst, igst, taxAmount?, discount, freight, otherCharges, placeOfSupply? }`. Returns 201 with the full invoice and its relations. |
| GET | `/final-invoice` | Filters: `paymentStatus`, company, customer, `fromLocation`, `deliveryChallanNo`, `poNumber`, `vehicleNo`, `placeOfSupply`, `totalAmount` range. Sortable by `invoiceNo`, `invoiceDate`, `totalAmount`. Returns 404 when the list is empty. |
| GET | `/final-invoice/view/:docid` | `InvoiceDetailDto`. Includes the company with bank details, the customer with GSTN and PAN, the approval summary, and the lines. |
| POST | `/final-invoice/pdf/download` | Body `{id: invoiceId}`. Renders `templates/invoiceTemplate.ejs` with Puppeteer and uploads it to Spaces. Returns `{data: {pdfUrl}}`. |
| PUT | `/final-invoice/amount-status/:id` | Body `{ammountStatus: 'paid'\|'unpaid'}`. |
| POST | `/final-invoice/export-report` | Body is a `FinalInvoiceReportFilter`. Builds an xlsx, uploads it to `reports/invoice/…`, and returns `{fileUrl}`. |
| GET | `/final-invoice/export/excel` | Excel export. |
| DELETE | `/final-invoice/delete/multiple` | Bulk delete. ⚠️ It does **not** reset `dc.isInvoiceCreated`. |

**Create logic** (`finalInvoice.service.ts`):
1. The DC must exist and `dc.isInvoiceCreated` must be false. ⚠️ The DC's approval status is **not** checked.
2. **Invoice number:** `<CompanyInitials>-<YYYY>-<BranchName>-<NNNNN>`, for example `PFL-2026-Ahmedabad-00012`. The serial is the last invoice number for the same company and branch plus 1. It does not reset each year, and a branch name containing `-` breaks it.
3. **Per line:**
   - `acceptedQty` is `dcItem.acceptedQty` when set, otherwise `qty − returned − rejected`.
   - `amount = acceptedQty × unitPrice`.
   - Gross and net weights are pro-rated by `accepted / original`.
4. **Header totals:**
   - `totalProductAmount = Σ amount`
   - `netProductWeight = Σ netWeight`
   - `taxAmount = dto.taxAmount ?? cgst + sgst + igst`. **Tax amounts are supplied by the client, not computed from GST rates.**
   - `totalAmount = totalProductAmount + taxAmount + freight + otherCharges − discount`
   - `totalAmtInWords = toWords(round(total)) + " Only"`
   - `placeOfSupply` defaults to the delivery address state.
5. Sets `dc.isInvoiceCreated = true`, creates the `documents` row, and starts the approval flow.

**PDF:** `getByIdForPdf` recalculates the lines as `qty − returned` and **excludes tax, freight and discount**, so the PDF total can differ from `invoices.totalAmount`. The template has no HSN or GST lines.

**Tables:**
- **`invoices`:**
  - `company_id`, `invoiceNo` (not unique), `invoiceDate`, `pdfData` (unused), `delivery_challan_id`, `customer_id`, `poNumber`, `branch_id` (fromLocation), `billingAddres_id`, `deliveryAddres_id`, `vehicleNo`, `placeOfSupply`
  - decimal(20,4) money columns: `totalProductAmount`, `netProductWeight`, `totalAmount`, `amount_in_words`, `cgst`/`sgst`/`igst` (**amounts, not rates**), `taxAmount`, `discount`, `freight`, `otherCharges`
  - `created_by`, `ammountStatus` (`paid|unpaid`, default unpaid)
- **`invoice_products`:** `product_id`, `varient_id`, `quantity`, `acceptedQty`, `rejectedQty`, `returnedQty`, `saleuom_id`, `amount`, `unitPrice`, `grossWeight`, `netWeight`, `hsnCode` (never set), `description`, `invoice_id`.

**Cache keys:** `finv:all|view|update|pdf:*`.

#### Return By Customer (`/returns`, `src/returnByCustomer/`)
**Purpose:** records goods the customer returned or rejected against **one** Customer DC.
- Category: `Operation`. **No stock movement:** returned goods are not added back to stock.

**Endpoints:**
| Method | Path | Notes |
|---|---|---|
| POST | `/returns` | Body `{ deliveryChallanNo* (DC id), companyName, location, customerName, date, remark, returnedProducts[]{productName, variant, saleUoM, unitPrice, returnedQty, returnedNetWt, returnedPackingMaterialWt, returnedGrossWt, rejectedQty, rejectedNetWt, rejectedGrossWt, rejectedPackingMaterialWt} }`. |
| GET | `/returns` | List. |
| GET | `/returns/:id` | Accepts either a record id or a document id. |
| GET | `/returns/view/:docid` | View. |
| GET | `/returns/update/:id` | Edit form. |
| GET | `/returns/get/rbcNo` | Dropdown used by the Dump Register form. |
| GET | `/returns/export/excel` | Excel export. |
| POST | `/returns/export-report` | Streams `ReturnBYCustomer_Report.xlsx`. |
| DELETE | `/returns/delete/multiple` | Does not reset the DC flags or item quantities, and does not invalidate the cache. |
| PATCH | `/returns/:id` | ⚠️ **Always fails.** It references the non-existent relations `proformaInvNo` and `returnedProducts.returnedUOM`. |

**Create logic:**
1. The DC must exist, and `isReturnByCustomerCreated` must be false.
2. Each returned product and variant must exist on the DC, and `returnedQty + rejectedQty ≤ dcItem.quantity`.
3. **Amounts are computed on the server:** `returnedQtyAmt = returnedQty × unitPrice` and `rejectedQtyAmt = rejectedQty × unitPrice`.
4. Sets `dc.isReturned` and `dc.isReturnByCustomerCreated` to true.
5. **Write-back:** raw SQL updates `item.returnedQty`, `rejectedQty`, and `acceptedQty = GREATEST(quantity − returned − rejected, 0)` for each product and variant on the DC. ⚠️ The column `deliveryChallanId` is unquoted in the SQL, so the update may miss.
6. Invalidates both the RBC and CDC caches.

**Tables:**
- **`return_by_customer`:** `delivery_challan_id`, `company_id`, `branch_id`, `customer_id`, `date`, `rbcNo`, `remark`, `createdby_id`.
- **`returned_products_by_customer`:** product, variant, `saleuom_id`, `unitPrice`, returned qty/amount/weights, rejected qty/amount/weights (all decimal(10,2)), `isChanged`, `"postReturnId"`.

**Number format:** `RBC<yyyyMMdd><count+1:5>`.

#### Second Sale (`/secondSales`, `src/secondSale/`)
**Purpose:** a distress or secondary sale of lower-grade or leftover produce to a free-text buyer. It can optionally link to a DC.
- Category: `Sale`. No stock effect.
- Totals, paid amount and pending amount all come from the client.

**Endpoints:** `POST /`, `GET /`, `GET /:id/view` (the id is a document id), `GET /:id/update`, `GET /export/excel`, `PATCH /:id`, `DELETE /:id` (scheduled), `DELETE /delete/multiple`.

**Tables:**
- **`second_sale_document`:** `company_id`, `branch_id`, `delivery_challan_id`, `saleDate` (NOT NULL), `customerName`, `secondSaleNo`, `customerContactNo`, `customerEmail`, `reasonForSale`, `customeraddress_id`, `totalNetWeight`, `totalGrossWeight`, `totalAmt`, `totalAmtInWords`, `paidAmount`, `pendingAmt`, `paymentMode`, `remarks`.
- **`second_sale_product`:** product, variant, `quantity` (⚠️ **int**), `unitPrice`, `amount`, weights, `saleuom_id`, packaging fields, `second_sale_register_id`.

**Number format:** `SSR<yyyyMMdd><count+1:5>`.

#### Dump Register (`/dumpRegister`, `src/dumpRegister/`)
**Purpose:** writes off spoiled or wasted produce at a branch.
- `dumpType` is one of `purchase` (linked to a GRN), `transferred` (linked to a DC), or `returned-by-customer` (linked to an RBC).
- Category: `Operation`.
- **On COMPLETE**, stock at `location` goes down (`qty −quantity`, `amount −amount`) and the counters `dumpQty` and `dumpAmt` go up.

**Endpoints:**
- `POST /`, `GET /`, `GET /view/:docid`, `GET /update/:id`, `GET /recyclebin`, `GET /export/excel`, `PATCH /:id`, `DELETE /:id`
- Bulk delete is **`DELETE /dumpRegister/delete/multiple/dumpRegisters`** (note the unusual path).

**Create:**
- `dumpProducts[]` is required. Lines with a quantity of 0 or less are skipped.
- Field aliases are accepted: `companyId|companyName`, `locationId|location`, `grn|grnNo`, `deliveryChallan|deliveryChallanNo`, `rbc|rbcNo`, `productId|productName`, `variantId|variant`, `uomId|uom`.

**Update:** hard-deletes and recreates all lines. There is no status guard, so editing after COMPLETE leaves stock out of step.

**Tables:**
- **`dump_register`:** `delivery_challan_id`, `rbc_id`, `grn_id`, `company_id`, `branch_id`, `date`, `dumpType`, `batchNo`, `dumpNo`, `totalQty` and `totalDumpCost` (⚠️ **integer**), `totalCostInWords`, `remark`, `requested_by_employee_id`.
- **`dump_product`:** product, variant, uom, `quantity`/`unitPrice`/`amount` decimal(12,2), `dump_register_id`.

**Number format:** `DPR<yyyyMMdd><count+1:5>`.

#### Sale Order (`/saleOrders`, legacy)
**Purpose:** a standalone customer purchase order with GST fields on each line.
- **It is not linked** to DCs or invoices, and it has no approval flow, no number generation, and no validation.
- **Endpoints:** `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (hard delete).
- **Tables:**
  - **`sale_order`:** `company_id`, `bill_from_id`, `shipped_from_id`, `bill_to_id`, `shipped_to_id` (→ `party_details`), `po_number` (**UNIQUE**, NOT NULL), `po_date`, `expected_delivery_date`, `customer_company_name`, `customer_id` (not an FK), `amount_in_words`, `vehicle_no`, `prepared_by`, `verified_by`, `authenticated_by`, `remark`, `otherCharges`, `transportationCharges`, `labourCharges`, `totalDeduction`.
  - **`sale_order_product`:** `productName` (free text), `quantity`, `price_per_unit`, `uom_id`, `gst` decimal(5,2), `total_amount`, `tax_amount`, `grand_total_amount`, `saleOrderId`.
  - **`party_details`:** `company_id`, `address_id`, `gstn`, `contactNo`.

#### Sales Target (`/sales-target`, `src/salesTarget/`)
**Purpose:** a monthly sales plan per salesperson, broken down as customer → product → week (1–5) with a ₹ amount per week.
- **Approval:** a plan the salesperson creates for themselves starts as `pending`. Only their **depth-1 manager** in `workflow_hierarchy` (department `sale`) can approve it. A plan created by a manager for someone else is `approved` immediately.
- **Months are 1-based** here; the `getAll` month name lookup assumes 0-based, which is a bug.

**Endpoints:**
| Method | Path | Notes |
|---|---|---|
| POST | `/sales-target/create/monthly-plan` | Body `{ employee?, month, year, plan: [{ customerId, salesTarget: [{ productId, weeklyTargets: [{ weekNo, startDate, endDate, amount }] }] }] }`. `totalProductSale` and `totalMonthlySale` are computed on the server. |
| GET | `/sales-target/getAll` | The caller's hierarchy scope. Filters: `employeeId`, `customerId`, month/year range. |
| GET | `/sales-target/monthly-plan-view/:id` | Plan view. |
| GET | `/sales-target/monthly-plan-update/:id` | Plan as an edit form. |
| GET | `/sales-target/view-plan-excel/:id` | Streams an xlsx and also writes it to `exports/view-plans/`. |
| GET | `/sales-target/files/:folder/:filename` | Serves files from `exports/{monthly-plans\|view-plans\|plan-sheets}`. Path traversal is guarded. |
| GET | `/sales-target/performance/:employeeId/:month/:year?customerId&productId` | Performance. |
| GET | `/sales-target/sales-per-customer/:employeeId/:month/:year` | Performance per customer. |
| GET | `/sales-target/sales-per-product/:employeeId/:month/:year` | Performance per product. |
| GET | `/sales-target/sales-summary/:employeeId/:month/:year` | Returns an achievement rate, product counts per band, and the best product, week and customer. |
| PATCH | `/sales-target/:id/approve` | Body `{action: 'approved'\|'rejected'}`. |
| GET | `/sales-target/manager/pending-approval` | Plans waiting for the caller's approval. |

**Tables:**
- **`sales_targets`:** `employee_id`, `created_by_id`, `month`, `year`, `totalMonthlySale`, `status` (`pending|rejected|approved`). There is **no unique constraint** on employee, month and year.
- **`sales_target_products`:** `monthly_sales_plan_id`, `customer_id`, `product_id`, `totalProductSale`.
- **`sales_target_weeks`:** `sales_target_product_id`, `weekNo`, `week_start_date`, `week_end_date`, `sale_amount`.
- **`sales_achievements`:** `weekly_sales_id`, `achievedAmount`, `saleDate`. ⚠️ **Nothing ever writes to this table**, so every "achieved" figure is 0.

#### Vehicle Dispatch Register (`/vehicleDispatches`, `src/vehicleDispatch/`)
**Purpose:** outbound logistics for a dispatch.
- Records the vehicle, driver, reaching and out times, client and address, the linked DC, transport bill, advance, the client's GRN number, net inward quantity, rejection, shrinkage/dump, and feedback.
- Category: `Operation`, **engine A**. No stock effect.

**Endpoints:**
| Method | Path | Notes |
|---|---|---|
| POST | `/` | Body `{ companyName: {id}, date, vehicleType, vehicleNo, driverName, driverMobNo, reachingTime, outTime, clientName*, clientAddress: {id}\|{...}, deliveryChallanNo: {id}, paymentDiscussed, transportationBillAmt, advancePaid, receivingPerson, supervisorName, accDeptVerification, remarksPFL, feedbackbyTransporterOwner, netInwardQty, clientGRNNo, paymentTerms, rejection, shrinkageDump }`. `reachingTime` and `outTime` use `HH:mm:ss`. Not run in a transaction. |
| GET | `/` | List. |
| GET | `/recyclebin` | Recycle bin. |
| GET | `/view/:docid` | Returns 403 if the caller is neither the creator nor an L1 approver. |
| GET | `/export/excel` | Excel export. |
| PATCH | `/:id` | Update. |
| DELETE | `/:id` | Delete. |
| DELETE | `/delete/multiple` | Bulk delete. |

The edit-form route `GET /:id` is commented out.

**Tables:**
- **`dispatch`:** `company_id`, `date`, `vehicleType`, `vehicleNo`, `driverName`, `vehicleDispatchNo`, `paymentDiscussed`, `driverMobNo`, `reachingTime`/`outTime` (time), `clientName` (NOT NULL), `client_address_id`, `receivingPerson`, `supervisorName`, `accDeptVerification`, `transportationBillAmt`, `advancePaid`, `remarksPFL`, `feedbackbyTransporterOwner`, `netInwardQty`, `clientGRNNo`, `paymentTerms`, `delivery_challan_id`, `rejection`, `shrinkageDump`.
- **`sku`** (`skuName`, `dispatchQuantity`, `dispatchId`): nothing writes to it.

**Number format:** `VDR<yyyyMMdd><count+1:5>`.

### 12.3 Operations: EOD Stock, Stock Correction, Inventory Reports

#### EOD Stock report (`/eodStock`, `src/eodStock/`)
**Purpose:** a *manually submitted* physical closing-stock report for one company and branch on a date.
- It has one line per SKU, holding the UOM quantity and the total weight in kg.
- Approval runs through **engine B** with the category `Operation`.
- **Stock is never recomputed or moved** by this module. It does not read `inventory_stock`.

**Endpoints:**
| Method | Path | Behaviour |
|---|---|---|
| POST | `/eodStock` | Body `{ companyName, location, stockDate, submission, comments, eodProducts[]{ sku, uom, qty, totalWeightInKg } }`. `submittedBy` is set to the user. Returns 201 `{data: id}`. The approval-flow pre-check is commented out. |
| GET | `/eodStock` | List of reports. |
| GET | `/eodStock/view/:docid` | View a report by document id. |
| GET | `/eodStock/update/:id` | Load a report for editing. |
| GET | `/eodStock/recyclebin` | Soft-deleted reports. |
| PATCH | `/eodStock/:id` | Update. There is no status guard. |
| DELETE | `/eodStock/:id` | Delete one report. |
| DELETE | `/eodStock/delete/multiple` | Delete several reports. |

**Tables:**
- **`stock_report`**: `company_id`, `branch_id`, `stock_date`, `submission`, `eodNo` (format `EOD-00001`, count-based), `comments`, `submitted_by` (a user id string, not an FK).
- **`sku_eod_report`**: `sku_id` (→ product), `uom_id`, `uom_quantity`, `total_weight_in_kg`, `stock_report_id`.

#### Stock Correction (`/stock-correction`, `src/stockCorrection/`; see also `STOCK_CORRECTION_API.txt`)
**Purpose:** a manual adjustment to one `inventory_stock` row.
- It has its **own** `pending → approved | rejected` flow and does **not** use the approval engine.
- **Any logged-in user can approve, including the person who submitted it.**

**Endpoints:**
| Method | Path | Behaviour |
|---|---|---|
| POST | `/stock-correction` | Body `{ inventoryStockId, correctionType: physical_count\|damage_write_off\|system_error\|other, physicalQty, correctionAmt?, reason?, correctionDate?, dumpQty?, dumpAmt?, dumpReason: damage\|expiry\|pest\|fire\|other, dumpRemarks?, dumpDate? }`. See the submit rules below. |
| GET | `/stock-correction/pending` | Pending corrections. |
| GET | `/stock-correction/:id` | One correction. |
| GET | `/stock-correction/stock/:inventoryStockId` | Returns `{currentStock, corrections[], pendingCorrections[]}`. |
| PATCH | `/stock-correction/:id/approve` | Body `{remarks?}`. See the approve rules below. |
| PATCH | `/stock-correction/:id/reject` | Body `{remarks?}`. No stock change. |

**Submit rules:**
- For `damage_write_off`, `dumpQty` must be greater than 0. The server sets `correctionDelta = −dumpQty` and `physicalQty = inwardQty − dumpQty`.
- For every other type, `correctionDelta = physicalQty − stock.inwardQty`.
- `systemQty` is snapshotted at submit time.

**Approve rules:** runs in a transaction and updates the stock row as follows:
- `inwardQty += correctionDelta`
- `inwardAmt += correctionAmt`, only when that amount is non-zero
- for a write-off, `dumpQty/dumpAmt += dump values`

There is no row lock, so two concurrent approvals could both apply.

**Table `stock_correction`:**
- References: `inventory_stock_id`, `company_id`, `location_id`, `product_id`, `variant_id`
- Quantities: `systemQty`, `physicalQty`, `correctionDelta`, `correctionAmt`
- Dump fields: `dumpReason`, `dumpQty`, `dumpAmt`, `dumpRemarks`, `dumpDate`
- Status fields: `correctionType`, `status`, `reason`, `remarks`, `created_by`, `approved_by`, `approvedAt`, `correctionDate`

#### Inventory Stock read APIs (`/inventoryStock`; details in §13)
| Method | Path | Behaviour |
|---|---|---|
| GET | `/inventoryStock/stock/filter/report?companyName=<companyId>&locationId&startDate&endDate` | Returns `{ inwardData, purchaseData (incl. RTV / non-RTV split), dumpData }`, grouped by product and variant. |
| GET | `/inventoryStock/endoftheday/eod-report?companyId&locationId&startDate&endDate` | Live day summary, listed below. |
| GET | `/inventoryStock/stock/locationwise-companywise?company&location&page&limit&search` | Stock summed by product. |
| GET | `/inventoryStock/stock/locationwise-companywise-productwise?company&location&product&…` | With `product`: rows per variant. Without it: raw rows. |

The end-of-day report covers:
- labour payments, transport payments
- RTV purchase, total, cash and other purchases
- received from CC/DC, total inward
- dumps, customer returns
- sales of the day, invoices, second sales
- internal stock transfers

---

### 12.4 Master Data

#### Vendor (`/vendors`, `src/vendor/createVendor/`)
**Purpose:** the supplier master. Vendors supply produce (fresh fruits, mangoes, vegetables, onion, potato, tomato, value-added products) and non-produce items (service, stationery, packing material, crockery, marketing products, staff welfare).

**What a vendor holds:**
- company details: office address, contact, GSTN, PAN, MSME, trade licence (each with its document copy)
- category and subcategory
- products: a main product plus a list of all products
- packing materials: a main one plus a list
- sale contact (`vendor_sale_info`)
- bank details (`bank_details_vendor` with a branch address)
- two trade references, each with an address
- credit and payment terms, dispatch, warehouse and packing locations

**Status flow:** `draft → pending → approved | notapproved`.
- A vendor created by an admin or verifier is auto-approved.
- **Only a verifier** may approve a vendor, and only while it is `pending`. Notifications go to the verifiers.

**Vendor code:** `VENDOR<YYYY><NNNN>`, computed as MAX + 1. It retries up to 10 times on a unique violation (`vendor_code` is UNIQUE). Deleting a vendor nulls its code.

**Endpoints:**
| Method | Path | Behaviour |
|---|---|---|
| POST | `/vendors` | Multipart with `upload.fields([gstnCopy, panCardCopy, msmeCopy, cancelledChequeCopy])`. Nested objects can be sent as JSON strings. Returns 201 `{data: id}`. Sending `id` performs an upsert. |
| PUT | `/vendors/:id` | Update. ⚠️ Mass-assignment: `status` and `vendorCode` can be overwritten. |
| PATCH | `/vendors/submit/:id` | Submits a draft. A new file replaces the old one, and the old file is deleted from Spaces. |
| PATCH | `/vendors/approve/:id?status=approved\|notapproved` | Approve or reject. |
| GET | `/vendors` | Role-scoped list. |
| GET | `/vendors/:id` | Relations returned as ids. |
| GET | `/vendors/view/:id` | Relations returned as names. |
| GET | `/vendors/update/:id` | Edit form. |
| GET | `/vendors/filterVendor/all` | Unscoped paginated list. |
| GET | `/vendors/bysearch/getvendors?search=<subcategoryId>` | Dropdown. |
| GET | `/vendors/filterData/:idOrCompanyName` | Look up by id or company name. |
| GET | `/vendors/filterVendor/withfilter?search=` | Search. |
| POST | `/vendors/upload-vendor` | Excel import. Company Name and Vendor Category are required; categories are found or created by name. |
| GET | `/vendors/export/excel` | Returns a Spaces URL. |
| GET | `/vendors/download/template` | Returns a Spaces URL. |
| DELETE | `/vendors/:id` | Delete one vendor. |
| DELETE | `/vendors/delete/multiple` | Delete several vendors. |

**Vendor category and subcategory:**
- `/vendor-categories`: `{name}` CRUD. This is **the only route using the zod `validate()` middleware**.
- `/vendor-subcategories`: `{name, category}` CRUD, plus `GET /getSubcategories?search=<categoryId|name>` for dropdowns.
- Both list endpoints return 404 when the list is empty.

**Tables:**
- **`vendor`**:
  - company and office: `company_name`, `office_address_id`, `office_contact_number`, `email`, `website`
  - statutory: `gstn`/`gstncopy`/`if_gstn_Copy`, `pan_number`/`pan_card_copy`, `MSME_Number`/`MSME_copy`, `trade_license_number`
  - terms: `vendor_credit_terms`, `proposed_payment_terms`, `payment_mode`
  - classification: `classification`, `vendor_code` (UNIQUE), `vendor_grade`
  - audit and status: `created_by`, `approved_by`, `status`
  - business: `date_of_incorporation`, `in_f_and_v_business_since`
  - products and packing: `main_products_to_be_supplied`, `main_packing_material_id`
  - locations: `dispatch_center`, `warehouse_locations`, `packing_center_location`
  - relations: `vendor_category_id`, `vendor_subcategory_id`, `vendor_sale_id`, `bank_details_vendor_id`
  - references: `ref_one_*`/`ref_two_*` plus `ref1_address_id`/`ref2_address_id`
- Join tables: `vendor_products`, `vendor_packing_materials`.
- **`bank_details_vendor`**, **`vendor_sale_info`**, **`vendor_category`**, **`vendor_subcategory`** (`categoryId`).

#### Customer (`/customers`, `src/customer/addcustomer/`)
**Purpose:** full B2B customer onboarding and KYC. It is referenced by DCs, invoices, RBC and sales targets.
- **Status flow and visibility rules are the same as for vendors and farmers**: only a verifier approves, and the customer must be `pending`.
- **Customer code:** the entity's `@BeforeInsert` generates `CUST<YYYYMMDD><NNNN>` through `utils/codeGeneration.ts`, which overrides a `CUST<YYYY><NNNN>` value the service computes. The code is not unique and is nulled on delete.

**Sub-entities (tables):**
| Table | Contents |
|---|---|
| `customers` | organisation name, image, organisation type, category, type, contacts and emails, `customercode`, `status`, `created_by`, `approved_by`, plus 1:1 FKs to the sub-tables below |
| `customer_bank_details` | account holder name, bank, branch, account no, IFSC, account type (`savings \| current \| cash credit \| over draft account \| other`), cancelled cheque or reason, bank statement, bank address |
| `customer_statutory_details` | PAN, Aadhaar and copies, GSTN, bill book, certifications (`iso \| apeda \| fssai \| other`), corporate registration (`msme \| other`), CIN, certificates |
| `customer_billing_details` | billing address (JoinColumn literally `"billing address"`), billing name, contact person, "commonly known as", contacts, billing format and address-proof copies |
| `customer_delivery_details` | delivery address, address copy, `deliveryTime` (stored as a timestamp, exposed as `HH:mm` IST), receiving person, contacts |
| `customer_payment_terms` | payment mode, margin deposit, `rtv` and `agreementExecuted` flags, L/C and B/G files, security deposit, **Initial and Revised Exposure Limit** (`IELinAmt`, `RELinAmt` with recommended-by and date), reason, evidence |
| `customer_office_use_only` | proposer BD, PFL coordinator, recommended by, dispatch location, relationship manager, average monthly billing, monthly volume (t), verification, validity, due diligence, creditworthiness, key account person, ledger created and verified |
| `customer_key_mobile_numbers` | accounts and owner contacts, mandi licence, registration, electricity bill, blacklisting (`customer_black_listed_by`, reason, by), visiting card, references 1 and 2 with addresses |
| `customer_product_specification` | 1:N: article name, specification, packing material spec, packing parameters, rejection criteria, comment |
| `customer_category`, `customer_type` | lookups |

**Endpoints:**
| Method | Path | Behaviour |
|---|---|---|
| POST | `/customers` | Multipart with up to 18 file fields, such as `customerImage`, `bankDetails[cancelledChequeCopy]`, `statutoryDetails[panCopy]`, `lc`, `bg`. If `id` is present, it acts as a draft upsert. |
| PUT | `/customers/:id` | Updates in a transaction. Product specifications are replaced. ⚠️ The audit user is undefined. |
| PATCH | `/customers/submit/:id` | Submits a draft. ⚠️ URLs for files nested inside sub-objects are not saved. |
| PATCH | `/customers/approve/:id?status=approved\|notapproved` | Approve or reject. |
| GET | `/customers` | Role-scoped list. |
| GET | `/customers/names/all` | Returns `[{id, organisationName}]`. |
| GET | `/customers/partial/all/:id` | Billing and delivery address, GST and PAN. Used by DC and invoice forms. |
| GET | `/customers/:id` | Full record. |
| GET | `/customers/view/:id` | View. |
| GET | `/customers/update/:id` | Edit form. |
| POST | `/customers/upload/customerdata` | Excel import. Rows missing billing or delivery addresses are skipped. |
| GET | `/customers/export/excel` | Export. |
| GET | `/customers/download/template` | Import template. |
| DELETE | `/customers/:id` | Delete one customer. |
| DELETE | `/customers/delete/multiple` | Delete several customers. |

Lookups: `/customerCategory` and `/customerType` both provide `{name}` CRUD.

#### Product catalogue (`src/product/**`)
Hierarchy: **Classification → Category → Subcategory → Product → Variants**. Each product also has a UOM and quality parameters.

**`/products`:**
| Method | Path | Behaviour |
|---|---|---|
| POST | `/products` | Multipart `image`. Body: `{ name, description, classification, category, subcategory, uom, packingType, prefix*, shelfLife, storageTemp, thresholdStock, variant[]{count, size, variety, origin, brand}, qualityParameters[]{name, type: good\|bad\|average} }`. |
| PUT | `/products/:id` | Updates. Variants are matched by id or by their attributes. Variants that are not sent end up orphaned. |
| GET | `/products` | List. |
| GET | `/products/:id` | One product. |
| GET | `/products/partial/data` | Partial list. |
| GET | `/products/partial/:id` | Partial record. |
| GET | `/products/serachData/product?search=` | Search. The path contains the typo `serachData`. |
| GET | `/products/productname?search=` | Search by name. |
| GET | `/products/getVarient/:id` | Variants of a product. |
| GET | `/products/getall/getvarient/:id` | Variants of a product. |
| POST | `/products/getproduct/byids` | Body `{ids}`. |
| POST | `/products/upload-product` | Excel import with variant groups `Variant1..5.*` and parameter groups `ParameterN.*`. Classification, category, subcategory and UOM are found or created by name. |
| GET | `/products/export/excel` | Export. |
| GET | `/products/download/template` | Import template. |
| DELETE | `/products/:id` | Delete one product. |
| DELETE | `/products/delete/multiple` | Delete several products. |

**Codes:**
- **Product code:** `PREFIX + max(n)+1` padded to 4 digits, for example `ONI0001`. The series only matches `^PREFIX\d+$`, soft-deleted rows are counted (`withDeleted`), and numbers are never reused.
- **Variant code:** `PREFIX + C{count}S{size}V{variety}O{origin}B{brand} + 3-digit seq`.
- **Variant name:** `"Product,Count-x,Size-y,Variety-z,Origin-o,Brand-b"`.

**Lookup CRUD:**
- `/productClassification`: `{name}`
- `/productCategory`: `{name, productClassification}`
- `/productSubcategory`: `{name, category}`
- These return 404 when the list is empty.

**Variant endpoints:**
- `/varients/getvarients/byids` (POST) and `/varients/partial/data` (GET) work.
- ⚠️ All `/productVarient/*` endpoints are **broken**: they reference a non-existent relation, `productTemplate`.

**Tables:**
- **`product`**: `product_name` (indexed), `product_image`, `description`, `classification_id`, `category_id`, `subcategory_id`, `uom_id`, `product_code`, `packing_type`, `prefix`, `shelf_life`, `storage_temp`, `thresholdStock`.
- **`productVarient`**: `product_id`, `variantName`, `varient_code`, `count`, `size`, `variety`, `origin`, `brand` (the five attributes are indexed).
- **`quality_parameters`**: `parameter_name`, `type`, `product_id`.
- **`product_classification`**, **`product_category`** (`classification_id`), **`product_subcategory`** (`category_id`).

#### UOM & conversion matrix
- **`/uoms`**: CRUD for `{unit, abbreviation, description}`, plus `GET /uoms/getAll/partialdata` and `DELETE /uoms/multiple-delete/delete`.
- **`/uom-conversion-matrix`**: CRUD for `{fromUOM, toUOM, conversionFactor decimal(10,4)}`.
  - This is **reference data only. Stock and document calculations do not convert UOMs**: quantities are raw `netWeight` values.

#### Packing Material (`/packingMaterial`)
- A master list of crates, boxes and similar items.
- Fields: `{ useFor: 'for purchase'|'for sale', packagingMaterialName, packagingMaterialWeight, packagingMaterialDescription, containsQuantity, uom }`.
- Endpoints: `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `GET /all/partial`, `DELETE /delete/multiple`.
- Table: `post_packaging_material`. Packing-material stock is not tracked.

#### Organisation / location masters
| Module | Route | Notes |
|---|---|---|
| Company | `/company` (read-only; seeded) | `GET /`, `GET /partial/details`, `GET /update/getall`, `GET /:id`. Tables: `company` (`name, officeAddress, gstNo, fassaiNo, logo`) and `bank_details_from_company`. |
| Branch | `/location-branches` | `POST /:branchType`, `GET /getall/:branchType`, `GET /:id`, `GET /filterData/filter/all`, `PATCH /:branchType/:id`, `DELETE /?id=&branchType=`, `DELETE /delete/multiple`. Setting capacity recomputes `balanceCapacity = total − current`. Table: `branches` (`name, addressId, contact person, notes, totalCapacity, currentCapacity, balanceCapacity, type: collection-center\|distribution-center\|seasonal-collection-center\|warehouse, prefix` (used for GRN numbering), `user_id`). **Branches are the stock locations.** |
| Office | `/location-offices` | `POST /:officeType`, `GET /:officeType`, `GET /:officeType/:id`, `GET /?search=<type>`, `GET /filterData/filter/all`, `PATCH /:officeType/:id`, `DELETE /delete/multiple`. Table: `offices` (`type: registered-office\|corporate-office`). Offices hold no stock. |
| Address | `/pincode` (**no auth**) | `GET /pincode/fetchAddressByPincode?pincode=NNNNNN` proxies `api.postalpincode.in` and caches the result for 24 hours. Table: `addresses` (`address1, address2, location, city, state, pincode`), shared by every module. |
| Driver | `/drivers` | CRUD. Table: `drivers` (`firstName, lastName, email UNIQUE, phoneNumber UNIQUE, addressId, status, vehicleType, vehicleNo`). |
| Levels | `/levels` | CRUD for `{name, hierarchy}`. This is legacy; only `grns.current_level_id` references it. |

---

### 12.5 Finance: Vouchers (`src/vouchers/`)

There are four payment voucher types, all on the procurement side. They all:
- can reference a **GRN** (`grn_id`), **Company** (`company_id`), and **Branch** (`location_id`)
- record `requestedBy`, `passBy` and `approveBy` users, `requestingDepartment`, `debitCreditTo`, `payReceivedFrom`, `paymentMode`, `amtWords`, `receiverName`, `anyAttachment` (Spaces URLs), and `remark`
- have an `approvalStatus` column that is **never maintained**. The real status lives in `documents`.

| Voucher | Route | Tables | Doc type | Specifics |
|---|---|---|---|---|
| Multi Cash Voucher | `/multiCashVoucher` | `multiple_cash_voucher`, `material_for_the_multi_cash_voucher` (`description`, `amt`) | `multi-cash-voucher` | Line items (`particulars[]`) and a link to a **Delivery Challan** (`delivery_challan_id`) |
| Labour Payment Voucher | `/lpvoucher` | `labour_payment_voucher` | `labor-payment-voucher` | `noOfLabours`, `loadingDate`, `ratePerLabour`, `totalAmt`, `products` (text), `kyc` |
| Transport Payment Voucher | `/tpvoucher` | `transport_payment_voucher`, `voucher_products` (M2M product) | `transport-payment-voucher` | Vehicle, driver, dispatch and destination. Amounts: `freightAmt, decidedAmt, actualAmt, advanceAmt, totalPayableAmt, deductionAmt, extraAmt, finalPayableAmt`. There is **no `totalAmt` column**. |
| Packing Material Payment Voucher | `/pmpvoucher` | `packing_material_payment`, `material_use_for_packing_voucher` (`itemName, itemQty, uom_id, rate, amt`) | `packaging-material-voucher` | `sellerName`, seller `address_id`, `purpose`, `kyc` |

**Approval:** all four use **engine C** (verifier, then amount-banded approvers, then finalizers) with the category `Procurement`.
- The voucher amount is passed as `totalAmt`.
- ⚠️ For TPV that value is undefined.
- ⚠️ The server computes no amounts. Every amount comes from the client.

**Common endpoints** (the same for every voucher base):
| Method | Path | Behaviour |
|---|---|---|
| POST | `/<base>/` | `uploadAttachments` (`anyAttachment`). Returns 201. |
| PATCH | `/<base>/:id` | `uploadAttachments`, `captureUser`. Writes an audit log. |
| GET | `/<base>/` | List. |
| GET | `/<base>/:docid/view` | View by document id. |
| GET | `/<base>/:id/update` | Edit form. |
| GET | `/<base>/recyclebin` | Soft-deleted vouchers. TPV uses `/recycle-bin`. |
| GET | `/<base>/export/excel` | Export. |
| DELETE | `/<base>/:id` | Scheduled delete. |
| DELETE | `/<base>/delete/multiple` | Sets `isDeleted` on the voucher and its document. |

**Aggregate endpoint:**
- `GET /vouchers?voucherType=multi-cash-voucher,labour-payment-voucher,transport-payment-voucher,packing-material-voucher&…` merges all four lists.
  - A filter that only some types support excludes the other types.
  - Sorting and paging happen in memory.
- `GET /vouchers/export/excel` exports a summary sheet plus one sheet per type.

⚠️ **Voucher numbers are not unique.** The generator returns `LV-`, `CV-`, `TPV-` or `PMPV-` followed by `yyyyMMdd`, without a serial, so every voucher of a type created on the same day gets the same number (§18).

---

### 12.6 HR, Organisation & Platform Modules

#### Employees (`/employee`, `src/employee/`)
| Method | Path | Behaviour |
|---|---|---|
| POST | `/employee` | Body `{ firstName, middleName, lastName, username, primaryMobNo, secondaryMobNo, primaryEmail, secondaryEmail, workEmail, cugNo, designation, joiningDate, department[], roles[], residentialAddress{}, permanentAddress{}, isAddressSame, joiningLocation, currentWorkLocation (branch **or** office id; resolved automatically), accessLocation[] (branch ids), companyName[] (company ids), permissions[]{documentDefinition, canCreate, canView, canEdit, canDelete, canDownload} }`. `employeeId = PF00` + a 4-digit sequence. Status is forced to **DRAFT**. A random password is generated. |
| GET | `/employee?page&limit&search&sort` | List. ⚠️ Includes the plaintext `password` (`tempPlainPassword`). |
| GET | `/employee/:id` | View. |
| GET | `/employee/:id/view` | View. |
| GET | `/employee/:id/update` | Edit form. |
| PUT | `/employee/:id` | Update. Writes an audit log. |
| PATCH | `/employee/submit/:id` | Moves the employee from `DRAFT` to `INACTIVE` (pending admin activation). |
| PATCH | `/employee/status/:id?status=ACTIVE\|INACTIVE\|SUSPENDED` | Activate, deactivate or suspend. |
| GET | `/employee/all/partial[?id=&department=]` | Without `id`: the user dropdown. With `id`: the subordinate tree from `workflow_hierarchy`. |
| POST | `/employee/user/upload` | Excel bulk import. Likely broken (it reads `req.file.path` on an S3 upload). |
| DELETE | `/employee/:id` | Scheduled delete, 6 months out. |
| DELETE | `/employee/delete/multiple` | Soft delete. |

**Employee lifecycle:** `DRAFT → (submit) → INACTIVE → (admin) → ACTIVE`. `SUSPENDED` is also possible. **Login is blocked only for `INACTIVE`.**

**Table `employees`:**
- names; mobile, email and CUG contacts
- `department` (simple-array), `roles` (enum[]), `joiningDate`, `designation`, `employeeId`
- `password`, `tempPlainPassword`, `isOnline`, `lastActivityAt`, `status` (`ACTIVE|INACTIVE|SUSPENDED|DRAFT`)
- address FKs, `joiningLocation_id`, `currentLocation_id` (branches), `joiningOfficedata_id`, `currentOffices_id` (offices)
- M2M `user_companies` and `access_location_id` (the branch-access join table; its column names are inverted)
- `employee_transfers` (`fromLocation`, `reLocation`, `transferDate`) has no API.

**Document permissions:**
- `/document-permission`: `POST /` works. ⚠️ `GET /` and `GET /:id` are broken, and create never sets the employee.
- `/document-details`: `GET /` and `POST /` for document definitions.

#### Workflow (reporting) hierarchy (`/workflow`, `src/workFlow/`)
This is a **closure table**, `workflow_hierarchy`, with columns `department`, `ancestor_id`, `descendant_id`, and `depth` (0 = self, 1 = direct report).
- It is **not** used for document approvals.
- It drives:
  - target approvals: the depth-1 manager approves procurement and sales targets
  - dashboard and target "team scope": self plus descendants
  - the `hasChild` flag returned at login
- Department values: `procurement, sale, operations, quality_checking, business_development, Branding_&_Marketing, exports, farming, accounts, finance, hr, it, admin, superAdmin`. Aliases are normalised (for example `purchase` becomes `procurement`).

| Method | Path | Behaviour |
|---|---|---|
| POST | `/workflow/add` | Body `{department, managerId, newSubordinate}`. Inserts the self rows, the direct row, and the cross product of the manager's ancestors and the subordinate's descendants. |
| POST | `/workflow/bulk` | Body `{department, relations:[{manager, subordinate}]}`. |
| GET | `/workflow/getworkflow/:department[?managerId=]` | Returns a tree: `{id, nodeId, name, children[]}`. |
| PUT | `/workflow/update-one` | Body `{department, managerId, oldSubordinate, newSubordinate}`. |
| DELETE | `/workflow/delete-node/:department/:nodeId` | Removes every row where the node is ancestor or descendant. Its subtree is orphaned. |

⚠️ The unique constraint is commented out, so duplicate rows build up. Run `npm run clean:workflow-duplicates` before enabling it. There is no cycle detection.

#### Labour & attendance
**Permanent labour, `/labors`:**
- CRUD over `permenat_labor` (table name misspelled in the code).
- Stored data: company, location, site, labour type (`Skilled|Semi-skilled|Unskilled`), Aadhaar and bank names, contacts, emergency contact, gender, blood group, education, marital status, preferences, reference, addresses, health, birth date, PF UAN.
- Related tables: `bank_details` (`bankName, branchName, accountNumber, ifscCode, aadharNo, panNo, electionCardNo`), `family_details` (not cascaded, so never saved), and `work_experience`.

**Temporary labour register, `/tempLabour`:**
- Table `labor_temporary_register` (`laborName`, `contactNo`, `type`).
- The same name plus contact returns 400 as a duplicate.
- ⚠️ `GET /:id` is broken.
- Bulk delete is a **hard** delete.

**Attendance, `/laborAttendances`:**
- Endpoints: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`.
- Body: `{ companyName, location, date, remarks, labourDetails[]{ laborType: temporary|permanent, labourName (id or name string), inTime, outTime?, amount } }`. `checkedBy` is set to the current user.
- Tables:
  - `labor_attendance_for_temporary_and_permanent`
  - `labor_detail`: `inTime`/`outTime` are `time` columns, exposed as `hh:mm a` IST.

#### Notifications, SSE, audit and activity: see §15.

#### Super-admin / recycle bin: see §10.7. `/test/*` has SSE test endpoints, open to any authenticated user.

---

## 13. Inventory & Stock Engine

**Files:** `src/inventoryStock/entity/inventoryStock.entity.ts`, `src/inventoryStock/service/inventoryMovement.service.ts`

### Ledger table `inventory_stock`
The ledger holds one row per **(company, branch location, product, variant or NULL)**.

| Column | Type | Meaning |
|---|---|---|
| `company_id`, `location_id` (→ branches), `product_id`, `variant_id` | FK, SET NULL | Stock key |
| `inwardQty` | decimal(10,2) | **Current on-hand quantity**. Despite the name, this is the running balance. |
| `inwardAmt` | decimal(12,2) | Current stock value |
| `dumpQty` / `dumpAmt` | decimal | Cumulative dump counters |

- Stock is held **per branch and company**. Offices hold no stock.
- **Quantities are raw `netWeight`** as entered, usually kg. There is **no UOM conversion**; `uom_conversion_matrix` is not used here.
- There is **no unique index** on the stock key. Uniqueness depends on the service doing "update, then insert if 0 rows".

### Movement rules (`InventoryMovementService`)
Stock moves **only when the approval `documents` row becomes `COMPLETE`**, inside `completeDocumentWithInventory(document)`. That method:
1. opens a transaction;
2. takes `SELECT … FOR UPDATE` on the `documents` row;
3. applies the movement only when `inventoryProcessed = false`;
4. sets `status` and `inventoryProcessed = true`, then commits.

This makes the movement **idempotent**. `assertMovementIsApplicable` runs a pre-flight check before the approver's stage is saved.

| Document type | Location | Qty Δ | Amount Δ | Dump Δ |
|---|---|---|---|---|
| `inward-register` | inward.location | **+netWeight** | +unitPrice×quantity | — |
| `DC_TYPE_CUSTOMER` | fromLocation | −netWeight | −amount | — |
| `DC_TYPE_STOCK_TRANSFER` | fromLocation | −netWeight | −amount | — |
| `dump-register` | location | −quantity (lines with qty ≤ 0 skipped) | −amount | +qty / +amount |
| `return-to-vendor` | rtv.location | −netWeight | −unitPrice×quantity | — |
| `DC_TYPE_OTHER`, GRN, RFPA, AQR, RBC, Second Sale, Invoice, EOD, vouchers | — | none | — | — |

- For DC lines that carry a variant, the product is taken from `variant.product`.
- **`adjustStock`** runs an atomic `UPDATE inventory_stock SET "inwardQty" = COALESCE(...) + Δ …`. If no row matches, it **inserts** a new row, so stock-outs on a missing row produce negative balances.
- **`validateAvailability`** exists but is off (`false`) for every type. The only availability check is at **Customer DC creation**.
- Only engines A and B call the inventory service. Engine C (GRN and vouchers) never moves stock, which is correct because those types have no movement.
- **Stock Correction approval** writes `inventory_stock` directly with a read-modify-write, without a lock.

### One-time migration
`npm run backfill:inventory-processed` (`src/scripts/backfillInventoryProcessed.ts`) marks every existing movement-type document as `inventoryProcessed = true`. Those documents already moved stock under the old "at creation" logic.

Run it after deploying the "stock at approval" change, in this order:
1. Deploy.
2. Pause approvals.
3. Run the script.
4. Resume approvals.

---

## 14. Dashboards & Reports

### 14.1 Shared rules
- **"Achieved" counts only `COMPLETE` documents:**
  - `documents.type = 'grn'` for procurement: quantity = Σ `grn_products.netWeight`, amount = Σ `grn.totalAmt`.
  - `'final-invoice'` for sales: amount = Σ `invoices.totalAmount`, quantity = Σ `netProductWeight`, or DC weight in the weekly plan.
- **Team scope** comes from `workflow_hierarchy`: the user plus their descendants, filtered by department `procurement` or `sale`.
- **Month numbering is inconsistent** (see §18). Most `/dashboard/midlevel/*` endpoints treat the incoming month as **0-based** and add 1. The weekly business-plan endpoints expect **1–12**.

### 14.2 Admin dashboard: `/admin/dashboard/*`
All endpoints are global counts with no date filter.

| Endpoint | Returns |
|---|---|
| `employee/total-count` | Total employees |
| `product/total-count` | Totals and breakdowns by classification, category and subcategory |
| `branch/total-count` | Totals by branch type |
| `farmer/total-count` | Total farmers |
| `customer/total-count` | Totals by type and category |
| `vender/total-count` (spelled "vender" in the route) | Totals by category |
| `top5vendor` | Returns **all** vendors despite the name. There is no LIMIT. |
| `top5farmer` | Top 5 farmers |
| `top5/customer` | Top 5 customers |
| `sale/top5products` | Top 5 products by sales |
| `active-users` | Users with an active session and login less than 135 minutes ago |

### 14.3 Role dashboard: `/dashboard/*`
**Weekly business plan** (spec in `docs/dashboard-weekly-business-plan-api.txt`):
- Endpoints: `GET /dashboard/business-plan/weekly/{procurement|sales}/{own|team}?month=1-12&year=`.
- Response: `{success, data: [{week: 'week-1'..'week-5', assignedQuantity, achievedQuantity, achievedAmount}], message}`.
- Weeks are the month's days 1–7, 8–14, 15–21, 22–28 and 29–end. A 28-day February has 4 weeks.
- Assigned values come from `procurement_target_weeks.qty` (the month is 0-based) or `sales_target_weeks.sale_amount` (₹).

**Mid-level team endpoints:**
| Endpoint | Returns |
|---|---|
| `midlevel/procurement/team-performance` | Totals, assigned vs achieved, achievement rate, variance, registered farmers/vendors |
| `midlevel/sale/team-performance` | The same for sales |
| `midlevel/procurement/source-wise` | Vendor vs farmer breakdown |
| `midlevel/{procurement\|sale}/team-members-performance?month&year` | Per-member breakdown |
| `weekly-procurement-performance`, `weekly-sales-performance` | Legacy; no COMPLETE filter |

**Registration insight:**
- `registration-insight/{farmer|vendor|customer}-registration` returns `{registeredThisMonth, totalRegistered, approved, pending, rejected}`.
- Per-member variants of each also exist.

**Upper-level (global) endpoints:**
- `upper-level/procurement-overview`, `sale-overview`, `grn-overview`, `invoice-overview`
- `customer-type-wise/sale-overview`, `customer-category-wise/sale-overview`
- `vendor-category-wise/procurement-overview`, `vendor-subcategory-wise/procurement-overview`
- `location-wise/sale-distribution`, `location-wise/procurement-distribution`

**Other endpoints:**
- `employee-count/by-dept?department=`
- `top5/customer?teamLeaderId=`
- `top5/farmer`, `top5/vendor`

### 14.4 Management and procurement dashboards
**`/api/management/getGrns/management/{vender|farmer|product}/:id`** returns date-wise totals, calculated as Σ quantity and Σ amount. The main `/getGrns/management` endpoint returns only `{status}`, because its logic is commented out.

**`/api/procurment/*`** endpoints:
| Endpoint | Behaviour |
|---|---|
| `getGrns/procurment?filterType=tillDate\|year\|month\|dateRange\|specificDate&…` | KPI bundle: totals, by month, category, product, source, top products |
| `getGrn/startdate/:s/enddate/:e` | Totals between two dates |
| `calculation/tilldate?filterType&filterValue` | Totals to date |
| `calculations/dates?filterType=tillDate\|financialYear\|today\|dateRange` | Totals by period; the financial year starts 1 April |
| `all/getreports` | Builds an Excel GRN report and uploads it to **AWS S3**, using the legacy `BUCKET_NAME`/`REGION` variables |
| `get/dashboard/calculation` | Dashboard calculations |
| `getdata/for/sourcefarmer` | Farmer-source data |
| `getGrns/companyName/:companyName` | **Broken** |

### 14.5 Reports
| Route | Auth | Input | Output |
|---|---|---|---|
| `/crystalreports/procurement/{detailed,summary,vendor-wise,product-wise,export/excel}` (POST), `/filters` (GET) | yes | `{startDate, endDate, vendorId, farmerId, branchId, companyId, grnType, purchaseType, productId, source}` | JSON, or a streamed xlsx |
| `/procurement-reports/{detailed,summary,vendor-wise,product-wise,export/excel,export/vendor-wise-excel}` (POST), `/filters` | yes | Same filters; net-weight based | JSON, or a streamed xlsx |
| `/reports/{generate,summary,export-excel,download/procurementReport,download/salesReport}` (POST) | yes | `{reportBased: employee\|location\|company\|source\|vendor\|farmer\|product, units: kg\|tonnes, period: custom\|previous_month\|current_month\|month_year\|quarterly, startDate, endDate, month, year, quarter, companyNames[], locations[], employees[], source, vendors[], farmers[], products[]}` | `[{name, quantity, amount}]`, or an xlsx (streamed or uploaded to Spaces). ⚠️ No COMPLETE filter. |
| `/sales-reports/*` (GET) | ⚠️ **none** | Detailed, summary, customer, product, returns, and Excel exports saved to `reports/sales/`. Also `saved` / `saved/:file` / `saved/delete/:file`. | JSON or xlsx |
| `/grn-report/download` (POST) | yes | `{startDate*, endDate*, company, purchaseLocation, vendor, farmer, createdBy, product, grnType, …, totalAmount+operator (whitelisted), verifiedBy[], approvedBy[], status}` | Uploads to Spaces at `reports/grn/…` and returns `{fileUrl}` |
| `/delivery-challan-report/download` (GET with a body) | yes | `DeliveryChallanReportFilter`. ⚠️ The operators are **SQL-injectable**. | Spaces `{fileUrl}` |
| `/final-invoice-report/download` (GET with a body) | yes | Same as the row above. ⚠️ Also injectable, and the upload is **broken**. | — |
| `/registration-reports/{generate,summary,download}` (POST) | yes | `{reportType: vendor\|farmer\|customer, period…, status, createdByIds[]}` | JSON, or Spaces xlsx |
| `/new-registration-reports/download` (POST) | yes | `{registrationType: farmer\|vendor\|customer\|all, period…, city, state, pincode, employee[]}` | A multi-sheet workbook uploaded to Spaces |
| `/procurement-report/:employeeId`, `/procurement-report/excel/generate/:employeeId` | yes | Query: date, company, location, party and product filters | JSON, or a server-local file path |
| `/source/:source` (vendor\|farmer) | yes | — | Party list |
| `/final-invoice/export-report`, `/returns/export-report` (POST) | yes | Report filters | xlsx |
| `/excel/download/{product\|farmer\|vendor\|employee\|customer}/template` | ⚠️ **none** | — | Legacy fixed templates from storage |
| `/userreport/{user-counts, total-purchase, total-sale, getCountsbystatus}` | yes | Date and user filters | Employee productivity and document-status counts |

---

## 15. Cross-cutting Frameworks

### 15.1 Document list filter framework (`src/global/filters/`)
The full generated reference is `docs/FILTER_EXPORT_IMPORT_API_DOCUMENTATION.md`. Regenerate it with `npm run docs:filters`; a test checks that it is in sync.

**Pipeline:**
1. The controller calls `applyDocumentListFilters(queryOptions, req.query, docType)`.
2. That function calls `parseDocumentFilters`, which validates the query string and returns 400 `AppError` on bad input.
3. The parsed result is stored in `options.documentFilters`, and search and sort move into SQL.
4. The visibility queries (engines A, B and C, and the invoice list) call `applyDocumentFilters(qb, input, {documentAlias, recordAlias})`.

**Common query parameters** (every document list and export):
| Parameter | Meaning |
|---|---|
| `startDate`, `endDate` (aliases `dateFrom`, `dateTo`) | `YYYY-MM-DD`, IST, inclusive. Applied to each module's *business date*. |
| `status` | Comma-separated `DocumentStatus` values |
| `search` | SQL OR across the number, creator, status, module fields and products |
| `documentNo`, `createdBy`, `approvedBy` | Text |
| `createdById`, `approvedById` | UUID lists |
| `approvalStartDate`, `approvalEndDate` | Approval date range |
| `sort=field:ASC\|DESC`, or `sortBy` + `sortOrder` | Whitelisted sortable keys only |
| `page`, `limit` | Pagination |
| `productId`, `productCode`, `productName`, `variantId`, `variant`, `categoryId`, `category` | Product filters; an `EXISTS` over the line items |
| `warehouseId` / `warehouse` | Aliases of `locationId` / `location` |

**Filter kinds:**
| Kind | SQL / behaviour |
|---|---|
| `id` | FK `IN` |
| `text` | `ILIKE`, wildcards escaped |
| `enum` | `IN` |
| `iexact` | Case-insensitive exact match |
| `boolean` | `true/1/yes`, `false/0/no` |
| `day` | Single day |
| `min`/`max` | Paired as `minAmount`/`maxAmount` and `minQuantity`/`maxQuantity` |

Unknown parameters are ignored.

**Business date by module:**
| Business date | Modules |
|---|---|
| `createdAt` | RFPA, GRN, DCs, vouchers |
| `COALESCE(dealSlipCreatedAt, createdAt)` | Deal Slip |
| `date` | Inward, Dump, RBC, Vehicle Dispatch |
| `arrivalDate` | AQR |
| `invoiceDate` | Final Invoice |
| `returnDate` | RTV |
| `saleDate` | Second Sale |

**Legacy (non-document) lists** use `utils/pagination.ts buildQuery(qb, options, alias)`:
- Filters: equality, `LIKE` on nested fields, and `<`, `>`, `<=`, `>=` numeric prefixes.
- `sort="a:DESC,b:ASC"`.
- ⚠️ It loads **every row**, then searches in memory by stringifying each row, then slices out the page. This does not scale for large tables.

### 15.2 Excel export and import (`src/excel/`)
**Transactional document exports** (`GET /<module>/export/excel`, 19 routes):
- Built by `DocumentExportService.export`, which uses the same filters and visibility rules as the list endpoint; `page` and `limit` are ignored.
- Streamed with the ExcelJS `WorkbookWriter`:
  - chunks of 500 refs
  - respects backpressure
  - rolls over to a new sheet after 1,048,575 rows
  - on a mid-stream error, the response is destroyed so the client never receives a truncated file
- Headers: `Content-Disposition: attachment; filename="<Stem>_<YYYY-MM-DD>.xlsx"`, `X-Export-Record-Count`, `Cache-Control: no-store`.
- Each `ExportDefinition` (`<module>/excel/*.export.ts`) produces a header sheet, a lines sheet, and an **Approvals** sheet (one row per stage action). Document metadata columns (status, last action, approver and rejecter) come from `documentMeta.ts`.
- User columns are restricted to id, name and employeeId, so password fields can never be exported.

**Master-data import and export** covers only **Product, Farmer, Customer and Vendor**:
- Column contracts live in `<module>/excel/*.columns.ts`, built from `ExcelColumn` and `ExcelColumnGroup` (repeating blocks such as `Variant1.Count`).
- Template and export workbooks have three sheets:
  - a data sheet, where required headers are red
  - `Instructions`
  - a hidden `Lists` sheet that drives the dropdowns
- Workbooks are uploaded to Spaces under `exports/`, and the response is `{downloadUrl, fileName, totalRecords}`.
- **Import** (multipart field `file`, maximum 10 MB):
  - Accepts xlsx, xls and csv. Customer does not accept csv.
  - Headers are matched case- and space-insensitively, and aliases are supported.
  - A missing required header returns 400 and nothing is imported.
  - Duplicates are **skipped, never updated**: Product by name, Farmer by mobile, Customer by organisation name, Vendor by company name.
  - Lookup values are resolved with `findOrCreateByName`, which normalises names to `[a-z0-9]`.
  - The response is `ImportSummary {totalRows, created, skipped[], failed[], unknownColumns, missingColumns}`.
  - The uploaded file is always deleted afterwards.
- **Cell coercion:**
  - booleans accept `yes/y/1/haan/ho` and `no/n/0/nahi`
  - dates accept Excel serials, `dd-mm-yyyy` and ISO
  - numbers have `₹` and `,` stripped
- **Cleanup:** a cron job at 01:30 runs `purgeOldExports(7 days)` on the `exports/` prefix. `reports/**` is **not** purged.
- The Postman collection in `docs/postman/` covers login plus template, export and import for the four master modules. The round-trip test (re-importing an export should skip every row) proves the header contract.

### 15.3 PDF generation
`utils/pdfGenerator.ts` (`PdfGeneratorService`):
1. Renders an EJS template from `src/templates/`.
2. Converts it to an A4 PDF with Puppeteer (headless, `--no-sandbox`).
3. Uploads it to Spaces at `invoices/…` or `pdfs/…` with public-read access.
4. Returns the public URL.

| Template | Status |
|---|---|
| `invoiceTemplate.ejs` | Used by `POST /final-invoice/pdf/download`. The seller address, FSSAI and terms are hard-coded (Ahmedabad). It has no GST lines. |
| `deliveryChallan.ejs` | **Not reachable.** The template path is wrong and the relations it expects no longer exist. |
| `multiCashVoucher.ejs` | Its caller is commented out. |

Puppeteer needs Chromium dependencies in any container image.

### 15.4 File uploads and downloads (DigitalOcean Spaces)
**Client:** `middleware/spaces.config.ts` creates an S3Client with endpoint `https://sgp1.digitaloceanspaces.com`, region `sgp1`, and credentials `DO_SPACES_KEY`/`DO_SPACES_SECRET`. ⚠️ TLS verification is disabled (`rejectUnauthorized: false`).

**Upload middlewares** (all objects are uploaded **public-read**):
| Middleware | Keys | Types | Limits |
|---|---|---|---|
| `upload` (`upload.middleware.ts`) | `documents/<ts>-<name>` | pdf, jpg, png, xlsx, xls | 10 MB |
| `uploadAttachments` | field `anyAttachment` or `anyAttachment[]` only | same | ≤ 5 files |
| `uploadArray` | `array/…` | also gif, webp, csv | 10 files |
| `uploadSingle` | `single/…` | — | — |

The stored value is `req.file.location`, which is the public URL.

**Download:** `GET /files/download?key=<key>` or `?url=<publicUrl>` (authenticated) streams the object as an attachment. ⚠️ There is no ownership check.

**Farmer document shortcuts:** `GET /farmers/:id/download/{id-proof|seven-twelve|farmer-photo|farm-photo}` redirects to `/files/download`.

### 15.5 Notifications and SSE
**Table `notifications`:** `user_id`, `message`, `isRead`, `createdAt`.

**`NotificationService`:**
| Method | Behaviour |
|---|---|
| `createNoti(message, userId)` | Deduplicates the same message to the same user within 30 s, saves to the DB, then pushes over SSE. |
| `createBatchNoti(message, userIds)` | Pushes over SSE, then bulk-saves. |
| `createNotiForRole(message, role)` | Sends to every user with that role. |

**SSE** (`sse/sse.service.ts`, an in-memory singleton):
- Clients connect with `GET /sse/notifications?token=<accessToken>`.
- **Each user can hold only one connection.** A new tab evicts the old one.
- Messages are buffered per user and flushed every 100 ms, or immediately at 10 messages.
- Message format: `data: {"type":"notification","message","date","time","isRead","userId","timestamp"}\n\n`.
- A heartbeat is sent every 30 s.
- ⚠️ Because the state is process-local, the app cannot scale horizontally without a Redis pub/sub or sticky sessions.

**Notification endpoints:**
| Method | Path | Behaviour |
|---|---|---|
| GET | `/notification/getbyuserid` | Returns `[{id, message, date, time, isRead}]`. |
| PATCH | `/notification/mark-all-read` | Marks all as read. |
| GET | `/notification/getallNotification` | ⚠️ Returns **every user's** notifications. |
| GET | `/notification/export-excel` | Exports to Spaces. |

### 15.6 Cron jobs (in-process `node-cron`; every instance runs them)
| Schedule | Job | File |
|---|---|---|
| `0 0 1 * *` (midnight on the 1st of each month) | `OverdueDeletionService.deleteOverdueRecordsForEntity` for InwardRegister, Farmer and Product: hard-deletes rows where `deletionScheduledAt <= now`. ⚠️ It is probably a no-op because the raw column name is wrong. | `cron/cronJob.ts`, `global/overdueDeletion.service.ts` |
| `30 1 * * *` (01:30 daily) | `purgeOldExports()` deletes Spaces `exports/` objects older than 7 days. These files contain PAN, bank and contact data. | `cron/cronJob.ts`, `excel/excelCleanup.service.ts` |
| *(not imported, dead)* | `utils/cronShedule.ts` (daily user hard-delete) and `utils/cronjobfordelete.ts` (every 5 minutes, purge of `isDeleted` rows) | — |

### 15.7 Logging, audit and activity
**Winston** (`utils/logger.ts`):
- Files: `logs/error.log` (5 MB × 5), `logs/combined.log` (10 MB × 5), `logs/user-activity.log` (`UserLogger`, with the username and IP).
- Outside production it also logs to the console.
- `ControllerLogger` wraps `UserLogger`.

**Audit log** (`audit_logs`: `entityName`, `entityId`, `changes` jsonb `{field: {oldValue, newValue}}`, `updatedBy`, `updatedAt`):
- Written by `AuditLogService.logChange(...)` from most update services.
- Read endpoints:
  - `GET /audit-logs`
  - `GET /audit-logs/:entityName/:entityId`
  - `GET /audit-logs/user/:userId/report`
  - `GET /audit-logs/date-range?startDate&endDate&entityName`
  - `GET /audit-logs/user/:userId` is shadowed by another route and cannot be reached.

**User activity log** (`user_activity_logs`):
- Columns: `user_id`, `userName`, `action`, `module` (about 40 values), `entityName`, `entityId`, `description`, `metadata`, `changes`, `ipAddress`, `userAgent`, `endpoint`, `httpMethod`, `statusCode`, `responseTime`, `isError`, `errorMessage`.
- `action` values: CREATE, UPDATE, DELETE, VIEW, APPROVE, REJECT, LOGIN, LOGOUT, EXPORT, PRINT, DOWNLOAD, ERROR.
- Indexed on `(userId, createdAt)`, `(action, createdAt)` and `(module, createdAt)`.
- Written fire-and-forget by controllers through `UserActivityLogService.logActivity`.
- Endpoints under `/user-activity-logs/*`:
  - `/user/:userId`, `/`, `/entity/:name/:id`
  - `/user/:userId/summary`, `/recent`, `/user/:userId/login-history`, `/user/:userId/errors`
  - `/my-activities`, `/activity-feed`, `/stats`
  - `DELETE /cleanup` always returns 403.

**System log** (`system_log`): records IP, browser and device at login. The OS fields are the server's, not the client's.

**Not active:** the `update-subscriber.ts` TypeORM subscriber (the subscriber glob does not match it) and `activityLogger.middleware.ts` (never used).

### 15.8 Time zone handling
- The business time zone is **Asia/Kolkata**. Postgres runs with `TZ=Asia/Kolkata` in docker-compose.
- `timestamp` columns have no zone.
- **Output:** `timezoneMiddleware` formats every `Date` in a response as `DD-MM-YYYY hh:mm A` IST. Many DTOs also add `createdDate` (`YYYY-MM-DD`) and `createdTime` (`hh:mm A`).
- **Input:**
  - Filter dates are parsed in IST (`FILTER_TIMEZONE`).
  - Some services accept `dd-MM-yyyy` and normalise it to `yyyy-MM-dd`: RFPA and inward dates.
  - Time fields accept `HH:mm` or `h:mm am/pm`: GRN `timeIn`, delivery time, attendance.
- Dashboards mostly use server-local `new Date()`. The weekly-plan windows are calculated in UTC.

---

## 16. Docker, Nginx & Deployment

### 16.1 `docker-compose.yml`
**The app itself is not containerised.** The compose file notes "app service removed — run locally with `npm start`", and there is **no Dockerfile** in the repo. Compose provides the infrastructure on the `primefresh_network` bridge network:

| Service | Image | Host port → container | Config |
|---|---|---|---|
| `postgres` (`postgres_primefresh`) | `postgres:17-alpine` | **6500 → 5432** | `POSTGRES_USER=admin`, `POSTGRES_PASSWORD=password123`, `POSTGRES_DB=node_typeorm`, `TZ=Asia/Kolkata`. Volume `pgdata`. `./postgres/init` is mounted at `/docker-entrypoint-initdb.d` (currently empty). Healthcheck: `pg_isready` every 10 s. |
| `redis` (`redis_primefresh`) | `redis:7-alpine` | 6379 → 6379 | `redis-server --appendonly yes --requirepass redis123`. Volume `redis_data`. Healthcheck: `redis-cli -a redis123 ping`. |
| `pgadmin` (`pgadmin_primefresh`) | `dpage/pgadmin4` | **9000 → 80** | `admin@example.com` / `password123`. Volume `pgadmin_data`. Depends on a healthy postgres. |
| `nginx` (`nginx_primefresh`) | `nginx:alpine` | **8004 → 8004** | Mounts `nginx/nginx.conf`, `nginx/conf.d/`, `nginx/ssl/` (read-only), and volume `nginx_logs`. Depends on a healthy postgres. |

⚠️ `nginx/conf.d/default.conf` proxies to `upstream app_backend { server app:4000; }`. Because the `app` service was removed from compose, **Nginx cannot resolve `app`** and will fail to start or return 502 errors.
- To proxy to an app running on the host, change the upstream to `host.docker.internal:4000` and add `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux.
- Alternatively, re-add an `app` service (see §16.4).

### 16.2 Nginx (`nginx/nginx.conf`, `nginx/conf.d/default.conf`)
**`nginx.conf` settings:**
- `worker_processes auto`, `worker_connections 1024`, epoll.
- Gzip level 6. `client_max_body_size 100M`.
- Rate-limit zones: `api` at 10 r/s and `files` at 5 r/s.
- Security headers: `X-Frame-Options SAMEORIGIN`, `X-XSS-Protection`, `nosniff`, `Referrer-Policy`, and a permissive CSP.
- The access log includes upstream timings.

**Server on port 8004:**
| Location | Behaviour |
|---|---|
| `/api/` | Proxied to the app. Burst 20. 60 s timeouts. Buffering on. WebSocket upgrade headers. |
| `/sales-target/` | Burst 15. 120 s timeouts for Excel generation. |
| `/files/exports/`, `/files/uploads/` | Static files served from `/var/www/exports` and `/var/www/uploads`. Only xlsx, xls, pdf, csv and txt (plus images for uploads) are allowed. `Content-Disposition: attachment`. CORS `*`. php, html and js are blocked. |
| `/stream/` | Proxied with buffering off and 300 s timeouts. Range requests are supported. |
| `/health` | Proxied to the app. ⚠️ The app has **no `/health` route**; `GET /` returns "Hello World!". |
| `/` | Proxied to the app. Dotfiles and `~` backup files are denied. |

- ⚠️ SSE (`/sse/notifications`) goes through `location /`, where buffering is on. The app sends `X-Accel-Buffering: no`, which disables buffering for that response.
- ⚠️ Most application routes do **not** start with `/api/` (for example `/grns` and `/rfpa`), so they fall through to `location /` and **are not rate-limited**.

**Other Nginx files:**
- `nginx/conf.d/ssl.conf` contains a fully commented HTTPS template (TLS 1.2/1.3, HSTS, HTTP→HTTPS redirect).
- `nginx/nginx-minimal.conf` is a smoke-test config that returns "nginx is working!".

### 16.3 Running locally
```bash
docker compose up -d postgres redis pgadmin      # infra
cp .env.example .env                             # set POSTGRES_PORT=6500, POSTGRES_USER=admin, POSTGRES_PASSWORD=password123,
                                                 # POSTGRES_DB=node_typeorm, REDIS_URL=redis://:redis123@localhost:6379,
                                                 # JWT_* (base64 PEMs), DO_SPACES_*, EMAIL_*, SEED_ADMIN_*
npm install
npm start                                        # ts-node-dev on :4000; schema auto-synced; seeds run
# first login: POST /auth/login {"uid":"Admin" | "<SEED_ADMIN_EMAIL>", "password": <tempPlainPassword from DB/GET /employee>}
```
⚠️ The seeded admin's password is **not** `SEED_ADMIN_PASSWORD` (see §18). Read `employees.tempPlainPassword` to get it.

**Production hints:**
- The server listens on `0.0.0.0:$PORT`.
- The process exits on any unhandled error, so run it under PM2 or systemd, or in a container with `restart: unless-stopped`.
- Known deployment targets:
  - frontend on Vercel (`prime-fresh-erp.vercel.app`)
  - backend on a DigitalOcean droplet (`139.59.83.235`)
  - files on DO Spaces `sgp1`
- With PM2 cluster mode, `config/default-{0,1}.ts` provide per-instance overrides. SSE and cron are per process, so run **one instance** or externalise them.

### 16.4 Suggested app container (not in the repo)
The app needs Chromium for Puppeteer and **must run through ts-node**, because the entity globs point at `src/`:
```dockerfile
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y chromium fonts-liberation && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium TZ=Asia/Kolkata
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 4000
CMD ["npx","ts-node","--transpile-only","src/app.ts"]
```
The service should be named `app` so the Nginx upstream `app:4000` resolves. Also set `POSTGRES_HOST=postgres`, `POSTGRES_PORT=5432` and `REDIS_URL=redis://:redis123@redis:6379`.

---

## 17. Scripts, Tests & Tooling

| npm script | What it does |
|---|---|
| `npm start` | `ts-node-dev --respawn --transpile-only --exit-child src/app.ts` |
| `npm run build` | `tsc` → `build/`. ⚠️ The compiled output is **not runnable as-is**, because the entity globs point at `src/**/*.entity.ts`. |
| `npm test` | Jest (ts-jest, `isolatedModules`, diagnostics off). All specs are pure unit tests; no DB is needed. |
| `npm run typeorm:migrate` | `typeorm migration:run -d src/utils/data-source.ts` |
| `npm run clean:workflow-duplicates` | De-duplicates `workflow_hierarchy`. Run it before enabling the unique constraint. |
| `npm run backfill:inventory-processed` | One-time `documents.inventoryProcessed` backfill (§13) |
| `npm run docs:filters` | Regenerates `docs/FILTER_EXPORT_IMPORT_API_DOCUMENTATION.md` |
| `npm run postman:build` | Regenerates the Postman collection and environment in `docs/postman/` |

**Other tooling:**
- `load-test-login.js` is a k6 script: 10 → 50 VUs against `/auth/login`, with thresholds p95 < 1 s and error rate < 5 %. ⚠️ It contains a hard-coded credential that should be removed.
- `run-migrations.ts` runs migrations programmatically.
- `fix-enum.sql` is manual SQL to remove `draft` from the target enums.

**Test specs** (`src/test/service/`):
| Spec | Covers |
|---|---|
| `documentFilter.spec.ts` | Parser and SQL for all 18 filter definitions |
| `excelExport.engine.spec.ts`, `excelExport.request.spec.ts`, `excelExport.definitions.spec.ts` | Streaming export engine, request contract, and every export definition |
| `excel.columns.spec.ts` | Master-data import/export round trip |
| `lookupByName.spec.ts` | Name lookup |
| `weeklyBusinessPlan.spec.ts` | Week windows and plan months |
| `procurementAchieved.spec.ts` | Procurement achievement calculation |
| `productCode.spec.ts` | Product code generation |
| `inventoryMovement.service.spec.ts` | Stock movement rules |
| `filterApiDocs.spec.ts` | The committed filter docs must match the generator (38 list/export routes) |

There are no controller, integration or report tests.

**Reference docs in the repo:**
- `docs/FILTER_EXPORT_IMPORT_API_DOCUMENTATION.md` (generated)
- `docs/excel-import-export-api.md`
- `docs/dashboard-weekly-business-plan-api.txt`
- `src/stockCorrection/STOCK_CORRECTION_API.txt`
- `docs/postman/README.md`

---

## 18. Known Issues, Risks & Gotchas

These issues were found by reading the code. They are grouped by severity. Fix them deliberately, one change at a time: many clients may depend on the current behaviour.

### 18.1 Security
1. **Plaintext passwords are stored and returned.** `employees.tempPlainPassword` holds the plaintext, and `GET /employee` returns it as `password`.
2. **The seeded admin password is ignored.** `createUser` overrides it with a random one and forces the status to `DRAFT`, which does not block login.
3. **Authorization is almost absent.**
   - `checkPermission` is applied only to RFPA create, edit and delete.
   - No roles are enforced on `/super-admin/*` (hard delete of any document), `/test/*` (message anyone), `/approval-flow` (anyone can rewrite approval chains), `/audit-logs` or `/user-activity-logs`.
   - `GET /notification/getallNotification` returns every user's notifications.
4. **Some routes have no authentication at all:**
   - `/sales-reports/*`, including listing, downloading and **deleting** saved report files
   - `/excel/download/*`
   - `/pincode`
   - `/sse/test`
5. **SQL injection.** Comparison operators are interpolated into SQL in the DC report, the Final Invoice report and the Return By Customer report. The Return By Customer write-back SQL also interpolates quantities. Whitelist the operators (the GRN report already does this).
6. **Rate limiting and Helmet are disabled.** Nginx rate limiting only covers `/api/*`, and most routes are not under that prefix.
7. **Token hygiene.**
   - The refresh token is returned in the response body and is never rotated.
   - The SSE token travels in the query string and is written to the logs.
   - `deserializeUser` ignores the user's `status`, so suspended users keep access until their token expires.
   - `isOnline` is set before the password check.
   - Blacklisted tokens are never purged, and the `token` column has no index even though it is queried on every request.
8. **Storage exposure.**
   - Every upload is public-read.
   - `/files/download` returns any object key without an ownership check.
   - The Spaces client runs with TLS verification off.
9. `load-test-login.js` contains a hard-coded credential.

### 18.2 Data integrity
1. **Document numbers are not safe under concurrency.** Most generators compute count+1 or MAX+1 without a lock and without a unique index. Collisions are possible.
   - **Voucher numbers never include a serial.** Every voucher of the same type created on the same day gets the same number (`LV-yyyyMMdd`, `CV-…`, `TPV-…`, `PMPV-…`).
   - A branch name containing `-` breaks the invoice serial.
   - The customer code computed in the service is overwritten by the entity's `@BeforeInsert` hook.
   - Fix pattern: use a Postgres sequence per series, or a `SELECT … FOR UPDATE` counter table, plus a unique index.
2. **The document row is created outside the business transaction.** `createDocument` and `startApprovalFlow` run outside, or after, the business row's transaction.
   - A failure there leaves a business row with no approval document.
   - `startApprovalFlow` can throw after commit, for example with "No approver found for this document amount".
3. **Editing after approval.** Only GRN resets its approval when edited.
   - Inward, AQR, RTV, the DCs, Dump, EOD, Second Sale, RFPA and Deal Slip can all be edited after they are COMPLETE.
   - For Inward, DCs, Dump and RTV this means **stock no longer matches the document**, because the stock movement has already been applied.
4. **Deletes do not unwind links.** Deleting a Deal Slip, Invoice or Return By Customer leaves `rfpa.isDealSlipCreated`, `dc.isInvoiceCreated` and `dc.isReturnByCustomerCreated` set to true. The parent can then never be used again.
   - Single DC deletes are **hard deletes** and leave the `documents` row orphaned.
5. **Link flags are never set.** The GRN `is*Created` flags, `dealSlip.isGrnCreated`, `grns.rfpa_id`, `grns.branch_id` and `rfpa/dealSlip.created_by` are never written. Dropdown filters that depend on them therefore return everything.
6. **No runtime validation of request bodies.** Most payloads go straight into `repository.create()` or `Object.assign()`. This allows mass assignment of fields such as `status`, `vendorCode` and approval fields.
7. **Wrong column types.** These columns are integers but receive fractional values:
   - `dump_register.totalQty` and `totalDumpCost`
   - `second_sale_product.quantity`
   - the `item` and `second_sale_product` packaging columns
   - `rfpa_product.quantity`
8. **Tax is not computed on the server.** Invoice CGST, SGST and IGST amounts come from the client. The PDF total leaves out tax, freight and discount. No HSN codes are stored.
9. **No stock availability check** on Stock Transfer DC or Dump, and none at approval time. The inventory stock key has no unique index.
10. `sales_achievements` and `procurement_achievements` are never written. Achievement is computed on the fly from GRNs; for sales, from invoices on the dashboards only.

### 18.3 Broken or dead functionality
| Area | Problem |
|---|---|
| `/productVarient/*` | Every route references the non-existent relation `productTemplate`. |
| `GET /tempLabour/:id` | References the non-existent relation `attendances`. |
| `PATCH /returns/:id` | References `proformaInvNo` and `returnedProducts.returnedUOM`, which don't exist. |
| `GET /document-permission`, `GET /document-permission/:id` | Reference a non-existent `level` relation. `POST` never sets the employee. |
| `/final-invoice-report/download` | The S3 client is never initialised. |
| `/api/procurment/getGrns/companyName/:companyName` | Broken. |
| `/api/management/getGrns/management` | Returns an empty result. |
| Source-wise procurement report | `GROUP BY` on a column that doesn't exist. |
| Crystal-report queries | Use field names that don't exist (`vendor.name`, `variant.name`, `uom.name`). |
| GRN `PUT` | Reads `req.file.path` on an S3 upload, so a new bill image is lost. Employee Excel upload has the same problem. |
| `approvalStatus: 'query'` | Fails with a DB enum error in engines A and C. |
| Engine C creator notifications | Never fire, because a relation isn't loaded. |
| Approver blocks 4–6 | Configured but never used. |
| GRN and vouchers without verifiers | Can never be approved. |
| Recycle-bin restore | Likely can't find rows, because `@DeleteDateColumn` hides them. |
| Recycle bin, `packaging-material-voucher` | Mapped to the master-data repository instead of the voucher repository. |
| `DELETE /user-activity-logs/cleanup` | Always returns 403. |
| `GET /audit-logs/user/:userId` | Shadowed by another route. |
| `getCountsbystatus` | Counts `"rejected"` instead of `"REJECT"`. |
| Overdue-deletion cron | Probably a no-op because of a column-name mismatch. |
| Scheduled deletions | Rows marked for deletion are never purged, except in 3 entities. |
| `utils/cronShedule.ts`, `utils/cronjobfordelete.ts`, `SSEHelperService`, `cache.middleware`, `performance`/`responseOptimizer` middleware, `activityLogger` middleware, `update-subscriber`, `swagger.ts`, `validateEnv.ts`, `OptimisedReportService`, `QueryOptimizerService` | Dead or unwired code. |
| DC PDF (`generateDeliveryChallanPdf`) | Wrong template path and relations that no longer exist. |
| Nginx upstream `app:4000` | No `app` service exists in compose. `/health` has no route in the app. |
| View endpoints: Final Invoice, Customer DC, Stock Transfer DC, Second Sale | `documentId` and `createdBy` come back undefined. |

### 18.4 Operational and performance
- **Schema:** `synchronize: true` in every environment. Schema changes are applied automatically on boot, and a destructive entity change can drop columns. Switch to migrations before any serious production use.
- **Pagination in memory:** `buildQuery` and several services load every row, search it in memory, then slice a page. Large tables will slow list endpoints down.
- **Blocking Redis calls:** `invalidatePattern` uses Redis `KEYS`.
- **Queries per request:**
  - `captureUser` runs a query with an undefined id on every request.
  - `deserializeUser` checks the blacklist against the DB on every request.
- **Horizontal scaling:** SSE clients, cron jobs and number generation all live in process memory, so the app is **single-instance only**.
- **Crash on any error:** `process.exit(1)` runs on any unhandled rejection. A supervisor is required.
- **Caching:**
  - Dates come back in different formats depending on whether the response was a cache hit or a miss.
  - Some cache keys are never invalidated: `product:variants:full:*`, `office:idtype:*`, and per-user list caches.
- **Month conventions:**
  - `procurement_targets.month` is 0-based and `sales_targets.month` is 1-based (see `utils/planMonth.ts`).
  - Dashboards and the sales-target `getAll` endpoint are not consistent with this.
- **Tracked noise:** `logs/combined.log` is tracked by git.

---

## 19. Conventions for Contributors

### Adding a transactional (approval) document module
Follow the existing RFPA or Dump Register pattern:
1. **Entity:** in `src/<mod>/entity/`, extend `Model`. Use `decimal` for money and weights, and a separate line entity with `cascade: true`.
2. **Document type:** add a value to `DocumentTypeEnum` in `approvalFlow/entity/docuemnt.entity.ts`.
3. **Engine and category:** decide the approval engine (A, B or C) and add the type to the matching list in `documentb.service.ts`: `isSingle…`, `isDoubleApprovalBasedDocument`, or the engine C types. Choose the category (`Procurement`, `Sale` or `Operation`).
4. **Document definition:** add an entry to `src/data/documentDefination.json` so a definition row is created and permissions can be granted.
5. **Service create flow:**
   1. `checkApprovalFlowExists`
   2. start a queryRunner transaction
   3. generate the number
   4. save
   5. `documentbService.createDocument({type, docDef, totalAmt, status: HOLD, lastActionBy, document_type_id})`
   6. commit
   7. `startApprovalFlow`
   8. invalidate the cache with `<prefix>:*`
6. **Stock movement:** if the document moves stock, add a `plan<Doc>` branch in `InventoryMovementService.planForDocument` and extend `inventoryMovement.service.spec.ts`.
7. **Lists:** use the engine's visibility query, add a filter definition in `global/filters/documentFilter.definitions.ts`, and call `applyDocumentListFilters` in the controller.
8. **Export:** add `excel/<mod>.export.ts` and the `GET /export/excel` route, then run `npm run docs:filters` (a test enforces it).
9. **Dependency injection:** add symbols to `types.ts` and bindings to `inversify.config.ts`. Use `inRequestScope` for repositories and `inSingletonScope` for services and controllers.
10. **Controller:** apply `deserializeUser, requireUser` (and `checkPermission` where appropriate). Send a notification and call `UserActivityLogService.logActivity` on writes, and `AuditLogService.logChange` on updates.
11. **Busting caches on approval:** add the module's cache prefix to the approval engines' cache-busting maps. Otherwise lists show a stale `overAllStatus`.

### General rules
- **Numbers and dates:**
  - Keep amounts as `decimal`; Postgres returns them as strings, so wrap them in `Number()`.
  - Accept dates as `YYYY-MM-DD` and times as `HH:mm`.
  - Business time zone is IST.
- **Routes:** `:docid` means `documents.id` (view and approval); `:id` means the business row id (update and delete). Keep the two consistent.
- **Master data:** preserve the `draft → pending → approved/notapproved` flow and the visibility rules.
- **Status names:** `Status.REJECTED` is the string **`'notapproved'`**. `DocumentStatus` terminal values are upper-case: **`COMPLETE`** and **`REJECT`**.
- **Formatting:** follow `.prettierrc`. There is no linter configured.

---

## Appendix A: Route Prefix Index

Every controller except those marked **public** is protected by `deserializeUser` + `requireUser`.

| Prefix | Module / purpose | Source |
|---|---|---|
| `/auth` (public) | login, refresh-token, logout | `src/auth` |
| `/employee` | employees, status, hierarchy subtree, bulk upload | `src/employee` |
| `/document-permission`, `/document-details` | permissions, document definitions | `src/employee`, `src/documentDef` |
| `/approval-flow`, `/documents`, `/approval` | approval configuration and approval actions | `src/approvalFlow` |
| `/workflow` | reporting hierarchy (closure table) | `src/workFlow` |
| `/super-admin` | recycle bin: soft-delete, restore, permanent delete | `src/sse` |
| `/notification`, `/sse` (public stream), `/test` | notifications, SSE | `src/notification`, `src/sse` |
| `/audit-logs`, `/user-activity-logs`, `/userreport` | audit and activity logs, user reports | `src/employeeActivity`, `src/employeeReport` |
| `/rfpa`, `/dealSlip`, `/grns`, `/paymentRequest` | procurement documents | respective modules |
| `/inwardRegister`, `/aqr`, `/dumpRegister`, `/eodStock`, `/stock-correction`, `/inventoryStock` | operations and stock | respective modules |
| `/return-to-vendor`, `/returns` | returns | `src/returnToVendor`, `src/returnByCustomer` |
| `/customer-delivery-challan`, `/tranfer-delivery-challan`, `/other-delivery-challan`, `/deliveryChallan` | delivery challans | `src/deliveryChallans` |
| `/final-invoice`, `/secondSales`, `/saleOrders`, `/vehicleDispatches` | sales and dispatch | respective modules |
| `/multiCashVoucher`, `/lpvoucher`, `/tpvoucher`, `/pmpvoucher`, `/vouchers` | vouchers | `src/vouchers` |
| `/procurement-target`, `/sales-target` | plans and targets | respective modules |
| `/vendors`, `/vendor-categories`, `/vendor-subcategories` | vendor master | `src/vendor` |
| `/farmers` | farmer master | `src/farmer` |
| `/customers`, `/customerCategory`, `/customerType` | customer master | `src/customer` |
| `/products`, `/productCategory`, `/productClassification`, `/productSubcategory`, `/productVarient`, `/varients` | product catalogue | `src/product` |
| `/uoms`, `/uom-conversion-matrix`, `/packingMaterial` | units of measure, packing | respective modules |
| `/company`, `/location-branches`, `/location-offices`, `/drivers`, `/levels`, `/pincode` (public) | organisation masters | respective modules |
| `/labors`, `/tempLabour`, `/laborAttendances` | labour | `src/labour`, `src/labourAttendence` |
| `/admin/dashboard`, `/dashboard`, `/api/management`, `/api/procurment` | dashboards | `src/dashboard` |
| `/crystalreports`, `/procurement-reports`, `/reports`, `/sales-reports` (**public**), `/grn-report`, `/delivery-challan-report`, `/final-invoice-report`, `/registration-reports`, `/new-registration-reports`, `/procurement-report`, `/source` | reports | `src/reports` |
| `/files` | Spaces download proxy | `src/file` |
| `/excel` (**public**) | legacy template downloads | `src/getExcel` |
| `GET /` (public) | "Hello World!" liveness check | `src/app.ts` |

## Appendix B: Glossary
| Term | Meaning |
|---|---|
| **F&V** | Fruits and vegetables |
| **RFPA** | Request For Purchase Approval |
| **GRN** | Goods Received Note |
| **AQR** | Arrival Quality Report |
| **DC** | Delivery Challan: a dispatch note, or a **Distribution Centre** when the context is locations |
| **CC** | Collection Centre, a branch type near farms |
| **RTV** | Return To Vendor |
| **RBC** | Return By Customer |
| **EOD** | End Of Day stock report |
| **MCV / LPV / TPV / PMPV** | Multi Cash / Labour Payment / Transport Payment / Packing Material Payment Voucher |
| **7/12 (Saat-Bara)** | Maharashtra land-record extract, stored on the farmer record |
| **Mandi** | Agricultural produce market, with a mandi licence on the customer KYC |
| **APMC** | Agricultural Produce Market Committee |
| **Bikri / consignment sales** | Consignment sale purchase type |
| **MGP** | Minimum guaranteed price purchase type |
| **IE / RE Limit** | Initial and Revised Exposure (credit) Limit for a customer |
| **Document (`documents` row)** | The approval-engine companion of every business document |
| **Verifier / Approver / Finalizer** | Approval stages. Roles with the same names also gate master-data approval. |
