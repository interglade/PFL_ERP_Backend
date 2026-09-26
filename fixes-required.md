# Fixes Required – PrimeFresh ERP Backend

Code review of all modules, done 2026-09-24. Nothing has been changed in the codebase yet.

- **Critical**: attackers can take over accounts or data, or real money, stock or data is being corrupted. Fix first.
- **High**: broken features, wrong report numbers, or serious weaknesses that are harder to exploit.

Line numbers are as of the review date and may drift.

**Suggested order:**
1. C1–C5: close the open reports endpoint, admin takeover and plaintext passwords.
2. C15: add authorization.
3. C14: rotate secrets and JWT keys.
4. C16: turn off `synchronize`.
5. C17–C30: approval, stock, invoice and voucher integrity.
6. H14: sequences and unique constraints for all document numbers.
7. The rest of High.

---

## 🔴 CRITICAL

### Security

- [ ] **C1. `/sales-reports` needs no login at all**
  - Where: [salesCrystalReport.controller.ts:23](src/reports/controller/salesCrystalReport.controller.ts#L23)
  - Bug: anyone on the internet can read all sales and customer data, list the report files on the server, and delete them with `GET /saved/delete/:fileName`. `limit` has no upper bound.
  - Fix:
    - Add `deserializeUser, requireUser` plus a role check to the controller.
    - Change the delete route to `DELETE`, admin only.
    - Cap `limit`.

- [ ] **C2. Any user can make themselves admin**
  - Where: [user.service.ts:697](src/employee/service/user.service.ts#L697), [user.controller.ts:41](src/employee/controller/user.controller.ts#L41)
  - Bug: `Object.assign(user, userData)` copies the raw request body onto the user, so `PUT /employee/:id {"roles":["admin"]}` works for anyone.
  - Fix:
    - Restrict the employee create, update and delete routes and `/status` to admins.
    - Whitelist the fields that can be updated.
    - Allow `roles` and `permissions` to change only through an admin-only endpoint.

- [ ] **C3. Account takeover by writing someone else's password**
  - Where: [user.service.ts:697](src/employee/service/user.service.ts#L697)
  - Bug: the same `Object.assign` lets anyone write a bcrypt hash they know into the admin's `password`, then log in as admin.
  - Fix: never accept `password` in the update route. Changing a password must go through a dedicated flow that checks the old password or an admin reset, and hashes on the server.

- [ ] **C4. Plaintext passwords are stored and handed out**
  - Where: [user.service.ts:119](src/employee/service/user.service.ts#L119), [user.service.ts:304](src/employee/service/user.service.ts#L304), [user.service.ts:840](src/employee/service/user.service.ts#L840), [user.entity.ts:195](src/employee/entity/user.entity.ts#L195), [userActivityLog.service.ts:185](src/employeeActivity/service/userActivityLog.service.ts#L185)
  - Bug: `tempPlainPassword` is stored in cleartext. It is returned by `GET /employee` and by the activity-log endpoint, and cached in Redis ([auth.controller.ts:199](src/auth/controller/auth.controller.ts#L199)).
  - Fix:
    - Drop the `tempPlainPassword` column and clear its existing data.
    - Send temporary passwords once by email or reset link, and force a change on first login.
    - Strip every secret field in `toJSON`.
    - Clear the Redis caches.

- [ ] **C5. Users can grant themselves document permissions**
  - Where: [documentPermission.controller.ts:71](src/employee/controller/documentPermission.controller.ts#L71), [documentPermission.service.ts:172](src/employee/service/documentPermission.service.ts#L172)
  - Bug: `POST /document-permission` has no admin check and spreads the body into the record.
  - Fix: admin-only route, with an explicit whitelist of fields.

- [ ] **C6. Any user can rewrite approval flows**
  - Where: [approvalFlow.controller.ts](src/approvalFlow/controller/approvalFlow.controller.ts), [approvalFlow.service.ts:614](src/approvalFlow/service/approvalFlow.service.ts#L614)
  - Bug: create, update and `/replace/user` are open to anyone. For example, `{oldUserId: CFO, newUserId: self}` makes the caller the CFO's replacement. `Object.assign(result, rest)` also allows changing `creator` and `type`.
  - Fix:
    - Admin-only routes.
    - Whitelist the fields.
    - Add a unique constraint on (creator, type).
    - Forbid a user from being an approver on their own flow.

- [ ] **C7. Any user can edit the workflow hierarchy**
  - Where: [WorkflowHierarchy.controller.ts](src/workFlow/controller/WorkflowHierarchy.controller.ts)
  - Bug: `/workflow/add {managerId: self, newSubordinate: CEO}` makes the caller the CEO's manager, so they then see that team's data in the dashboards.
  - Fix: admin/HR-only routes.

- [ ] **C8. SQL injection through comparison operators**
  - Where:
    - [postReturnByCustomer.service.ts:1122](src/returnByCustomer/service/postReturnByCustomer.service.ts#L1122), 1131, 1138, 1144
    - [deliveryChallanReport.service.ts:229](src/reports/service/deliveryChallanReport.service.ts#L229), 241
    - [finalInvoiceReport.service.ts:233](src/reports/service/finalInvoiceReport.service.ts#L233), 263
  - Bug: the operator from `req.body` is pasted into the SQL text (`andWhere(\`x ${operator} :v\`)`), which allows blind extraction of any table.
  - Fix: whitelist the operators (`=, !=, <, <=, >, >=`), the same way [grnReport.service.ts:273](src/reports/service/grnReport.service.ts#L273) already does.

- [ ] **C9. Any user can permanently delete any business document**
  - Where: [superAdmin.controller.ts:295](src/sse/superAdmin.controller.ts#L295)
  - Bug: the "super-admin" soft-delete and hard-delete routes only require a login.
  - Fix: super-admin role check, and record every call in the audit log.

- [ ] **C10. Any user can change payment request bank details**
  - Where: [paymentRequest.controller.ts:22](src/paymentReq/controller/paymentRequest.controller.ts#L22), line 143, and [paymentRequest.service.ts:145](src/paymentReq/service/paymentRequest.service.ts#L145)
  - Bug: every payment request (including bank account and IFSC) is readable by anyone. `update(id, req.body)` lets anyone change `bankAccNo`, `amount` and so on, and redirect the payment.
  - Fix:
    - Owner or approver check.
    - Whitelist the fields.
    - Block edits once approval has started.
  - Same problem for labour bank details: [labor.service.ts:72](src/labour/service/labor.service.ts#L72).

- [ ] **C11. Any user can overwrite another vendor's or customer's bank, GST or PAN details**
  - Where: [vendor.service.ts:1502](src/vendor/createVendor/service/vendor.service.ts#L1502), [vendor.service.ts:331](src/vendor/createVendor/service/vendor.service.ts#L331), [customer.service.ts:1441](src/customer/addcustomer/service/customer.service.ts#L1441), [customer.service.ts:2177](src/customer/addcustomer/service/customer.service.ts#L2177)
  - Bug: nested records trust the `id` in the body. Updating vendor A with vendor B's bank-row id overwrites vendor B's bank details.
  - Fix: ignore client-supplied sub-record ids, or check that each id belongs to the parent record being edited.

- [ ] **C12. Any user can delete any file in the storage bucket**
  - Where: [vendor.controller.ts:453](src/vendor/createVendor/controller/vendor.controller.ts#L453), [customer.controller.ts:280](src/customer/addcustomer/controller/customer.controller.ts#L280)
  - Bug: on submit with a new file, the code deletes whatever URL the client sent for that field.
  - Fix: only delete the file URL stored on the database record, never one taken from the request body.

- [ ] **C13. KYC, bank and invoice files are publicly readable**
  - Where:
    - [upload.middleware.ts:31](src/middleware/upload.middleware.ts#L31), [uploadarray.middleware.ts:46](src/middleware/uploadarray.middleware.ts#L46), [uploadsingle.middleware.ts:51](src/middleware/uploadsingle.middleware.ts#L51)
    - [excelFile.service.ts:367](src/excel/excelFile.service.ts#L367)
    - Report controllers and [pdfGenerator.ts:62](src/utils/pdfGenerator.ts#L62)
    - [file.controller.ts:34](src/file/file.controller.ts#L34)
  - Bug:
    - Every upload and export uses `ACL: 'public-read'` with a guessable key (timestamp + filename).
    - `/files/download` returns any object in the bucket to any logged-in user.
  - Fix:
    - Make the bucket private and serve files through short-lived pre-signed URLs.
    - Use random (UUID) keys.
    - Check authorization per file.

- [ ] **C14. Secrets and tokens are in tracked files**
  - Where: `logs/combined.log` (tracked in git), [docker-compose.yml](docker-compose.yml) lines 39, 60, 67, 81, [sse.controller.ts:30](src/sse/sse.controller.ts#L30), [captureip.ts:14](src/middleware/captureip.ts#L14)
  - Bug:
    - The log holds about 3,700 access JWTs, because the SSE token goes in the query string and `originalUrl` is logged.
    - The DB, Redis and pgAdmin passwords are hardcoded, and ports 6500, 6379 and 9000 are exposed on every network interface.
  - Fix:
    - Remove `logs/` from git and from its history.
    - Rotate the JWT keys and all passwords.
    - Move secrets into `.env`.
    - Bind the ports to `127.0.0.1` or remove them.
    - Redact tokens from logged URLs.

- [ ] **C15. Role and branch authorization is missing almost everywhere**
  - Where: every controller except [rfpa.controller.ts](src/rfpa/controller/rfpa.controller.ts)
  - Bug: routes only check that the user is logged in, so any employee can create, edit, delete or approve anything in any branch.
  - Fix:
    - Apply `checkPermission` (or a role guard) to every create, update, delete and approve route.
    - Scope every query to the user's allowed companies and branches.

### Data integrity and money

- [ ] **C16. `synchronize: true` in production**
  - Where: [data-source.ts:17](src/utils/data-source.ts#L17)
  - Bug:
    - Every startup changes the database to match the entity files, which can drop columns and lose data.
    - Migrations and `fix-enum.sql` can never run ahead of it.
    - The `src/migration/` folder isn't picked up by the migrations glob.
  - Fix:
    - Set `synchronize: false`.
    - Generate a baseline migration.
    - Move `src/migration/*` into `src/migrations/`.
    - Run migrations as part of deployment.

- [ ] **C17. A rejected document can still be approved to COMPLETE**
  - Where: [documentb.service.ts:579](src/approvalFlow/service/documentb.service.ts#L579), 649, 678, 996
  - Bug: `if (!info.verified)` only checks that a verifier stage exists, not that it said APPROVED. After the verifier rejects, L1 can still approve, and F1/F2 take it to COMPLETE. A rejected voucher can therefore still be paid.
  - Fix: reject any action when `document.status` is REJECT or COMPLETE, and require `verified.status === APPROVED` before approvers can act.

- [ ] **C18. `/updatesecondlevel` skips the verifier and finalizer stages**
  - Where: [documentb.controller.ts:89](src/approvalFlow/controller/documentb.controller.ts#L89), [docDoubleApprover.service.ts:127](src/approvalFlow/service/docDoubleApprover.service.ts#L127), line 291
  - Bug: any voucher or GRN id can be sent to this endpoint. It reaches COMPLETE after L1 and L2 alone, and for a GRN that also posts stock.
  - Fix: check `document.type` and reject the document types that must go through the verifier and finalizers.

- [ ] **C19. Stock can go negative**
  - Where: [inventoryMovement.service.ts:340](src/inventoryStock/service/inventoryMovement.service.ts#L340), 409, 470, 527; [customerDeliveryChallan.service.ts:255](src/deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service.ts#L255)
  - Bug:
    - Every movement plan returns `validateAvailability: false`.
    - The check when a DC is created ignores pending DCs and takes no lock. Three 100 kg DCs against 100 kg of stock all pass, leaving -200.
    - Dumps and RTVs are never checked.
  - Fix:
    - Set `validateAvailability: true` for outgoing movements (DC, stock transfer, dump, RTV), checked under a row lock.
    - The tests in [inventoryMovement.service.spec.ts:359](src/test/service/inventoryMovement.service.spec.ts#L359) already expect this.

- [ ] **C20. One GRN can be inwarded many times**
  - Where: [inwardRegister.service.ts:142](src/inwardRegister/service/inwardRegister.service.ts#L142)
  - Bug: the code never checks that the GRN exists and is approved. `isInwardCreated` and `isAQRCreated` are never set anywhere, so the same goods can be added to stock any number of times.
  - Fix:
    - Lock the GRN row.
    - Check the GRN is approved and `isInwardCreated = false`.
    - Set the flag in the same transaction.
    - Add a unique constraint on `inward.grn_id`.

- [ ] **C21. Editing or deleting approved documents never reverses stock**
  - Where:
    - Inward: [inwardRegister.service.ts:602](src/inwardRegister/service/inwardRegister.service.ts#L602), 693, 1153
    - Customer DC: [customerDeliveryChallan.service.ts:723](src/deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service.ts#L723), 741, 756
    - Stock-transfer DC: [stockTransferDeliveryChallan.service.ts:528](src/deliveryChallans/stockTransferDC/service/stockTransferDeliveryChallan.service.ts#L528), 545
    - Other DC: [otherDeliveryChallan.service.ts:496](src/deliveryChallans/otherDeliveryChallan/service/otherDeliveryChallan.service.ts#L496), 513
    - Dump: [dumpRegister.service.ts:605](src/dumpRegister/service/dumpRegister.service.ts#L605), 677, 717
    - RTV: [retrunToVendor.service.ts:456](src/returnToVendor/service/retrunToVendor.service.ts#L456), 491
  - Bug:
    - `Object.assign(entity, req.body)` edits are allowed on approved or processed documents.
    - Deletes leave the stock movement in place.
    - The RTV guard relies on `document_id`, which is never set.
  - Fix:
    - Block edits and deletes once `inventoryProcessed = true`, or post a reversing movement in the same transaction.
    - Whitelist update fields.
    - Set `ReturnToVendor.document`.

- [ ] **C22. Double invoicing, and invoices for unapproved DCs**
  - Where: [finalInvoice.service.ts:99](src/invoice/service/finalInvoice.service.ts#L99), 119
  - Bug:
    - `isInvoiceCreated` is read with no lock and there is no unique constraint, so a double click creates two invoices.
    - There is no check that the DC's approval is COMPLETE.
    - The DC PATCH can reset `isInvoiceCreated` to false.
  - Fix:
    - Lock the DC with `FOR UPDATE`.
    - Require the DC approval to be COMPLETE.
    - Add a unique constraint on `invoices.delivery_challan_id` for non-deleted rows.
    - Stop the DC update from setting that flag.

- [ ] **C23. Invoice tax and total are trusted from the client**
  - Where: [finalInvoice.service.ts:173](src/invoice/service/finalInvoice.service.ts#L173)
  - Bug: `taxAmount = body.taxAmount ?? …` is never checked against CGST, SGST, IGST or the product GST rates. `discount` is unbounded.
  - Fix:
    - Recompute taxes and totals on the server from the lines and GST rates.
    - Reject a request that sets CGST+SGST and IGST together.
    - Bound `discount`.

- [ ] **C24. Stock-transfer and other DCs on the same day get the same challan number**
  - Where: [customerDeliveryChallan.service.ts:110](src/deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service.ts#L110), [stockTransferDeliveryChallan.service.ts:118](src/deliveryChallans/stockTransferDC/service/stockTransferDeliveryChallan.service.ts#L118), [otherDeliveryChallan.service.ts:92](src/deliveryChallans/otherDeliveryChallan/service/otherDeliveryChallan.service.ts#L92)
  - Bug: the count goes through the CustomerDeliveryChallan repository, which filters on the customer type. Its count is always 0 for S and O numbers, so every one is `…00001`.
  - Fix: use a database sequence per prefix and date, and add a unique constraint on `challanNo`.

- [ ] **C25. Every voucher on the same day gets the same number**
  - Where: [labourPaymentVoucher.service.ts:474](src/vouchers/labourPaymentV/service/labourPaymentVoucher.service.ts#L474) (line 464 also searches the wrong `CV-` prefix), [multiCashVoucher.service.ts:584](src/vouchers/multiCashV/service/multiCashVoucher.service.ts#L584), [pmpvoucher.service.ts:581](src/vouchers/paymentMaterialV/service/pmpvoucher.service.ts#L581), [transportPaymentV.service.ts:559](src/vouchers/tranportPaymentV/service/transportPaymentV.service.ts#L559)
  - Bug: the serial is computed and then discarded, so every voucher is `XX-yyyyMMdd`.
  - Fix: include the serial from a sequence, and add a unique constraint on `voucherNo`.

- [ ] **C26. Vouchers can be edited after approval, including the amount**
  - Where: [labourPaymentVoucher.service.ts:434](src/vouchers/labourPaymentV/service/labourPaymentVoucher.service.ts#L434), [multiCashVoucher.service.ts:539](src/vouchers/multiCashV/service/multiCashVoucher.service.ts#L539), [pmpvoucher.service.ts:533](src/vouchers/paymentMaterialV/service/pmpvoucher.service.ts#L533), [transportPaymentV.service.ts:510](src/vouchers/tranportPaymentV/service/transportPaymentV.service.ts#L510), line 116
  - Bug:
    - `Object.assign(voucher, body)` runs with no status or owner check, and `documents.totalAmt` is never updated.
    - The approval amount (`totalAmt`) comes from the client, and the TPV entity doesn't even store it.
    - MCV and LPV totals are never recomputed from their lines.
    - Bulk delete removes COMPLETE vouchers.
  - Fix:
    - Block edits after approval starts, or reset approval on edit.
    - Recompute `totalAmt` on the server from the lines or the payable fields, and update `documents.totalAmt`.
    - Whitelist fields.
    - Block deleting COMPLETE vouchers.

- [ ] **C27. The same GRN can be paid many times**
  - Where: create paths of LPV, MCV ([multiCashVoucher.service.ts:380](src/vouchers/multiCashV/service/multiCashVoucher.service.ts#L380)), TPV, PMPV and [paymentRequest.service.ts:23](src/paymentReq/service/paymentRequest.service.ts#L23)
  - Bug: nothing checks for an existing voucher or payment against the same GRN.
  - Fix: check for existing non-deleted, non-rejected payments under a lock, or add a unique constraint where one payment per GRN is the rule.

- [ ] **C28. Stock corrections can be self-approved and applied twice**
  - Where: [stockCorrection.controller.ts:19](src/stockCorrection/controller/stockCorrection.controller.ts#L19), 93; [stockCorrection.service.ts:90](src/stockCorrection/service/stockCorrection.service.ts#L90)
  - Bug:
    - Any user can approve, including their own correction.
    - The PENDING check is read outside the transaction, so two concurrent approvals both apply the delta.
    - The stock row is written back as an absolute value, overwriting any movement committed in between.
  - Fix:
    - Role check plus maker-checker (the approver can't be the creator).
    - Lock the correction row inside the transaction.
    - Use an atomic `qty = qty + delta` update.

- [ ] **C29. Any user can approve or reject any deal slip**
  - Where: [dealSlip.service.ts:303](src/dealSlip/service/dealSlip.service.ts#L303) (`PATCH /dealSlip/approve/:id`)
  - Bug: sets `approvalStatus` with no role, workflow-membership or state check.
  - Fix: remove the route, or route it through the approval-flow service.

- [ ] **C30. Approval and payment status can be set directly from the request body**
  - Where:
    - Farmer: [farmer.service.ts:937](src/farmer/service/farmer.service.ts#L937), 773
    - Vendor: [vendor.service.ts:1587](src/vendor/createVendor/service/vendor.service.ts#L1587), 122
    - GRN: [grn.controller.ts:785](src/grn/controller/grn.controller.ts#L785) and [grn.service.ts:832](src/grn/service/grn.service.ts#L832)
  - Bug:
    - Farmers and vendors can be set to `status: "approved"`, bypassing the VERIFIER-only approve route.
    - Any user can mark any GRN as paid.
    - The update route also accepts `grnNo`, `createdBy`, `vendorCode` and `approvedBy`.
  - Fix:
    - Whitelist fields on every update route.
    - Change status only through the approve endpoints, with role checks.

---

## 🟠 HIGH

### Security and access

- [ ] **H1. No login rate limit or lockout**
  - Where: [app.ts:113](src/app.ts#L113), [auth.controller.ts:213](src/auth/controller/auth.controller.ts#L213)
  - Bug:
    - `authRateLimit` and `helmet` are commented out.
    - Login saves `isOnline = true` before checking the password.
    - A second login at the same moment reads the cached user (which has no password) and returns 500.
  - Fix:
    - Enable the rate limit and helmet, and add account lockout.
    - Check the password first.
    - Don't use the cached user for the password check.

- [ ] **H2. Deactivated or "deleted" employees keep full access**
  - Where: [deserializeUser.ts:59](src/middleware/deserializeUser.ts#L59), [auth.controller.ts:152](src/auth/controller/auth.controller.ts#L152), [user.service.ts:578](src/employee/service/user.service.ts#L578)
  - Bug:
    - Neither authentication nor token refresh checks `status` or `deletionScheduledAt`.
    - The cleanup cron jobs (`cronShedule.ts`, `startAutoDeleteJob`) are never started.
    - [overdueDeletion.service.ts:17](src/global/overdueDeletion.service.ts#L17) uses the wrong column name.
  - Fix:
    - Reject inactive or scheduled-for-deletion users in both places, and revoke their sessions.
    - Wire up the cron jobs and fix the column name.

- [ ] **H3. Test endpoints are live in production**
  - Where: [test.controller.ts:31](src/sse/test.controller.ts#L31)
  - Bug: any user can send notifications to anyone, list connected users, and crash the server with `/test/send-multiple {"count":1e8}`.
  - Fix: remove these endpoints from the production build, or restrict them to admins with a capped count.

- [ ] **H4. TLS certificate checking is disabled**
  - Where: [spaces.config.ts:5](src/middleware/spaces.config.ts#L5), [address.service.ts:255](src/address/service/address.service.ts#L255)
  - Bug: `rejectUnauthorized: false` on the storage client and the pincode API, so a man-in-the-middle can capture the storage keys and documents.
  - Fix: remove it.

- [ ] **H5. Data from other branches and users is readable**
  - Where:
    - [inventoryStock.controller.ts:42](src/inventoryStock/controller/inventoryStock.controller.ts#L42)
    - Dashboard: [dashboard.controller.ts:750](src/dashboard/controller/dashboard.controller.ts#L750) (`teamLeaderId` from the query), and the `/admin/dashboard/*` and `/upper-level/*` routes
    - Activity logs: [userActivityLog.controller.ts:94](src/employeeActivity/controller/userActivityLog.controller.ts#L94) (the admin check is commented out)
    - Audit logs: [auditLog.controller.ts:18](src/employeeActivity/controller/auditLog.controller.ts#L18)
    - [userReport.controller.ts:45](src/employeeReport/controller/userReport.controller.ts#L45)
    - Vendor and customer detail endpoints: [vendor.service.ts:436](src/vendor/createVendor/service/vendor.service.ts#L436), 471, 703, 1639, 1712
  - Fix:
    - Scope data to the user's branches and hierarchy on the server.
    - Admin-only for company-wide views and logs.
    - Paginate the audit logs.

- [ ] **H6. Notifications leak across users**
  - Where: [notification.controller.ts:29](src/notification/controller/notification.controller.ts#L29), 51, 78
  - Bug: `getallNotification` returns every user's notifications, and the Excel export is `public-read`.
  - Fix: filter by the current user, admin-only export, private file.

- [ ] **H7. Anyone can create an already-approved target**
  - Where: [salesTarget.service.ts:58](src/salesTarget/service/salesTarget.service.ts#L58), [salesTarget.controller.ts:26](src/salesTarget/controller/salesTarget.controller.ts#L26), [procurementTarget.service.ts:156](src/procurementTarget/service/procurementTarget.service.ts#L156), [procurementTarget.controller.ts:43](src/procurementTarget/controller/procurementTarget.controller.ts#L43)
  - Bug: status is APPROVED whenever the creator differs from the target employee, and `employeeId` comes from the body.
  - Fix: allow it only when the creator is the employee's manager in the hierarchy.

### Approval and workflow logic

- [ ] **H8. Approval order is not enforced**
  - Where: [documentb.service.ts:700](src/approvalFlow/service/documentb.service.ts#L700) to 987
  - Bug: L2 or L3 can approve before L1.
  - Fix: require the previous level to be approved before accepting the next.

- [ ] **H9. Concurrent approvals overwrite each other**
  - Where: [documentb.service.ts:662](src/approvalFlow/service/documentb.service.ts#L662), 714, 772; [docDoubleApprover.service.ts:275](src/approvalFlow/service/docDoubleApprover.service.ts#L275)
  - Bug: approval info is loaded, changed and saved with no transaction or lock, so one approval is lost and the document gets stuck.
  - Fix: run each approval in a transaction with `FOR UPDATE` on the document and its approval info.
  - Also add null guards at 612, 820, 990 and 1039, where the code crashes after saving.

- [ ] **H10. Workflow hierarchy has no cycle check, and duplicate rows pile up**
  - Where: [workFlowHierarchy.service.ts:21](src/workFlow/service/workFlowHierarchy.service.ts#L21), [workflowClosure.entity.ts:65](src/workFlow/entity/workflowClosure.entity.ts#L65)
  - Fix:
    - Reject a new link when the subordinate is already an ancestor of the manager.
    - Run [cleanDuplicateWorkflowHierarchy.ts](src/scripts/cleanDuplicateWorkflowHierarchy.ts), then restore the unique constraint.

- [ ] **H11. Editing a GRN keeps the old approval amount**
  - Where: [grn.service.ts:872](src/grn/service/grn.service.ts#L872), 273
  - Bug: approval restarts but `document.totalAmt` isn't updated, and the create amount comes from the client.
  - Fix: recompute the total from the lines on the server, and update the document before restarting approval.

- [ ] **H12. Approved RFPAs, AQRs and deal slips can be edited without re-approval**
  - Where: [rfpa.service.ts:275](src/rfpa/service/rfpa.service.ts#L275), 296; [aqr.service.ts:662](src/aqr/service/aqr.service.ts#L662); [dealSlip.service.ts:335](src/dealSlip/service/dealSlip.service.ts#L335)
  - Bug:
    - Edits are allowed after approval.
    - RFPA `rfpaId` can be overwritten.
    - A deal slip can be re-pointed to another RFPA.
    - An AQR supplier change (`selectedParty`) is silently dropped.
    - `DELETE /rfpa/delete/multiple` has no permission check.
  - Fix: block edits after approval, or reset approval on edit; whitelist fields.

- [ ] **H13. Creates are only partly transactional**
  - Where:
    - [grn.service.ts:270](src/grn/service/grn.service.ts#L270), [rfpa.service.ts:211](src/rfpa/service/rfpa.service.ts#L211), [dealSlip.service.ts:254](src/dealSlip/service/dealSlip.service.ts#L254), [aqr.service.ts:159](src/aqr/service/aqr.service.ts#L159), [inwardRegister.service.ts:267](src/inwardRegister/service/inwardRegister.service.ts#L267)
    - [customerDeliveryChallan.service.ts:307](src/deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service.ts#L307), [finalInvoice.service.ts:245](src/invoice/service/finalInvoice.service.ts#L245)
    - [labourPaymentVoucher.service.ts:94](src/vouchers/labourPaymentV/service/labourPaymentVoucher.service.ts#L94), plus the MCV, PMPV and TPV creates
    - Vehicle dispatch create
  - Bug:
    - `createDocument` writes outside the queryRunner.
    - `startApprovalFlow` runs after commit, and the catch then calls rollback on a transaction that is already committed.
    - The user sees an error, retries, and duplicates build up stuck in HOLD.
  - Fix: pass the transaction manager into `createDocument` and `startApprovalFlow`, and run everything inside a single transaction.

### Numbering and duplicates

- [ ] **H14. Document numbers repeat after deletes or under concurrency**
  - Where:
    - Employee: [user.service.ts:811](src/employee/service/user.service.ts#L811)
    - Inward: [inwardRegister.service.ts:111](src/inwardRegister/service/inwardRegister.service.ts#L111)
    - GRN: [grn.service.ts:1194](src/grn/service/grn.service.ts#L1194) (its prefix `ILIKE` also matches other branches)
    - RFPA: [rfpa.service.ts:241](src/rfpa/service/rfpa.service.ts#L241)
    - Deal slip: [dealSlip.service.ts:280](src/dealSlip/service/dealSlip.service.ts#L280)
    - AQR: [aqr.service.ts:74](src/aqr/service/aqr.service.ts#L74)
    - Customer DC: [customerDeliveryChallan.service.ts:116](src/deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service.ts#L116)
    - Invoice: [finalInvoice.service.ts:278](src/invoice/service/finalInvoice.service.ts#L278) (it also breaks when the branch name contains `-`)
    - Vehicle dispatch: [vehicleDispatch.service.ts:63](src/vehicleDispatch/service/vehicleDispatch.service.ts#L63)
    - Customer code: [codeGeneration.ts:178](src/utils/codeGeneration.ts#L178)
  - Bug: numbers are built as count+1 or MAX+1 outside any transaction, soft-deleted rows are excluded from the count, and none of these columns is unique.
  - Fix: use Postgres sequences or a locked counter table, and add a unique constraint on each number column.

- [ ] **H15. Bulk employee import gives every row the same employee ID**
  - Where: [user.service.ts:940](src/employee/service/user.service.ts#L940)
  - Fix: generate the ID per row.

- [ ] **H16. Stock rows can be duplicated**
  - Where: [inventoryStock.entity.ts:9](src/inventoryStock/entity/inventoryStock.entity.ts#L9), [inventoryMovement.service.ts:635](src/inventoryStock/service/inventoryMovement.service.ts#L635)
  - Bug: there is no unique key on (company, location, product, variant). Two concurrent first-time movements both insert, and every later update then changes both rows.
  - Fix:
    - Clean up the duplicate rows.
    - Add the unique constraint.
    - Use `INSERT … ON CONFLICT DO UPDATE`.

- [ ] **H17. Concurrent duplicate deal slips and returns**
  - Where: [dealSlip.service.ts:231](src/dealSlip/service/dealSlip.service.ts#L231), [postReturnByCustomer.service.ts:206](src/returnByCustomer/service/postReturnByCustomer.service.ts#L206)
  - Bug:
    - The one-per-parent flag is read with no lock.
    - A deal slip can be raised against a HOLD or REJECTED RFPA.
    - Bulk delete never resets `rfpa.isDealSlipCreated` ([dealSlip.service.ts:730](src/dealSlip/service/dealSlip.service.ts#L730)).
  - Fix: `FOR UPDATE` on the parent row, check the parent is approved, and reset the flag on delete.

### Stock and quantity logic

- [ ] **H18. Dumps deduct a count from stock that is kept in kg**
  - Where: [inventoryMovement.service.ts:453](src/inventoryStock/service/inventoryMovement.service.ts#L453), [dumpProduct.entity.ts](src/dumpRegister/entity/dumpProduct.entity.ts)
  - Bug: 5 crates of 20 kg deduct 5 instead of 100.
  - Fix: store net weight on dump lines, or convert through the UOM matrix before deducting.

- [ ] **H19. Stock correction adjustment is fixed at submit time**
  - Where: [stockCorrection.service.ts:41](src/stockCorrection/service/stockCorrection.service.ts#L41) to 48, and line 102
  - Bug:
    - If stock moves before approval, the final quantity is wrong.
    - `DAMAGE_WRITE_OFF` has no bound.
    - A missing `physicalQty` gives `NaN`.
  - Fix: compute the delta at approval time under a lock, and validate the inputs.

- [ ] **H20. Returns aren't checked against the original quantities**
  - Where: [retrunToVendor.service.ts:123](src/returnToVendor/service/retrunToVendor.service.ts#L123), [postReturnByCustomer.service.ts:293](src/returnByCustomer/service/postReturnByCustomer.service.ts#L293), 369, 843
  - Bug:
    - RTV quantity isn't compared with the GRN or earlier RTVs, and the RTV location comes from the client.
    - Customer returns aren't summed across repeated lines and include soft-deleted returns.
    - Updates are never re-validated.
  - Fix:
    - Validate the total returned (including earlier returns) against the source document.
    - Take the location from the source document.
    - Re-validate on update.

- [ ] **H21. A stock transfer never adds stock at the destination**
  - Where: [inventoryMovement.service.ts:349](src/inventoryStock/service/inventoryMovement.service.ts#L349)
  - Bug: stock leaves the source when the transfer is approved. The destination only gets it if someone separately raises an inward register, and nothing links the two.
  - Fix: post the destination movement automatically, or track an "in transit" state tied to the transfer DC.

- [ ] **H22. RFPA quantity is an integer column**
  - Where: [rfpaProduct.entity.ts](src/rfpa/entity/rfpaProduct.entity.ts)
  - Bug: 12.5 kg fails to save.
  - Fix: `decimal`, matching GRN and Inward. Also add validation for negative or zero quantities in all procurement DTOs.

### Wrong numbers in reports and dashboards

- [ ] **H23. Sales achievement is always 0**
  - Where: [salesTarget.service.ts:662](src/salesTarget/service/salesTarget.service.ts#L662)
  - Bug: nothing writes to `sales_achievements`.
  - Fix: compute achievement from approved invoices or DCs, the same way procurement does ([procurementTarget.service.ts:680](src/procurementTarget/service/procurementTarget.service.ts#L680)).
  - Also: sales plan create isn't transactional and allows duplicates ([salesTarget.service.ts:43](src/salesTarget/service/salesTarget.service.ts#L43)), and the month label is off by one ([salesTarget.service.ts:285](src/salesTarget/service/salesTarget.service.ts#L285)).

- [ ] **H24. GRN amounts are multiplied by the number of product lines**
  - Where:
    - [procurementCrystalReport.service.ts:185](src/reports/service/procurementCrystalReport.service.ts#L185), 237, 405, 469, 496
    - [dashboard.service.ts:3645](src/dashboard/service/dashboard.service.ts#L3645), 3725
    - [procurmentDashbord.service.ts:506](src/dashboard/service/procurmentDashbord.service.ts#L506), 563
  - Bug: `SUM(grn.totalAmt)` is taken after joining `grnProducts`.
  - Fix: sum in a subquery without the product join, or sum the line amounts instead.

- [ ] **H25. Report date ranges are wrong**
  - Where:
    - [report.service.ts:92](src/reports/service/report.service.ts#L92) and [salesReport.service.ts:71](src/reports/service/salesReport.service.ts#L71): `startDate.setHours(23,59,59)` drops the first day.
    - [report.service.ts:843](src/reports/service/report.service.ts#L843) and [salesReport.service.ts:444](src/reports/service/salesReport.service.ts#L444): the date filter is in the LEFT JOIN condition, so product reports show all-time totals.
    - [salesCrystalReport.controller.ts:74](src/reports/controller/salesCrystalReport.controller.ts#L74), [grnReport.controller.ts:146](src/reports/controller/grnReport.controller.ts#L146), [deliveryChallanReport.service.ts:120](src/reports/service/deliveryChallanReport.service.ts#L120), [procurementCrystalReport.controller.ts:45](src/reports/controller/procurementCrystalReport.controller.ts#L45): the end date is exclusive and parsed as UTC.
    - [weeklyBusinessPlan.service.ts:75](src/dashboard/service/weeklyBusinessPlan.service.ts#L75): weeks and months start at 05:30 IST.
    - [inventoryStock.service.ts:216](src/inventoryStock/service/inventoryStock.service.ts#L216): the EOD day boundaries use string timestamps with no timezone.
  - Fix: one shared IST date-range helper returning start-of-day ≤ x < next-day-start, with the filters moved into `WHERE`.

- [ ] **H26. Deleted, rejected or pending documents are counted in totals**
  - Where: [report.service.ts:155](src/reports/service/report.service.ts#L155) to 935, [salesReport.service.ts:120](src/reports/service/salesReport.service.ts#L120) to 493, [salesCrystalReport.service.ts:491](src/reports/service/salesCrystalReport.service.ts#L491), [inventoryStock.service.ts:216](src/inventoryStock/service/inventoryStock.service.ts#L216) (EOD), [dashboard.service.ts:2277](src/dashboard/service/dashboard.service.ts#L2277), 2840, [weeklyBusinessPlan.service.ts:191](src/dashboard/service/weeklyBusinessPlan.service.ts#L191)
  - Fix: filter `deletedAt IS NULL` and approved/COMPLETE status, and exclude transfer GRNs and non-customer DC types where applicable.
  - Also: `.where()` after `.andWhere()` discards the purchase-only filter in [procurmentDashbord.service.ts:627](src/dashboard/service/procurmentDashbord.service.ts#L627), 648, 674, 745, and `challan.type = 'customer'` should be `'customer_delivery_challan'` in [userreport.service.ts:247](src/employeeReport/service/userreport.service.ts#L247).

- [ ] **H27. Dashboard targets compare the wrong things**
  - Where: [dashboard.service.ts:2497](src/dashboard/service/dashboard.service.ts#L2497), 2536, 2548, 3000, 3017, 3761 to 3886, 3999; the `month ? m+1 : m` pattern at 313, 871, 1003 and elsewhere
  - Bug:
    - The ₹ target is compared with kg sold.
    - The sales month (1–12) and procurement month (0–11) are mixed up.
    - `month=0` is treated as "no month".
    - Weekly views drop the last day of each week.
  - Fix:
    - Use one month convention everywhere.
    - Compare like units.
    - Make week ends inclusive in IST.

- [ ] **H28. The invoice PDF total differs from the invoice**
  - Where: [finalInvoice.service.ts:777](src/invoice/service/finalInvoice.service.ts#L777)
  - Bug: it ignores `rejectedQty`, tax, freight, other charges and discount, and the amount in words drops paise.
  - Fix: render the stored `totalAmount` and line amounts.

### Broken endpoints and crashes

- [ ] **H29. Endpoints that always fail**
  - Final invoice report: `s3Client` and `bucketName` are never set.
    - Where: [finalInvoiceReport.controller.ts:20](src/reports/controller/finalInvoiceReport.controller.ts#L20)
    - Fix: set them up.
  - Procurement summary, vendor-wise, product-wise and vendor-wise export: they select columns that don't exist (`vendor.name`, `variant.name`), and unquoted aliases come back as 0.
    - Where: [procurementCrystalReport.service.ts:232](src/reports/service/procurementCrystalReport.service.ts#L232), 296, 403
    - Fix: correct the column names and quote the aliases.
  - `reportBased:"source"`: `GROUP BY source_type` uses an alias that doesn't exist.
    - Where: [report.service.ts:580](src/reports/service/report.service.ts#L580)
  - Return-by-customer PATCH: requests relations that don't exist.
    - Where: [postReturnByCustomer.service.ts:843](src/returnByCustomer/service/postReturnByCustomer.service.ts#L843)
  - All `/productVarient` GET routes: join `productTemplate` instead of `product`.
    - Where: [productVarient.service.ts:127](src/product/productVarient/service/productVarient.service.ts#L127), 166, 195
  - Document-permission GET routes: relation `level` doesn't exist.
    - Where: [documentPermission.service.ts](src/employee/service/documentPermission.service.ts)
  - Bulk employee upload: S3 upload has no `req.file.path`.
    - Where: [user.controller.ts:562](src/employee/controller/user.controller.ts#L562)
    - Fix: parse from a buffer.
  - Labour attendance save: `parse()` is called with no format.
    - Where: [labourForAttendance.entity.ts:216](src/labourAttendence/entity/labourForAttendance.entity.ts#L216)
  - Farmer update with a file attached: the multipart fields aren't JSON-parsed.
    - Where: [farmer.service.ts:904](src/farmer/service/farmer.service.ts#L904)
  - `/audit-logs/user/:id` can never be reached: the route order is wrong.
    - Where: [auditLog.controller.ts:36](src/employeeActivity/controller/auditLog.controller.ts#L36)

- [ ] **H30. Recycle-bin restore and permanent delete never work**
  - Where: [superadmin.service.ts:68](src/sse/superadmin.service.ts#L68), 122, 142, 200
  - Bug: `findOne` excludes soft-deleted rows, and `update({deletedAt: undefined})` does nothing.
  - Fix: use `withDeleted: true` with `restore()`, inside a transaction.

- [ ] **H31. One null value makes a whole list return 500**
  - Where:
    - EOD list: [eodStock.service.ts:261](src/eodStock/service/eodStock.service.ts#L261), 366
    - Customer list: [customer.service.ts:458](src/customer/addcustomer/service/customer.service.ts#L458)
    - Invoice report: [finalInvoiceReport.service.ts:745](src/reports/service/finalInvoiceReport.service.ts#L745), 779
    - GRN drill-down: [procurmentDashboard.controller.ts:339](src/dashboard/controller/procurmentDashboard.controller.ts#L339), 349
    - DC create: [customerDeliveryChallan.service.ts:169](src/deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service.ts#L169)
    - Hierarchy dashboards build an empty `IN ()`: [dashboard.service.ts:298](src/dashboard/service/dashboard.service.ts#L298), 2763, 2947
  - Fix: use optional chaining on nullable relations, and handle the empty case.

- [ ] **H32. Editing a product detaches or renumbers all its variants**
  - Where: [product.service.ts:891](src/product/createproduct/service/product.service.ts#L891), 928; [varients.service.ts:145](src/product/productVarient/service/varients.service.ts#L145)
  - Bug: `product.variant = []` nulls `product_id` on every existing variant, and existing variants get new codes.
  - Fix:
    - Update the variants that are sent, and leave the others alone.
    - Never regenerate existing codes.
    - Make the Excel import transactional ([product.service.ts:706](src/product/createproduct/service/product.service.ts#L706)).

- [ ] **H33. Customer and vendor file uploads are silently lost**
  - Where: [customer.service.ts:2186](src/customer/addcustomer/service/customer.service.ts#L2186), [customer.controller.ts:660](src/customer/addcustomer/controller/customer.controller.ts#L660), 703; [vendor.service.ts:353](src/vendor/createVendor/service/vendor.service.ts#L353)
  - Bug:
    - Field names don't match between multer and the handler.
    - Nested keys are set on the top-level entity.
    - The vendor cancelled-cheque upload is never applied.
    - The old file has already been deleted by then.
    - Customer product-spec edits resurrect deleted rows ([customer.service.ts:1651](src/customer/addcustomer/service/customer.service.ts#L1651)).
  - Fix:
    - Align the field names.
    - Set the nested properties properly.
    - Delete the old file only after a successful save.
    - Reload the specs before saving.

- [ ] **H34. Every audit record names the wrong user**
  - Where: [deserializeUser.ts:110](src/middleware/deserializeUser.ts#L110), [app.ts:173](src/app.ts#L173)
  - Bug: the global `captureUser` runs before authentication and looks up `findOne({id: undefined})`, which returns the first employee. Edits are attributed to an arbitrary person.
  - Fix: run it after `deserializeUser`, and skip the lookup when there is no user.

- [ ] **H35. "Delete" reports success but nothing is deleted, or it blocks re-processing**
  - Where:
    - Records that stay active after delete: vendor [vendor.service.ts:1610](src/vendor/createVendor/service/vendor.service.ts#L1610) (it also frees `vendorCode` for reuse), UOM [UOM.service.ts:126](src/uom/service/UOM.service.ts#L126), UOM matrix, vendor category, vendor subcategory, office, levels.
    - Product: [product.service.ts:972](src/product/createproduct/service/product.service.ts#L972). It is later hard-deleted by a cron job, cascading to its variants.
    - Invoice delete doesn't reset the DC's `isInvoiceCreated`: [finalInvoice.service.ts:889](src/invoice/service/finalInvoice.service.ts#L889).
    - Delete errors are swallowed and success is returned for stock-transfer and other DCs.
  - Fix:
    - Use real soft delete (`softDelete`) and exclude deleted rows from lists and dropdowns.
    - Never hard-delete master data that documents still reference.
    - Reset parent flags on delete.
    - Rethrow errors.
