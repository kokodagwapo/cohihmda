-- AgilePlan Database Schema
-- Supports Kanban boards, tasks, columns, activities, and attachments

-- Create kanban_boards table
CREATE TABLE IF NOT EXISTS public.kanban_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Coheus by Teraverde',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create kanban_columns table
CREATE TABLE IF NOT EXISTS public.kanban_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id, position)
);

-- Create kanban_tasks table
CREATE TABLE IF NOT EXISTS public.kanban_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id UUID NOT NULL REFERENCES public.kanban_columns(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  week TEXT,
  date_range TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create kanban_task_tags table (many-to-many)
CREATE TABLE IF NOT EXISTS public.kanban_task_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.kanban_tasks(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, tag)
);

-- Create kanban_comments table
CREATE TABLE IF NOT EXISTS public.kanban_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.kanban_tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create kanban_attachments table
CREATE TABLE IF NOT EXISTS public.kanban_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.kanban_tasks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('image', 'document')),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create kanban_activities table (audit trail)
CREATE TABLE IF NOT EXISTS public.kanban_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.kanban_tasks(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'task_moved', 'task_created', 'task_updated', 'task_deleted',
    'comment_added', 'comment_deleted',
    'attachment_added', 'attachment_deleted',
    'task_shared', 'task_exported',
    'column_created', 'column_updated', 'column_deleted'
  )),
  description TEXT NOT NULL,
  from_column_id UUID REFERENCES public.kanban_columns(id) ON DELETE SET NULL,
  to_column_id UUID REFERENCES public.kanban_columns(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_kanban_boards_tenant ON public.kanban_boards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_board ON public.kanban_columns(board_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_column ON public.kanban_tasks(column_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_board ON public.kanban_tasks(board_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_due_date ON public.kanban_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_kanban_comments_task ON public.kanban_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_kanban_attachments_task ON public.kanban_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_kanban_activities_board ON public.kanban_activities(board_id);
CREATE INDEX IF NOT EXISTS idx_kanban_activities_task ON public.kanban_activities(task_id);
CREATE INDEX IF NOT EXISTS idx_kanban_activities_created ON public.kanban_activities(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.kanban_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_activities ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access boards for their tenant
CREATE POLICY "Users can view boards for their tenant"
  ON public.kanban_boards FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create boards for their tenant"
  ON public.kanban_boards FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update boards for their tenant"
  ON public.kanban_boards FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete boards for their tenant"
  ON public.kanban_boards FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

-- Similar policies for columns, tasks, etc. (simplified for brevity)
-- In production, add comprehensive RLS policies for all tables

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_kanban_boards_updated_at
  BEFORE UPDATE ON public.kanban_boards
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kanban_columns_updated_at
  BEFORE UPDATE ON public.kanban_columns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kanban_tasks_updated_at
  BEFORE UPDATE ON public.kanban_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kanban_comments_updated_at
  BEFORE UPDATE ON public.kanban_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
