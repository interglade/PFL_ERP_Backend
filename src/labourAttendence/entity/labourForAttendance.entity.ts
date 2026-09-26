import { Column, Entity, ManyToOne, JoinColumn } from "typeorm";
import Model from "../../global/model.entity";
import { LaborAttendance } from "./laborattendance.entity";
import { parse } from "date-fns";
import { format, toDate, toZonedTime } from "date-fns-tz";


@Entity('labor_detail')
export class LaborDetail extends Model {
  @Column({
    type: "enum",
    enum: ["temporary", "permanent"],
  })
  laborType: string;

  @Column({ nullable: false, name: "labor_id" })
  labourName: string; // ID of the associated labor (temporary or permanent)

  @Column({
    type: "time",
    transformer: {
      // When reading from the database, convert the raw time to 12-hour IST format
      from: (value: string) => {
        // Assume the DB value is in "HH:mm:ss" (24-hour format)
        const parsedDate = parse(value);
        // Convert parsed time to IST (Asia/Kolkata)
        const istDate = toZonedTime(parsedDate, "Asia/Kolkata");
        // Format it as "hh:mm a" (12-hour format with AM/PM)
        return format(istDate, "hh:mm a", { timeZone: "Asia/Kolkata" });
      },
      // When writing to the database, convert from the expected "hh:mm a" format to "HH:mm:ss"
      to: (value: string) => {
        // Parse the provided time which is expected to be in "hh:mm a" format
        const parsedDate = parse(value);
        // Convert to IST (though the parsed date is already treated as local; this ensures the correct zone)
        const istDate = toZonedTime(parsedDate, "Asia/Kolkata");
        // Format back to 24-hour "HH:mm:ss" for storing in the DB
        return format(istDate, "HH:mm:ss", { timeZone: "Asia/Kolkata" });
      },
    },
  })
  inTime: string;

  @Column({ type: "time",nullable:true, transformer: {
    from: (value: string | null) => {
        if (!value) return null; // Handle NULL or empty values
        
        try {
            // Ensure value is properly formatted before parsing
            //const parsedDate = parse(value, "HH:mm:ss", new Date());
            const parsedDate = toDate(value)
            const istDate = toZonedTime(parsedDate, "Asia/Kolkata");
            return format(istDate, "hh:mm a", { timeZone: "Asia/Kolkata" });
        } catch (error) {
            console.error("Error parsing time:", value, error);
            return null; // Return null instead of crashing
        }
    },
    to: (value: string | null) => {
        if (!value) return null;

        try {
            // const parsedDate = parse(value, "hh:mm a", new Date(), { locale: undefined });
            const parsedDate = toDate(value)
            const istDate = toZonedTime(parsedDate, "Asia/Kolkata");
            return format(istDate, "HH:mm:ss", { timeZone: "Asia/Kolkata" });
        } catch (error) {
            console.error("Error formatting time:", value, error);
            return null;
        }
    }
}})
outTime: string;


  @Column('decimal', { precision: 12, scale: 2, nullable: true,default: 0 })
  amount: number;

  @ManyToOne(() => LaborAttendance, attendance => attendance. labourDetails, { onDelete: "CASCADE" })
  @JoinColumn({ name: 'attendance_id' })
  attendance: LaborAttendance;
  
}
