import { injectable } from 'inversify';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import AppError from '../utils/appError';
import { Status } from '../utils/status.enum';
import { Role, User } from '../employee/entity/user.entity';
import { UserRepository } from '../employee/repository/user.repository';
import { CacheService } from '../global/cache.service';
import { NotificationService } from '../notification/service/notification.service';
import { AuditLogService } from '../employeeActivity/service/auditLog.service';
import { formatDateTime } from '../utils/dateUtils';
import { RegistrationModel } from './registration.entity';
import { isUniqueViolation, uniqueViolationText } from './transport.utils';

export const CACHE_TTL_LIST = 180;
export const CACHE_TTL_DETAIL = 300;

export interface Requester {
  id: string;
  name: string;
  isAdmin: boolean;
  isVerifier: boolean;
  /** Admin or verifier: may approve / reject and see everyone's submissions. */
  isPrivileged: boolean;
}

export interface AuditFields {
  createdBy: string | null;
  approvedBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

export const userDisplayName = (user?: Partial<User> | null): string | null => {
  if (!user) return null;
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || null;
};

/**
 * The registration life cycle shared by Transporter, Vehicle and Driver, modelled
 * on the Farmer / Vendor registrations:
 *
 * - create: draft stays draft; admin / verifier creators are approved at once;
 *   everyone else starts `pending`.
 * - submit: a draft becomes `pending` (or `approved` for an admin / verifier).
 * - approve: only an admin or verifier, only while the record is `pending`.
 * - visibility: employees see approved records plus their own; verifiers see every
 *   submitted record; admins also see their own drafts.
 * - only the creator or an admin / verifier may edit or delete a record.
 *
 * A module supplies its fields, validation, uniqueness rules and read models; this
 * class owns the status transitions, ownership checks, codes, caching and
 * notifications.
 *
 * `@injectable()` is required here too: inversify refuses a subclass whose base
 * class is not marked, even though the subclasses declare every injection.
 */
@injectable()
export abstract class TransportRegistrationService<E extends RegistrationModel> {
  /** Shown in messages and audit logs, e.g. `Transporter`. */
  protected abstract readonly label: string;
  protected abstract readonly cachePrefix: string;
  protected abstract readonly tableName: string;
  protected abstract readonly codeColumn: string;
  protected abstract readonly codePrefix: string;

  constructor(
    protected readonly repo: Repository<E>,
    protected readonly userRepository: UserRepository,
    protected readonly cacheService: CacheService,
    protected readonly notificationService: NotificationService,
    protected readonly auditLogService: AuditLogService,
  ) {}

  // ─── Module hooks ─────────────────────────────────────────────────────────

  protected abstract displayName(entity: E): string;
  protected abstract newEntity(): E;
  /** Loads the entity with every relation `applyBody` touches. */
  protected abstract loadForWrite(id: string): Promise<E | null>;
  /** Copies the fields present in `body` onto the entity (normalising values). */
  protected abstract applyBody(entity: E, body: Record<string, any>): Promise<void>;
  /** Required-field validation, run for everything except drafts. */
  protected abstract assertComplete(entity: E): void;
  /** Rejects a duplicate of another live record (409). */
  protected abstract assertUnique(entity: E, excludeId?: string): Promise<void>;
  /** Flat, comparable field values for the audit log. */
  protected abstract snapshot(entity: E): Record<string, unknown>;
  /** Throws 409 when other records still depend on these ones. */
  protected async assertDeletable(_entities: E[]): Promise<void> {}

  // ─── Requester / visibility ───────────────────────────────────────────────

  protected async getRequester(userId: string): Promise<Requester> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new AppError(404, 'User not found');
    const isAdmin = !!user.roles?.includes(Role.ADMIN);
    const isVerifier = !!user.roles?.includes(Role.VERIFIER);
    return {
      id: user.id,
      name: userDisplayName(user) || user.username || 'Unknown',
      isAdmin,
      isVerifier,
      isPrivileged: isAdmin || isVerifier,
    };
  }

