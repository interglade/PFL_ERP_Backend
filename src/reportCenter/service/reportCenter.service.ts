import { injectable } from 'inversify';
import { Role } from '../../employee/entity/user.entity';
import AppError from '../../utils/appError';
import { AppDataSource } from '../../utils/data-source';
import { buildTable } from '../engine/grouping';
import { fmtDay, nowLabel, parseParams } from '../engine/params';
import { findReport } from '../engine/registry';
import { resolveScope } from '../engine/scope';
import {
  MAX_DETAIL_ROWS,
  REPORT_TYPE_LABELS,
  ReportDefinition,
  ReportParams,
  ReportPermKey,
  ReportResult,
  ReportScope,
  TableRow,
} from '../reportCenter.types';

export interface RunOutput {
  result: ReportResult;
  /** Every detail row (also when the table was cut), for the Excel Data sheet and CSV. */
  detailRows: Record<string, any>[];
  groupCount: number;
}

const q = (sql: string, values: any[]) => AppDataSource.query(sql, values);

@injectable()
export class ReportCenterService {
  getDefinition(key: string): ReportDefinition {
    const def = findReport(key);
    if (!def) throw new AppError(404, `Report "${key}" does not exist`);
    return def;
  }

  async run(key: string, query: Record<string, any>, user: any): Promise<RunOutput> {
    const def = this.getDefinition(key);
    const params = parseParams(def, query);
    const scope = await resolveScope(user, def.permKey);
    const data = await def.run(params, scope);
    const columns = data.columns ?? def.columns;
    const groups = params.groupBy.map((g) => def.groupings.find((x) => x.key === g)!);

    let summaryOnly = params.summaryOnly;
    let rows = data.rows;
    let truncated = !!data.truncated;
    const notes = [...(data.notes ?? [])];
    if (rows.length > MAX_DETAIL_ROWS) {
      if (groups.length) {
        summaryOnly = true;
        notes.unshift(`${rows.length.toLocaleString('en-IN')} rows: shown as group totals only. Excel has every row on its Data sheet.`);
      } else {
        rows = rows.slice(0, MAX_DETAIL_ROWS);
        truncated = true;
      }
    }

    const body: TableRow[] = [];
    if (data.opening) body.push(data.opening);
    body.push(
      ...buildTable({
        rows,
        columns,
        groups,
        summaryOnly,
        grandTotal: !data.noGrandTotal,
        link: data.link,
        groupLink: data.groupLink,
      }),
    );
    if (data.closing) body.push(data.closing);
    // Report-to-report links carry the target's type: the app's report URLs are /reports/center/<type>/<key>.
    for (const r of body) {
      if (r.link?.kind === 'report') r.link.type = findReport(r.link.report)?.permKey;
    }

    const [company, paramsSummary] = await Promise.all([this.letterhead(params), this.describe(def, params, scope, summaryOnly)]);

    return {
      result: {
        key: def.key,
        code: def.code,
        title: def.title,
        typeLabel: REPORT_TYPE_LABELS[def.permKey],
        description: def.description,
        generatedAt: nowLabel(),
        generatedBy: scope.userName,
        company,
        paramsSummary,
        kpis: data.kpis ?? [],
        chart: data.chart ?? null,
        party: data.party ?? null,
        columns,
        rows: body,
        detailCount: data.rows.length,
        truncated,
        notes,
        layout: def.layout,
      },
      detailRows: data.rows,
      groupCount: summaryOnly ? Math.max(groups.length - 1, 0) : groups.length,
    };
  }

  /** The chosen company's letterhead; with no single company chosen, the group's (Prime Fresh Limited). */
  private async letterhead(p: ReportParams): Promise<ReportResult['company']> {
    const rows =
      p.companyIds.length === 1
        ? await q(`SELECT name, "officeAddress", "gstNo", logo FROM company WHERE id = $1`, [p.companyIds[0]])
        : await q(`SELECT name, "officeAddress", "gstNo", logo FROM company WHERE "isDeleted" = false ORDER BY (name = 'Prime Fresh Limited') DESC, name LIMIT 1`, []);
    const c = rows[0];
    if (!c) return null;
    return {
      name: p.companyIds.length === 1 ? c.name : `${c.name} (all companies)`,
      address: c.officeAddress ?? '',
      gstNo: p.companyIds.length === 1 ? c.gstNo ?? '' : '',
      logo: c.logo ?? '',
    };
  }

