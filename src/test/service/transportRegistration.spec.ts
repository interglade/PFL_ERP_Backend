/**
 * Transporter / Vehicle / Driver registration — the shared life cycle
 * (src/transport/transportRegistration.service.ts) with an in-memory repository:
 * creation status by role, submit, approve / reject, ownership, visibility rules,
 * code generation and the unique-violation handling.
 */

import 'reflect-metadata';

import { Role } from '../../employee/entity/user.entity';
import { Status } from '../../utils/status.enum';
import AppError from '../../utils/appError';
import { TransportRegistrationService } from '../../transport/transportRegistration.service';

interface Thing {
  id: string;
  code?: string;
  name?: string | null;
  status: Status;
  createdBy?: any;
  approvedBy?: any;
  createdAt?: Date;
}

class FakeRepo {
  rows = new Map<string, Thing>();
  nextId = 1;
  lastCode: string | null = null;
  failSaveWith: any[] = [];

  create() {
    return {} as Thing;
  }
  async save(entity: Thing) {
    const failure = this.failSaveWith.shift();
    if (failure) throw failure;
    if (!entity.id) {
      entity.id = `id-${this.nextId++}`;
      entity.createdAt = new Date('2026-10-12T10:00:00Z');
    }
    this.rows.set(entity.id, entity);
    if (entity.code) this.lastCode = entity.code;
    return entity;
  }
  async findOne({ where }: any) {
    return this.rows.get(where.id) ?? null;
  }
  async find({ where }: any) {
    const ids: string[] = where.id?.value ?? [];
    return ids.map((id) => this.rows.get(id)).filter(Boolean);
  }
  async softDelete({ id }: any) {
    let affected = 0;
    for (const key of id.value as string[]) if (this.rows.delete(key)) affected++;
    return { affected };
  }
  async query() {
    return [{ code: this.lastCode }];
  }
}

const USERS: Record<string, any> = {
  admin: { id: 'admin', roles: [Role.ADMIN], firstName: 'Ada', lastName: 'Admin' },
  verifier: { id: 'verifier', roles: [Role.VERIFIER], firstName: 'Vera', lastName: 'Verifier' },
  both: { id: 'both', roles: [Role.ADMIN, Role.VERIFIER], firstName: 'Both', lastName: 'Roles' },
  emp1: { id: 'emp1', roles: [Role.EMPLOYEE], firstName: 'Eve', lastName: 'One' },
  emp2: { id: 'emp2', roles: [Role.EMPLOYEE], firstName: 'Evan', lastName: 'Two' },
};

class TestService extends TransportRegistrationService<any> {
  protected readonly label = 'Thing';
  protected readonly cachePrefix = 'thing';
  protected readonly tableName = 'things';
  protected readonly codeColumn = 'code';
  protected readonly codePrefix = 'TH-';
  blockDelete = false;

  protected displayName(e: Thing) {
    return e.name || 'Thing';
  }
  protected newEntity() {
    return {} as Thing;
  }
  protected async loadForWrite(id: string) {
    return this.repo.findOne({ where: { id } } as any);
  }
  protected async applyBody(e: Thing, body: Record<string, any>) {
    if (body.name !== undefined) e.name = body.name;
  }
  protected assertComplete(e: Thing) {
    if (!e.name) throw new AppError(400, 'Name is required');
  }
  protected async assertUnique(e: Thing) {
    if (e.name === 'DUP') throw new AppError(409, 'already registered');
  }
  protected snapshot(e: Thing) {
    return { name: e.name, status: e.status };
  }
  protected async assertDeletable() {
    if (this.blockDelete) throw new AppError(409, 'in use');
  }

  // expose protected helpers for the tests
  visibility(qb: any, requester: any) {
    this.applyVisibility(qb, 'thing', requester);
  }
  requesterOf(id: string) {
    return this.getRequester(id);
  }
  code() {
    return this.nextCode();
  }
  canEdit(requester: any, createdById?: string | null) {
    return this.canEditRow(requester, createdById);
  }
}

