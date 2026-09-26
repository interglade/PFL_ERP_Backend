import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';

import AppError from '../../utils/appError';
import { LevelsRepository } from '../repository/levels.repository';
import { DocumentDefinitionRepository } from '../../documentDef/repository/documentDefination.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { Levels } from '../entity/levels.entity';


@injectable()
export class LevelsService {
  constructor(
    @inject(TYPES.LevelsRepository)
    private readonly levelsRepository: LevelsRepository,
    @inject(TYPES.DocumentDefinitionRepository)
    private readonly documentDefinitionRepository: DocumentDefinitionRepository,
    @inject(TYPES.DocumentPermissionRepository)
    private readonly documentPermissionRepository: DocumentDefinitionRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
  ) {}
  async createLevel(levelData: any): Promise<any> {
    const level = this.levelsRepository.create(levelData);
    const savedLevel = await this.levelsRepository.save(level);

   

      

      
      return savedLevel;
    }
  

  async deleteLevel(id: string): Promise<boolean> {
    // Find the level by ID
    const level = await this.levelsRepository.findOne({ where: { id } });

    if (!level) {
      throw new AppError(404, `Level with ID ${id} not found`);
    }

    // Calculate the date 6 months ahead
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

    

    // Set the deletionScheduledAt field for the level
    level.deletionScheduledAt = sixMonthsFromNow;

    // Save the updated level with the scheduled deletion date
    await this.levelsRepository.save(level);

    
    return true;
  }

  async getLevelById(id: string): Promise<any> {
    const result = await this.levelsRepository.findOne({
      where: { id },
     
    });

    if (!result) return null;

    const formatted = {
      id: result.id,

      name: result.name,
      hierarchy: result.hierarchy,
      
    };

    return formatted;
  }

  async getAllLevels(): Promise<any> {
    const results = await this.levelsRepository.find({
      // relations: ['permissions', 'permissions.documentDefinition'],
    });

    return results.map((result) => ({
      id: result.id,

      name: result.name,
      hierarchy: result.hierarchy,
      
    }));
  }

  async updateLevel(
    id: string,
    levelData: Partial<Levels>,
    updatedBy: string,
  ): Promise<Levels> {
    const level = await this.levelsRepository.findOne({
      where: { id },
      
    });

    if (!level) {
      throw new Error(`Level with id ${id} not found`);
    }

    const oldData = { ...level };

   Object.assign(level, levelData);
    const updatedLevel = await this.levelsRepository.save(level);
    return updatedLevel;
  }

  async findOneWithPermissions(id: string): Promise<any> {
    return this.levelsRepository.findOne({
      where: { id },
      relations: [
        'permissions',
        'permissions.documentDefinition',
        'department',
      ],
    });
  }

  
}
