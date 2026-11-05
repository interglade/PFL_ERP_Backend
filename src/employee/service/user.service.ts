import { id, inject, injectable } from 'inversify';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { merge } from 'lodash';

dotenv.config();
import config from 'config';

import { EmployeeStatus, Role, User } from '../entity/user.entity';
import { signJwt } from '../../utils/jwt';

import { DataSource, ILike, In } from 'typeorm';



import AppError from '../../utils/appError';

import { UserRepository } from '../repository/user.repository';
import { RoleRepository } from '../../sse/role.repository';
import { TYPES } from '../../types';

import { buildQuery, PaginationOptions } from '../../utils/pagination';

import { formatDateTime } from '../../utils/dateUtils';
import { CompanyRepository } from '../../company/repository/company.repository';
import { Department } from '../../utils/status.enum';

import { WorkflowHierarchyRepository } from '../../workFlow/repository/WorkflowHierarchy.repository';

import logger from '../../utils/logger';
import {
  CreateUserDto,
  UpdateUserDto,
  UserListResponseDto,
  UserViewResponseDto,
  UserUpdateFormDto,
  UserPartialResponseDto,
} from '../dto/user.dto';
import { AddressRepository } from '../../address/repository/address.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { BranchessRepository } from '../../branch/repository/branches.repository';
import { AddressService } from '../../address/service/address.service';
import { CacheService } from '../../global/cache.service';
import { Address } from '../../address/entity/address.entity';
import { Company } from '../../company/entity/company.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { DocumentDefinition, DocumentTypeEnum } from '../../documentDef/entity/documentdef.entity';
import { DocumentPermission } from '../entity/permission.entity';
import { normalizeRoles } from '../../utils/roles';
import { nextEmployeeIds } from '../employeeIds';
import { CONTACT_FIELDS, CONTACT_LABELS, ContactField, ContactOwner, findContactClashes } from '../employeeContacts';
import { PERMISSION_TICKED_SQL } from '../employeePermissions';

const CACHE_PREFIX = 'user';
const CACHE_TTL = 300; // 5 minutes

interface Tokens {
  access_token: string;
  refresh_token: string;
}

@injectable()
export class UserService {
  private roleRepository: RoleRepository;

