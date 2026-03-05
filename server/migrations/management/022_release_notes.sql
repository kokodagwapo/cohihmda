-- Release notes automation tables (management DB)

CREATE TABLE IF NOT EXISTS release_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  is_draft BOOLEAN NOT NULL DEFAULT true,
  email_sent_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_notes_is_draft ON release_notes(is_draft);
CREATE INDEX IF NOT EXISTS idx_release_notes_published_at ON release_notes(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_notes_created_at ON release_notes(created_at DESC);

CREATE TABLE IF NOT EXISTS release_note_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_note_id UUID NOT NULL REFERENCES release_notes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('feature', 'improvement', 'fix')),
  link TEXT,
  link_label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_note_entries_release_note_id
  ON release_note_entries(release_note_id, sort_order, created_at);
