-- Fix user_sessions foreign key to reference public.users instead of auth.users
-- This is needed because the Express backend uses public.users table

-- Drop the old foreign key constraint
ALTER TABLE public.user_sessions 
DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey;

-- Add new foreign key constraint pointing to public.users
ALTER TABLE public.user_sessions 
ADD CONSTRAINT user_sessions_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
