import { Response } from 'express';
import { pool } from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';

// Type definitions for Kanban board (avoid importing from frontend)
interface Task {
  id: string;
  content?: string;
  status?: string;
  title?: string;
  description?: string;
  priority?: string;
  assignee?: string;
  dueDate?: string;
  week?: string;
  dateRange?: string;
  tags?: string[];
  comments?: any[];
  attachments?: any[];
  subtasks?: Array<{ id: string; text: string; completed: boolean }>;
  dependencies?: string[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface Column {
  id: string;
  title: string;
  taskIds?: string[];
  tasks?: Task[];
  color?: string;
}

/**
 * Get tenant ID from user profile
 */
async function getTenantId(userId: string): Promise<string | null> {
  const result = await pool.query(
    'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
    [userId]
  );
  return result.rows[0]?.tenant_id || null;
}

/**
 * Get or create default board for tenant
 */
async function getOrCreateBoard(tenantId: string): Promise<string> {
  // Check if board exists
  const existing = await pool.query(
    'SELECT id FROM public.kanban_boards WHERE tenant_id = $1 LIMIT 1',
    [tenantId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new board
  const result = await pool.query(
    'INSERT INTO public.kanban_boards (tenant_id, name) VALUES ($1, $2) RETURNING id',
    [tenantId, 'Coheus by Teraverde']
  );

  return result.rows[0].id;
}

/**
 * Convert database column to Column interface
 */
async function dbColumnToColumn(dbColumn: any, boardId: string): Promise<Column> {
  // Get tasks for this column
  const tasksResult = await pool.query(
    `SELECT 
      t.id, t.title, t.description, t.priority, t.due_date, t.week, t.date_range,
      t.position,
      COALESCE(
        json_agg(DISTINCT tag.tag) FILTER (WHERE tag.tag IS NOT NULL),
        '[]'::json
      ) as tags,
      COALESCE(
        json_agg(
          DISTINCT json_build_object(
            'id', c.id, 'text', c.text, 'author', p.full_name,
            'authorAvatar', p.avatar_url, 'createdAt', c.created_at
          )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
      ) as comments
    FROM public.kanban_tasks t
    LEFT JOIN public.kanban_task_tags tag ON t.id = tag.task_id
    LEFT JOIN public.kanban_comments c ON t.id = c.task_id
    LEFT JOIN public.profiles p ON c.author_id = p.id
    WHERE t.column_id = $1 AND t.board_id = $2
    GROUP BY t.id, t.title, t.description, t.priority, t.due_date, t.week, t.date_range, t.position
    ORDER BY t.position ASC`,
    [dbColumn.id, boardId]
  );

  const tasks: Task[] = tasksResult.rows.map((row: any) => {
    // Handle tags - could be array or JSON string
    let tags: string[] = [];
    if (row.tags) {
      if (Array.isArray(row.tags)) {
        tags = row.tags;
      } else if (typeof row.tags === 'string') {
        try {
          const parsed = JSON.parse(row.tags);
          tags = Array.isArray(parsed) ? parsed : [];
        } catch {
          tags = [];
        }
      }
    }

    // Handle comments - could be array or JSON string
    let comments: any[] = [];
    if (row.comments) {
      if (Array.isArray(row.comments)) {
        comments = row.comments;
      } else if (typeof row.comments === 'string') {
        try {
          const parsed = JSON.parse(row.comments);
          comments = Array.isArray(parsed) ? parsed : [];
        } catch {
          comments = [];
        }
      }
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      priority: (row.priority || 'medium') as 'low' | 'medium' | 'high',
      dueDate: row.due_date ? new Date(row.due_date).toISOString().split('T')[0] : undefined,
      week: row.week || '',
      dateRange: row.date_range || '',
      tags,
      comments: comments.map((c: any) => ({
        id: c.id,
        text: c.text,
        author: c.author || 'Unknown',
        authorAvatar: c.authorAvatar,
        createdAt: new Date(c.createdAt),
      })),
      attachments: [], // TODO: Load attachments if needed
    };
  });

  return {
    id: dbColumn.id,
    title: dbColumn.title,
    color: dbColumn.color,
    tasks,
  };
}

/**
 * GET /api/agileplan/boards
 * Get all boards/columns for tenant
 */
export async function getBoards(req: AuthRequest, res: Response) {
  try {
    const tenantId = await getTenantId(req.userId!);
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const boardId = await getOrCreateBoard(tenantId);

    // Get all columns for this board
    const columnsResult = await pool.query(
      'SELECT * FROM public.kanban_columns WHERE board_id = $1 ORDER BY position ASC',
      [boardId]
    );

    // If no columns exist, return empty array (frontend will initialize)
    if (columnsResult.rows.length === 0) {
      return res.json({ columns: [] });
    }

    // Convert to Column format
    const columns = await Promise.all(
      columnsResult.rows.map((col) => dbColumnToColumn(col, boardId))
    );

    res.json({ columns });
  } catch (error) {
    console.error('Error getting boards:', error);
    res.status(500).json({ error: 'Failed to get boards' });
  }
}

/**
 * POST /api/agileplan/boards
 * Save board/columns
 */
export async function saveBoard(req: AuthRequest, res: Response) {
  try {
    const tenantId = await getTenantId(req.userId!);
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { columns } = req.body as { columns: Column[] };
    const boardId = await getOrCreateBoard(tenantId);

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Delete existing columns (cascade will delete tasks)
      await pool.query('DELETE FROM public.kanban_columns WHERE board_id = $1', [boardId]);

      // Insert columns and tasks
      for (let i = 0; i < columns.length; i++) {
        const column = columns[i];

        // Insert column
        const columnResult = await pool.query(
          'INSERT INTO public.kanban_columns (board_id, title, color, position) VALUES ($1, $2, $3, $4) RETURNING id',
          [boardId, column.title, column.color || null, i]
        );

        const columnId = columnResult.rows[0].id;

        // Insert tasks
        for (let j = 0; j < column.tasks.length; j++) {
          const task = column.tasks[j];

          const taskResult = await pool.query(
            `INSERT INTO public.kanban_tasks 
              (column_id, board_id, title, description, priority, due_date, week, date_range, position)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              columnId,
              boardId,
              task.title,
              task.description || null,
              task.priority || 'medium',
              task.dueDate || null,
              task.week || null,
              task.dateRange || null,
              j,
            ]
          );

          const taskId = taskResult.rows[0].id;

          // Insert tags
          if (task.tags && task.tags.length > 0) {
            for (const tag of task.tags) {
              await pool.query(
                'INSERT INTO public.kanban_task_tags (task_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [taskId, tag]
              );
            }
          }

          // Insert comments
          if (task.comments && task.comments.length > 0) {
            for (const comment of task.comments) {
              await pool.query(
                'INSERT INTO public.kanban_comments (task_id, author_id, text) VALUES ($1, $2, $3)',
                [taskId, req.userId, comment.text]
              );
            }
          }
        }
      }

      await pool.query('COMMIT');
      res.json({ success: true });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error saving board:', error);
    res.status(500).json({ error: 'Failed to save board' });
  }
}

/**
 * GET /api/agileplan/boards/:boardId/columns
 * Get columns for a board
 */
export async function getColumns(req: AuthRequest, res: Response) {
  try {
    const boardId = req.params.boardId as string;
    const tenantId = await getTenantId(req.userId!);

    // Verify board belongs to tenant
    const boardResult = await pool.query(
      'SELECT id FROM public.kanban_boards WHERE id = $1 AND tenant_id = $2',
      [boardId, tenantId]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const columnsResult = await pool.query(
      'SELECT * FROM public.kanban_columns WHERE board_id = $1 ORDER BY position ASC',
      [boardId]
    );

    const columns = await Promise.all(
      columnsResult.rows.map((col) => dbColumnToColumn(col, boardId))
    );

    res.json({ columns });
  } catch (error) {
    console.error('Error getting columns:', error);
    res.status(500).json({ error: 'Failed to get columns' });
  }
}

/**
 * POST /api/agileplan/columns
 * Create a new column
 */
export async function createColumn(req: AuthRequest, res: Response) {
  try {
    const { title, color, boardId } = req.body;
    const tenantId = await getTenantId(req.userId!);

    // Verify board belongs to tenant
    const boardResult = await pool.query(
      'SELECT id FROM public.kanban_boards WHERE id = $1 AND tenant_id = $2',
      [boardId, tenantId]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Get max position
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 as position FROM public.kanban_columns WHERE board_id = $1',
      [boardId]
    );

    const position = positionResult.rows[0].position;

    const result = await pool.query(
      'INSERT INTO public.kanban_columns (board_id, title, color, position) VALUES ($1, $2, $3, $4) RETURNING *',
      [boardId, title, color || null, position]
    );

    const column = await dbColumnToColumn(result.rows[0], boardId);
    res.json(column);
  } catch (error) {
    console.error('Error creating column:', error);
    res.status(500).json({ error: 'Failed to create column' });
  }
}

/**
 * PUT /api/agileplan/columns/:id
 * Update a column
 */
export async function updateColumn(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { title, color } = req.body;
    const tenantId = await getTenantId(req.userId!);

    // Verify column belongs to tenant's board
    const columnResult = await pool.query(
      `SELECT c.* FROM public.kanban_columns c
       JOIN public.kanban_boards b ON c.board_id = b.id
       WHERE c.id = $1 AND b.tenant_id = $2`,
      [id, tenantId]
    );

    if (columnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    await pool.query(
      'UPDATE public.kanban_columns SET title = $1, color = $2 WHERE id = $3',
      [title, color || null, id]
    );

    const updated = await pool.query('SELECT * FROM public.kanban_columns WHERE id = $1', [id]);
    const column = await dbColumnToColumn(updated.rows[0], updated.rows[0].board_id);

    res.json(column);
  } catch (error) {
    console.error('Error updating column:', error);
    res.status(500).json({ error: 'Failed to update column' });
  }
}

/**
 * DELETE /api/agileplan/columns/:id
 * Delete a column
 */
export async function deleteColumn(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const tenantId = await getTenantId(req.userId!);

    // Verify column belongs to tenant's board
    const columnResult = await pool.query(
      `SELECT c.* FROM public.kanban_columns c
       JOIN public.kanban_boards b ON c.board_id = b.id
       WHERE c.id = $1 AND b.tenant_id = $2`,
      [id, tenantId]
    );

    if (columnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    await pool.query('DELETE FROM public.kanban_columns WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting column:', error);
    res.status(500).json({ error: 'Failed to delete column' });
  }
}

/**
 * POST /api/agileplan/tasks
 * Create a new task
 */
export async function createTask(req: AuthRequest, res: Response) {
  try {
    const { columnId, ...taskData } = req.body;
    const tenantId = await getTenantId(req.userId!);

    // Verify column belongs to tenant's board
    const columnResult = await pool.query(
      `SELECT c.*, b.id as board_id FROM public.kanban_columns c
       JOIN public.kanban_boards b ON c.board_id = b.id
       WHERE c.id = $1 AND b.tenant_id = $2`,
      [columnId, tenantId]
    );

    if (columnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    const boardId = columnResult.rows[0].board_id;

    // Get max position
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 as position FROM public.kanban_tasks WHERE column_id = $1',
      [columnId]
    );

    const position = positionResult.rows[0].position;

    const taskResult = await pool.query(
      `INSERT INTO public.kanban_tasks 
        (column_id, board_id, title, description, priority, due_date, week, date_range, position, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        columnId,
        boardId,
        taskData.title,
        taskData.description || null,
        taskData.priority || 'medium',
        taskData.dueDate || null,
        taskData.week || null,
        taskData.dateRange || null,
        position,
        req.userId,
      ]
    );

    const taskId = taskResult.rows[0].id;

    // Insert tags
    if (taskData.tags && taskData.tags.length > 0) {
      for (const tag of taskData.tags) {
        await pool.query(
          'INSERT INTO public.kanban_task_tags (task_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [taskId, tag]
        );
      }
    }

    // Get the created task
    const taskWithTagsResult = await pool.query(
      `SELECT 
        t.id, t.title, t.description, t.priority, t.due_date, t.week, t.date_range,
        COALESCE(
          json_agg(DISTINCT tag.tag) FILTER (WHERE tag.tag IS NOT NULL),
          '[]'::json
        ) as tags
      FROM public.kanban_tasks t
      LEFT JOIN public.kanban_task_tags tag ON t.id = tag.task_id
      WHERE t.id = $1
      GROUP BY t.id, t.title, t.description, t.priority, t.due_date, t.week, t.date_range`,
      [taskId]
    );

    const row = taskWithTagsResult.rows[0];
    let tags: string[] = [];
    if (row.tags) {
      if (Array.isArray(row.tags)) {
        tags = row.tags;
      } else if (typeof row.tags === 'string') {
        try {
          const parsed = JSON.parse(row.tags);
          tags = Array.isArray(parsed) ? parsed : [];
        } catch {
          tags = [];
        }
      }
    }

    const createdTask: Task = {
      id: row.id,
      title: row.title,
      description: row.description || '',
      priority: (row.priority || 'medium') as 'low' | 'medium' | 'high',
      dueDate: row.due_date ? new Date(row.due_date).toISOString().split('T')[0] : undefined,
      week: row.week || '',
      dateRange: row.date_range || '',
      tags,
      comments: [],
      attachments: [],
    };

    res.json(createdTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
}

/**
 * PUT /api/agileplan/tasks/:id
 * Update a task
 */
export async function updateTask(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const taskData = req.body;
    const tenantId = await getTenantId(req.userId!);

    // Verify task belongs to tenant's board
    const taskResult = await pool.query(
      `SELECT t.* FROM public.kanban_tasks t
       JOIN public.kanban_boards b ON t.board_id = b.id
       WHERE t.id = $1 AND b.tenant_id = $2`,
      [id, tenantId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await pool.query(
      `UPDATE public.kanban_tasks 
       SET title = $1, description = $2, priority = $3, due_date = $4, week = $5, date_range = $6
       WHERE id = $7`,
      [
        taskData.title,
        taskData.description || null,
        taskData.priority || 'medium',
        taskData.dueDate || null,
        taskData.week || null,
        taskData.dateRange || null,
        id,
      ]
    );

    // Update tags
    if (taskData.tags) {
      await pool.query('DELETE FROM public.kanban_task_tags WHERE task_id = $1', [id]);
      for (const tag of taskData.tags) {
        await pool.query(
          'INSERT INTO public.kanban_task_tags (task_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, tag]
        );
      }
    }

    // Get the updated task with tags
    const updatedTaskResult = await pool.query(
      `SELECT 
        t.id, t.title, t.description, t.priority, t.due_date, t.week, t.date_range,
        COALESCE(
          json_agg(DISTINCT tag.tag) FILTER (WHERE tag.tag IS NOT NULL),
          '[]'::json
        ) as tags
      FROM public.kanban_tasks t
      LEFT JOIN public.kanban_task_tags tag ON t.id = tag.task_id
      WHERE t.id = $1
      GROUP BY t.id, t.title, t.description, t.priority, t.due_date, t.week, t.date_range`,
      [id]
    );

    const row = updatedTaskResult.rows[0];
    let tags: string[] = [];
    if (row.tags) {
      if (Array.isArray(row.tags)) {
        tags = row.tags;
      } else if (typeof row.tags === 'string') {
        try {
          const parsed = JSON.parse(row.tags);
          tags = Array.isArray(parsed) ? parsed : [];
        } catch {
          tags = [];
        }
      }
    }

    const task: Task = {
      id: row.id,
      title: row.title,
      description: row.description || '',
      priority: (row.priority || 'medium') as 'low' | 'medium' | 'high',
      dueDate: row.due_date ? new Date(row.due_date).toISOString().split('T')[0] : undefined,
      week: row.week || '',
      dateRange: row.date_range || '',
      tags,
      comments: [],
      attachments: [],
    };

    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
}

/**
 * PUT /api/agileplan/tasks/:id/move
 * Move a task between columns
 */
export async function moveTask(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { fromColumnId, toColumnId, position } = req.body;
    const tenantId = await getTenantId(req.userId!);

    // Verify task belongs to tenant's board
    const taskResult = await pool.query(
      `SELECT t.* FROM public.kanban_tasks t
       JOIN public.kanban_boards b ON t.board_id = b.id
       WHERE t.id = $1 AND b.tenant_id = $2`,
      [id, tenantId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Verify columns belong to same board
    const columnResult = await pool.query(
      `SELECT c.* FROM public.kanban_columns c
       JOIN public.kanban_boards b ON c.board_id = b.id
       WHERE c.id IN ($1, $2) AND b.tenant_id = $3`,
      [fromColumnId, toColumnId, tenantId]
    );

    if (columnResult.rows.length !== 2) {
      return res.status(400).json({ error: 'Invalid columns' });
    }

    const newPosition = position !== undefined ? position : 0;

    // Update task
    await pool.query(
      'UPDATE public.kanban_tasks SET column_id = $1, position = $2 WHERE id = $3',
      [toColumnId, newPosition, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error moving task:', error);
    res.status(500).json({ error: 'Failed to move task' });
  }
}

/**
 * DELETE /api/agileplan/tasks/:id
 * Delete a task
 */
export async function deleteTask(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const tenantId = await getTenantId(req.userId!);

    // Verify task belongs to tenant's board
    const taskResult = await pool.query(
      `SELECT t.* FROM public.kanban_tasks t
       JOIN public.kanban_boards b ON t.board_id = b.id
       WHERE t.id = $1 AND b.tenant_id = $2`,
      [id, tenantId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await pool.query('DELETE FROM public.kanban_tasks WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
}

/**
 * GET /api/agileplan/activities
 * Get activity log
 */
export async function getActivities(req: AuthRequest, res: Response) {
  try {
    const tenantId = await getTenantId(req.userId!);
    const boardId = await getOrCreateBoard(tenantId);

    const result = await pool.query(
      `SELECT a.*, p.full_name as user_name
       FROM public.kanban_activities a
       LEFT JOIN public.profiles p ON a.user_id = p.id
       WHERE a.board_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [boardId]
    );

    res.json({ activities: result.rows });
  } catch (error) {
    console.error('Error getting activities:', error);
    res.status(500).json({ error: 'Failed to get activities' });
  }
}

/**
 * POST /api/agileplan/activities
 * Log an activity
 */
export async function logActivity(req: AuthRequest, res: Response) {
  try {
    const { type, description, taskTitle, fromColumn, toColumn, user } = req.body;
    const tenantId = await getTenantId(req.userId!);
    const boardId = await getOrCreateBoard(tenantId);

    // Get task ID if taskTitle is provided
    let taskId = null;
    if (taskTitle) {
      const taskResult = await pool.query(
        'SELECT id FROM public.kanban_tasks WHERE title = $1 AND board_id = $2 LIMIT 1',
        [taskTitle, boardId]
      );
      taskId = taskResult.rows[0]?.id || null;
    }

    // Get column IDs if provided
    let fromColumnId = null;
    let toColumnId = null;
    if (fromColumn) {
      const colResult = await pool.query(
        'SELECT id FROM public.kanban_columns WHERE title = $1 AND board_id = $2 LIMIT 1',
        [fromColumn, boardId]
      );
      fromColumnId = colResult.rows[0]?.id || null;
    }
    if (toColumn) {
      const colResult = await pool.query(
        'SELECT id FROM public.kanban_columns WHERE title = $1 AND board_id = $2 LIMIT 1',
        [toColumn, boardId]
      );
      toColumnId = colResult.rows[0]?.id || null;
    }

    await pool.query(
      `INSERT INTO public.kanban_activities 
        (board_id, task_id, activity_type, description, from_column_id, to_column_id, user_id, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        boardId,
        taskId,
        type,
        description,
        fromColumnId,
        toColumnId,
        req.userId,
        JSON.stringify({ user }),
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error logging activity:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
}
