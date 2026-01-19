# AgilePlan Database Setup Guide

## Current State

**AgilePlan now supports multiple deployment options:**
- ✅ Docker PostgreSQL with Express backend (production-ready)
- ✅ Production backend API
- ✅ localStorage fallback (offline mode)

## Recommended Approach: Hybrid Strategy

### Option 1: Supabase (Recommended for Development)

**Pros:**
- ✅ Fastest setup (5 minutes)
- ✅ Built-in authentication
- ✅ Real-time subscriptions (live updates)
- ✅ Local Supabase CLI support
- ✅ Automatic API generation
- ✅ Built-in file storage for attachments

**Cons:**
- ⚠️ Vendor lock-in (can migrate later)
- ⚠️ Cloud dependency (unless using local Supabase)

**Setup Steps:**

1. **Install Supabase CLI** (if not already installed):
```bash
npm install -g supabase
```

2. **Start Local Supabase**:
```bash
supabase start
```

3. **Run Migration**:
```bash
supabase migration up
# Or apply the migration file:
supabase db reset
```

4. **Use Supabase Client** in AgilePlan:
```typescript
import { supabase } from '@/integrations/supabase/client';

// Load boards
const { data: boards } = await supabase
  .from('kanban_boards')
  .select('*, columns(*, tasks(*))')
  .eq('tenant_id', tenantId);
```

### Option 2: Docker PostgreSQL + Express Backend (Recommended for Production)

**Pros:**
- ✅ Full control
- ✅ No vendor lock-in
- ✅ Better performance
- ✅ Aligns with existing backend architecture
- ✅ Can use existing Docker setup

**Cons:**
- ⚠️ More setup required
- ⚠️ Need to build API endpoints
- ⚠️ Manual real-time implementation

**Setup Steps:**

1. **Start PostgreSQL**:
```bash
docker-compose up -d postgres
```

2. **Run Migration** (using existing database connection):
```bash
# Connect to database
psql -h localhost -U postgres -d coheus -f supabase/migrations/20251211000000_agileplan.sql
```

3. **Create API Routes** in `server/src/routes/agileplan.ts`:
```typescript
import { Router } from 'express';
import { pool } from '../config/database.js';

const router = Router();

// GET /api/agileplan/boards
router.get('/boards', async (req, res) => {
  // Fetch boards with columns and tasks
});

// POST /api/agileplan/tasks
router.post('/tasks', async (req, res) => {
  // Create task
});

// PUT /api/agileplan/tasks/:id/move
router.put('/tasks/:id/move', async (req, res) => {
  // Move task between columns
});
```

4. **Update Frontend** to use API instead of localStorage

## Database Schema

The migration file `supabase/migrations/20251211000000_agileplan.sql` creates:

- **kanban_boards** - Board instances
- **kanban_columns** - Columns (Backlogs, Doing Now, etc.)
- **kanban_tasks** - Tasks/cards
- **kanban_task_tags** - Task tags (many-to-many)
- **kanban_comments** - Task comments
- **kanban_attachments** - File attachments
- **kanban_activities** - Audit trail/history

## Migration Strategy

### Phase 1: Add Database Support (Keep localStorage as Fallback)
- Add database functions alongside localStorage
- Use database when available, fallback to localStorage
- Allows gradual migration

### Phase 2: Full Database Migration
- Remove localStorage dependency
- All data in database
- Real-time sync via Supabase or WebSocket

### Phase 3: Multi-User Support
- Add tenant/user isolation
- Real-time collaboration
- Activity feed with user attribution

## Best Practice: Use Supabase for Now

**Recommended immediate approach:**

1. **Use Supabase locally** for development
   - Fast iteration
   - Real-time features
   - Easy testing

2. **Keep Docker PostgreSQL** for production
   - Full control
   - Better performance
   - No vendor dependency

3. **Migration path:**
   - Develop with Supabase
   - Export schema to Docker PostgreSQL
   - Use same schema in both

## Quick Start: Supabase Local

```bash
# 1. Start Supabase locally
supabase start

# 2. Apply migration
supabase migration up

# 3. Get connection details
supabase status

# 4. Update .env with local Supabase URL and key
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<from supabase status>
```

## Quick Start: Docker PostgreSQL

```bash
# 1. Start PostgreSQL
docker-compose up -d postgres

# 2. Run migration
psql -h localhost -U postgres -d coheus < supabase/migrations/20251211000000_agileplan.sql

# 3. Create Express API routes
# (See server/src/routes/agileplan.ts example above)
```

## Next Steps

1. Choose your approach (Supabase or Docker + Express)
2. Run the migration
3. Create API client/service layer
4. Update AgilePlan component to use database
5. Add real-time sync (Supabase subscriptions or WebSocket)
