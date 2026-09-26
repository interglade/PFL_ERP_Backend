import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';
import { ApprovalFlowRepository } from '../repository/approvalFlow.repository';
import { UserRepository } from '../../employee/repository/user.repository';

import { In } from 'typeorm';

import { AppDataSource } from '../../utils/data-source';

import logger from '../../utils/logger';
import { FinalizerBlockRepository } from '../repository/finalizerBlock.repository';
import { ApprovalLevelRepository } from '../repository/approvalLevel.repository';
import { ApproverBlockRepository } from '../repository/approverBlock.repository';
import { User } from '../../employee/entity/user.entity';
import { CacheService } from '../../global/cache.service';
type ApproverBlockInput = {
  hierarchy: number;
  minAmtCanApprove: number;
  maxAmtCanApprove: number;
  users: string[];
};

@injectable()
export class ApprovalFlowService {
  constructor(
    @inject(TYPES.ApprovalFlowRepository)
    private approvalFlowRepository: ApprovalFlowRepository,
    @inject(TYPES.UserRepository)
    private userRepository: UserRepository,
    @inject(TYPES.FinalizerBlockRepository)
    private finalizerBlockRepository: FinalizerBlockRepository,
    @inject(TYPES.ApprovalLevelRepository)
    private approvalLevelRepository: ApprovalLevelRepository,
    @inject(TYPES.ApproverBlockRepository)
    private approverBlockRepository: ApproverBlockRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'approvalFlow';
  private readonly CACHE_TTL = 180; // 3 minutes

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:view:${id}`),
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
      );
    }
    await Promise.all(tasks);
  }

  async create(data: {
    creator: string;
    type: string;
    verifiers: string[];
    approvers: {
      firstApprover: ApproverBlockInput | null;
      secondApprover: ApproverBlockInput | null;
      thirdApprover: ApproverBlockInput | null;
      fourthApprover: ApproverBlockInput | null;
      fifthApprover: ApproverBlockInput | null;
      sixthApprover: ApproverBlockInput | null;
    };
    finalizers: {
      firstFinalizers: string[];
      secondFinalizers: string[];
    };
  }): Promise<any> {
    logger.info('Service data', data);
    logger.info('Creator ID:', data.approvers.firstApprover?.users);
    logger.info('Creator ID:', data.approvers.secondApprover?.users);
    
    
    
    const creator = await this.userRepository.findOneBy({ id: data.creator });
    if (!creator) throw new Error('Creator not found');
    const type = data.type;
    const verifiers = await this.userRepository.findBy({
      id: In(data.verifiers || []),
    });

    const createApproverBlock = async (
      blockData: ApproverBlockInput | null,
    ) => {
      if (!blockData) return null;
      const users = await this.userRepository.findBy({
        id: In(blockData.users || []),
      });

      logger.info("Users: ", users);
      
      return this.approverBlockRepository.save({
        hierarchy: blockData.hierarchy,
        minAmtCanApprove: blockData.minAmtCanApprove,
        maxAmtCanApprove: blockData.maxAmtCanApprove,
        users,
      });
    };

    const [
      firstApprover,
      secondApprover,
      thirdApprover,
      fourthApprover,
      fifthApprover,
      sixthApprover,
    ] = await Promise.all([
      createApproverBlock(data.approvers.firstApprover),
      createApproverBlock(data.approvers.secondApprover),
      createApproverBlock(data.approvers.thirdApprover),
      createApproverBlock(data.approvers.fourthApprover),
      createApproverBlock(data.approvers.fifthApprover),
      createApproverBlock(data.approvers.sixthApprover),
    ]);
    logger.log('Approval level', createApproverBlock);
    logger.log('First approver', firstApprover);
    logger.log('Second approver', secondApprover);
    

    // const approvalLevel: any = await this.approvalLevelRepository.save({
    //   ...firstApprover,
    //   ...secondApprover,
    //   ...thirdApprover,
    //   ...fourthApprover,
    //   ...fifthApprover,
    //   ...sixthApprover,
    // });

    const approvalLevel = this.approvalLevelRepository.create();
    if (firstApprover) approvalLevel.firstApprover = firstApprover;
    if (secondApprover) approvalLevel.secondApprover = secondApprover;
    if (thirdApprover) approvalLevel.thirdApprover = thirdApprover;
    if (fourthApprover) approvalLevel.fourthApprover = fourthApprover;
    if (fifthApprover) approvalLevel.fifthApprover = fifthApprover;
    if (sixthApprover) approvalLevel.sixthApprover = sixthApprover;
    
    const savedApprovalLevel = await this.approvalLevelRepository.save(approvalLevel);


    // console.log('Approval level', approvalLevel.firstApprover);
    // console.log('Approval level', approvalLevel.secondApprover?.users);

    const firstFinalizers = await this.userRepository.findBy({
      id: In(data.finalizers.firstFinalizers || []),
    });
    const secondFinalizers = await this.userRepository.findBy({
      id: In(data.finalizers.secondFinalizers || []),
    });

    const finalizerBlock = await this.finalizerBlockRepository.save({
      firstFinalizers,
      secondFinalizers,
    });
    logger.log("Finalizers: ",finalizerBlock);
    
    const approvalFlow = this.approvalFlowRepository.create();
    approvalFlow.creator = creator;
    approvalFlow.type = type as any;
    approvalFlow.verifiers = verifiers;
    approvalFlow.approvers = savedApprovalLevel;
    approvalFlow.finalizers = finalizerBlock;
    
    logger.log('Approval flow', approvalFlow);

    const saved = await this.approvalFlowRepository.save(approvalFlow);
    await this.invalidateCache();
    return saved;
  }

 async getAll(type?: string, page?: number, limit?: number): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${type ?? 'all'}:${page ?? 0}:${limit ?? 0}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const query = this.approvalFlowRepository
      .createQueryBuilder('approvalflows')
      .leftJoinAndSelect('approvalflows.creator', 'creator')
      .leftJoinAndSelect('approvalflows.verifiers', 'verifiers')
      .leftJoinAndSelect('approvalflows.approvers', 'approvers')
      .leftJoinAndSelect('approvers.firstApprover', 'firstApprover')
      .leftJoinAndSelect('firstApprover.users', 'firstApproverUsers')
      .leftJoinAndSelect('approvers.secondApprover', 'secondApprover')
      .leftJoinAndSelect('secondApprover.users', 'secondApproverUsers')
      .leftJoinAndSelect('approvers.thirdApprover', 'thirdApprover')
      .leftJoinAndSelect('thirdApprover.users', 'thirdApproverUsers')
      .leftJoinAndSelect('approvers.fourthApprover', 'fourthApprover')
      .leftJoinAndSelect('fourthApprover.users', 'fourthApproverUsers')
      .leftJoinAndSelect('approvers.fifthApprover', 'fifthApprover')
      .leftJoinAndSelect('fifthApprover.users', 'fifthApproverUsers')
      // .leftJoinAndSelect('approvers.sixthApprover', 'sixthApprover')
      // .leftJoinAndSelect('sixthApprover.users', 'sixthApproverUsers')
      .leftJoinAndSelect('approvalflows.finalizers', 'finalizers')
      .leftJoinAndSelect('finalizers.firstFinalizers', 'firstFinalizers')
      .leftJoinAndSelect('finalizers.secondFinalizers', 'secondFinalizers');

    //console.log(type);
    if (type) {
      query.where('approvalflows.type = :type', { type });
    }

    const isPaginated = page !== undefined && limit !== undefined;

    if (isPaginated) {
      query.skip((page! - 1) * limit!).take(limit!);
    }

    const [data, total] = await query.getManyAndCount();

    //console.log('getall', data);
    //     const mapApprover = (approver:any) =>
    // approver
    //   ? {
    //       id: approver.id || null,
    //       hierarchy: approver.hierarchy || null,
    //       minAmtCanApprove: approver.minAmtCanApprove,
    //       maxAmtCanApprove: approver.maxAmtCanApprove,
    //       users: approver.users?.map((user:any) => ({
    //         id: user?.id || null,
    //         firstName: user.firstName,
    //         middleName: user.middleName,
    //         lastName: user.lastName,
    //       })),
    //     }
    //   : null;
    const mapApprover = (approver: any) =>
      approver
        ? {
            id: approver.id || null,
            hierarchy: approver.hierarchy || null,
            minAmtCanApprove: approver.minAmtCanApprove,
            maxAmtCanApprove: approver.maxAmtCanApprove,
            users: approver.users?.map(
              (user: any) => `${user.firstName} ${user.lastName}`,
            ),
          }
        : null;

    const formattedResponse = data.map((result) => {
      return {
        id: result.id,
        type: result.type,
        // creator: result.creator
        //   ? {
        //       id: result.creator?.id || null,
        //       firstName: result.creator.firstName,
        //       middleName: result.creator.middleName,
        //       lastName: result.creator.lastName,
        //     }
        //   : null,
        creator: result.creator
          ? `${result.creator.firstName} ${result.creator.lastName}`
          : null,

        // verifiers: result.verifiers.map((verifier) => {
        //   return {
        //     id: verifier?.id || null,
        //     firstName: verifier.firstName,
        //     middleName: verifier.middleName,
        //     lastName: verifier.lastName,
        //   };
        // }),
        verifiers: (result.verifiers ?? []).map((verifier) => {
          return `${verifier.firstName} ${verifier.lastName}`;
        }),
        approvers:
          result.approvers
            ? {
                firstApprover: result.approvers.firstApprover
                  ? mapApprover(result.approvers.firstApprover)
                  : null,
                secondApprover: result.approvers.secondApprover
                  ? mapApprover(result.approvers.secondApprover)
                  : null,
                thirdApprover: result.approvers.thirdApprover
                  ? mapApprover(result.approvers.thirdApprover)
                  : null,
                fourthApprover: result.approvers.fourthApprover
                  ? mapApprover(result.approvers.fourthApprover)
                  : null,
                fifthApprover: result.approvers.fifthApprover
                  ? mapApprover(result.approvers.fifthApprover)
                  : null,
                // sixthApprover: result.approvers.sixthApprover
                //   ? mapApprover(result.approvers.sixthApprover)
                //   : null,
              }
            : null,

        finalizers: {
          firstFinalizers:
            result.finalizers?.firstFinalizers?.map(
              (firstFinalizer) =>
                `${firstFinalizer.firstName} ${firstFinalizer.lastName}`,
            ) ?? [],
          secondFinalizers:
            result.finalizers?.secondFinalizers?.map(
              (secondFinalizers) =>
                `${secondFinalizers.firstName} ${secondFinalizers.lastName}`,
            ) ?? [],
        },
      };
    });
    const effectivePage = isPaginated ? page! : 1;
    const effectiveLimit = isPaginated ? limit! : total;

    const result = {
      data: formattedResponse,
      total,
      page: effectivePage,
      limit: effectiveLimit,
      totalPages: isPaginated ? Math.ceil(total / limit!) : 1,
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async getbyidforview(id: string): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const result = await this.approvalFlowRepository
      .createQueryBuilder('approvalflows')
      .leftJoinAndSelect('approvalflows.creator', 'creator')
      .leftJoinAndSelect('approvalflows.verifiers', 'verifiers')
      .leftJoinAndSelect('approvalflows.approvers', 'approvers')
      .leftJoinAndSelect('approvers.firstApprover', 'firstApprover')
      .leftJoinAndSelect('firstApprover.users', 'firstApproverUsers')
      .leftJoinAndSelect('approvers.secondApprover', 'secondApprover')
      .leftJoinAndSelect('secondApprover.users', 'secondApproverUsers')
      .leftJoinAndSelect('approvers.thirdApprover', 'thirdApprover')
      .leftJoinAndSelect('thirdApprover.users', 'thirdApproverUsers')
      .leftJoinAndSelect('approvers.fourthApprover', 'fourthApprover')
      .leftJoinAndSelect('fourthApprover.users', 'fourthApproverUsers')
      .leftJoinAndSelect('approvers.fifthApprover', 'fifthApprover')
      .leftJoinAndSelect('fifthApprover.users', 'fifthApproverUsers')
      .leftJoinAndSelect('approvers.sixthApprover', 'sixthApprover')
      .leftJoinAndSelect('sixthApprover.users', 'sixthApproverUsers')
      .leftJoinAndSelect('approvalflows.finalizers', 'finalizers')
      .leftJoinAndSelect('finalizers.firstFinalizers', 'firstFinalizers')
      .leftJoinAndSelect('finalizers.secondFinalizers', 'secondFinalizers')
      .where('approvalflows.id = :id', { id })
      .getOne();

    if (!result) {
      return null;
    }

    const mapApprover = (approver: any) =>
      approver
        ? {
            id: approver.id || null,
            hierarchy: approver.hierarchy || null,
            minAmtCanApprove: approver.minAmtCanApprove,
            maxAmtCanApprove: approver.maxAmtCanApprove,
            users: approver.users?.map(
              (user: any) => `${user.firstName} ${user.lastName}`,
            ),
          }
        : null;

    const formattedResponse = {
      id: result.id,
      creator: result.creator
        ? `${result.creator.firstName} ${result.creator.lastName}`
        : null,
      verifiers: result.verifiers?.map(
        (verifier: any) => `${verifier.firstName} ${verifier.lastName}`,
      ),
      approvers: result.approvers
        ? {
            firstApprover: mapApprover(result.approvers.firstApprover),
            secondApprover: mapApprover(result.approvers.secondApprover),
            thirdApprover: mapApprover(result.approvers.thirdApprover),
            fourthApprover: mapApprover(result.approvers.fourthApprover),
            fifthApprover: mapApprover(result.approvers.fifthApprover),
            sixthApprover: mapApprover(result.approvers.sixthApprover),
          }
        : null,
      finalizers: {
        firstFinalizers:
          result.finalizers?.firstFinalizers?.map(
            (f: any) => `${f.firstName} ${f.lastName}`,
          ) || [],
        secondFinalizers:
          result.finalizers?.secondFinalizers?.map(
            (f: any) => `${f.firstName} ${f.lastName}`,
          ) || [],
      },
    };

    await this.cacheService.set(cacheKey, formattedResponse, this.CACHE_TTL);
    return formattedResponse;
  }

  async getByIdForUpdate(id: string): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;
    const result = await this.approvalFlowRepository
      .createQueryBuilder('approvalflows')
      .leftJoinAndSelect('approvalflows.creator', 'creator')
      .leftJoinAndSelect('approvalflows.verifiers', 'verifiers')
      .leftJoinAndSelect('approvalflows.approvers', 'approvers')
      .leftJoinAndSelect('approvers.firstApprover', 'firstApprover')
      .leftJoinAndSelect('firstApprover.users', 'firstApproverUsers')
      .leftJoinAndSelect('approvers.secondApprover', 'secondApprover')
      .leftJoinAndSelect('secondApprover.users', 'secondApproverUsers')
      .leftJoinAndSelect('approvers.thirdApprover', 'thirdApprover')
      .leftJoinAndSelect('thirdApprover.users', 'thirdApproverUsers')
      .leftJoinAndSelect('approvers.fourthApprover', 'fourthApprover')
      .leftJoinAndSelect('fourthApprover.users', 'fourthApproverUsers')
      .leftJoinAndSelect('approvers.fifthApprover', 'fifthApprover')
      .leftJoinAndSelect('fifthApprover.users', 'fifthApproverUsers')
      .leftJoinAndSelect('approvers.sixthApprover', 'sixthApprover')
      .leftJoinAndSelect('sixthApprover.users', 'sixthApproverUsers')
      .leftJoinAndSelect('approvalflows.finalizers', 'finalizers')
      .leftJoinAndSelect('finalizers.firstFinalizers', 'firstFinalizers')
      .leftJoinAndSelect('finalizers.secondFinalizers', 'secondFinalizers')
      .where('approvalflows.id = :id', { id })
      .getOne();

    if (!result) {
      return null;
    }

    const mapApprover = (approver: any) =>
      approver
        ? {
            id: approver.id || null,
            hierarchy: approver.hierarchy || null,
            minAmtCanApprove: approver.minAmtCanApprove,
            maxAmtCanApprove: approver.maxAmtCanApprove,
            users: approver.users?.map((user: any) => user.id),
          }
        : null;

    const formattedResponse = {
      id: result.id,
      creator: result.creator ? result.creator.id : null,
      verifiers: result.verifiers?.map((verifier: any) => verifier.id),
      approvers: result.approvers
        ? {
            firstApprover: mapApprover(result.approvers.firstApprover),
            secondApprover: mapApprover(result.approvers.secondApprover),
            thirdApprover: mapApprover(result.approvers.thirdApprover),
            fourthApprover: mapApprover(result.approvers.fourthApprover),
            fifthApprover: mapApprover(result.approvers.fifthApprover),
            sixthApprover: mapApprover(result.approvers.sixthApprover),
          }
        : null,
      finalizers: {
        firstFinalizers:
          result.finalizers?.firstFinalizers?.map((f: any) => f.id) || [],
        secondFinalizers:
          result.finalizers?.secondFinalizers?.map((f: any) => f.id) || [],
      },
    };

    await this.cacheService.set(cacheKey, formattedResponse, this.CACHE_TTL);
    return formattedResponse;
  }

  

  //TODO: Approval Flow Update
  async update(id: string, data: any): Promise<any> {
    const result = await this.approvalFlowRepository
      .createQueryBuilder('approvalflows')
      .leftJoinAndSelect('approvalflows.creator', 'creator')
      .leftJoinAndSelect('approvalflows.verifiers', 'verifiers')
      .leftJoinAndSelect('approvalflows.approvers', 'approvers')
      .leftJoinAndSelect('approvers.firstApprover', 'firstApprover')
      .leftJoinAndSelect('firstApprover.users', 'firstApproverUsers')
      .leftJoinAndSelect('approvers.secondApprover', 'secondApprover')
      .leftJoinAndSelect('secondApprover.users', 'secondApproverUsers')
      .leftJoinAndSelect('approvers.thirdApprover', 'thirdApprover')
      .leftJoinAndSelect('thirdApprover.users', 'thirdApproverUsers')
      .leftJoinAndSelect('approvers.fourthApprover', 'fourthApprover')
      .leftJoinAndSelect('fourthApprover.users', 'fourthApproverUsers')
      .leftJoinAndSelect('approvers.fifthApprover', 'fifthApprover')
      .leftJoinAndSelect('fifthApprover.users', 'fifthApproverUsers')
      .leftJoinAndSelect('approvers.sixthApprover', 'sixthApprover')
      .leftJoinAndSelect('sixthApprover.users', 'sixthApproverUsers')
      .leftJoinAndSelect('approvalflows.finalizers', 'finalizers')
      .leftJoinAndSelect('finalizers.firstFinalizers', 'firstFinalizers')
      .leftJoinAndSelect('finalizers.secondFinalizers', 'secondFinalizers')
      .where('approvalflows.id = :id', { id })
      .getOne();

    if (!result) {
      throw new Error(`ApprovalFlow with ID ${id} not found`);
    }

    if (data.verifiers) {
      const verifiers = await this.userRepository.findBy({
        id: In(data.verifiers),
      });
      logger.log(
        'Fetched verifiers:',
        verifiers.map((v) => v.id),
      );
      result.verifiers = verifiers;
    }

    if (data.approvers) {
      const approverData = data.approvers;

      const approverBlockMap = {
        ...(approverData.firstApprover && {
          firstApprover: approverData.firstApprover,
        }),
        ...(approverData.secondApprover && {
          secondApprover: approverData.secondApprover,
        }),
        ...(approverData.thirdApprover && {
          thirdApprover: approverData.thirdApprover,
        }),
        ...(approverData.fourthApprover && {
          fourthApprover: approverData.fourthApprover,
        }),
        ...(approverData.fifthApprover && {
          fifthApprover: approverData.fifthApprover,
        }),
        ...(approverData.sixthApprover && {
          sixthApprover: approverData.sixthApprover,
        }),
      };

      const approversEntity = result.approvers;

      for (const [key, approverInputRaw] of Object.entries(approverBlockMap)) {
        const approverInput = approverInputRaw as ApproverBlockInput & {
          id?: string;
        };
        if (!approverInput?.id) continue;

        const approverEntity = await this.approverBlockRepository.findOne({
          where: { id: approverInput.id },
          relations: ['users'],
        });

        if (!approverEntity)
          throw new Error(
            `Approver block with id ${approverInput.id} not found`,
          );

        if (
          approverInput.hierarchy !== undefined &&
          approverInput.hierarchy !== null
        ) {
          approverEntity.hierarchy = approverInput.hierarchy;
        }

        if (
          approverInput.minAmtCanApprove !== undefined &&
          approverInput.minAmtCanApprove !== null
        ) {
          approverEntity.minAmtCanApprove = Number(
            approverInput.minAmtCanApprove,
          );
        }

        if (
          approverInput.maxAmtCanApprove !== undefined &&
          approverInput.maxAmtCanApprove !== null
        ) {
          approverEntity.maxAmtCanApprove = Number(
            approverInput.maxAmtCanApprove,
          );
        }

        if (approverInput.users && approverInput.users.length > 0) {
          const userEntities = await this.userRepository.findByIds(
            approverInput.users,
          );
          approverEntity.users = userEntities;
        }

        await this.approverBlockRepository.save(approverEntity);
        (approversEntity as any)[key] = approverEntity;
      }

      await this.approvalLevelRepository.save(approversEntity);
    }

    if (data.finalizers) {
      const firstFinalizers = await this.userRepository.findBy({
        id: In(data.finalizers.firstFinalizers || []),
      });

      const secondFinalizers = await this.userRepository.findBy({
        id: In(data.finalizers.secondFinalizers || []),
      });

      const finalizerBlock = await this.finalizerBlockRepository.findOne({
        where: { id: result.finalizers?.id },
        relations: ['firstFinalizers', 'secondFinalizers'],
      });

      if (finalizerBlock) {
        finalizerBlock.firstFinalizers = firstFinalizers;
        finalizerBlock.secondFinalizers = secondFinalizers;

        await this.finalizerBlockRepository.save(finalizerBlock);
        result.finalizers = finalizerBlock;
      }
    }

    const { verifiers, approvers, finalizers, ...rest } = data;
    Object.assign(result, rest);

    const updated = await this.approvalFlowRepository.save(result);
    await this.invalidateCache(id);
    return updated;
  }

  /**
   * Swap every reference to `oldUserId` for `newUserId` across the approval
   * system. A user can only be referenced from five places, so rather than
   * hydrating every flow with its full relation tree and re-saving each one,
   * each place is rewritten with a single statement.
   *
   * The junction tables are keyed on (owner_id, user_id), so a plain UPDATE
   * would violate that key whenever the owner already lists the new user.
   * Deleting just the old rows that would collide keeps the previous
   * "drop the old user, add the new one only if missing" behaviour.
   */
  async replaceUserInApprovalSystem(
    oldUserId: string,
    newUserId: string,
  ): Promise<void> {
    if (oldUserId === newUserId) return;

    await AppDataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);

      await userRepo.findOneOrFail({ where: { id: oldUserId } });
      await userRepo.findOneOrFail({ where: { id: newUserId } });

      const junctions = [
        { table: 'approval_flow_verifiers', owner: 'approval_flow_id' },
        { table: 'approver_block_users', owner: 'block_id' },
        {
          table: 'finalizer_block_first_finalizers',
          owner: 'finalizer_block_id',
        },
        {
          table: 'finalizer_block_second_finalizers',
          owner: 'finalizer_block_id',
        },
      ];

      for (const { table, owner } of junctions) {
        await manager.query(
          `DELETE FROM "${table}"
            WHERE "user_id" = $1
              AND "${owner}" IN (
                SELECT "${owner}" FROM "${table}" WHERE "user_id" = $2
              )`,
          [oldUserId, newUserId],
        );

        await manager.query(
          `UPDATE "${table}" SET "user_id" = $2 WHERE "user_id" = $1`,
          [oldUserId, newUserId],
        );
      }

      await manager.query(
        `UPDATE "approval_flows"
            SET "creator_id" = $2, "updatedAt" = now()
          WHERE "creator_id" = $1`,
        [oldUserId, newUserId],
      );
    });

    // Invalidate all approval flow cache entries since user references changed across all flows
    await this.invalidatePattern();
  }

  private async invalidatePattern(): Promise<void> {
    await this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:*`);
  }

  //TODO: Here we check approval flow for logged user
  async findApprovalFlowForLoggedUser(userId: any, docDef: any){
    try {
      console.log(userId, docDef);

      const approvalFlow = await this.approvalFlowRepository.findOne({
        where: {
          creator: { id: userId },
          type:  docDef,
        },
        relations: [
          'verifiers',
          'approvers',
          'approvers.firstApprover',
          'approvers.secondApprover',
          'approvers.thirdApprover',
          'approvers.fourthApprover',
          'approvers.fifthApprover',
          'approvers.sixthApprover',
        ],
      });
        //console.log("Approval flow: ", approvalFlow);

      return approvalFlow;

    } catch (error: any) {
      console.error('Approval flow service error:', { userId, docDef, originalError: error?.message });
      throw new Error(
          `Something went wrong In Approval flow service: ${error?.message || 'Unknown error'}`,
        );
    }
  }

  // Returns approval flow for a user+department with id+name for every user in the flow
  async getApprovalFlowForUserAndDepartment(userId: string, department: string): Promise<any | null> {
    try {
      const approvalFlow = await this.approvalFlowRepository.findOne({
        where: {
          creator: { id: userId },
          type: department as any,
        },
        relations: [
          'verifiers',
          'approvers',
          'approvers.firstApprover',
          'approvers.firstApprover.users',
          'approvers.secondApprover',
          'approvers.secondApprover.users',
          'approvers.thirdApprover',
          'approvers.thirdApprover.users',
          'approvers.fourthApprover',
          'approvers.fourthApprover.users',
          'approvers.fifthApprover',
          'approvers.fifthApprover.users',
          'approvers.sixthApprover',
          'approvers.sixthApprover.users',
          'finalizers',
          'finalizers.firstFinalizers',
          'finalizers.secondFinalizers',
        ],
      });

      if (!approvalFlow) return null;

      const mapUser = (u: any) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() });

      return {
        id: approvalFlow.id,
        type: approvalFlow.type,
        verifiers: (approvalFlow.verifiers ?? []).map(mapUser),
        approvers: approvalFlow.approvers
          ? {
              firstApprover:  (approvalFlow.approvers.firstApprover?.users ?? []).map(mapUser),
              secondApprover: (approvalFlow.approvers.secondApprover?.users ?? []).map(mapUser),
              thirdApprover:  (approvalFlow.approvers.thirdApprover?.users ?? []).map(mapUser),
              fourthApprover: (approvalFlow.approvers.fourthApprover?.users ?? []).map(mapUser),
              fifthApprover:  (approvalFlow.approvers.fifthApprover?.users ?? []).map(mapUser),
              sixthApprover:  (approvalFlow.approvers.sixthApprover?.users ?? []).map(mapUser),
            }
          : null,
        finalizers: approvalFlow.finalizers
          ? {
              firstFinalizers:  (approvalFlow.finalizers.firstFinalizers ?? []).map(mapUser),
              secondFinalizers: (approvalFlow.finalizers.secondFinalizers ?? []).map(mapUser),
            }
          : null,
      };
    } catch (error: any) {
      throw new Error(`getApprovalFlowForUserAndDepartment error: ${error?.message || 'Unknown error'}`);
    }
  }

}


