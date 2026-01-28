/**
 * Market Rate Service
 * Fetches and stores daily mortgage market rates from FRED API
 * 
 * Data Source: FRED API - OBMMIC30YF (30-Year Fixed Rate Conforming Mortgage Index)
 * API Documentation: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
 */

// Use management database pool - market_rates is a global table in the management database
import { pool } from '../../config/managementDatabase.js';
import { logInfo, logError } from '../logger.js';

const FRED_API_KEY = process.env.FRED_API_KEY;
const FRED_API_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const FRED_SERIES_ID = 'OBMMIC30YF'; // 30-Year Fixed Rate Conforming Mortgage Index

export interface MarketRate {
  date: string; // YYYY-MM-DD
  rate: number; // Percentage (e.g., 6.097 for 6.097%)
}

export interface FREDObservation {
  date: string;
  value: string; // FRED returns as string, may be "." for missing data
}

export interface FREDResponse {
  observations: FREDObservation[];
  count: number;
  units: string;
  output_type: number;
  file_type: string;
}

/**
 * Fetch market rates from FRED API
 * @param startDate - Start date in YYYY-MM-DD format (default: 3 years ago)
 * @param endDate - End date in YYYY-MM-DD format (default: today)
 * @returns Array of market rates
 */
export async function fetchMarketRatesFromFRED(
  startDate?: string,
  endDate?: string
): Promise<MarketRate[]> {
  if (!FRED_API_KEY) {
    throw new Error('FRED_API_KEY is not configured. Please set it in environment variables.');
  }

  // Calculate default dates if not provided
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  const observationStart = startDate || threeYearsAgo.toISOString().split('T')[0];
  const observationEnd = endDate || today.toISOString().split('T')[0];

  const url = new URL(FRED_API_BASE_URL);
  url.searchParams.append('series_id', FRED_SERIES_ID);
  url.searchParams.append('api_key', FRED_API_KEY);
  url.searchParams.append('file_type', 'json');
  url.searchParams.append('observation_start', observationStart);
  url.searchParams.append('observation_end', observationEnd);

  try {
    console.log('[FRED API] ========================================');
    console.log('[FRED API] Starting FRED API call...');
    console.log('[FRED API] Series ID:', FRED_SERIES_ID);
    console.log('[FRED API] Date Range:', observationStart, 'to', observationEnd);
    console.log('[FRED API] API Key configured:', !!FRED_API_KEY);
    console.log('[FRED API] Full URL:', url.toString().replace(FRED_API_KEY || '', '***REDACTED***'));
    logInfo(`Fetching market rates from FRED API (${observationStart} to ${observationEnd})`);

    const response = await fetch(url.toString());
    
    console.log('[FRED API] Response status:', response.status, response.statusText);
    console.log('[FRED API] Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[FRED API] ❌ Error response:', errorText);
      throw new Error(`FRED API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as FREDResponse;
    console.log('[FRED API] Response received successfully');
    console.log('[FRED API] Response structure:', {
      hasObservations: !!data.observations,
      observationsCount: data.observations?.length || 0,
      count: data.count,
      units: data.units,
      fileType: data.file_type
    });

    if (!data.observations || !Array.isArray(data.observations)) {
      console.error('[FRED API] ❌ Invalid response structure:', data);
      throw new Error('Invalid FRED API response: missing observations array');
    }

    // Filter out missing data (FRED uses "." for missing values)
    const allObservations = data.observations.length;
    const rates: MarketRate[] = data.observations
      .filter(obs => obs.value && obs.value !== '.' && !isNaN(parseFloat(obs.value)))
      .map(obs => ({
        date: obs.date,
        rate: parseFloat(obs.value)
      }));

    const filteredOut = allObservations - rates.length;
    console.log('[FRED API] ✅ Successfully parsed rates:');
    console.log('[FRED API]   - Total observations:', allObservations);
    console.log('[FRED API]   - Valid rates:', rates.length);
    console.log('[FRED API]   - Filtered out (missing data):', filteredOut);
    if (rates.length > 0) {
      console.log('[FRED API]   - First rate:', rates[0]);
      console.log('[FRED API]   - Last rate:', rates[rates.length - 1]);
    }
    console.log('[FRED API] ========================================');
    
    logInfo(`Fetched ${rates.length} market rate observations from FRED API`);
    return rates;
  } catch (error: any) {
    console.error('[FRED API] ❌ ========================================');
    console.error('[FRED API] ❌ FRED API call failed!');
    console.error('[FRED API] ❌ Error:', error.message);
    console.error('[FRED API] ❌ Stack:', error.stack);
    console.error('[FRED API] ❌ ========================================');
    logError(`Failed to fetch market rates from FRED API: ${error.message}`, error);
    throw error;
  }
}

/**
 * Store market rates in the database (upsert by date)
 * @param rates - Array of market rates to store
 * @returns Number of rates stored/updated
 */
export async function storeMarketRates(rates: MarketRate[]): Promise<number> {
  if (rates.length === 0) {
    return 0;
  }

  let storedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  console.log('[FRED API] ========================================');
  console.log('[FRED API] Storing market rates in database...');
  console.log('[FRED API] Rates to store:', rates.length);

  try {
    // Use transaction for batch insert
    await pool.query('BEGIN');
    console.log('[FRED API] Database transaction started');

    for (const rate of rates) {
      try {
        const result = await pool.query(
          `INSERT INTO public.market_rates (rate_date, rate, series_id, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (rate_date) 
           DO UPDATE SET
             rate = EXCLUDED.rate,
             updated_at = NOW()
           RETURNING (xmax = 0) AS inserted`,
          [rate.date, rate.rate, FRED_SERIES_ID]
        );
        
        const wasInserted = result.rows[0]?.inserted !== false;
        if (wasInserted) {
          storedCount++;
        } else {
          updatedCount++;
        }
      } catch (error: any) {
        errorCount++;
        console.error(`[FRED API] ❌ Failed to store rate for ${rate.date}:`, error.message);
        logError(`Failed to store market rate for ${rate.date}: ${error.message}`, error);
        // Continue with other rates
      }
    }

    await pool.query('COMMIT');
    console.log('[FRED API] ✅ Database transaction committed');
    console.log('[FRED API] Storage results:');
    console.log('[FRED API]   - New rates inserted:', storedCount);
    console.log('[FRED API]   - Existing rates updated:', updatedCount);
    console.log('[FRED API]   - Errors:', errorCount);
    console.log('[FRED API]   - Total processed:', storedCount + updatedCount);
    console.log('[FRED API] ========================================');
    
    // Clear cache so next bucketing will reload fresh rates
    clearMarketRateCache();
    
    logInfo(`Stored ${storedCount} new market rates, updated ${updatedCount} existing rates in database`);
    return storedCount + updatedCount;
  } catch (error: any) {
    await pool.query('ROLLBACK');
    console.error('[FRED API] ❌ ========================================');
    console.error('[FRED API] ❌ Database transaction rolled back!');
    console.error('[FRED API] ❌ Error:', error.message);
    console.error('[FRED API] ❌ ========================================');
    logError(`Failed to store market rates: ${error.message}`, error);
    throw error;
  }
}

/**
 * Fetch and store market rates from FRED API
 * @param startDate - Optional start date (default: 3 years ago)
 * @param endDate - Optional end date (default: today)
 * @returns Number of rates stored
 */
export async function syncMarketRatesFromFRED(
  startDate?: string,
  endDate?: string
): Promise<number> {
  console.log('[FRED API] ========================================');
  console.log('[FRED API] 🚀 Starting syncMarketRatesFromFRED');
  console.log('[FRED API] ========================================');
  
  try {
    const rates = await fetchMarketRatesFromFRED(startDate, endDate);
    const storedCount = await storeMarketRates(rates);
    
    console.log('[FRED API] ========================================');
    console.log('[FRED API] ✅ Sync completed successfully!');
    console.log('[FRED API] Total rates stored:', storedCount);
    console.log('[FRED API] ========================================');
    
    return storedCount;
  } catch (error: any) {
    console.error('[FRED API] ========================================');
    console.error('[FRED API] ❌ Sync failed!');
    console.error('[FRED API] Error:', error.message);
    console.error('[FRED API] ========================================');
    logError(`Failed to sync market rates from FRED: ${error.message}`, error);
    throw error;
  }
}

// In-memory cache for market rates to avoid repeated database queries during bucketing
// This prevents connection pool exhaustion when processing thousands of loans
const marketRateCache = new Map<string, number | null>();
let cacheInitialized = false;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
let cacheExpiry = Date.now() + CACHE_TTL;

/**
 * Initialize market rate cache by loading all rates from database
 * This is called once at the start of bucketing to avoid repeated queries
 */
export async function initializeMarketRateCache(): Promise<void> {
  if (cacheInitialized && Date.now() < cacheExpiry) {
    return; // Cache is still valid
  }

  try {
    const result = await pool.query(
      'SELECT rate_date, rate FROM public.market_rates ORDER BY rate_date'
    );

    marketRateCache.clear();
    for (const row of result.rows) {
      marketRateCache.set(row.rate_date, parseFloat(row.rate));
    }

    cacheInitialized = true;
    cacheExpiry = Date.now() + CACHE_TTL;
  } catch (error: any) {
    // If table doesn't exist or connection timeout, silently continue with empty cache
    if (error?.message?.includes('does not exist') || 
        error?.code === '42P01' ||
        error?.message?.includes('timeout')) {
      marketRateCache.clear();
      cacheInitialized = true;
      cacheExpiry = Date.now() + CACHE_TTL;
      return;
    }
    // For other errors, log but don't block
    console.error('[FRED API] ❌ Error initializing market rate cache:', error.message);
    logError('Failed to initialize market rate cache', error);
    // Continue with empty cache
    marketRateCache.clear();
    cacheInitialized = true;
    cacheExpiry = Date.now() + CACHE_TTL;
  }
}

/**
 * Clear the market rate cache (useful after syncing new rates)
 */
export function clearMarketRateCache(): void {
  marketRateCache.clear();
  cacheInitialized = false;
}

/**
 * Get market rate for a specific date from database (with in-memory cache)
 * @param date - Date in YYYY-MM-DD format or Date object
 * @returns Market rate or null if not found
 */
export async function getMarketRateForDate(date: string | Date): Promise<number | null> {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];

  // Check cache first (if initialized and not expired)
  if (cacheInitialized && Date.now() < cacheExpiry) {
    const cachedRate = marketRateCache.get(dateStr);
    if (cachedRate !== undefined) {
      return cachedRate;
    }
    // If date not in cache, return null (don't query DB for missing dates during bucketing)
    return null;
  }

  // Cache not initialized or expired - query database
  try {
    const result = await pool.query(
      'SELECT rate FROM public.market_rates WHERE rate_date = $1',
      [dateStr]
    );

    if (result.rows.length === 0) {
      // Silently return null - missing market rate data is expected for some dates
      return null;
    }

    const rate = parseFloat(result.rows[0].rate);
    // Cache the result for future use
    marketRateCache.set(dateStr, rate);
    return rate;
  } catch (error: any) {
    // If table doesn't exist or connection timeout, silently return null (don't spam errors)
    if (error?.message?.includes('does not exist') || 
        error?.code === '42P01' ||
        error?.message?.includes('timeout')) {
      // Table doesn't exist or connection issues - this is expected in development
      // Return null silently to allow bucketing to continue
      return null;
    }
    // For other errors, log but don't block
    console.error(`[FRED API] ❌ Error getting rate for ${dateStr}:`, error.message);
    logError(`Failed to get market rate for date ${dateStr}: ${error.message}`, error);
    return null;
  }
}

/**
 * Get market rates for a date range from database
 * @param startDate - Start date in YYYY-MM-DD format or Date object
 * @param endDate - End date in YYYY-MM-DD format or Date object
 * @returns Array of market rates sorted by date
 */
export async function getMarketRatesForRange(
  startDate: string | Date,
  endDate: string | Date
): Promise<MarketRate[]> {
  const startStr = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
  const endStr = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];

  try {
    const result = await pool.query(
      'SELECT rate_date, rate FROM public.market_rates WHERE rate_date >= $1 AND rate_date <= $2 ORDER BY rate_date ASC',
      [startStr, endStr]
    );

    return result.rows.map(row => ({
      date: row.rate_date,
      rate: parseFloat(row.rate)
    }));
  } catch (error: any) {
    // If table doesn't exist, silently return empty array (don't spam errors)
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return [];
    }
    logError(`Failed to get market rates for range ${startStr} to ${endStr}: ${error.message}`, error);
    return [];
  }
}

/**
 * Get the most recent market rate from database (for active loans)
 * Uses cache if initialized, otherwise queries database
 * @returns Most recent market rate or null if not found
 */
export async function getMostRecentMarketRate(): Promise<number | null> {
  // If cache is initialized, get the most recent rate from cache
  if (cacheInitialized && Date.now() < cacheExpiry) {
    if (marketRateCache.size === 0) {
      return null; // Empty cache - no market rates available
    }
    // Get the most recent date in the cache
    let mostRecentDate: string | null = null;
    for (const dateStr of marketRateCache.keys()) {
      if (!mostRecentDate || dateStr > mostRecentDate) {
        mostRecentDate = dateStr;
      }
    }
    return mostRecentDate ? marketRateCache.get(mostRecentDate) ?? null : null;
  }

  // Cache not initialized - query database (but this should rarely happen)
  try {
    const result = await pool.query(
      'SELECT rate FROM public.market_rates ORDER BY rate_date DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      return null;
    }

    return parseFloat(result.rows[0].rate);
  } catch (error: any) {
    // If table doesn't exist or timeout, silently return null
    if (error?.message?.includes('does not exist') || 
        error?.code === '42P01' ||
        error?.message?.includes('timeout')) {
      return null;
    }
    logError(`Failed to get most recent market rate: ${error.message}`, error);
    return null;
  }
}

/**
 * Get all market rates from database (for loading into memory)
 * @returns Array of market rates sorted by date
 */
export async function getAllMarketRates(): Promise<MarketRate[]> {
  try {
    const result = await pool.query(
      'SELECT rate_date, rate FROM public.market_rates ORDER BY rate_date ASC'
    );

    console.log(`[FRED API] Retrieved ${result.rows.length} market rates from database`);
    return result.rows.map(row => ({
      date: row.rate_date,
      rate: parseFloat(row.rate)
    }));
  } catch (error: any) {
    console.error('[FRED API] ❌ Error getting all market rates:', error.message);
    logError(`Failed to get all market rates: ${error.message}`, error);
    return [];
  }
}

/**
 * Test FRED API connection (for debugging)
 * Fetches a small date range to verify API is working
 * @returns Test result with success status and sample data
 */
export async function testFREDAPI(): Promise<{
  success: boolean;
  message: string;
  sampleRates?: MarketRate[];
  error?: string;
}> {
  console.log('[FRED API] ========================================');
  console.log('[FRED API] 🧪 Testing FRED API connection...');
  console.log('[FRED API] ========================================');
  
  try {
    // Test with last 7 days
    const today = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 7);
    
    const testStart = weekAgo.toISOString().split('T')[0];
    const testEnd = today.toISOString().split('T')[0];
    
    console.log('[FRED API] Test date range:', testStart, 'to', testEnd);
    
    const rates = await fetchMarketRatesFromFRED(testStart, testEnd);
    
    console.log('[FRED API] ========================================');
    console.log('[FRED API] ✅ FRED API test PASSED!');
    console.log('[FRED API] Retrieved', rates.length, 'rates for test period');
    console.log('[FRED API] ========================================');
    
    return {
      success: true,
      message: `FRED API is working correctly. Retrieved ${rates.length} rates for the last 7 days.`,
      sampleRates: rates.slice(0, 5) // Return first 5 as samples
    };
  } catch (error: any) {
    console.error('[FRED API] ========================================');
    console.error('[FRED API] ❌ FRED API test FAILED!');
    console.error('[FRED API] Error:', error.message);
    console.error('[FRED API] ========================================');
    
    return {
      success: false,
      message: 'FRED API test failed',
      error: error.message
    };
  }
}
