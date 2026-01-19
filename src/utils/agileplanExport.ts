import { Task, Column } from '@/components/ui/kanban-board';

export interface ExportTask {
  // Core fields
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string;
  status: string; // Column name
  
  // Build Timeline fields
  week: string;
  dateRange: string;
  tags: string[];
  
  // Jira-specific fields
  issueType?: string;
  project?: string;
  assignee?: string;
  jiraLabels?: string[];
  components?: string[];
  epicLink?: string;
  sprint?: string;
  
  // Trello-specific fields
  listName?: string;
  cardName?: string;
  cardDesc?: string;
  due?: string;
  trelloLabels?: string[];
  members?: string[];
  checklist?: string[];
  
  // Metadata
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Extract all tasks from columns and format for export
 */
export function extractTasksForExport(columns: Column[]): ExportTask[] {
  const tasks: ExportTask[] = [];
  
  columns.forEach((column) => {
    column.tasks.forEach((task) => {
      tasks.push({
        id: task.id,
        title: task.title,
        description: task.description || '',
        priority: task.priority || 'medium',
        dueDate: task.dueDate || '',
        status: column.title,
        week: task.week || '',
        dateRange: task.dateRange || '',
        tags: task.tags || [],
        
        // Jira fields
        issueType: 'Task',
        project: 'COHEUS',
        jiraLabels: task.tags || [],
        components: ['Backend', 'Infrastructure'],
        sprint: task.week || '',
        
        // Trello fields
        listName: column.title,
        cardName: task.title,
        cardDesc: task.description || '',
        due: task.dueDate || '',
        checklist: task.description ? [task.description] : [],
      });
    });
  });
  
  return tasks.sort((a, b) => {
    if (!a.dueDate || !b.dueDate) return 0;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
}

/**
 * Export tasks as JSON (Jira/Trello compatible)
 */
export function exportTasksAsJSON(columns: Column[], format: 'jira' | 'trello' | 'generic' = 'generic'): string {
  const tasks = extractTasksForExport(columns);
  
  if (format === 'jira') {
    // Jira JSON import format
    const jiraIssues = tasks.map((task) => ({
      fields: {
        project: { key: 'COHEUS' },
        summary: task.title,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: task.description || task.title,
                },
              ],
            },
          ],
        },
        issuetype: { name: 'Task' },
        priority: { name: task.priority === 'high' ? 'High' : task.priority === 'medium' ? 'Medium' : 'Low' },
        duedate: task.dueDate || null,
        labels: task.tags || [],
        components: [{ name: 'Backend' }],
        customfield_10020: task.week || '', // Sprint field (if using Jira Software)
      },
    }));
    
    return JSON.stringify({ issues: jiraIssues }, null, 2);
  }
  
  if (format === 'trello') {
    // Trello JSON format (for Trello Power-Ups or API)
    const trelloCards = tasks.map((task) => ({
      name: task.title,
      desc: task.description || '',
      due: task.dueDate || null,
      idList: task.status, // Would need actual list ID in real Trello
      pos: 'bottom',
      labels: task.tags?.map((tag) => ({ name: tag, color: 'blue' })) || [],
      checklists: task.description
        ? [
            {
              name: 'Details',
              checkItems: [{ name: task.description, pos: 0 }],
            },
          ]
        : [],
    }));
    
    return JSON.stringify({ cards: trelloCards }, null, 2);
  }
  
  // Generic JSON format
  return JSON.stringify(tasks, null, 2);
}

/**
 * Export tasks as CSV (Jira/Trello compatible)
 */
export function exportTasksAsCSV(columns: Column[], format: 'jira' | 'trello' | 'generic' = 'generic'): string {
  const tasks = extractTasksForExport(columns);
  
  if (format === 'jira') {
    // Jira CSV import format
    const headers = [
      'Summary',
      'Issue Type',
      'Description',
      'Priority',
      'Due Date',
      'Labels',
      'Components',
      'Sprint',
      'Status',
    ];
    
    const rows = tasks.map((task) => [
      task.title,
      'Task',
      (task.description || '').replace(/"/g, '""'), // Escape quotes
      task.priority === 'high' ? 'High' : task.priority === 'medium' ? 'Medium' : 'Low',
      task.dueDate || '',
      (task.tags || []).join(';'),
      'Backend',
      task.week || '',
      task.status,
    ]);
    
    const csvRows = [headers, ...rows].map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    );
    
    return csvRows.join('\n');
  }
  
  if (format === 'trello') {
    // Trello CSV format
    const headers = [
      'Card Name',
      'List Name',
      'Card Description',
      'Due Date',
      'Labels',
      'Checklist',
      'Priority',
      'Week',
      'Date Range',
    ];
    
    const rows = tasks.map((task) => [
      task.title,
      task.status,
      (task.description || '').replace(/"/g, '""'),
      task.dueDate || '',
      (task.tags || []).join(','),
      task.description || '',
      task.priority,
      task.week || '',
      task.dateRange || '',
    ]);
    
    const csvRows = [headers, ...rows].map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    );
    
    return csvRows.join('\n');
  }
  
  // Generic CSV format
  const headers = [
    'ID',
    'Title',
    'Description',
    'Priority',
    'Due Date',
    'Status',
    'Week',
    'Date Range',
    'Tags',
  ];
  
  const rows = tasks.map((task) => [
    task.id,
    task.title,
    (task.description || '').replace(/"/g, '""'),
    task.priority,
    task.dueDate || '',
    task.status,
    task.week || '',
    task.dateRange || '',
    (task.tags || []).join(';'),
  ]);
  
  const csvRows = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  
  return csvRows.join('\n');
}

/**
 * Download file helper
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
