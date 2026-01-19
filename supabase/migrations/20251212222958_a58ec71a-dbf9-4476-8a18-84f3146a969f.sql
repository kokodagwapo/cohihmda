-- Create AgilePlan tables for persistent storage

-- Table for storing boards/columns configuration
CREATE TABLE public.agileplan_boards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for storing individual tasks
CREATE TABLE public.agileplan_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  board_id UUID REFERENCES public.agileplan_boards(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
  assignee_name TEXT,
  assignee_avatar TEXT,
  tags TEXT[] DEFAULT '{}',
  due_date DATE,
  week TEXT,
  date_range TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for storing task comments
CREATE TABLE public.agileplan_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.agileplan_tasks(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  author_avatar TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for storing activity history/audit log
CREATE TABLE public.agileplan_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('task_moved', 'task_created', 'task_updated', 'task_deleted', 'comment_added', 'attachment_added', 'task_shared', 'task_exported')),
  description TEXT NOT NULL,
  task_id UUID REFERENCES public.agileplan_tasks(id) ON DELETE SET NULL,
  task_title TEXT,
  from_column TEXT,
  to_column TEXT,
  user_name TEXT NOT NULL DEFAULT 'System',
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for storing task attachments
CREATE TABLE public.agileplan_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.agileplan_tasks(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('image', 'document')) DEFAULT 'document',
  url TEXT NOT NULL,
  size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.agileplan_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agileplan_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agileplan_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agileplan_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agileplan_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for agileplan_boards
CREATE POLICY "Users can view boards in their tenant" ON public.agileplan_boards
  FOR SELECT USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can insert boards in their tenant" ON public.agileplan_boards
  FOR INSERT WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can update boards in their tenant" ON public.agileplan_boards
  FOR UPDATE USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can delete boards in their tenant" ON public.agileplan_boards
  FOR DELETE USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

-- RLS Policies for agileplan_tasks
CREATE POLICY "Users can view tasks in their tenant" ON public.agileplan_tasks
  FOR SELECT USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can insert tasks in their tenant" ON public.agileplan_tasks
  FOR INSERT WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can update tasks in their tenant" ON public.agileplan_tasks
  FOR UPDATE USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can delete tasks in their tenant" ON public.agileplan_tasks
  FOR DELETE USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

-- RLS Policies for agileplan_comments
CREATE POLICY "Users can view comments in their tenant" ON public.agileplan_comments
  FOR SELECT USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can insert comments in their tenant" ON public.agileplan_comments
  FOR INSERT WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can update comments in their tenant" ON public.agileplan_comments
  FOR UPDATE USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can delete comments in their tenant" ON public.agileplan_comments
  FOR DELETE USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

-- RLS Policies for agileplan_activities
CREATE POLICY "Users can view activities in their tenant" ON public.agileplan_activities
  FOR SELECT USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can insert activities in their tenant" ON public.agileplan_activities
  FOR INSERT WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

-- RLS Policies for agileplan_attachments
CREATE POLICY "Users can view attachments in their tenant" ON public.agileplan_attachments
  FOR SELECT USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can insert attachments in their tenant" ON public.agileplan_attachments
  FOR INSERT WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

CREATE POLICY "Users can delete attachments in their tenant" ON public.agileplan_attachments
  FOR DELETE USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid()));

-- Create indexes for better performance
CREATE INDEX idx_agileplan_tasks_tenant ON public.agileplan_tasks(tenant_id);
CREATE INDEX idx_agileplan_tasks_column ON public.agileplan_tasks(column_id);
CREATE INDEX idx_agileplan_tasks_board ON public.agileplan_tasks(board_id);
CREATE INDEX idx_agileplan_comments_task ON public.agileplan_comments(task_id);
CREATE INDEX idx_agileplan_activities_tenant ON public.agileplan_activities(tenant_id);
CREATE INDEX idx_agileplan_activities_created ON public.agileplan_activities(created_at DESC);
CREATE INDEX idx_agileplan_attachments_task ON public.agileplan_attachments(task_id);

-- Add triggers for updated_at
CREATE TRIGGER update_agileplan_boards_updated_at
  BEFORE UPDATE ON public.agileplan_boards
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_agileplan_tasks_updated_at
  BEFORE UPDATE ON public.agileplan_tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Enable realtime for activity updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.agileplan_activities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agileplan_tasks;