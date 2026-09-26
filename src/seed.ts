
import { Role } from "./employee/entity/user.entity";
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
        password: adminPassword,
        status: "ACTIVE",
        primaryMobNo: adminPhone,
        roles: [Role.EMPLOYEE, Role.ADMIN],
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
        console.log("Admin user created:", admin.id);
      } catch (validationError) {
        console.error("Validation failed:", validationError);
      }
    } else {
      console.log("Admin user already exists.");
    }
  } catch (error) {
    console.error("Error during seeding admin user:", error);
  }
}
