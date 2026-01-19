import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { format } from 'date-fns';

// Default timezone fallback
const DEFAULT_TIMEZONE = 'America/New_York';

// Get user's timezone from browser
export function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {
    console.warn('Failed to detect timezone, using default:', e);
    return DEFAULT_TIMEZONE;
  }
}

// Get timezone from localStorage or detect it
let cachedTimezone: string | null = null;

export function getUserTimezone(): string {
  if (cachedTimezone) {
    return cachedTimezone;
  }
  
  // Try to get from localStorage first
  const stored = localStorage.getItem('user_timezone');
  if (stored) {
    cachedTimezone = stored;
    return stored;
  }
  
  // Detect and cache
  const detected = detectUserTimezone();
  cachedTimezone = detected;
  localStorage.setItem('user_timezone', detected);
  return detected;
}

export function setUserTimezone(timezone: string): void {
  cachedTimezone = timezone;
  localStorage.setItem('user_timezone', timezone);
}

// Get the active timezone (user's preference or detected)
export function getActiveTimezone(): string {
  return getUserTimezone();
}

// Legacy export for backward compatibility
export const APP_TIMEZONE = DEFAULT_TIMEZONE;

/**
 * Get current date/time in the user's timezone
 */
export function getNowInTimezone(): Date {
  return toZonedTime(new Date(), getActiveTimezone());
}

/**
 * Convert a date string to a Date object
 * Assumes the date string is in YYYY-MM-DD format
 * Returns a Date object that represents the date in the app's timezone
 */
export function parseDateInTimezone(dateString: string): Date {
  // For date-only strings like "2026-01-15", parse as UTC date at midnight
  // This ensures consistent date comparison regardless of user's local timezone
  const [year, month, day] = dateString.split('-').map(Number);
  // Create as UTC date to avoid timezone shifts
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Format a date in the user's timezone
 */
export function formatInTimezone(date: Date, formatString: string): string {
  return formatInTimeZone(date, getActiveTimezone(), formatString);
}

/**
 * Check if a date is today in the user's timezone
 */
export function isTodayInTimezone(date: Date): boolean {
  const now = getNowInTimezone();
  const dateInTz = toZonedTime(date, getActiveTimezone());
  
  return (
    dateInTz.getFullYear() === now.getFullYear() &&
    dateInTz.getMonth() === now.getMonth() &&
    dateInTz.getDate() === now.getDate()
  );
}

/**
 * Get start of day in user's timezone
 */
export function startOfDayInTimezone(date: Date): Date {
  const tz = getActiveTimezone();
  const zonedDate = toZonedTime(date, tz);
  zonedDate.setHours(0, 0, 0, 0);
  return fromZonedTime(zonedDate, tz);
}

/**
 * Get end of day in user's timezone
 */
export function endOfDayInTimezone(date: Date): Date {
  const tz = getActiveTimezone();
  const zonedDate = toZonedTime(date, tz);
  zonedDate.setHours(23, 59, 59, 999);
  return fromZonedTime(zonedDate, tz);
}
