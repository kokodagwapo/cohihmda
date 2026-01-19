-- Create dashboard_content table for storing editable dashboard content
CREATE TABLE IF NOT EXISTS public.dashboard_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_key TEXT UNIQUE NOT NULL,
  content_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups by content_key
CREATE INDEX IF NOT EXISTS idx_dashboard_content_key ON public.dashboard_content(content_key);

-- Enable RLS
ALTER TABLE public.dashboard_content ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (anyone can view dashboard content)
CREATE POLICY "Anyone can view dashboard content"
ON public.dashboard_content
FOR SELECT
USING (true);

-- Create policy for authenticated users to insert/update
CREATE POLICY "Authenticated users can insert dashboard content"
ON public.dashboard_content
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update dashboard content"
ON public.dashboard_content
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Add comment to table
COMMENT ON TABLE public.dashboard_content IS 'Stores editable dashboard content that can be modified in-place';
