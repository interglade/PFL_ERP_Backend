import {
    EventSubscriber,
    EntitySubscriberInterface,
    UpdateEvent,
    DataSource,
  } from 'typeorm';
// Keep the subscriber independent of the service's module path. The service is
// supplied by the application's dependency-injection container at runtime.
interface AuditLogService {
  logChange(
    entityName: string,
    entityId: unknown,
    databaseEntity: unknown,
    changes: Record<string, { oldValue: any; newValue: any }>,
    updatedBy: unknown,
  ): Promise<void>;
}

  
  @EventSubscriber()
  export class UpdateSubscriber implements EntitySubscriberInterface {
    constructor(private readonly auditLogService: AuditLogService) {}
  
    // This method tells TypeORM to listen to all entities
    listenTo() {
      return Object;  // Listen to all entities
    }
  
    // After an update event, track changes and log them
    async afterUpdate(event: UpdateEvent<any>): Promise<void> {
      if (event.entity && event.databaseEntity) {
        const entityName = event.metadata.name;
        const entityId = event.entity.id;
  
        const changes: Record<string, { oldValue: any; newValue: any }> = {};
  
        // Compare old and new values for each updated column
        for (const column of event.updatedColumns) {
          if (event.databaseEntity[column.propertyName] !== event.entity[column.propertyName]) {
            changes[column.propertyName] = {
              oldValue: event.databaseEntity[column.propertyName],
              newValue: event.entity[column.propertyName],
            };
          }
        }
  
        // If changes are detected, log them
        if (Object.keys(changes).length > 0) {
          const updatedBy = event.queryRunner?.data?.updatedBy || 'Unknown';  // Capture the user who made the change
          await this.auditLogService.logChange(entityName, entityId, event.databaseEntity, changes, updatedBy);
        }
      }
    }
  }
  