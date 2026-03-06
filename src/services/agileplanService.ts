import { Column, Task } from '@/components/ui/kanban-board';
import { api } from '@/lib/api';

export type Environment = 'docker' | 'production' | 'offline';

export interface ChangeEvent {
  type: 'task_moved' | 'task_created' | 'task_updated' | 'task_deleted' | 'column_updated' | 'board_updated';
  taskId?: string;
  columnId?: string;
  boardId?: string;
  data?: any;
  timestamp: Date;
}

class AgilePlanService {
  private apiUrl: string | null = null;
  private environment: Environment = 'offline';
  private syncQueue: Array<{ operation: string; data: any; timestamp: number }> = [];
  private changeCallbacks: Set<(event: ChangeEvent) => void> = new Set();
  private syncInterval: number | null = null;
  private wsConnection: WebSocket | null = null;

  constructor() {
    this.detectEnvironment();
    this.startSyncQueueProcessor();
  }

  /**
   * Detect the current environment based on available API URLs
   */
  private detectEnvironment(): void {
    const agileplanApiUrl = import.meta.env.VITE_AGILEPLAN_API_URL;
    const apiUrl = import.meta.env.VITE_API_URL;

    // Use AgilePlan-specific URL if set, otherwise fall back to general API URL
    this.apiUrl = agileplanApiUrl || apiUrl || null;

    if (!this.apiUrl) {
      this.environment = 'offline';
      return;
    }

    // Determine environment based on URL
    if (this.apiUrl.includes('localhost') || this.apiUrl.includes('127.0.0.1')) {
      this.environment = 'docker';
    } else {
      this.environment = 'production';
    }
  }

  /**
   * Get the base API URL for requests
   */
  private getApiUrl(): string | null {
    return this.apiUrl;
  }

