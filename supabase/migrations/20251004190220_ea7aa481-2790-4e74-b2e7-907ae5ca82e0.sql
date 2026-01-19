-- Create enum for call status
CREATE TYPE public.call_status AS ENUM ('in_progress', 'completed', 'failed', 'flagged');

-- Create enum for document types
CREATE TYPE public.document_type AS ENUM ('pay_stub', 'bank_statement', 'id_document', 'tax_return', 'other');

-- Create enum for verification status
CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'flagged', 'rejected');

-- Create tenants table
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create contacts table
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  monthly_income DECIMAL(10, 2),
  employer TEXT,
  employment_status TEXT,
  loan_amount_requested DECIMAL(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create call_sessions table
CREATE TABLE public.call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status call_status NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  sentiment_score DECIMAL(3, 2),
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create conversation_turns table
CREATE TABLE public.conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id UUID NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL CHECK (speaker IN ('agent', 'customer')),
  message TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create documents table
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  call_session_id UUID REFERENCES public.call_sessions(id) ON DELETE SET NULL,
  document_type document_type NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create verification_results table
CREATE TABLE public.verification_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  status verification_status NOT NULL DEFAULT 'pending',
  extracted_data JSONB,
  confidence_score DECIMAL(3, 2),
  flags JSONB,
  notes TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_results ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies for tenants
CREATE POLICY "Users can view their tenant"
  ON public.tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

-- Create RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Create RLS Policies for contacts
CREATE POLICY "Users can view contacts in their tenant"
  ON public.contacts FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert contacts in their tenant"
  ON public.contacts FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can update contacts in their tenant"
  ON public.contacts FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

-- Create RLS Policies for call_sessions
CREATE POLICY "Users can view call sessions in their tenant"
  ON public.call_sessions FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert call sessions in their tenant"
  ON public.call_sessions FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can update call sessions in their tenant"
  ON public.call_sessions FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

-- Create RLS Policies for conversation_turns
CREATE POLICY "Users can view conversation turns in their tenant"
  ON public.conversation_turns FOR SELECT
  USING (call_session_id IN (
    SELECT id FROM public.call_sessions 
    WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid())
  ));

CREATE POLICY "Users can insert conversation turns in their tenant"
  ON public.conversation_turns FOR INSERT
  WITH CHECK (call_session_id IN (
    SELECT id FROM public.call_sessions 
    WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid())
  ));

-- Create RLS Policies for documents
CREATE POLICY "Users can view documents in their tenant"
  ON public.documents FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert documents in their tenant"
  ON public.documents FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can update documents in their tenant"
  ON public.documents FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

-- Create RLS Policies for verification_results
CREATE POLICY "Users can view verification results in their tenant"
  ON public.verification_results FOR SELECT
  USING (document_id IN (
    SELECT id FROM public.documents 
    WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid())
  ));

CREATE POLICY "Users can insert verification results in their tenant"
  ON public.verification_results FOR INSERT
  WITH CHECK (document_id IN (
    SELECT id FROM public.documents 
    WHERE tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid())
  ));

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_tenant_id UUID;
BEGIN
  -- Create a default tenant for the user
  INSERT INTO public.tenants (name)
  VALUES ('Demo Tenant')
  RETURNING id INTO default_tenant_id;

  -- Insert profile for new user
  INSERT INTO public.profiles (user_id, tenant_id, full_name, email)
  VALUES (
    NEW.id,
    default_tenant_id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false);

-- Create storage policies
CREATE POLICY "Users can upload documents to their tenant"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view documents in their tenant"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete documents in their tenant"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.profiles WHERE user_id = auth.uid()
    )
  );