/** A years active span as the UI prints it, or null when no year is tagged. */
export const yearRange = (firstYear: number | null, lastYear: number | null): string | null =>
    firstYear == null
        ? null
        : lastYear != null && lastYear !== firstYear
          ? `${firstYear} - ${lastYear}`
          : `${firstYear}`
