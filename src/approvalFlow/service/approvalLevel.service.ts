import { inject, injectable } from "inversify";

import { TYPES } from "../../types";
import { UserRepository } from "../../employee/repository/user.repository";
import { Department } from "../../utils/status.enum";
import logger from "../../utils/logger";
import { ApprovalLevelRepository } from "../repository/approvalLevel.repository";

@injectable()
export class ApprovalLevelService {
  constructor(
    @inject(TYPES.ApprovalLevelRepository) private approvalLevelRepository: ApprovalLevelRepository,
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
  ) {}

  /**
   * OBSOLETE — retained so the GET /approval route keeps responding.
   *
   * This method belongs to the old approval model, where `approval_levels`
   * carried `employee`, `department` and `isCompleted` columns. That model was
   * replaced (commit 6633b43) by ApprovalFlow -> ApprovalLevel -> ApproverBlock,
   * where an ApprovalLevel holds up to six approver blocks and each block holds
   * its users. There is no longer any column on ApprovalLevel to store an
   * employee, a department or a completion flag.
   *
   * The previous implementation still assigned those three properties. Because
   * the app runs under `ts-node-dev --transpile-only` the type errors were never
   * surfaced, and at runtime the assignments were simply ignored by TypeORM —
   * so every call inserted a blank row into `approval_levels` and its
   * "already exists" lookup (`where: { id: employee.id }`) could never match.
   *
   * It now logs and returns without writing anything, so it no longer creates
   * junk rows. Approval levels are configured through ApprovalFlowService.
   *
   * NOTE: the controller calls this without `await`, so this must not throw —
   * an unhandled rejection there would take the process down.
   */
  async createApprovalLevelForEmployee(
    employeeId: string,
    department: Department,
    level: number,
  ): Promise<void> {
    const employee = await this.userRepository.findOne({ where: { id: employeeId } });

    if (!employee) {
      logger.error(`Approval level not created: employee not found for ID ${employeeId}`);
      return;
    }

    logger.error(
      "createApprovalLevelForEmployee is obsolete and did nothing. " +
        "ApprovalLevel no longer stores employee/department/isCompleted — " +
        "configure approvers via ApprovalFlowService instead.",
      { employeeId, department, level },
    );
  }
}