  private addressRepository: AddressRepository;

  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.BranchessRepository)
    private readonly branchRepository: BranchessRepository,
    @inject(TYPES.AddressService) private addressService: AddressService,
    @inject(TYPES.CompanyRepository)
    private readonly companyRepository: CompanyRepository,
    @inject(TYPES.WorkflowHierarchyRepository)
    private readonly workflowHierarchyRepository: WorkflowHierarchyRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {
    this.addressRepository = this.dataSource.getRepository(
      Address,
    ) as AddressRepository;
  }

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:filter:*`),
      this.cacheService.del(`${CACHE_PREFIX}:count`),
    ];
    if (id) {
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:id:${id}`));
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:view:${id}`));
      tasks.push(this.cacheService.del(`${CACHE_PREFIX}:update:${id}`));
    }
    await Promise.all(tasks);
  }

  private generateRandomPassword(length: number = 10): string {
    const charset =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&';
    let password = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      password += charset[randomIndex];
    }

    return password;
  }

  async createUser(input: CreateUserDto & Record<string, any>): Promise<User> {
    let employeeId = await this.generateEmployeeId();

    input.tempPlainPassword = this.generateRandomPassword();

    let accessLocationEntities: any[] = [];

    if (input.accessLocation && input.accessLocation.length > 0) {
      accessLocationEntities = await this.branchRepository.findBy({
        id: In(input.accessLocation),
      });
    }
    
    let companyEntities: any[] = [];
    if (input.companyName && input.companyName.length > 0) {
      companyEntities = await this.companyRepository.findBy({
        id: In(input.companyName),
      });
    }
// Handle roles: EMPLOYEE always, SUPER_ADMIN implies ADMIN
const roles: Role[] = normalizeRoles(input.roles);

    // Handle departments — accepts both 'departments' (array) and 'department' (array or string)
    // Normalises to lowercase so 'HR', 'hr', 'Hr' all match
    let departments: Department[] = [];
    const rawDepts: any[] = input.departments?.length
      ? input.departments
      : Array.isArray(input.department)
      ? input.department
      : input.department
      ? [input.department]
      : [];

    if (rawDepts.length > 0) {
      departments = rawDepts
        .map((d: any) => (typeof d === 'string' ? d.toLowerCase().trim() : d))
        .filter((d: string) => Object.values(Department).includes(d as Department)) as Department[];
    }

    // The form has no draft save: Submit creates the user Inactive, like the Excel import
    // (docs/user-import-plan.md D2). The admin sets permissions, then activates.
    const resolvedStatus = EmployeeStatus.INACTIVE;

    const user = this.userRepository.create({
      ...input,
      employeeId,
      status: resolvedStatus,
      accessLocation: accessLocationEntities,
      companyName: companyEntities,
      roles: roles,
      department: departments,
    } as any);

    const saved = await this.userRepository.save(user as any) as User;
    await this.invalidateCache();
    return saved;
  }
  async submitEmployee(
    employeeId: string,
    employeeData: Record<string, any> = {},
  ): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: employeeId },
      relations: ['permanentAddress', 'residentialAddress'],
    });
    if (!user) throw new AppError(404, 'Employee not found');

    // Set status to Inactive (submitted for admin review — equivalent to "pending")
    user.status = EmployeeStatus.INACTIVE;

    // Scalar fields allowed to be updated on submit
    const scalarFields = [
      'firstName', 'middleName', 'lastName',
      'primaryMobNo', 'secondaryMobNo',
      'primaryEmail', 'secondaryEmail', 'workEmail',
      'cugNo', 'designation', 'joiningDate',
      'gender', 'dob', 'username',
    ];

    for (const field of scalarFields) {
      if (employeeData[field] !== undefined && employeeData[field] !== null && employeeData[field] !== '') {
        (user as any)[field] = employeeData[field];
      }
    }

    // Handle nested address objects (sent as JSON string in multipart/form-data)
    const parseIfString = (val: any): any => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    const permanentAddressData = parseIfString(employeeData.permanentAddress);
    if (permanentAddressData && typeof permanentAddressData === 'object') {
      Object.assign(user.permanentAddress ??= {} as Address, permanentAddressData);
    }

    const residentialAddressData = parseIfString(employeeData.residentialAddress);
    if (residentialAddressData && typeof residentialAddressData === 'object') {
      Object.assign(user.residentialAddress ??= {} as Address, residentialAddressData);
    }

    const saved = await this.userRepository.save(user as any) as User;
    await this.invalidateCache(employeeId);
    return saved;
  }

  async updateStatus(id: string, status: EmployeeStatus) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new Error('User not found');
    }
    user.status = status;
    const saved = await this.userRepository.save(user);
    await this.invalidateCache(id);
    return saved;
  }
  /** `permissions: 'notSet'` lists only the users without any permission tick (after an import). */
  async getAllUsers(
    queryOptions: PaginationOptions,
    userId?: string,
    filter: { permissions?: 'set' | 'notSet' } = {},
  ): Promise<UserListResponseDto> {
    const key = `${CACHE_PREFIX}:list:${userId ?? 'all'}:${JSON.stringify(queryOptions)}:${filter.permissions ?? ''}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.permanentAddress', 'permanentAddress')
      .leftJoin('user.residentialAddress', 'residentialAddress')
      .leftJoin('user.joiningLocation', 'joiningLocation')
      .leftJoin('user.joiningOffice', 'joiningOffice')
      .leftJoin('user.currentWorkLocation', 'currentWorkLocation')
      .leftJoin('user.currentOfficeLocation', 'currentOfficeLocation')
      .leftJoin('user.accessLocation', 'accessLocation')
      .select([
        'user.id', 'user.firstName', 'user.middleName', 'user.lastName',
        'user.username', 'user.primaryMobNo', 'user.secondaryMobNo',
        'user.primaryEmail', 'user.secondaryEmail', 'user.joiningDate',
        'user.cugNo', 'user.workEmail', 'user.employeeId', 'user.status',
        'user.tempPlainPassword', 'user.createdAt',
        'permanentAddress.id', 'permanentAddress.address1', 'permanentAddress.address2',
        'permanentAddress.location', 'permanentAddress.city', 'permanentAddress.state', 'permanentAddress.pincode',
        'residentialAddress.id', 'residentialAddress.address1', 'residentialAddress.address2',
        'residentialAddress.location', 'residentialAddress.city', 'residentialAddress.state', 'residentialAddress.pincode',
        'joiningLocation.id', 'joiningLocation.name',
        'joiningOffice.id', 'joiningOffice.name',
        'currentWorkLocation.id', 'currentWorkLocation.name',
        'currentOfficeLocation.id', 'currentOfficeLocation.name',
        'accessLocation.id', 'accessLocation.name',
      ])
      .orderBy('user.createdAt', 'DESC');

    if (filter.permissions) {
      const ticked =
        `EXISTS (SELECT 1 FROM document_permissions dp WHERE dp."employeeId" = "user"."id" ` +
        `AND dp."deletedAt" IS NULL AND ${PERMISSION_TICKED_SQL('dp')})`;
      queryBuilder.andWhere(filter.permissions === 'set' ? ticked : `NOT ${ticked}`);
    }

    const { meta, data } = await buildQuery(queryBuilder, queryOptions, 'user');

    const withPermissions = new Set<string>();
    if (data.length) {
      const rows: { id: string }[] = await this.dataSource
        .getRepository(DocumentPermission)
        .createQueryBuilder('p')
        .select('DISTINCT p."employeeId"', 'id')
        .where('p."employeeId" IN (:...ids)', { ids: data.map((user) => user.id) })
        .andWhere(PERMISSION_TICKED_SQL('p'))
        .getRawMany();
      rows.forEach((row) => withPermissions.add(row.id));
    }

    const mapAddress = (address: any): any =>
      address
        ? {
            id: address.id,
            address1: address.address1,
            address2: address.address2,
            location: address.location,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
          }
        : null;

    const users = data.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      username: user.username,
      primaryMobNo: user.primaryMobNo,
      secondaryMobNo: user.secondaryMobNo,
      primaryEmail: user.primaryEmail,
      secondaryEmail: user.secondaryEmail,
      joiningDate: user.joiningDate,
      cugNo: user.cugNo,
      workEmail: user.workEmail,
      employeeId: user.employeeId,
      status: user.status,
      password: user.tempPlainPassword,
      permissionsSet: withPermissions.has(user.id),
      accessLocation: user.accessLocation.map((location: any) => location.name),
      permanentAddress: mapAddress(user.permanentAddress),
      residentialAddress: mapAddress(user.residentialAddress),
      joiningLocation: user.joiningLocation
        ? user.joiningLocation.name
        : user.joiningOffice
        ? user.joiningOffice.name
        : null,
      currentWorkLocation: user.currentWorkLocation
        ? user.currentWorkLocation.name
        : user.currentOfficeLocation
        ? user.currentOfficeLocation.name
        : null,
    }));

    const formatted = { data: users, meta };
    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }


  async findUserById(userId: string): Promise<UserViewResponseDto> {
    const key = `${CACHE_PREFIX}:id:${userId}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: [
        'permanentAddress',
        'companyName',
        'residentialAddress',
        'permissions',
        'permissions.documentDefinition',
        'joiningLocation',
        'joiningOffice',
        'currentOfficeLocation',
        'currentWorkLocation',
        'accessLocation',
      ],
    });
    if (!user) {
      throw new AppError(404, `User with ID ${userId} not found`);
    }
    const formatted = this.mapToUserDTO(user);
    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  async findUserByIdForUpdate(userId: string): Promise<UserUpdateFormDto> {
    const key = `${CACHE_PREFIX}:update:${userId}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: [
        'permanentAddress',
        'companyName',
        'residentialAddress',
        'permissions',
        'permissions.documentDefinition',
        'joiningLocation',
        'joiningOffice',
        'currentOfficeLocation',
        'currentWorkLocation',
        'accessLocation',
      ],
    });
    if (!user) {
      throw new AppError(404, `User with ID ${userId} not found`);
    }
    const formatted = this.mapToUser(user);
    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  private mapToUser(user: User): UserUpdateFormDto {
    const mapAddress = (address: any): any =>
      address
        ? {
            id: address.id,
            address1: address.address1,
            address2: address.address2,
            location: address.location,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
          }
        : null;

    const mapBasicUser = (u: User): any => u.id;
    const rawDate = user.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);

    return {
      id: user.id,
      createdDate,
      createdTime,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      username: user.username,
      primaryMobNo: user.primaryMobNo,
      secondaryMobNo: user.secondaryMobNo,
      primaryEmail: user.primaryEmail,
      secondaryEmail: user.secondaryEmail,
      joiningDate: user.joiningDate,
      designation: user.designation,
      cugNo: user.cugNo,
      otherWorkLocationInput: user.otherWorkLocationInput,
      workEmail: user.workEmail,
isAddressSame: user.isAddressSame,
      employeeId: user.employeeId,
      status: user.status,

      joiningLocation: user.joiningLocation?.id
        ? user.joiningLocation.id
        : user.joiningOffice?.id
        ? user.joiningOffice.id
        : null,

      currentWorkLocation: user.currentWorkLocation?.id
        ? user.currentWorkLocation.id
        : user.currentOfficeLocation?.id
        ? user.currentOfficeLocation.id
        : null,

      accessLocation: user.accessLocation.map((location) => location.id),

      companyName: user.companyName?.map((company) => company.id) || [],

      roles: user.roles || [],

      department: Array.isArray(user.department) ? user.department : [],
      permanentAddress: mapAddress(user.permanentAddress),
      residentialAddress: mapAddress(user.residentialAddress),

      //permissions: user.permissions.map((perm) => perm.id),
      permissions: user.permissions.map((perm) => ({
        id: perm.id,
        documentDefinition: perm.documentDefinition?.id,
        canCreate: perm.canCreate,
        canView: perm.canView,
        canEdit: perm.canEdit,
        canDelete: perm.canDelete,
        canDownload: perm.canDownload,
        canExport: perm.canExport,
      })),
    };
  }
  async findUserByIdForView(userId: string): Promise<UserViewResponseDto> {
    const key = `${CACHE_PREFIX}:view:${userId}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: [
        'permanentAddress',
        'companyName',
        'residentialAddress',
        'permissions',
        'permissions.documentDefinition',
        'joiningLocation',
        'joiningOffice',
        'currentOfficeLocation',
        'currentWorkLocation',
        'accessLocation',
      ],
    });
    if (!user) {
      throw new AppError(404, `User with ID ${userId} not found`);
    }
    const formatted = this.mapToUserDTO(user);
    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }

  private mapToUserDTO(user: User): UserViewResponseDto {
    const mapAddress = (address: Address): any => ({
      id: address?.id,
      address1: address?.address1,
      address2: address?.address2,
      location: address?.location,
      city: address?.city,
      state: address?.state,
      pincode: address?.pincode,
    });

    const mapBasicUser = (u: User): any => ({
      id: u.id,
      firstName: u.firstName,
      middleName: u.middleName,
      lastName: u.lastName,
      employeeId: u.employeeId,
      status: u.status,
    });

    return {
      id: user.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      username: user.username,
      primaryMobNo: user.primaryMobNo,
      secondaryMobNo: user.secondaryMobNo,
      primaryEmail: user.primaryEmail,
      secondaryEmail: user.secondaryEmail,
      joiningDate: user.joiningDate,
      designation: user.designation,
      cugNo: user.cugNo,
      otherWorkLocationInput: user.otherWorkLocationInput,
      workEmail: user.workEmail,
isAddressSame:user.isAddressSame,
      employeeId: user.employeeId,
      status: user.status,

      joiningLocation: user.joiningLocation?.name
        ? user.joiningLocation.name
        : user.joiningOffice?.name
        ? user.joiningOffice.name
        : null,

      currentWorkLocation: user.currentWorkLocation?.name
        ? user.currentWorkLocation.name
        : user.currentOfficeLocation?.name
        ? user.currentOfficeLocation.name
        : null,

      accessLocation: user.accessLocation.map((location) => location.name),
      companyName: user.companyName?.map((company) => company.name),
      roles: user.roles,
      department: user.department,
      //currentLevel: user.currentLevel ? mapBasicUser(user.currentLevel) : null,

      permanentAddress: mapAddress(user.permanentAddress),
      residentialAddress: mapAddress(user.residentialAddress),

      permissions: user.permissions.map((perm) => ({
        id: perm.id,
        canCreate: perm.canCreate,
        canView: perm.canView,
        canEdit: perm.canEdit,
        canDelete: perm.canDelete,
        canDownload: perm.canDownload,
        canExport: perm.canExport,
        documentDefinition: perm.documentDefinition?.id,
        // documentDefinition: {
        //   id: perm.documentDefinition?.id,
        //   uniqueKey: perm.documentDefinition?.uniqueKey,
        //   name: perm.documentDefinition?.name,
        //   documentType: perm.documentDefinition?.documentType,
        // },
      })),
    };
  }

  async findUserByEmail(email: string): Promise<any> {
    return this.userRepository.findOne({
      where: { workEmail: email },
    });
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      return false;
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    

    user.deletionScheduledAt = sixMonthsFromNow;

    await this.userRepository.save(user);

    await this.invalidateCache(id);
    return true;
  }


  async updateUser(id: string, userData: UpdateUserDto & Record<string, any>, updatedBy: string): Promise<User | null> {
    
    const user = await this.userRepository.findOne({
      where: { id },
      relations: [
        "permanentAddress",
        "companyName",
        "residentialAddress",
        "permissions",
        "permissions.documentDefinition",
        "joiningLocation",
        "joiningOffice",
        "currentOfficeLocation",
        "currentWorkLocation",
        "accessLocation",
      ],
    });

    if (!user) {
      throw new AppError(404, "User not found");
    }

    // Store original user for audit log
    const originalUser = { ...user };

    // Handle access locations
    if (userData.accessLocation !== undefined) {
      if (typeof (userData as any).accessLocation === 'string') {
        try {
          (userData as any).accessLocation = JSON.parse((userData as any).accessLocation);
        } catch (e) {
          logger.warn("Failed to parse accessLocation string, treating as single ID");
          (userData as any).accessLocation = [(userData as any).accessLocation];
        }
      }
      
      if (Array.isArray(userData.accessLocation) && userData.accessLocation.length > 0) {
        const accessLocationEntities = await this.branchRepository.findBy({
          id: In(userData.accessLocation),
        });
        user.accessLocation = accessLocationEntities;
      } else {
        user.accessLocation = [];
      }
      delete userData.accessLocation;
    }

    // Handle company names
    if (userData.companyName !== undefined) {
      if (typeof (userData as any).companyName === 'string') {
        try {
          (userData as any).companyName = JSON.parse((userData as any).companyName);
        } catch (e) {
          logger.warn("Failed to parse companyName string, treating as single ID");
          (userData as any).companyName = [(userData as any).companyName];
        }
      }
      
      if (Array.isArray(userData.companyName) && userData.companyName.length > 0) {
        const companyEntities = await this.companyRepository.findBy({
          id: In(userData.companyName),
        });
        user.companyName = companyEntities;
      } else {
        user.companyName = [];
      }
      delete userData.companyName;
    }

    // Handle roles
    if (userData.roles) {
      // EMPLOYEE always, SUPER_ADMIN implies ADMIN
      user.roles = normalizeRoles(userData.roles);
      // Remove from userData to prevent overwriting
      delete userData.roles;
    }

    // Handle date fields that might come as strings
    if (userData.dateOfBirth && typeof userData.dateOfBirth === 'string') {
      userData.dateOfBirth = new Date(userData.dateOfBirth);
    }
    if (userData.joiningDate && typeof userData.joiningDate === 'string') {
      userData.joiningDate = new Date(userData.joiningDate);
    }

    // Handle null values for string fields
    Object.keys(userData).forEach(key => {
      if (userData[key] === 'null' || userData[key] === '') {
        userData[key] = null;
      }
    });

    // Update user with remaining userData
    Object.assign(user, userData);

    const updatedUser = await this.userRepository.save(user);

    await this.auditLogService.logChange(
      "User",
      id,
      originalUser,
      updatedUser,
      updatedBy
    );

    await this.invalidateCache(id);
    return updatedUser;
  }



  /**
   * Employee dropdown list.
   * - `role`: only employees holding that role
   * - `ids`: only these employees (resolves saved selections to names; an empty list returns nobody)
   * - `activeOnly`: only Active employees (the others cannot log in)
   */
  async filterUser(
    options: PaginationOptions,
    criteria: { role?: Role; ids?: string[]; activeOnly?: boolean } = {},
  ): Promise<UserPartialResponseDto> {
    const key = `${CACHE_PREFIX}:filter:${JSON.stringify({ options, criteria })}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.firstName',
        'user.middleName',
        'user.lastName',
        'user.employeeId',
        'user.roles',
      ])
      .orderBy('user.firstName', 'ASC');

    if (criteria.role) {
      queryBuilder.andWhere(':role = ANY(user.roles)', { role: criteria.role });
    }
    if (criteria.ids) {
      if (criteria.ids.length === 0) {
        return { data: [], meta: { total: 0, page: options.page, pages: 0 } };
      }
      queryBuilder.andWhere('user.id IN (:...ids)', { ids: criteria.ids });
    }
    if (criteria.activeOnly) {
      queryBuilder.andWhere('user.status = :active', { active: EmployeeStatus.ACTIVE });
    }

    // Search the whole name ("first middle last" or "first last") and the employee id in SQL,
    // so a search with a space in it matches
    const search = options.search?.trim();
    if (search) {
      queryBuilder.andWhere(
        `(CONCAT_WS(' ', user.firstName, user.middleName, user.lastName) ILIKE :search
          OR CONCAT_WS(' ', user.firstName, user.lastName) ILIKE :search
          OR user.employeeId ILIKE :search)`,
        { search: `%${search}%` },
      );
    }

    const result = await buildQuery(queryBuilder, { ...options, search: '' }, 'user');

    const formattedUsers = result.data.map((user) => ({
      id: user.id,
      fullName: `${user.firstName} ${user.middleName || ''} ${user.lastName}`.trim(),
      employeeId: user.employeeId,
      roles: user.roles || [],
    }));

    const formatted = { ...result, data: formattedUsers };
    await this.cacheService.set(key, formatted, CACHE_TTL);
    return formatted;
  }


  async findUserByIdentifier(uid: string): Promise<User | null> {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uid);
    const isPhoneNumber = /^[+\d][\d\s]+$/.test(uid);
    const isUsername = !isEmail && !isPhoneNumber;

    let user: User | null = null;

    if (isUsername) {
      user = await this.userRepository.findOne({
        where: { username: uid },
        relations: [
          'permissions',
          'permissions.documentDefinition',
          'currentWorkLocation',
          //'currentLevel',
        ],
      });
    } else if (isEmail) {
      user = await this.userRepository.findOne({
        where: { workEmail: uid },
        relations: [
          'permissions',
          'permissions.documentDefinition',
          'currentWorkLocation',
          //'currentLevel',
        ],
      });
    } else if (isPhoneNumber) {
      user = await this.userRepository.findOne({
        where: { primaryMobNo: uid },
        relations: [
          'permissions',
          'permissions.documentDefinition',
          'currentWorkLocation',
          //'currentLevel',
        ],
      });
    }

    return user;
  }

  async signTokens(user: User): Promise<Tokens> {
    const access_token = signJwt({ sub: user.id }, 'accessTokenPrivateKey', {
      expiresIn: `${config.get<number>('accessTokenExpiresIn')}m`,
    });

    const refresh_token = signJwt({ sub: user.id }, 'refreshTokenPrivateKey', {
      expiresIn: `${config.get<number>('refreshTokenExpiresIn')}m`,
    });

    return { access_token, refresh_token };
  }

  async getTotalNumberOfUsers(): Promise<number> {
    const key = `${CACHE_PREFIX}:count`;
    const cached = await this.cacheService.get<number>(key);
    if (cached !== null) return cached;

    const count = await this.userRepository.count();
    await this.cacheService.set(key, count, CACHE_TTL);
    return count;
  }

  /** Highest Employee ID given out so far (deleted users included) + 1; see `nextEmployeeIds`. */
  async generateEmployeeId(): Promise<string> {
    const taken = await this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .select('user.employeeId', 'employeeId')
      .getRawMany<{ employeeId: string | null }>();
    return nextEmployeeIds(taken.map((row) => row.employeeId), 1)[0];
  }

  /**
   * Username, mobiles and emails no other user may hold (docs/user-import-plan.md D7).
   * Only the fields being set - or changed, for an existing user - are checked, so an
   * old clash already in the database does not block unrelated edits. 409 on a clash.
   */
  async assertContactsUnique(values: Partial<Record<ContactField, unknown>>, userId?: string): Promise<void> {
    const others = await this.userRepository.find({
      select: ['id', 'employeeId', 'firstName', 'lastName', 'isDeleted', ...CONTACT_FIELDS],
    });
    const current = userId ? others.find((user) => user.id === userId) : undefined;

    const own: ContactOwner['values'] = {};
    const checked: ContactField[] = [];
    for (const field of CONTACT_FIELDS) {
      const raw = values[field];
      const given = raw === undefined ? undefined : raw === null ? null : String(raw).trim() || null;
      own[field] = given !== undefined ? given : current?.[field];
      if (given && String(given).toLowerCase() !== String(current?.[field] ?? '').trim().toLowerCase()) {
        checked.push(field);
      }
    }
    if (!checked.length) return;

    const owners: ContactOwner[] = others
      .filter((user) => user.id !== userId && !user.isDeleted)
      .map((user) => ({
        key: user.id,
        label: `${user.employeeId ?? ''} ${[user.firstName, user.lastName].filter(Boolean).join(' ')}`.trim(),
        row: null,
        values: user,
        checked: [],
      }));
    owners.push({ key: userId ?? 'new', label: 'this user', row: 0, values: own, checked });

    const clashes = findContactClashes(owners);
    if (clashes.length) {
      throw new AppError(
        409,
        clashes.map((clash) => `${CONTACT_LABELS[clash.property]} "${clash.value}" is already used by ${clash.by}`).join('; '),
      );
    }
  }

  //TODO:New By Vaishali

  resetPasswordLink = async (
    email: string,
    newPassword: string,
    confirmPassword: string,
  ) => {
    try {
      if (newPassword !== confirmPassword) {
        return { status: 400, message: 'Passwords do not match' };
      }
      const user = await this.userRepository.findOneBy({ workEmail: email });
      if (user) {
        user.password = await bcrypt.hash(newPassword, 10);
        user.tempPlainPassword = newPassword; // keep plain for admin visibility
        await this.userRepository.save(user);
        return { status: 200, message: 'Password Reset Successfully' };
      }
      return { status: 404, message: 'User Not Found' };
    } catch (error) {
      return { status: 500, message: 'Internal Server Error', error };
    }
  };

 

  async getWorkflowHierarchy(employeeId: string, options?: PaginationOptions & { department?: string; maxDepth?: number }): Promise<any> {
    // Query to get all workflow hierarchy relationships for the given employee
    // depth = 0 is self-reference, depth > 0 are subordinates
    const qb = this.workflowHierarchyRepository
      .createQueryBuilder('wh')
      .leftJoinAndSelect('wh.descendant', 'descendant')
      .where('wh.ancestor_id = :employeeId', { employeeId })
      .andWhere('wh.depth >= 0') // Include self (depth = 0) + all subordinates
      .orderBy('wh.depth', 'ASC')
      .addOrderBy('descendant.firstName', 'ASC');

    // maxDepth=1: the employee and their direct team only (whom they may create plans for)
    if (options?.maxDepth !== undefined) {
      qb.andWhere('wh.depth <= :maxDepth', { maxDepth: options.maxDepth });
    }

    // Apply department filter at DB level if provided
    if (options?.department) {
      qb.andWhere('wh.department = :department', { department: options.department });
    }

    const hierarchyData = await qb.getMany();

    if (!hierarchyData || hierarchyData.length === 0) {
      return { data: [], meta: { total: 0, page: options?.page, pages: 0 } };
    }

    // Format and deduplicate by employee id (same employee can appear at multiple depths)
    const seen = new Set<string>();
    let formattedHierarchy = hierarchyData.reduce<{
      id: string; fullName: string; employeeId: string; roles: string[]; department: string;
    }[]>((acc, item) => {
      if (!seen.has(item.descendant.id)) {
        seen.add(item.descendant.id);
        acc.push({
          id: item.descendant.id,
          fullName: `${item.descendant.firstName} ${item.descendant.middleName || ''} ${item.descendant.lastName}`.trim(),
          employeeId: item.descendant.employeeId,
          roles: item.descendant.roles || [],
          department: item.department,
        });
      }
      return acc;
    }, []);

    // Apply in-memory search
    if (options?.search && options.search.trim()) {
      const term = options.search.toLowerCase();
      formattedHierarchy = formattedHierarchy.filter((item) =>
        item.fullName.toLowerCase().includes(term) ||
        item.employeeId?.toLowerCase().includes(term)
      );
    }

    const total = formattedHierarchy.length;

    // Apply pagination
    const { page, limit } = options || {};
    let paginatedData = formattedHierarchy;
    if (page && limit) {
      const offset = (page - 1) * limit;
      paginatedData = formattedHierarchy.slice(offset, offset + limit);
    }

    return {
      data: paginatedData,
      meta: {
        total,
        page,
        pages: page && limit ? Math.ceil(total / limit) : 1,
      },
    };
  }

