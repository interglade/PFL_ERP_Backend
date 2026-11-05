
import bcrypt from "bcryptjs";
import { EmployeeStatus, Role, User } from "./employee/entity/user.entity";
import { normalizeRoles } from "./utils/roles";
import { AppDataSource } from "./utils/data-source";
import { CreateUserDto } from "./employee/dto/user.dto";
import { container } from "./inversify.config";
import { UserService } from "./employee/service/user.service";
import { TYPES } from "./types";
import { seedDocumentDefDatabase } from "./seed/documentSeed";

export async function seedAdmin() {
  const userService = container.get<UserService>(TYPES.UserService);

  try {
    const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    const adminPhone = process.env.SEED_ADMIN_PHONE || "0000000000";

    if (!adminPassword) {
      console.warn("[Seed] SEED_ADMIN_PASSWORD not set in .env — skipping admin seed.");
      return;
    }

    const existingAdmin = await userService.findUserByEmail(adminEmail);
    if (!existingAdmin) {
      const employeeId = await userService.generateEmployeeId();

      // Typed so the seed payload is checked against the real DTO, and so
      // `status` keeps its literal type instead of widening to `string`.
      const adminData: CreateUserDto & Record<string, any> = {
        firstName: "Admin",
        lastName: "Admin",
        username: "Admin",
        workEmail: adminEmail,
        primaryEmail: adminEmail,
        password: adminPassword,
        status: EmployeeStatus.ACTIVE,
        primaryMobNo: adminPhone,
        // The seeded account is the first Super Admin (normalizeRoles adds ADMIN)
        roles: [Role.EMPLOYEE, Role.SUPER_ADMIN, Role.ADMIN],
        department: ["admin"],
        joiningDate: new Date("2022-01-12"),
        employeeId: employeeId,
        permanentAddress: {
          address1: "123 Main St",
          address2: "Suite 100",
          location: "City Center",
          city: "Admin City",
          state: "Admin State",
          pincode: "123456",
        },
      };

      try {
        const admin = await userService.createUser(adminData);
        // createUser always starts employees as DRAFT with a random password:
        // activate the Super Admin and give it SEED_ADMIN_PASSWORD (not kept in plain text)
        await AppDataSource.getRepository(User).update(admin.id, {
          status: EmployeeStatus.ACTIVE,
          password: await bcrypt.hash(adminPassword, 12),
          tempPlainPassword: null as any,
        });
        console.log("Admin user created:", admin.id);
      } catch (validationError) {
        console.error("Validation failed:", validationError);
      }
    } else if (!existingAdmin.roles?.includes(Role.SUPER_ADMIN) || existingAdmin.status !== EmployeeStatus.ACTIVE) {
      // Older databases: the seeded admin becomes the first Super Admin and is active
      existingAdmin.roles = normalizeRoles([...(existingAdmin.roles ?? []), Role.SUPER_ADMIN]);
      existingAdmin.status = EmployeeStatus.ACTIVE;
      await AppDataSource.getRepository(User).save(existingAdmin);
      console.log("Seeded admin upgraded to an active Super Admin.");
    } else {
      console.log("Admin user already exists.");
    }
  } catch (error) {
    console.error("Error during seeding admin user:", error);
  }
}