// async getById(id: String): Promise<any> {
  //   const data = await this.approvalFlowRepository
  //     .createQueryBuilder('approvalflows')
  //     .leftJoinAndSelect('approvalflows.creator', 'creator')
  //     .leftJoinAndSelect('approvalflows.verifiers', 'verifiers')
  //     .leftJoinAndSelect('approvalflows.approvers', 'approvers')
  //     .leftJoinAndSelect('approvers.firstApprover', 'firstApprover')
  //     .leftJoinAndSelect('firstApprover.users', 'firstApproverUsers')
  //     .leftJoinAndSelect('approvers.secondApprover', 'secondApprover')
  //     .leftJoinAndSelect('secondApprover.users', 'secondApproverUsers')
  //     .leftJoinAndSelect('approvers.thirdApprover', 'thirdApprover')
  //     .leftJoinAndSelect('thirdApprover.users', 'thirdApproverUsers')
  //     .leftJoinAndSelect('approvers.fourthApprover', 'fourthApprover')
  //     .leftJoinAndSelect('fourthApprover.users', 'fourthApproverUsers')
  //     .leftJoinAndSelect('approvers.fifthApprover', 'fifthApprover')
  //     .leftJoinAndSelect('fifthApprover.users', 'fifthApproverUsers')
  //     .leftJoinAndSelect('approvers.sixthApprover', 'sixthApprover')
  //     .leftJoinAndSelect('sixthApprover.users', 'sixthApproverUsers')
  //     .leftJoinAndSelect('approvalflows.finalizers', 'finalizers')
  //     .leftJoinAndSelect('finalizers.firstFinalizers', 'firstFinalizers')
  //     .leftJoinAndSelect('finalizers.secondFinalizers', 'secondFinalizers')
  //     .getOne();

  //   // return data;
  //   const mapApprover = (approver:any) =>
  // approver
  //   ? {
  //       id: approver.id || null,
  //       hierarchy: approver.hierarchy || null,
  //       minAmtCanApprove: approver.minAmtCanApprove,
  //       maxAmtCanApprove: approver.maxAmtCanApprove,
  //       users: approver.users?.map((user:any) => user.id),
  //     }
  //   : null;

  //   const formattedResponse =  {
  //       id: data?.id,
  //       creator: data?.creator.id,
  //       verifiers: data?.verifiers.map((verifier) => verifier.id),
  //      approvers: data?.approvers !== null
  // ? {
  //     firstApprover: data?.approvers.firstApprover
  //       ? mapApprover(data?.approvers.firstApprover)
  //       : null,
  //     secondApprover: data?.approvers.secondApprover
  //       ? mapApprover(data?.approvers.secondApprover)
  //       : null,
  //     thirdApprover: data?.approvers.thirdApprover
  //       ? mapApprover(data?.approvers.thirdApprover)
  //       : null,
  //     fourthApprover: data?.approvers.fourthApprover
  //       ? mapApprover(data?.approvers.fourthApprover)
  //       : null,
  //     fifthApprover: data?.approvers.fifthApprover
  //       ? mapApprover(data?.approvers.fifthApprover)
  //       : null,
  //     sixthApprover: data?.approvers.sixthApprover
  //       ? mapApprover(data?.approvers.sixthApprover)
  //       : null,
  //   }
  // : null,

  //       finalizers:
  //       {
  //        firstFinalizers: data?.finalizers.firstFinalizers
  //          ? data?.finalizers?.firstFinalizers.map((firstFinalizer) => firstFinalizer.id) : [],
  //          secondFinalizers: data?.finalizers.secondFinalizers
  //          ? data?.finalizers?.secondFinalizers.map((secondFinalizers) => secondFinalizers.id) : [],
  //       }
  //     };
  //   return formattedResponse;

  // }

