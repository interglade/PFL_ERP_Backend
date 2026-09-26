import { 
  BaseEntity, 
  Column, 
  CreateDateColumn, 
  DeleteDateColumn,
  PrimaryGeneratedColumn, 
  UpdateDateColumn 
} from "typeorm";
import { format } from "date-fns"
import { toZonedTime} from "date-fns-tz";

export default abstract class Model extends BaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;



// @CreateDateColumn({
//   type: "timestamp",
//   transformer: {
//     from: (value: string | Date | null) => {
//       if (!value) return null; // Handle null values explicitly
//       try {
//         const parsedDate = value instanceof Date ? value : new Date(value);
//         //console.log("Raw value from DB:", value);
//         //console.log("Parsed Date:", parsedDate);

//         if (isNaN(parsedDate.getTime())) {
//           console.error("Invalid date encountered:", value);
//           return null;
//         }

//         return format(toZonedTime(parsedDate, "Asia/Kolkata"), "dd-MM-yyyy hh:mm a");
//       } catch (error) {
//         console.error("Date transformation error:", error);
//         return null;
//       }
//     },
//     to: (value: Date) => (value instanceof Date ? value : new Date(value)), 
//   },
// })
// createdAt: Date;

// @UpdateDateColumn({
//   type: "timestamp",
//   transformer: {
//     from: (value: string | Date | null) => {
//       if (!value) return null;
//       try {
//         const parsedDate = value instanceof Date ? value : new Date(value);
//         //console.log("Raw value from DB:", value);
//         //console.log("Parsed Date:", parsedDate);

//         if (isNaN(parsedDate.getTime())) {
//           console.error("Invalid date encountered:", value);
//           return null;
//         }

//         return format(toZonedTime(parsedDate, "Asia/Kolkata"), "dd-MM-yyyy hh:mm a");
//       } catch (error) {
//         console.error("Date transformation error:", error);
//         return null;
//       }
//     },
//     to: (value: Date) => (value instanceof Date ? value : new Date(value)), 
//   },
// })
//updatedAt: Date;
@CreateDateColumn({
  type: "timestamp",
  transformer: {
    from: (value: string | Date | null) => {
      if (!value || value === "Invalid Date") return null; // Ensure null or invalid dates are handled
      try {
        const parsedDate = value instanceof Date ? value : new Date(value);
        if (isNaN(parsedDate.getTime())) {
          console.error("Invalid date encountered:", value);
          return null;
        }
        return parsedDate; // Return as a valid Date object
      } catch (error) {
        console.error("Date transformation error:", error);
        return null;
      }
    },
    to: (value: Date | null) => (value && value instanceof Date ? value : new Date()), 
  },
})
createdAt: Date;

@UpdateDateColumn({
  type: "timestamp",
  transformer: {
    from: (value: string | Date | null) => {
      if (!value || value === "Invalid Date") return null;
      try {
        const parsedDate = value instanceof Date ? value : new Date(value);
        if (isNaN(parsedDate.getTime())) {
          console.error("Invalid date encountered:", value);
          return null;
        }
        return parsedDate;
      } catch (error) {
        console.error("Date transformation error:", error);
        return null;
      }
    },
    to: (value: Date | null) => (value && value instanceof Date ? value : new Date()), 
  },
})
updatedAt: Date;

 
  @Column({ name: "deletion_scheduled_at", type: "timestamp", nullable: true })
  deletionScheduledAt: Date;


  @Column({ default: false })
  isDeleted: boolean;

  @DeleteDateColumn({ type: "timestamp", nullable: true })
  deletedAt: Date;
}