  /** The filters as printed in the parameters box: names, not ids. */
  private async describe(def: ReportDefinition, p: ReportParams, scope: ReportScope, summaryOnly: boolean) {
    const names = async (sql: string, ids: string[]) => (ids.length ? (await q(sql, [ids])).map((r: any) => r.name).join(', ') : '');
    const [companies, locations, vendors, farmers, products, employees, customers] = await Promise.all([
      names(`SELECT name FROM company WHERE id = ANY($1::uuid[]) ORDER BY name`, p.companyIds),
      names(`SELECT name FROM branches WHERE id = ANY($1::uuid[]) ORDER BY name`, p.locationIds),
      names(`SELECT company_name AS name FROM vendor WHERE id = ANY($1::uuid[]) ORDER BY 1`, p.vendorIds),
      names(`SELECT trim(concat_ws(' ', "farmerfName", "farmerlName")) AS name FROM farmer WHERE id = ANY($1::uuid[]) ORDER BY 1`, p.farmerIds),
      names(`SELECT product_name AS name FROM product WHERE id = ANY($1::uuid[]) ORDER BY 1`, p.productIds),
      names(`SELECT trim(concat_ws(' ', "firstName", "lastName")) AS name FROM employees WHERE id = ANY($1::uuid[]) ORDER BY 1`, p.employeeIds),
      names(`SELECT organisation_name AS name FROM customers WHERE id = ANY($1::uuid[]) ORDER BY 1`, p.customerIds),
    ]);

    const out: { label: string; value: string }[] = [];
    for (const spec of def.params) {
      switch (spec.kind) {
        case 'dateRange':
          out.push({ label: spec.label, value: `${fmtDay(p.from)} to ${fmtDay(p.to)}` });
          break;
        case 'date':
          out.push({ label: spec.label, value: fmtDay(p.asOn) });
          break;
        case 'companies':
          out.push({ label: spec.label, value: companies || 'All' });
          break;
        case 'locations':
          out.push({ label: spec.label, value: locations || 'All' });
          break;
        case 'supplier':
        case 'suppliers':
          out.push({ label: spec.label, value: [vendors, farmers].filter(Boolean).join(', ') || 'All' });
          break;
        case 'customer':
        case 'customers':
          out.push({ label: spec.label, value: customers || 'All' });
          break;
        case 'products':
          out.push({ label: spec.label, value: products || 'All' });
          break;
        case 'employees':
          out.push({ label: spec.label, value: employees || 'All' });
          break;
        case 'select':
          out.push({ label: spec.label, value: spec.options?.find((o) => o.value === p.extra[spec.key])?.label ?? p.extra[spec.key] });
          break;
      }
    }
    if (def.groupings.length) {
      const g = p.groupBy.map((k) => def.groupings.find((x) => x.key === k)?.label).filter(Boolean).join(' › ');
      out.push({ label: 'Grouped by', value: (g || 'None') + (summaryOnly ? ' (totals only)' : '') });
    }
    if (scope.creatorIds) out.push({ label: 'Scope', value: 'Your and your team\'s documents' });
    return out;
  }

  /**
   * Choices for the filter pickers. Employees are limited to the viewer's team in the report
   * type's department (`permKey`) unless admin.
   */
  async options(user: any, permKey: ReportPermKey = 'purchase-report') {
    const roles: string[] = Array.isArray(user?.roles) ? user.roles : [];
    const isAdmin = roles.includes(Role.ADMIN);
    const scope = isAdmin ? null : (await resolveScope(user, permKey)).creatorIds;
    const [companies, locations, vendors, farmers, products, employees, customers] = await Promise.all([
      q(`SELECT id, name AS label FROM company WHERE "isDeleted" = false ORDER BY name`, []),
      q(`SELECT id, name AS label, type::text AS hint FROM branches WHERE "isDeleted" = false ORDER BY name`, []),
      q(`SELECT 'vendor:' || id AS id, company_name AS label, COALESCE(vendor_code, '') AS hint FROM vendor
          WHERE "isDeleted" = false AND COALESCE(company_name, '') <> '' ORDER BY company_name`, []),
      q(`SELECT 'farmer:' || id AS id, trim(concat_ws(' ', "farmerfName", "farmermName", "farmerlName")) AS label, COALESCE("farmerCode", '') AS hint
           FROM farmer WHERE "isDeleted" = false ORDER BY 2`, []),
      q(`SELECT id, product_name AS label FROM product WHERE "isDeleted" = false ORDER BY product_name`, []),
      scope
        ? q(`SELECT id, trim(concat_ws(' ', "firstName", "lastName")) AS label FROM employees WHERE id = ANY($1::uuid[]) ORDER BY 2`, [scope])
        : q(`SELECT id, trim(concat_ws(' ', "firstName", "lastName")) AS label FROM employees WHERE "isDeleted" = false ORDER BY 2`, []),
      q(`SELECT id, organisation_name AS label, COALESCE(customercode, '') AS hint FROM customers
          WHERE "isDeleted" = false AND COALESCE(organisation_name, '') <> '' ORDER BY organisation_name`, []),
    ]);
    return {
      companies,
      locations,
      suppliers: [
        ...vendors.map((v: any) => ({ ...v, hint: ['Vendor', v.hint].filter(Boolean).join(' · ') })),
        ...farmers.map((f: any) => ({ ...f, hint: ['Farmer', f.hint].filter(Boolean).join(' · ') })),
      ],
      products,
      employees,
      customers,
    };
  }
}