  /**
   * Adds the list visibility rules. The query must join `createdBy` as `createdBy`.
   *
   * - employee: approved records of everyone + own records of any status
   * - verifier: everyone's records except drafts
   * - admin: everyone's records, own drafts only
   */
  protected applyVisibility(qb: SelectQueryBuilder<E>, alias: string, requester: Requester): void {
    if (!requester.isPrivileged) {
      qb.where(`(${alias}.status = :visApproved OR createdBy.id = :visUser)`, {
        visApproved: Status.APPROVED,
        visUser: requester.id,
      });
    } else if (requester.isVerifier && !requester.isAdmin) {
      qb.where(`${alias}.status != :visDraft`, { visDraft: Status.DRAFT });
    } else {
      qb.where(`(${alias}.status != :visDraft OR createdBy.id = :visUser)`, {
        visDraft: Status.DRAFT,
        visUser: requester.id,
      });
    }
  }

  /** Records that can still be picked in other forms: approved and pending. */
  protected applyPickable(qb: SelectQueryBuilder<E>, alias: string): void {
    qb.where(`${alias}.status IN (:...pickStatuses)`, { pickStatuses: [Status.APPROVED, Status.PENDING] });
  }

  protected canModify(requester: Requester, entity: E): boolean {
    return requester.isPrivileged || (entity.createdBy as User | undefined)?.id === requester.id;
  }

  /** Whether the requester may edit the row (list rows carry `createdBy.id`). */
  protected canEditRow(requester: Requester, createdById?: string | null): boolean {
    return requester.isPrivileged || (!!createdById && createdById === requester.id);
  }

  protected assertCanModify(requester: Requester, entity: E): void {
    if (!this.canModify(requester, entity)) {
      throw new AppError(403, `You can only edit or delete ${this.label.toLowerCase()} records you created`);
    }
  }

  protected auditFields(entity: E): AuditFields {
    const { createdDate, createdTime } = entity.createdAt
      ? formatDateTime(entity.createdAt)
      : { createdDate: null, createdTime: null };
    return {
      createdBy: userDisplayName(entity.createdBy as User),
      approvedBy: userDisplayName(entity.approvedBy as User),
      createdDate,
      createdTime,
    };
  }

  // ─── Cache ────────────────────────────────────────────────────────────────