  /**
   * Check if backend is available
   */
  private async checkBackendAvailable(): Promise<boolean> {
    if (!this.apiUrl) return false;

    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Make API request with automatic fallback
   */
  private async apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const apiUrl = this.getApiUrl();
    
    if (!apiUrl) {
      throw new Error('No API URL configured');
    }

    const token = api.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${apiUrl}${endpoint}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      // Queue operation for retry if offline
      if (error instanceof Error && error.message.includes('fetch')) {
        this.queueOperation(endpoint, options);
      }
      throw error;
    }
  }

  /**
   * Queue an operation for later sync
   */
  private queueOperation(endpoint: string, options: RequestInit): void {
    this.syncQueue.push({
      operation: endpoint,
      data: options,
      timestamp: Date.now(),
    });
    localStorage.setItem('agileplan-sync-queue', JSON.stringify(this.syncQueue));
  }

  /**
   * Process queued operations when backend becomes available
   */
  private async processSyncQueue(): Promise<void> {
    if (this.syncQueue.length === 0) return;

    const isAvailable = await this.checkBackendAvailable();
    if (!isAvailable) return;

    const queue = [...this.syncQueue];
    this.syncQueue = [];

    for (const item of queue) {
      try {
        await this.apiRequest(item.operation, item.data);
      } catch (error) {
        // Re-queue failed operations
        this.syncQueue.push(item);
      }
    }

    localStorage.setItem('agileplan-sync-queue', JSON.stringify(this.syncQueue));
  }

  /**
   * Start processing sync queue periodically
   */
  private startSyncQueueProcessor(): void {
    if (this.syncInterval) return;

    this.syncInterval = window.setInterval(() => {
      this.processSyncQueue();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Load boards/columns for a tenant
   */
  async loadBoards(tenantId?: string): Promise<Column[]> {
    try {
      const boards = await this.apiRequest<{ columns: Column[] }>('/api/agileplan/boards');
      return boards.columns || [];
    } catch (error) {
      // Fallback to localStorage
      return this.loadFromLocalStorage();
    }
  }

  /**
   * Save board/columns
   */
  async saveBoard(columns: Column[], tenantId?: string): Promise<void> {
    try {
      await this.apiRequest('/api/agileplan/boards', {
        method: 'POST',
        body: JSON.stringify({ columns, tenantId }),
      });
      
      // Also save to localStorage as backup
      this.saveToLocalStorage(columns);
      
      // Notify subscribers
      this.notifyChange({
        type: 'board_updated',
        data: { columns },
        timestamp: new Date(),
      });
    } catch (error) {
      // Save to localStorage as fallback
      this.saveToLocalStorage(columns);
      throw error;
    }
  }

  /**
   * Load activity log (best-effort; returns [] if unavailable)
   */
  async loadActivities(): Promise<any[]> {
    try {
      const response = await this.apiRequest<{ activities: any[] }>('/api/agileplan/activities', { method: 'GET' });
      const activities = response.activities || [];
      return activities.map((a) => ({
        id: a.id ?? `activity-${Date.now()}`,
        type: a.type,
        description: a.description,
        taskTitle: a.task_title ?? a.taskTitle,
        fromColumn: a.from_column ?? a.fromColumn,
        toColumn: a.to_column ?? a.toColumn,
        user: a.user ?? a.user_name ?? 'User',
        timestamp: new Date(a.created_at ?? a.timestamp ?? Date.now()),
      }));
    } catch (error) {
      // Activities are non-critical; fail silently
      return [];
    }
  }

  /**
   * Move a task between columns
   */
  async moveTask(
    taskId: string,
    fromColumnId: string,
    toColumnId: string,
    newPosition?: number
  ): Promise<void> {
    try {
      await this.apiRequest(`/api/agileplan/tasks/${taskId}/move`, {
        method: 'PUT',
        body: JSON.stringify({ fromColumnId, toColumnId, position: newPosition }),
      });

      this.notifyChange({
        type: 'task_moved',
        taskId,
        columnId: toColumnId,
        data: { fromColumnId, toColumnId },
        timestamp: new Date(),
      });
    } catch (error) {
      // Operation will be queued for retry
      throw error;
    }
  }

  /**
   * Create a new task
   */
  async createTask(task: Task, columnId: string): Promise<Task> {
    try {
      const created = await this.apiRequest<Task>('/api/agileplan/tasks', {
        method: 'POST',
        body: JSON.stringify({ ...task, columnId }),
      });

      this.notifyChange({
        type: 'task_created',
        taskId: created.id,
        columnId,
        data: { task: created },
        timestamp: new Date(),
      });

      return created;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update a task
   */
  async updateTask(task: Task): Promise<Task> {
    try {
      const updated = await this.apiRequest<Task>(`/api/agileplan/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify(task),
      });

      this.notifyChange({
        type: 'task_updated',
        taskId: task.id,
        data: { task: updated },
        timestamp: new Date(),
      });

      return updated;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    try {
      await this.apiRequest(`/api/agileplan/tasks/${taskId}`, {
        method: 'DELETE',
      });

      this.notifyChange({
        type: 'task_deleted',
        taskId,
        timestamp: new Date(),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create a column
   */
  async createColumn(column: Column, boardId?: string): Promise<Column> {
    try {
      const created = await this.apiRequest<Column>('/api/agileplan/columns', {
        method: 'POST',
        body: JSON.stringify({ ...column, boardId }),
      });

      this.notifyChange({
        type: 'column_updated',
        columnId: created.id,
        data: { column: created },
        timestamp: new Date(),
      });

      return created;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update a column
   */
  async updateColumn(column: Column): Promise<Column> {
    try {
      const updated = await this.apiRequest<Column>(`/api/agileplan/columns/${column.id}`, {
        method: 'PUT',
        body: JSON.stringify(column),
      });

      this.notifyChange({
        type: 'column_updated',
        columnId: column.id,
        data: { column: updated },
        timestamp: new Date(),
      });

      return updated;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete a column
   */
  async deleteColumn(columnId: string): Promise<void> {
    try {
      await this.apiRequest(`/api/agileplan/columns/${columnId}`, {
        method: 'DELETE',
      });

      this.notifyChange({
        type: 'column_updated',
        columnId,
        data: { deleted: true },
        timestamp: new Date(),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Log an activity
   */
  async logActivity(activity: {
    type: string;
    description: string;
    taskTitle?: string;
    fromColumn?: string;
    toColumn?: string;
    user?: string;
  }): Promise<void> {
    try {
      await this.apiRequest('/api/agileplan/activities', {
        method: 'POST',
        body: JSON.stringify(activity),
      });
    } catch (error) {
      // Silently fail - activities are not critical
      console.warn('Failed to log activity:', error);
    }
  }

  /**
   * Subscribe to real-time changes
   */
  subscribeToChanges(callback: (event: ChangeEvent) => void): () => void {
    this.changeCallbacks.add(callback);

    // Try to establish WebSocket connection if backend is available
    if (this.apiUrl && import.meta.env.VITE_AGILEPLAN_SYNC_ENABLED !== 'false') {
      this.connectWebSocket();
    }

    // Return unsubscribe function
    return () => {
      this.changeCallbacks.delete(callback);
      if (this.changeCallbacks.size === 0) {
        this.disconnectWebSocket();
      }
    };
  }

  /**
   * Connect to WebSocket for real-time updates
   */
  private connectWebSocket(): void {
    if (this.wsConnection?.readyState === WebSocket.OPEN) return;

    // Use getWebSocketUrl to get direct backend URL (bypasses CloudFront)
    import('@/lib/api').then(({ getWebSocketUrl, getWebSocketProtocol }) => {
      try {
        const backendUrl = getWebSocketUrl();
        // Remove protocol from backend URL and use appropriate WebSocket protocol
        const urlWithoutProtocol = backendUrl.replace(/^https?:\/\//, '');
        const wsProtocol = getWebSocketProtocol(backendUrl);
        const token = api.getToken() || '';
        const wsUrl = `${wsProtocol}${urlWithoutProtocol}/ws/agileplan?token=${encodeURIComponent(token)}`;
        
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('✅ AgilePlan WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const change: ChangeEvent = JSON.parse(event.data);
            this.notifyChange(change);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        ws.onerror = (error) => {
          console.warn('AgilePlan WebSocket error:', error);
        };

        ws.onclose = () => {
          console.log('AgilePlan WebSocket disconnected');
          // Attempt to reconnect after 5 seconds
          setTimeout(() => {
            if (this.changeCallbacks.size > 0) {
              this.connectWebSocket();
            }
          }, 5000);
        };

        this.wsConnection = ws;
      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
      }
    }).catch((error) => {
      console.error('Failed to import getWebSocketUrl:', error);
    });
  }

  /**
   * Disconnect WebSocket
   */
  private disconnectWebSocket(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }

  /**
   * Notify all subscribers of a change
   */
  private notifyChange(event: ChangeEvent): void {
    this.changeCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in change callback:', error);
      }
    });
  }

  /**
   * Load from localStorage (fallback)
   */
  private loadFromLocalStorage(): Column[] {
    try {
      const saved = localStorage.getItem('agileplan-columns');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
    }
    return [];
  }

  /**
   * Save to localStorage (fallback)
   */
  private saveToLocalStorage(columns: Column[]): void {
    try {
      localStorage.setItem('agileplan-columns', JSON.stringify(columns));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  }

  /**
   * Get current environment
   */
  getEnvironment(): Environment {
    return this.environment;
  }

  /**
   * Check if backend is available
   */
  async isBackendAvailable(): Promise<boolean> {
    return this.checkBackendAvailable();
  }
}

// Export singleton instance
export const agileplanService = new AgilePlanService();