async softDeleteEmployees(userIds: string[]) {
  const result = await this.userRepository.softDelete({
    id: In(userIds)
  });
  await this.invalidateCache();
  return result;
}
  
}


 // updateEmployeeIdRoleCode(employeeId: string, newRoleCode: string): string {
  //   const companyCode = employeeId.slice(2, 4);
  //   const serialNumber = employeeId.slice(-4);

  //   const oldRoleCode = employeeId.charAt(4);

  //   if (oldRoleCode === newRoleCode) {
  //     return employeeId;
  //   }

  //   return `PF${companyCode}${newRoleCode}${serialNumber}`;
  // }


  // async filteruser(queryOptions:PaginationOptions): Promise<any> {
  //   const user = await this.userRepository.find({
  //     //where: { status: 'ACTIVE' },
  //     select: {
  //       id: true,
  //       firstName: true,
  //       middleName: true,
  //       lastName: true,
  //       employeeId: true,
  //     },
  //   });
  //   const formattedUsers = user.map((user) => ({
  //     id: user.id,

  //     fullName: `${user.firstName} ${user.middleName || ''} ${user.lastName}`,

  //     employeeId: user.employeeId,
  //   }));
  //   return formattedUsers;
  // }


  // async updateUser(id: string, userData: any, updatedBy: string): Promise<any> {
  //   const user = await this.userRepository.findOne({
  //     where: { id: id },
  //     relations: [
  //       'permanentAddress',
  //       'companyName',
  //       'residentialAddress',
  //       //'reportingManagers',
  //       //'currentLevel',
  //       'permissions',
  //       // 'reportingManagers.level',
  //       // 'reportingManagers.reportingTo',
  //       'permissions.documentDefinition',
  //       'joiningLocation',
  //       'joiningOffice',
  //       'currentOfficeLocation',
  //       'currentWorkLocation',
  //       'accessLocation',
  //     ],
  //   });
  //   if (!user) {
  //     throw new AppError(404, 'User not found');
  //   }

  //   // Step 1: Nullify OneToOne relations if they are being updated
  //   const needsNullUpdate =
  //     userData.joiningLocation !== undefined ||
  //     userData.joiningOffice !== undefined ||
  //     userData.currentWorkLocation !== undefined ||
  //     userData.currentOfficeLocation !== undefined;

  //   if (needsNullUpdate) {
  //     user.joiningLocation = null;
  //     user.joiningOffice = null;
  //     user.currentWorkLocation = null;
  //     user.currentOfficeLocation = null;
  //     await this.userRepository.save(user);
  //   }

  //   // Step 2: Reassign updated values
  //   if (userData.joiningLocation !== undefined) {
  //     user.joiningLocation = userData.joiningLocation;
  //   }

  //   if (userData.joiningOffice !== undefined) {
  //     user.joiningOffice = userData.joiningOffice;
  //   }

  //   if (userData.currentWorkLocation !== undefined) {
  //     user.currentWorkLocation = userData.currentWorkLocation;
  //   }

  //   if (userData.currentOfficeLocation !== undefined) {
  //     user.currentOfficeLocation = userData.currentOfficeLocation;
  //   }

  //   const originalUser = { ...user };

  //   Object.assign(user, userData);

  //   const updatedUser = await this.userRepository.save(user);

  //   await this.auditLogService.logChange(
  //     'User',
  //     id,
  //     originalUser,
  //     updatedUser,
  //     updatedBy,
  //   );

  //   return updatedUser;
  // }

