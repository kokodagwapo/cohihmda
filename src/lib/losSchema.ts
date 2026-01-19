/**
 * Universal LOS (Loan Origination System) Schema Mapping
 * 
 * This module provides a standardized interface for mapping data from different
 * Loan Origination Systems (Encompass, Calyx, OptimalBlue, etc.) to a universal schema.
 * 
 * This enables seamless integration with multiple LOS providers while maintaining
 * a consistent data structure throughout the application.
 */

// Universal Funnel Data Schema
export interface LOSFunnelData {
  loansStarted: {
    revenue: number;
    units: number;
    volume: number;
  };
  noRespaApp: {
    revenue: number;
    units: number;
    volume: number;
    lostRevenue: number;
  };
  respaApp: {
    revenue: number;
    units: number;
    volume: number;
  };
  originated: {
    revenue: number;
    units: number;
    volume: number;
  };
  falloutWithdrawn: {
    revenue: number;
    units: number;
    volume: number;
    lostRevenue: number;
  };
  falloutDenied: {
    revenue: number;
    units: number;
    volume: number;
    lostRevenue: number;
  };
  stillActive: {
    revenue: number;
    units: number;
    volume: number;
  };
}

// Universal LOS API Response Schema
export interface LOSApiResponse {
  year: number;
  asOfDate: string;
  funnelData: LOSFunnelData;
  metadata?: {
    source: string; // LOS system name (e.g., "Encompass", "Calyx", "OptimalBlue")
    lastUpdated: string;
    dataQuality: 'high' | 'medium' | 'low';
  };
}

// Supported LOS Types
export type LOSType = 'encompass' | 'calyx' | 'optimalblue' | 'mortgagebot' | 'floify' | 'generic';

/**
 * Maps different LOS API responses to our universal schema
 * 
 * @param losData - Raw data from LOS API
 * @param losType - Type of LOS system
 * @returns Standardized LOSFunnelData
 */