  protected async invalidate(id?: string): Promise<void> {
    const tasks: Promise<unknown>[] = [
      this.cacheService.invalidatePattern(`${this.cachePrefix}:list:*`),
      this.cacheService.invalidatePattern(`${this.cachePrefix}:picker:*`),
      this.cacheService.invalidatePattern(`${this.cachePrefix}:lookup:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.cachePrefix}:view:${id}`),
        this.cacheService.del(`${this.cachePrefix}:update:${id}`),
      );
    }
    await Promise.all(tasks);
  }

  protected async remember<T>(key: string, ttl: number, produce: () => Promise<T>): Promise<T> {
    const cached = await this.cacheService.get<T>(key);
    if (cached) return cached;
    const value = await produce();
    if (value !== null && value !== undefined) await this.cacheService.set(key, value, ttl);
    return value;
  }

  // ─── Code generation ──────────────────────────────────────────────────────

  /** `TR-00001`, one past the highest code ever issued (soft-deleted rows included). */
  protected async nextCode(): Promise<string> {
    const rows: Array<{ code: string | null }> = await this.repo.query(
      `SELECT "${this.codeColumn}" AS code FROM "${this.tableName}" WHERE "${this.codeColumn}" LIKE $1 ` +
        `ORDER BY LENGTH("${this.codeColumn}") DESC, "${this.codeColumn}" DESC LIMIT 1`,
      [`${this.codePrefix}%`],
    );
    const last = rows[0]?.code ? parseInt(rows[0].code.slice(this.codePrefix.length), 10) : 0;
    const next = Number.isNaN(last) ? 1 : last + 1;
    return `${this.codePrefix}${String(next).padStart(5, '0')}`;
  }

  /** Saves a new row with a fresh code, retrying when two requests race for the same code. */
  protected async saveNew(entity: E): Promise<E> {
    const attempts = 4;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      (entity as any)[this.codeColumn] = await this.nextCode();
      try {
        return (await this.repo.save(entity as any)) as E;
      } catch (error) {
        if (isUniqueViolation(error) && uniqueViolationText(error).includes(this.codeColumn) && attempt < attempts) {
          continue;
        }
        throw this.translateSaveError(error);
      }
    }
    throw new AppError(500, `Could not generate a ${this.label.toLowerCase()} code, please retry`);
  }

  protected async saveExisting(entity: E): Promise<E> {
    try {
      return (await this.repo.save(entity as any)) as E;
    } catch (error) {
      throw this.translateSaveError(error);
    }
  }

  /** The service-level checks run first; this catches a race that slipped past them. */
  protected translateSaveError(error: unknown): unknown {
    if (isUniqueViolation(error)) {
      return new AppError(409, `This ${this.label.toLowerCase()} is already registered`);
    }
    return error;
  }

  // ─── Life cycle ───────────────────────────────────────────────────────────

  async create(body: Record<string, any>, userId: string): Promise<E> {
    const requester = await this.getRequester(userId);
    const requested = body.status === Status.DRAFT ? Status.DRAFT : undefined;
    const status = requested ?? (requester.isPrivileged ? Status.APPROVED : Status.PENDING);

    const entity = this.newEntity();
    await this.applyBody(entity, body);
    if (status !== Status.DRAFT) this.assertComplete(entity);
    await this.assertUnique(entity);

    entity.status = status;
    entity.createdBy = { id: userId } as User;
    if (status === Status.APPROVED) entity.approvedBy = { id: userId } as User;

    const saved = await this.saveNew(entity);
    await this.invalidate();

    if (status !== Status.DRAFT) this.notifyCreated(saved, requester).catch(() => {});
    return saved;
  }

  /** Turns a draft into a submitted record. */
  async submit(id: string, body: Record<string, any>, userId: string): Promise<E> {
    const entity = await this.loadForWrite(id);
    if (!entity) throw new AppError(404, `${this.label} not found`);
    const requester = await this.getRequester(userId);
    this.assertCanModify(requester, entity);
    if (entity.status !== Status.DRAFT) {
      throw new AppError(400, `${this.label} is already submitted (status '${entity.status}')`);
    }

    await this.applyBody(entity, body);
    this.assertComplete(entity);
    await this.assertUnique(entity, entity.id);

    if (requester.isPrivileged) {
      entity.status = Status.APPROVED;
      entity.approvedBy = { id: requester.id } as User;
    } else {
      entity.status = Status.PENDING;
    }

    const saved = await this.saveExisting(entity);
    await this.invalidate(id);
    this.notifyCreated(saved, requester).catch(() => {});
    return saved;
  }

  async update(id: string, body: Record<string, any>, userId: string): Promise<E> {
    const entity = await this.loadForWrite(id);
    if (!entity) throw new AppError(404, `${this.label} not found`);
    const requester = await this.getRequester(userId);
    this.assertCanModify(requester, entity);

    const before = this.snapshot(entity);
    await this.applyBody(entity, body);
    if (entity.status !== Status.DRAFT) this.assertComplete(entity);
    await this.assertUnique(entity, entity.id);

    // A rejected record edited by its creator goes back to the approvers.
    const resubmitted = entity.status === Status.REJECTED && !requester.isPrivileged;
    if (resubmitted) {
      entity.status = Status.PENDING;
      entity.approvedBy = null as unknown as User;
    }

    const saved = await this.saveExisting(entity);
    await this.invalidate(id);

    try {
      await this.auditLogService.logChange(this.label, id, before, this.snapshot(saved), userId);
    } catch {
      // The audit trail must never block an edit.
    }
    if (resubmitted) this.notifyCreated(saved, requester).catch(() => {});
    return saved;
  }

  async approve(id: string, approverId: string, status: Status): Promise<E> {
    if (status !== Status.APPROVED && status !== Status.REJECTED) {
      throw new AppError(400, `Invalid status '${status}'. Only 'approved' or 'notapproved' are allowed.`);
    }
    const approver = await this.getRequester(approverId);
    if (!approver.isPrivileged) {
      throw new AppError(403, `Only an Admin or Verifier can approve or reject ${this.label.toLowerCase()} records`);
    }

    const entity = await this.repo.findOne({ where: { id } as any });
    if (!entity) throw new AppError(404, `${this.label} not found`);
    if (entity.status !== Status.PENDING) {
      throw new AppError(
        400,
        `${this.label} cannot be approved because its current status is '${entity.status}'. Only records with status 'pending' can be approved or rejected.`,
      );
    }

    entity.status = status;
    entity.approvedBy = { id: approverId } as User;
    const saved = await this.repo.save(entity as any);
    await this.invalidate(id);

    this.notifyDecision(saved as E, approver, status).catch(() => {});
    return saved as E;
  }

  async softDelete(ids: string[], userId: string): Promise<{ affected: number }> {
    const unique = Array.from(new Set(ids));
    const requester = await this.getRequester(userId);

    const entities = await this.repo.find({ where: { id: In(unique) } as any, relations: ['createdBy'] as any });
    if (entities.length === 0) throw new AppError(404, `${this.label} not found`);
    if (!requester.isPrivileged) {
      const foreign = entities.find((e) => (e.createdBy as User | undefined)?.id !== requester.id);
      if (foreign) {
        throw new AppError(403, `You can only edit or delete ${this.label.toLowerCase()} records you created`);
      }
    }
    await this.assertDeletable(entities);

    const result = await this.repo.softDelete({ id: In(entities.map((e) => e.id)) } as any);
    await this.invalidate();
    for (const entity of entities) await this.invalidate(entity.id);
    return { affected: result.affected ?? entities.length };
  }

  // ─── Notifications (never block the request) ──────────────────────────────

  private async notifyCreated(entity: E, requester: Requester): Promise<void> {
    try {
      const name = this.displayName(entity);
      if (requester.isPrivileged) {
        if (entity.status === Status.APPROVED) {
          await this.notificationService.createNoti(`${this.label} "${name}" created successfully`, requester.id);
        }
        return;
      }
      await this.notificationService.createNoti(
        `Your ${this.label.toLowerCase()} "${name}" has been sent for approval`,
        requester.id,
      );
      await this.notificationService.createNotiForRoles(
        `${this.label} "${name}" is awaiting your approval, created by ${requester.name}`,
        [Role.VERIFIER, Role.ADMIN],
      );
    } catch {
      // ignore
    }
  }

  private async notifyDecision(entity: E, approver: Requester, status: Status): Promise<void> {
    try {
      const approved = status === Status.APPROVED;
      const name = this.displayName(entity);
      await this.notificationService.createNoti(
        approved
          ? `You approved ${this.label.toLowerCase()} "${name}" successfully`
          : `You rejected ${this.label.toLowerCase()} "${name}"`,
        approver.id,
      );
      const withCreator = await this.repo.findOne({ where: { id: entity.id } as any, relations: ['createdBy'] as any });
      const creatorId = (withCreator?.createdBy as User | undefined)?.id;
      if (creatorId && creatorId !== approver.id) {
        await this.notificationService.createNoti(
          approved
            ? `Your ${this.label.toLowerCase()} "${name}" has been approved by ${approver.name}`
            : `Your ${this.label.toLowerCase()} "${name}" has been rejected by ${approver.name}`,
          creatorId,
        );
      }
    } catch {
      // ignore
    }
  }
}
