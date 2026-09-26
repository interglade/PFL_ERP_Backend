import { inject, injectable } from "inversify";

import { TYPES } from "../../types";

import AppError from "../../utils/appError";

import { buildQuery, PaginationOptions } from "../../utils/pagination";
import { LaborAttendancesRepository } from "../repository/labourAttendances.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { LaborAttendance } from "../entity/laborattendance.entity";

@injectable()
export class LaborAttendancesService {


constructor(
    @inject(TYPES.LaborAttendancesRepository)
    private laborAttendanceRepository: LaborAttendancesRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService
  ) {}

  public async getAllAttendances(queryOptions:PaginationOptions): Promise<any> {
    let queryBuilder= await this.laborAttendanceRepository.createQueryBuilder("laborAttendance")
    .leftJoinAndSelect("laborAttendance.labourDetails", "labourDetails")
    .orderBy("laborAttendance.date", "DESC")

    const result = await buildQuery(queryBuilder, queryOptions,"laborAttendance");
    return result;
  }

  public async getAttendanceById(id: string): Promise<LaborAttendance | null> {
    return this.laborAttendanceRepository.findOne({
      where: { id },
      relations: ["labourDetails"],
    });
  }
  public async createAttendance(attendanceData: any): Promise<any> {
   
  

  // Assign the laborDetails to the attendance object
  //attendanceData.laborDetails = laborDetails;
    const attendance = this.laborAttendanceRepository.create(attendanceData);
    
    return this.laborAttendanceRepository.save(attendance);
  }
  public async updateAttendance(
    id: string,
    attendanceData: Partial<LaborAttendance>,
    updatedBy: string
  ): Promise<LaborAttendance | null> {
    // Find the existing attendance record
    const attendance = await this.laborAttendanceRepository.findOne({ where: { id } });

    if (!attendance) return null;

    // Store the original data for audit logging
    const originalAttendance = { ...attendance };

    // Apply updates
    Object.assign(attendance, attendanceData);

    // Save the updated attendance
    const updatedAttendance = await this.laborAttendanceRepository.save(attendance);

    // Log the changes
    await this.auditLogService.logChange(
      "LaborAttendance", // Entity name
      id,                // Entity ID
      originalAttendance, // Original data
      updatedAttendance, // Updated data
      updatedBy          // User who made the update
    );

    return updatedAttendance;
  }


 // Delete an Attendance with scheduled deletion (6 months)
async deleteAttendance(id: string): Promise<boolean> {
  const attendance = await this.laborAttendanceRepository.findOne({ where: { id } });

  if (!attendance) {
    throw new AppError(404, `Attendance with ID ${id} not found`);
  }

  // Calculate the date 6 months ahead
  const now = new Date();
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
  sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)
  

  // Set the deletionScheduledAt field for the attendance
  attendance.deletionScheduledAt = sixMonthsFromNow;

  // Save the updated attendance with the scheduled deletion date
  await this.laborAttendanceRepository.save(attendance);

  return true;
}

 
}