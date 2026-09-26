import moment from "moment";
import logger from "./logger";

/**
 * Parses a date (string or Date object) and extracts the formatted date and time separately.
 * @param rawDate - A date in string format "DD-MM-YYYY hh:mm A" or a Date object
 * @returns An object containing `createdDate` and `createdTime`
 */
export function formatDateTime(rawDate: string | Date): { createdDate: string | null, createdTime: string | null } {
  if (!rawDate) {
    logger.error("Invalid input date: " + rawDate);
    return { createdDate: null, createdTime: null };
  }

  let parsedDate: moment.Moment;

  if (rawDate instanceof Date) {
    parsedDate = moment(rawDate); // Convert Date object to Moment
  } else if (typeof rawDate === "string") {
    parsedDate = moment(rawDate, "DD-MM-YYYY hh:mm A", true);
  } else {
    logger.error("Invalid date type: " + typeof rawDate);
    return { createdDate: null, createdTime: null };
  }

  if (!parsedDate.isValid()) {
    logger.error("Invalid date value: " + rawDate);
    return { createdDate: null, createdTime: null };
  }

  return {
    //createdDate: parsedDate.format("DD-MM-YYYY"), // Output: "26-03-2025"
     createdDate: parsedDate.format("YYYY-MM-DD"),
    createdTime: parsedDate.format("hh:mm A")    // Output: "12:50 PM"
  };
}
