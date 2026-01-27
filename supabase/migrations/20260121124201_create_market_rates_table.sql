-- Market Rates Table for FRED API Data
-- Migration Date: 2026-01-21
-- Description: Table for storing daily mortgage market rates from FRED API (OBMMIC30YF series)

-- Market rates table (global, not tenant-specific)
CREATE TABLE IF NOT EXISTS public.market_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date DATE NOT NULL UNIQUE,
  rate DECIMAL(10, 4) NOT NULL,
  series_id TEXT NOT NULL DEFAULT 'OBMMIC30YF',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_rates_date ON public.market_rates(rate_date);
CREATE INDEX IF NOT EXISTS idx_market_rates_series ON public.market_rates(series_id);

COMMENT ON TABLE public.market_rates IS 'Daily mortgage market rates from FRED API (30-Year Fixed Rate Conforming Mortgage Index)';
COMMENT ON COLUMN public.market_rates.rate_date IS 'Date of the market rate observation';
COMMENT ON COLUMN public.market_rates.rate IS 'Market interest rate as percentage (e.g., 6.097 for 6.097%)';
COMMENT ON COLUMN public.market_rates.series_id IS 'FRED series identifier (default: OBMMIC30YF)';

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_market_rates_updated_at 
  BEFORE UPDATE ON public.market_rates 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();