const build = () => {
  const repo = new FakeRepo();
  const notifications = { createNoti: jest.fn().mockResolvedValue(undefined), createNotiForRoles: jest.fn().mockResolvedValue(undefined) };
  const audit = { logChange: jest.fn().mockResolvedValue(undefined) };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    invalidatePattern: jest.fn().mockResolvedValue(undefined),
  };
  const users = { findOneBy: jest.fn(async ({ id }: any) => USERS[id] ?? null) };
  const service = new TestService(repo as any, users as any, cache as any, notifications as any, audit as any);
  return { service, repo, notifications, audit, cache };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('create', () => {
  it('starts an employee record as pending, owned by the creator, with the first code', async () => {
    const { service } = build();
    const saved = await service.create({ name: 'Raju' }, 'emp1');
    expect(saved.status).toBe(Status.PENDING);
    expect(saved.createdBy).toEqual({ id: 'emp1' });
    expect(saved.approvedBy).toBeUndefined();
    expect(saved.code).toBe('TH-00001');
  });

  it('approves an admin or verifier record straight away and records them as approver', async () => {
    const { service } = build();
    for (const userId of ['admin', 'verifier', 'both']) {
      const saved = await service.create({ name: 'Raju' }, userId);
      expect(saved.status).toBe(Status.APPROVED);
      expect(saved.approvedBy).toEqual({ id: userId });
    }
  });

  it('keeps a draft a draft for everyone and skips the required-field check', async () => {
    const { service, notifications } = build();
    const draft = await service.create({ status: Status.DRAFT }, 'emp1');
    expect(draft.status).toBe(Status.DRAFT);
    const adminDraft = await service.create({ status: Status.DRAFT }, 'admin');
    expect(adminDraft.status).toBe(Status.DRAFT);
    await flush();
    expect(notifications.createNoti).not.toHaveBeenCalled();
  });

  it('rejects a non-draft record with missing required fields', async () => {
    const { service } = build();
    await expect(service.create({}, 'emp1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('ignores any other status the client sends', async () => {
    const { service } = build();
    const saved = await service.create({ name: 'x', status: Status.APPROVED }, 'emp1');
    expect(saved.status).toBe(Status.PENDING);
  });

  it('surfaces a duplicate as 409 and saves nothing', async () => {
    const { service, repo } = build();
    await expect(service.create({ name: 'DUP' }, 'emp1')).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.rows.size).toBe(0);
  });

  it('tells the creator and the approvers about a submitted record', async () => {
    const { service, notifications } = build();
    await service.create({ name: 'Raju' }, 'emp1');
    await flush();
    expect(notifications.createNoti).toHaveBeenCalledWith('Your thing "Raju" has been sent for approval', 'emp1');
    expect(notifications.createNotiForRoles).toHaveBeenCalledWith(
      'Thing "Raju" is awaiting your approval, created by Eve One',
      [Role.VERIFIER, Role.ADMIN],
    );
  });

  it('only confirms to the creator when an admin creates (nothing to approve)', async () => {
    const { service, notifications } = build();
    await service.create({ name: 'Raju' }, 'admin');
    await flush();
    expect(notifications.createNoti).toHaveBeenCalledWith('Thing "Raju" created successfully', 'admin');
    expect(notifications.createNotiForRoles).not.toHaveBeenCalled();
  });
});

describe('code generation', () => {
  it('counts up from the last issued code', async () => {
    const { service } = build();
    expect((await service.create({ name: 'a' }, 'emp1')).code).toBe('TH-00001');
    expect((await service.create({ name: 'b' }, 'emp1')).code).toBe('TH-00002');
    expect((await service.create({ name: 'c' }, 'emp1')).code).toBe('TH-00003');
  });

  it('retries with a fresh code when another request took the same one', async () => {
    const { service, repo } = build();
    repo.failSaveWith = [{ driverError: { code: '23505', detail: 'Key (code)=(TH-00001) already exists.' } }];
    const saved = await service.create({ name: 'a' }, 'emp1');
    expect(saved.status).toBe(Status.PENDING);
    expect(saved.code).toMatch(/^TH-\d{5}$/);
  });

  it('reports any other unique violation as a duplicate registration', async () => {
    const { service, repo } = build();
    repo.failSaveWith = [{ driverError: { code: '23505', constraint: 'UQ_vehicles_vehicle_no', detail: 'Key (vehicleNoNormalized)=(MH12AB1234)' } }];
    await expect(service.create({ name: 'a' }, 'emp1')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('submit', () => {
  it('moves an employee draft to pending', async () => {
    const { service } = build();
    const draft = await service.create({ status: Status.DRAFT }, 'emp1');
    const submitted = await service.submit(draft.id, { name: 'Raju' }, 'emp1');
    expect(submitted.status).toBe(Status.PENDING);
  });

  it('approves it at once for an admin or verifier', async () => {
    const { service } = build();
    const draft = await service.create({ status: Status.DRAFT }, 'verifier');
    const submitted = await service.submit(draft.id, { name: 'Raju' }, 'verifier');
    expect(submitted.status).toBe(Status.APPROVED);
    expect(submitted.approvedBy).toEqual({ id: 'verifier' });
  });

  it('refuses to submit something that is not a draft', async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await expect(service.submit(pending.id, { name: 'Raju' }, 'emp1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses to submit someone else's draft", async () => {
    const { service } = build();
    const draft = await service.create({ status: Status.DRAFT }, 'emp1');
    await expect(service.submit(draft.id, { name: 'Raju' }, 'emp2')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses an incomplete submission', async () => {
    const { service } = build();
    const draft = await service.create({ status: Status.DRAFT }, 'emp1');
    await expect(service.submit(draft.id, {}, 'emp1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('404s for an unknown record', async () => {
    const { service } = build();
    await expect(service.submit('nope', {}, 'emp1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('approve / reject', () => {
  it('lets a verifier or admin approve a pending record and records who did', async () => {
    const { service } = build();
    for (const approver of ['verifier', 'admin']) {
      const pending = await service.create({ name: 'Raju' }, 'emp1');
      const approved = await service.approve(pending.id, approver, Status.APPROVED);
      expect(approved.status).toBe(Status.APPROVED);
      expect(approved.approvedBy).toEqual({ id: approver });
    }
  });

  it('rejects with the not-approved status', async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    expect((await service.approve(pending.id, 'verifier', Status.REJECTED)).status).toBe(Status.REJECTED);
  });

  it('forbids employees, including the creator', async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await expect(service.approve(pending.id, 'emp1', Status.APPROVED)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.approve(pending.id, 'emp2', Status.APPROVED)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('only decides records that are pending', async () => {
    const { service } = build();
    const draft = await service.create({ status: Status.DRAFT }, 'emp1');
    await expect(service.approve(draft.id, 'verifier', Status.APPROVED)).rejects.toMatchObject({ statusCode: 400 });
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await service.approve(pending.id, 'verifier', Status.APPROVED);
    await expect(service.approve(pending.id, 'verifier', Status.REJECTED)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts only approved / notapproved as the outcome', async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await expect(service.approve(pending.id, 'verifier', Status.PENDING)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.approve(pending.id, 'verifier', undefined as any)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('tells the approver and the creator the outcome', async () => {
    const { service, notifications } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await flush();
    notifications.createNoti.mockClear();
    await service.approve(pending.id, 'verifier', Status.APPROVED);
    await flush();
    expect(notifications.createNoti).toHaveBeenCalledWith('You approved thing "Raju" successfully', 'verifier');
    expect(notifications.createNoti).toHaveBeenCalledWith('Your thing "Raju" has been approved by Vera Verifier', 'emp1');
  });
});

describe('update', () => {
  it('lets the creator edit and keeps the status', async () => {
    const { service, audit } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    const updated = await service.update(pending.id, { name: 'Raju P' }, 'emp1');
    expect(updated.name).toBe('Raju P');
    expect(updated.status).toBe(Status.PENDING);
    expect(audit.logChange).toHaveBeenCalledWith('Thing', pending.id, { name: 'Raju', status: Status.PENDING }, { name: 'Raju P', status: Status.PENDING }, 'emp1');
  });

  it("forbids another employee from editing, but not an admin or verifier", async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await expect(service.update(pending.id, { name: 'X' }, 'emp2')).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.update(pending.id, { name: 'Y' }, 'verifier')).name).toBe('Y');
    expect((await service.update(pending.id, { name: 'Z' }, 'admin')).name).toBe('Z');
  });

  it("does not change an approved record's status when its creator edits it", async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await service.approve(pending.id, 'verifier', Status.APPROVED);
    expect((await service.update(pending.id, { name: 'Raju P' }, 'emp1')).status).toBe(Status.APPROVED);
  });

  it('sends a rejected record back to pending when its creator edits it', async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await service.approve(pending.id, 'verifier', Status.REJECTED);
    const resubmitted = await service.update(pending.id, { name: 'Raju P' }, 'emp1');
    expect(resubmitted.status).toBe(Status.PENDING);
    expect(resubmitted.approvedBy).toBeNull();
  });

  it('leaves a rejected record rejected when a verifier edits it', async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await service.approve(pending.id, 'verifier', Status.REJECTED);
    expect((await service.update(pending.id, { name: 'Raju P' }, 'verifier')).status).toBe(Status.REJECTED);
  });

  it('keeps a draft a draft and allows it to be incomplete', async () => {
    const { service } = build();
    const draft = await service.create({ status: Status.DRAFT }, 'emp1');
    expect((await service.update(draft.id, { name: null }, 'emp1')).status).toBe(Status.DRAFT);
  });

  it('still validates a submitted record', async () => {
    const { service } = build();
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await expect(service.update(pending.id, { name: null }, 'emp1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not let an audit failure block the edit', async () => {
    const { service, audit } = build();
    audit.logChange.mockRejectedValue(new Error('audit down'));
    const pending = await service.create({ name: 'Raju' }, 'emp1');
    await expect(service.update(pending.id, { name: 'Raju P' }, 'emp1')).resolves.toBeDefined();
  });
});

describe('softDelete', () => {
  it('lets the creator delete their own records', async () => {
    const { service, repo } = build();
    const a = await service.create({ name: 'a' }, 'emp1');
    const b = await service.create({ name: 'b' }, 'emp1');
    const result = await service.softDelete([a.id, b.id], 'emp1');
    expect(result.affected).toBe(2);
    expect(repo.rows.size).toBe(0);
  });

  it("forbids deleting anyone else's record, even in a mixed selection", async () => {
    const { service, repo } = build();
    const mine = await service.create({ name: 'a' }, 'emp1');
    const theirs = await service.create({ name: 'b' }, 'emp2');
    await expect(service.softDelete([mine.id, theirs.id], 'emp1')).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.rows.size).toBe(2);
  });

  it('lets an admin or verifier delete anything', async () => {
    const { service } = build();
    const a = await service.create({ name: 'a' }, 'emp1');
    expect((await service.softDelete([a.id], 'admin')).affected).toBe(1);
  });

  it('stops when the module says other records depend on it', async () => {
    const { service, repo } = build();
    const a = await service.create({ name: 'a' }, 'admin');
    service.blockDelete = true;
    await expect(service.softDelete([a.id], 'admin')).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.rows.size).toBe(1);
  });

  it('404s when nothing matches', async () => {
    const { service } = build();
    await expect(service.softDelete(['nope'], 'admin')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('list visibility', () => {
  const run = async (userId: string) => {
    const { service } = build();
    const where = jest.fn();
    await service.visibility({ where } as any, await service.requesterOf(userId));
    return where.mock.calls[0] as [string, Record<string, string>];
  };

  it('employees see approved records plus their own', async () => {
    const [sql, params] = await run('emp1');
    expect(sql).toBe('(thing.status = :visApproved OR createdBy.id = :visUser)');
    expect(params).toEqual({ visApproved: Status.APPROVED, visUser: 'emp1' });
  });

  it('a verifier sees every submitted record and no drafts', async () => {
    const [sql, params] = await run('verifier');
    expect(sql).toBe('thing.status != :visDraft');
    expect(params).toEqual({ visDraft: Status.DRAFT });
  });

  it('an admin also sees their own drafts', async () => {
    const [sql, params] = await run('admin');
    expect(sql).toBe('(thing.status != :visDraft OR createdBy.id = :visUser)');
    expect(params).toEqual({ visDraft: Status.DRAFT, visUser: 'admin' });
  });

  it('a user who is both admin and verifier follows the admin rule', async () => {
    const [sql] = await run('both');
    expect(sql).toBe('(thing.status != :visDraft OR createdBy.id = :visUser)');
  });

  it('can edit: privileged users everywhere, employees only on their own rows', async () => {
    const { service } = build();
    const emp = await service.requesterOf('emp1');
    const admin = await service.requesterOf('admin');
    expect(service.canEdit(emp, 'emp1')).toBe(true);
    expect(service.canEdit(emp, 'emp2')).toBe(false);
    expect(service.canEdit(emp, null)).toBe(false);
    expect(service.canEdit(admin, 'emp2')).toBe(true);
  });

  it('404s for an unknown requester', async () => {
    const { service } = build();
    await expect(service.requesterOf('ghost')).rejects.toMatchObject({ statusCode: 404 });
  });
});
