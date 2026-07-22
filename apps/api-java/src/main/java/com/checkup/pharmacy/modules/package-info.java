/**
 * Business feature modules — organised <b>package-by-feature</b>. Each business
 * capability lives in its own sub-package and owns its full vertical slice, so a
 * developer works in one place per feature and modules stay decoupled.
 *
 * <pre>
 * modules/&lt;feature&gt;/
 *   ├── &lt;Feature&gt;Controller.java   REST layer      (@RestController, thin)
 *   ├── &lt;Feature&gt;Service.java      business logic   (@Service, @Transactional)
 *   ├── &lt;Feature&gt;Repository.java   data access      (Spring Data JPA)
 *   ├── &lt;Feature&gt;.java             JPA entity mapped onto the Prisma table
 *   └── dto/                       request/response records (Bean-Validated)
 * </pre>
 *
 * Conventions (enforced in review):
 * <ul>
 *   <li>Controllers stay thin — no business logic, no direct repository access.</li>
 *   <li>Every query is scoped by {@code TenantContext.pharmacyId()}; a missing
 *       scope is a cross-tenant data leak.</li>
 *   <li>Entities never leave a module as an API response — always map to a
 *       {@code dto/} record so the wire contract is explicit and stable.</li>
 *   <li>Every response is wrapped in
 *       {@link com.checkup.pharmacy.common.api.ApiResponse}.</li>
 * </ul>
 */
package com.checkup.pharmacy.modules;
