// src/utils/dateTransformer.ts
import logger from "./logger";

export const dateTransformer = {
    from: (value: string | Date | null) => {
      if (!value || value === "Invalid Date") return null;
      try {
        const parsedDate = value instanceof Date ? value : new Date(value);
        if (isNaN(parsedDate.getTime())) {
          logger.error("Invalid date encountered: " + value);
          return null;
        }
        return parsedDate;
      } catch (error) {
        logger.error("Date transformation error: " + error);
        return null;
      }
    },
    to: (value: Date | null) => (value && value instanceof Date ? value : new Date()),
  };
  