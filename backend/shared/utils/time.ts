/**
 * Helper utilities for managing ISO UTC timestamps and checking quiet hour restrictions.
 */

/**
 * Returns the current date in UTC as a Date object or ISO string.
 */
export function getCurrentUTCTime(): Date {
  return new Date();
}

/**
 * Checks if a given time falls within the configured quiet hours range.
 * Supports quiet hours that span across midnight (e.g., 22:00:00 to 08:00:00).
 *
 * @param quietStart Time string in 'HH:MM:SS' or 'HH:MM' format.
 * @param quietEnd Time string in 'HH:MM:SS' or 'HH:MM' format.
 * @param timeToCheck The date/time to check (defaults to current time).
 */
export function isWithinQuietHours(
  quietStart: string,
  quietEnd: string,
  timeToCheck: Date = new Date()
): boolean {
  const parseToMinutes = (timeStr: string): number => {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return hours * 60 + minutes;
  };

  const startMinutes = parseToMinutes(quietStart);
  const endMinutes = parseToMinutes(quietEnd);
  
  // Get time of day in minutes for the active check date
  const checkMinutes = timeToCheck.getHours() * 60 + timeToCheck.getMinutes();

  if (startMinutes <= endMinutes) {
    // Normal window (e.g. 09:00:00 to 17:00:00)
    return checkMinutes >= startMinutes && checkMinutes <= endMinutes;
  } else {
    // Midnight spanning window (e.g. 22:00:00 to 08:00:00)
    return checkMinutes >= startMinutes || checkMinutes <= endMinutes;
  }
}
