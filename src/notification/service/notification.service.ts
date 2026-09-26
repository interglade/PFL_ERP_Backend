import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';

import { SSEService } from '../../sse/sse.service';

import logger from '../../utils/logger';
import ExcelJS from 'exceljs';
import { NotificationRepository } from '../repository/notification.repository';
import { Notification } from '../entity/notifications.entity';
import { UserService } from '../../employee/service/user.service';
import { UserRepository } from '../../employee/repository/user.repository';
import { Role } from '../../employee/entity/user.entity';


@injectable()
export class NotificationService {
  constructor(
    @inject(TYPES.NotificationRepository)
    private readonly notificationRepository: NotificationRepository,
    @inject(TYPES.UserService)
    private readonly userService: UserService,
    @inject(TYPES.UserRepository)
    private readonly userRepository: UserRepository,
    @inject(TYPES.SSEService)
    private readonly sseService: SSEService,
  ) {}

  async createNoti(message: string, userId: string): Promise<void> {
    try {
      if (!message || !userId) return;

      // Deduplicate: skip if an identical notification was saved in the last 30 seconds.
      // 5s was too short — React StrictMode double-mounts + SSE reconnect on login
      // can stretch the overlap beyond 5s, causing duplicate DB records and
      // multiple "Login successfully" toasts on the frontend.
      const thirtySecondsAgo = new Date(Date.now() - 30000);
      const recent = await this.notificationRepository
        .createQueryBuilder('n')
        .leftJoin('n.user', 'u')
        .where('n.message = :message', { message })
        .andWhere('u.id = :userId', { userId })
        .andWhere('n.createdAt >= :since', { since: thirtySecondsAgo })
        .getOne();

      if (recent) {
        logger.info(`createNoti deduplicated for user ${userId}: "${message}"`);
        return;
      }

      // Save to DB first — ensures the record exists before SSE pushes
      // so frontend fetch-on-connect always sees a consistent state.
      await this.saveNotificationToDb(message, userId);

      // Send SSE only after DB save — avoids race condition where frontend
      // fetches notifications before the DB write has committed.
      if (this.sseService.isUserConnected(userId)) {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        let hours = now.getHours();
        const minutes = pad(now.getMinutes());
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;

        this.sseService.sendToUser(userId, {
          type: 'notification',
          message,
          date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
          time: `${pad(hours)}:${minutes} ${ampm}`,
          isRead: false,
          userId,
          timestamp: now.toISOString(),
        });
      }

    } catch (error) {
      logger.error(`createNoti failed for user ${userId}:`, error);
    }
  }

  public async saveNotificationToDb(message: string, userId: string): Promise<void> {
    const notification = this.notificationRepository.create({
      message,
      user: { id: userId } as any,
    });
    await this.notificationRepository.save(notification);
  }

  async getAllNoti(): Promise<any> {
    const rawNotifications = await this.notificationRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.user', 'user')
      // .where('user.id = :userId', { userId })
      .select(['notification.id', 'notification.message', 'user.id'])
      .orderBy('notification.createdAt', 'ASC')
      .getRawMany();

    return rawNotifications.map((item) => ({
      id: item.notification_id,
      message: item.notification_message,
      user: item.user_id,
    }));
  }

