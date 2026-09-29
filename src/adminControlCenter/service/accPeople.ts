import { DataSource } from 'typeorm';
import {
  Contact,
  EMPTY_CONTACT,
  contactRole,
  fullName,
  parseDepartments,
  parseRoles,
  primaryRole,
} from './accShared.util';

/** An employee as the dashboard needs them, loaded in bulk. */
export interface Person {
  id: string;
  name: string;
  roles: string[];
  departments: string[];
  phone: string;
  active: boolean;
  isLeader: boolean;
}

/**
 * Loads the given employees (or every employee when `ids` is omitted) in one
 * query, plus whether each one leads a team in the workflow hierarchy.
 */
export async function loadPeople(ds: DataSource, ids?: string[]): Promise<Map<string, Person>> {
  const list = ids ? Array.from(new Set(ids.filter(Boolean))) : null;
  if (list && list.length === 0) return new Map();

  const rows: any[] = await ds.query(
    `SELECT e.id, e."firstName", e."middleName", e."lastName", e.username,
            e.roles::text[] AS roles, e.department, e."primaryMobNo" AS phone,
            (e.status::text = 'ACTIVE' AND e."isDeleted" = false) AS active,
            EXISTS (SELECT 1 FROM workflow_hierarchy h
                     WHERE h.ancestor_id = e.id AND h.depth > 0 AND h."isDeleted" = false) AS "isLeader"
       FROM employees e
      ${list ? 'WHERE e.id = ANY($1)' : ''}`,
    list ? [list] : [],
  );

  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: fullName(r.firstName, r.lastName) || r.username || '',
        roles: parseRoles(r.roles),
        departments: parseDepartments(r.department),
        phone: r.phone || '',
        active: !!r.active,
        isLeader: !!r.isLeader,
      },
    ]),
  );
}

/**
 * Contact object for a person. `actingAs` overrides the role shown, e.g. the
 * person a GRN waits on at Approval L2 reads as "Approver - ...".
 */
export function toContact(person: Person | undefined, actingAs?: string): Contact {
  if (!person) return { ...EMPTY_CONTACT };
  const workRoles = person.roles.filter((r) => r !== 'admin');
  const role = actingAs || primaryRole(workRoles.length ? workRoles : person.roles);
  return {
    name: person.name,
    role: contactRole(role, person.departments, person.isLeader),
    phone: person.phone,
  };
}

/** The first user who can act: active users first, then by name. */
export function pickFirst(userIds: string[], people: Map<string, Person>): Person | undefined {
  const candidates = userIds.map((id) => people.get(id)).filter((p): p is Person => !!p);
  candidates.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return candidates[0];
}

/** Role to show for the person a document waits on, from its stage. */
export function roleForStage(stage: string): string {
  if (stage.startsWith('Verification')) return 'Verifier';
  if (stage.startsWith('Finalization')) return 'Finalizer';
  return 'Approver';
}