export const mapLOSDataToUniversalSchema = (
  losData: any,
  losType: LOSType
): LOSFunnelData => {
  switch (losType) {
    case 'encompass':
      // Ellie Mae Encompass mapping
      return {
        loansStarted: {
          revenue: losData.loansStarted?.revenue || losData.totalRevenue || losData.revenue || 0,
          units: losData.loansStarted?.units || losData.totalUnits || losData.units || 0,
          volume: losData.loansStarted?.volume || losData.totalVolume || losData.volume || 0,
        },
        noRespaApp: {
          revenue: losData.noRespaApp?.revenue || losData.noRespaRevenue || 0,
          units: losData.noRespaApp?.units || losData.noRespaUnits || 0,
          volume: losData.noRespaApp?.volume || losData.noRespaVolume || 0,
          lostRevenue: losData.noRespaApp?.lostRevenue || losData.noRespaLostRevenue || 0,
        },
        respaApp: {
          revenue: losData.respaApp?.revenue || losData.respaRevenue || 0,
          units: losData.respaApp?.units || losData.respaUnits || 0,
          volume: losData.respaApp?.volume || losData.respaVolume || 0,
        },
        originated: {
          revenue: losData.originated?.revenue || losData.closedRevenue || losData.closed?.revenue || 0,
          units: losData.originated?.units || losData.closedUnits || losData.closed?.units || 0,
          volume: losData.originated?.volume || losData.closedVolume || losData.closed?.volume || 0,
        },
        falloutWithdrawn: {
          revenue: losData.falloutWithdrawn?.revenue || losData.withdrawnRevenue || losData.withdrawn?.revenue || 0,
          units: losData.falloutWithdrawn?.units || losData.withdrawnUnits || losData.withdrawn?.units || 0,
          volume: losData.falloutWithdrawn?.volume || losData.withdrawnVolume || losData.withdrawn?.volume || 0,
          lostRevenue: losData.falloutWithdrawn?.lostRevenue || losData.withdrawnLostRevenue || 0,
        },
        falloutDenied: {
          revenue: losData.falloutDenied?.revenue || losData.deniedRevenue || losData.denied?.revenue || 0,
          units: losData.falloutDenied?.units || losData.deniedUnits || losData.denied?.units || 0,
          volume: losData.falloutDenied?.volume || losData.deniedVolume || losData.denied?.volume || 0,
          lostRevenue: losData.falloutDenied?.lostRevenue || losData.deniedLostRevenue || 0,
        },
        stillActive: {
          revenue: losData.stillActive?.revenue || losData.activeRevenue || losData.active?.revenue || 0,
          units: losData.stillActive?.units || losData.activeUnits || losData.active?.units || 0,
          volume: losData.stillActive?.volume || losData.activeVolume || losData.active?.volume || 0,
        },
      };

    case 'calyx':
      // Calyx Point mapping
      return {
        loansStarted: {
          revenue: losData.loansStarted?.revenue || losData.totalRevenue || 0,
          units: losData.loansStarted?.units || losData.totalUnits || 0,
          volume: losData.loansStarted?.volume || losData.totalVolume || 0,
        },
        noRespaApp: {
          revenue: losData.noRespaApp?.revenue || losData.noRespaRevenue || 0,
          units: losData.noRespaApp?.units || losData.noRespaUnits || 0,
          volume: losData.noRespaApp?.volume || losData.noRespaVolume || 0,
          lostRevenue: losData.noRespaApp?.lostRevenue || losData.noRespaLostRevenue || 0,
        },
        respaApp: {
          revenue: losData.respaApp?.revenue || losData.respaRevenue || 0,
          units: losData.respaApp?.units || losData.respaUnits || 0,
          volume: losData.respaApp?.volume || losData.respaVolume || 0,
        },
        originated: {
          revenue: losData.originated?.revenue || losData.closedRevenue || 0,
          units: losData.originated?.units || losData.closedUnits || 0,
          volume: losData.originated?.volume || losData.closedVolume || 0,
        },
        falloutWithdrawn: {
          revenue: losData.falloutWithdrawn?.revenue || losData.withdrawnRevenue || 0,
          units: losData.falloutWithdrawn?.units || losData.withdrawnUnits || 0,
          volume: losData.falloutWithdrawn?.volume || losData.withdrawnVolume || 0,
          lostRevenue: losData.falloutWithdrawn?.lostRevenue || losData.withdrawnLostRevenue || 0,
        },
        falloutDenied: {
          revenue: losData.falloutDenied?.revenue || losData.deniedRevenue || 0,
          units: losData.falloutDenied?.units || losData.deniedUnits || 0,
          volume: losData.falloutDenied?.volume || losData.deniedVolume || 0,
          lostRevenue: losData.falloutDenied?.lostRevenue || losData.deniedLostRevenue || 0,
        },
        stillActive: {
          revenue: losData.stillActive?.revenue || losData.activeRevenue || 0,
          units: losData.stillActive?.units || losData.activeUnits || 0,
          volume: losData.stillActive?.volume || losData.activeVolume || 0,
        },
      };

    case 'optimalblue':
      // OptimalBlue mapping
      return mapLOSDataToUniversalSchema(losData, 'generic');

    case 'mortgagebot':
      // MortgageBot mapping
      return mapLOSDataToUniversalSchema(losData, 'generic');

    case 'floify':
      // Floify mapping
      return mapLOSDataToUniversalSchema(losData, 'generic');

    default:
      // Generic mapping - assumes data already matches our schema or needs minimal transformation
      return {
        loansStarted: {
          revenue: losData.loansStarted?.revenue || 0,
          units: losData.loansStarted?.units || 0,
          volume: losData.loansStarted?.volume || 0,
        },
        noRespaApp: {
          revenue: losData.noRespaApp?.revenue || 0,
          units: losData.noRespaApp?.units || 0,
          volume: losData.noRespaApp?.volume || 0,
          lostRevenue: losData.noRespaApp?.lostRevenue || 0,
        },
        respaApp: {
          revenue: losData.respaApp?.revenue || 0,
          units: losData.respaApp?.units || 0,
          volume: losData.respaApp?.volume || 0,
        },
        originated: {
          revenue: losData.originated?.revenue || 0,
          units: losData.originated?.units || 0,
          volume: losData.originated?.volume || 0,
        },
        falloutWithdrawn: {
          revenue: losData.falloutWithdrawn?.revenue || 0,
          units: losData.falloutWithdrawn?.units || 0,
          volume: losData.falloutWithdrawn?.volume || 0,
          lostRevenue: losData.falloutWithdrawn?.lostRevenue || 0,
        },
        falloutDenied: {
          revenue: losData.falloutDenied?.revenue || 0,
          units: losData.falloutDenied?.units || 0,
          volume: losData.falloutDenied?.volume || 0,
          lostRevenue: losData.falloutDenied?.lostRevenue || 0,
        },
        stillActive: {
          revenue: losData.stillActive?.revenue || 0,
          units: losData.stillActive?.units || 0,
          volume: losData.stillActive?.volume || 0,
        },
      };
  }
};

/**
 * Validates LOS data structure
 * 
 * @param data - Data to validate
 * @returns true if valid, false otherwise
 */
export const validateLOSData = (data: any): data is LOSFunnelData => {
  return (
    data &&
    typeof data.loansStarted === 'object' &&
    typeof data.loansStarted.revenue === 'number' &&
    typeof data.loansStarted.units === 'number' &&
    typeof data.loansStarted.volume === 'number' &&
    typeof data.noRespaApp === 'object' &&
    typeof data.respaApp === 'object' &&
    typeof data.originated === 'object' &&
    typeof data.falloutWithdrawn === 'object' &&
    typeof data.falloutDenied === 'object' &&
    typeof data.stillActive === 'object'
  );
};