  //TODO:By Vaishali..get all nottification by user
  async getNotiByUserId(userId: string): Promise<any> {
    const rawNotifications = await this.notificationRepository
      .createQueryBuilder('notification')
      .leftJoin('notification.user', 'user')
      .where('user.id = :userId', { userId })
      .orderBy('notification.createdAt', 'ASC')
      .select([
        'notification.id',
        'notification.message',
        'notification.isRead',
        'notification.createdAt',
      ])
      .getRawMany();

    return rawNotifications.map((item) => {
      const createdAt = item.notification_createdAt as Date;

      // Pad helper
      const pad = (n: number) => n.toString().padStart(2, '0');

      // Date part yyyy-mm-dd
      const year = createdAt.getFullYear();
      const month = pad(createdAt.getMonth() + 1);
      const day = pad(createdAt.getDate());
      const formattedDate = `${year}-${month}-${day}`;

      // Time part hh:mm AM/PM
      let hours = createdAt.getHours();
      const minutes = pad(createdAt.getMinutes());
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // hour '0' should be '12'
      const formattedTime = `${pad(hours)}:${minutes} ${ampm}`;

      return {
        id: item.notification_id,
        message: item.notification_message,
        date: formattedDate,
        time: formattedTime,
        isRead: item.notification_isRead,
      };
    });
  }



  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository
      .createQueryBuilder()
      .update()
      .set({ isRead: true })
      .where('user_id = :userId AND "isRead" = false', { userId })
      .execute();
  }

  // Batch notification for multiple users — optimized for performance
  async createBatchNoti(message: string, userIds: string[]): Promise<void> {
    if (!message || !userIds || userIds.length === 0) return;

    try {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      let hours = now.getHours();
      const minutes = pad(now.getMinutes());
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;

      const formattedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const formattedTime = `${pad(hours)}:${minutes} ${ampm}`;

      const ssePayload = {
        type: 'notification',
        message,
        date: formattedDate,
        time: formattedTime,
        isRead: false,
        timestamp: now.toISOString(),
      };

      // Send SSE to all connected users immediately (non-blocking)
      for (const userId of userIds) {
        if (this.sseService.isUserConnected(userId)) {
          this.sseService.sendToUser(userId, { ...ssePayload, userId });
        }
      }

      // Save to DB in background (non-blocking)
      this.saveBatchNotificationsToDb(message, userIds).catch((err) =>
        logger.error(`createBatchNoti DB save failed:`, err)
      );

    } catch (error) {
      logger.error(`createBatchNoti failed:`, error);
    }
  }

  /**
   * Send a notification to every user who holds the given role.
   * Uses a direct raw query on the injected userRepository — avoids the
   * .extend() limitation where custom methods are not available at runtime.
   */
  async createNotiForRole(message: string, role: Role): Promise<void> {
    try {
      // Raw SQL — safe because `role` is a trusted enum value, not user input
      const rows: Array<{ id: string }> = await this.userRepository.query(
        `SELECT id FROM employees WHERE $1::employees_roles_enum = ANY(roles)`,
        [role],
      );
      const userIds = rows.map((r) => r.id);
      logger.info(`createNotiForRole: found ${userIds.length} user(s) with role "${role}"`);
      if (userIds.length === 0) return;

      await Promise.all(userIds.map((id) => this.createNoti(message, id)));
    } catch (error) {
      logger.error(`createNotiForRole failed for role "${role}":`, error);
    }
  }

  private async saveBatchNotificationsToDb(message: string, userIds: string[]): Promise<void> {
    const notifications = userIds.map(userId =>
      this.notificationRepository.create({ message, user: { id: userId } as any })
    );
    await this.notificationRepository.save(notifications);
  }

  async exportToExcel(): Promise<Buffer> {
    const notifications = await this.notificationRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.user', 'user')
      .select([
        'notification.id',
        'notification.message',
        'notification.createdAt',
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.username',
      ])
      .orderBy('notification.createdAt', 'ASC')
      .getMany();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Notifications');

    sheet.columns = [
      { header: 'Sr. No.',    key: 'srNo',      width: 10 },
      { header: 'Created At', key: 'createdAt', width: 22 },
      { header: 'User ID',    key: 'userId',    width: 38 },
      { header: 'Username',   key: 'username',  width: 25 },
      { header: 'Message',    key: 'message',   width: 50 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2E75B6' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 20;

    const pad = (n: number) => n.toString().padStart(2, '0');

    notifications.forEach((noti, index) => {
      const createdAt = noti.createdAt ? new Date(noti.createdAt) : null;
      let formattedDate = '';
      if (createdAt && !isNaN(createdAt.getTime())) {
        const year  = createdAt.getFullYear();
        const month = pad(createdAt.getMonth() + 1);
        const day   = pad(createdAt.getDate());
        let hours   = createdAt.getHours();
        const mins  = pad(createdAt.getMinutes());
        const ampm  = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        formattedDate = `${year}-${month}-${day} ${pad(hours)}:${mins} ${ampm}`;
      }

      const fullName = noti.user
        ? `${noti.user.firstName ?? ''} ${noti.user.lastName ?? ''}`.trim()
        : '';
      const username = noti.user?.username ?? fullName;

      sheet.addRow({
        srNo:      index + 1,
        createdAt: formattedDate,
        userId:    noti.user?.id ?? '',
        username,
        message:   noti.message,
      });
    });

    sheet.getColumn('message').alignment = { wrapText: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }
}


  // async markAsRead(notificationId: string, userId: string): Promise<void> {
  //   await this.notificationRepository
  //     .createQueryBuilder()
  //     .update()
  //     .set({ isRead: true })
  //     .where('id = :notificationId AND user_id = :userId', { notificationId, userId })
  //     .execute();
  // }

