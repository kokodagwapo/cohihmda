-- Add DELETE RLS policies to tables missing them

-- contacts: tenant-scoped delete
CREATE POLICY "Users can delete contacts in their tenant"
ON public.contacts
FOR DELETE
USING (tenant_id IN (
  SELECT profiles.tenant_id
  FROM profiles
  WHERE profiles.user_id = auth.uid()
));

-- documents: tenant-scoped delete
CREATE POLICY "Users can delete documents in their tenant"
ON public.documents
FOR DELETE
USING (tenant_id IN (
  SELECT profiles.tenant_id
  FROM profiles
  WHERE profiles.user_id = auth.uid()
));

-- conversation_turns: tenant-scoped delete via call_sessions
CREATE POLICY "Users can delete conversation turns in their tenant"
ON public.conversation_turns
FOR DELETE
USING (call_session_id IN (
  SELECT call_sessions.id
  FROM call_sessions
  WHERE call_sessions.tenant_id IN (
    SELECT profiles.tenant_id
    FROM profiles
    WHERE profiles.user_id = auth.uid()
  )
));

-- verification_results: tenant-scoped delete via documents
CREATE POLICY "Users can delete verification results in their tenant"
ON public.verification_results
FOR DELETE
USING (document_id IN (
  SELECT documents.id
  FROM documents
  WHERE documents.tenant_id IN (
    SELECT profiles.tenant_id
    FROM profiles
    WHERE profiles.user_id = auth.uid()
  )
));

-- call_sessions: tenant-scoped delete
CREATE POLICY "Users can delete call sessions in their tenant"
ON public.call_sessions
FOR DELETE
USING (tenant_id IN (
  SELECT profiles.tenant_id
  FROM profiles
  WHERE profiles.user_id = auth.uid()
));

-- profiles: users can delete their own profile
CREATE POLICY "Users can delete their own profile"
ON public.profiles
FOR DELETE
USING (user_id = auth.uid());