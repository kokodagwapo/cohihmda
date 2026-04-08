/**
 * Export AgilePlan Tasks to JSON and CSV
 * Compatible with Jira and Trello import formats
 * 
 * Run with: npx tsx scripts/exportAgilePlanTasks.ts
 */

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string;
  week: string;
  dateRange: string;
  tags: string[];
  status: string;
}

// All tasks from The Build Timeline (Dec 15, 2025 - Jan 23, 2026)
const allTasks: Task[] = [
  // Week 1: Foundation (Dec 15-19, 2025)
  {
    id: 'w1-1',
    title: 'AWS infrastructure setup',
    description: 'VPC, EC2, RDS, S3 configuration',
    priority: 'high',
    dueDate: '2025-12-15',
    week: 'Week 1',
    dateRange: 'Dec 15-19',
    tags: ['Week 1', 'December 2025', 'Foundation', 'Infrastructure', 'AWS'],
    status: 'Backlogs',
  },
  {
    id: 'w1-2',
    title: 'Architecture diagrams and decision docs',
    description: 'Create comprehensive architecture documentation',
    priority: 'high',
    dueDate: '2025-12-16',
    week: 'Week 1',
    dateRange: 'Dec 15-19',
    tags: ['Week 1', 'December 2025', 'Foundation', 'Documentation', 'Architecture'],
    status: 'Backlogs',
  },
  {
    id: 'w1-3',
    title: 'Database schema design',
    description: 'Design PostgreSQL schema with multi-tenant support',
    priority: 'high',
    dueDate: '2025-12-17',
    week: 'Week 1',
    dateRange: 'Dec 15-19',
    tags: ['Week 1', 'December 2025', 'Foundation', 'Database', 'PostgreSQL'],
    status: 'Backlogs',
  },
  {
    id: 'w1-4',
    title: 'Prisma ORM setup',
    description: 'Configure Prisma with database connection',
    priority: 'medium',
    dueDate: '2025-12-18',
    week: 'Week 1',
    dateRange: 'Dec 15-19',
    tags: ['Week 1', 'December 2025', 'Foundation', 'ORM', 'Prisma'],
    status: 'Backlogs',
  },
  {
    id: 'w1-5',
    title: 'Development environment',
    description: 'Docker, local setup, and development tooling',
    priority: 'medium',
    dueDate: '2025-12-19',
    week: 'Week 1',
    dateRange: 'Dec 15-19',
    tags: ['Week 1', 'December 2025', 'Foundation', 'DevOps', 'Docker'],
    status: 'Backlogs',
  },

  // Week 2: Core Backend (Dec 22-26, 2025)
  {
    id: 'w2-1',
    title: 'Authentication system',
    description: 'JWT + refresh tokens implementation',
    priority: 'high',
    dueDate: '2025-12-22',
    week: 'Week 2',
    dateRange: 'Dec 22-26',
    tags: ['Week 2', 'December 2025', 'Backend', 'Authentication', 'JWT'],
    status: 'Backlogs',
  },
  {
    id: 'w2-2',
    title: 'SSO implementation',
    description: 'AWS IAM + SAML integration',
    priority: 'high',
    dueDate: '2025-12-23',
    week: 'Week 2',
    dateRange: 'Dec 22-26',
    tags: ['Week 2', 'December 2025', 'Backend', 'SSO', 'SAML', 'AWS IAM'],
    status: 'Backlogs',
  },
  {
    id: 'w2-3',
    title: 'Multi-tenant isolation',
    description: 'Row-level security implementation',
    priority: 'high',
    dueDate: '2025-12-24',
    week: 'Week 2',
    dateRange: 'Dec 22-26',
    tags: ['Week 2', 'December 2025', 'Backend', 'Multi-tenant', 'Security'],
    status: 'Backlogs',
  },
  {
    id: 'w2-4',
    title: 'API Gateway and rate limiting',
    description: 'Configure API Gateway with rate limiting',
    priority: 'medium',
    dueDate: '2025-12-25',
    week: 'Week 2',
    dateRange: 'Dec 22-26',
    tags: ['Week 2', 'December 2025', 'Backend', 'API Gateway', 'Rate Limiting'],
    status: 'Backlogs',
  },
  {
    id: 'w2-5',
    title: 'Middleware',
    description: 'Auth, tenant resolution, logging middleware',
    priority: 'medium',
    dueDate: '2025-12-26',
    week: 'Week 2',
    dateRange: 'Dec 22-26',
    tags: ['Week 2', 'December 2025', 'Backend', 'Middleware', 'Express'],
    status: 'Backlogs',
  },

  // Week 3: LOS Connectors (Dec 29-Jan 2, 2025-2026)
  {
    id: 'w3-1',
    title: 'Universal loan schema',
    description: 'Canonical model design',
    priority: 'high',
    dueDate: '2025-12-29',
    week: 'Week 3',
    dateRange: 'Dec 29-Jan 2',
    tags: ['Week 3', 'December 2025', 'LOS Connectors', 'Schema', 'Data Model'],
    status: 'Backlogs',
  },
  {
    id: 'w3-2',
    title: 'Base connector class',
    description: 'Factory pattern implementation',
    priority: 'high',
    dueDate: '2025-12-30',
    week: 'Week 3',
    dateRange: 'Dec 29-Jan 2',
    tags: ['Week 3', 'December 2025', 'LOS Connectors', 'Design Patterns', 'Factory'],
    status: 'Backlogs',
  },
  {
    id: 'w3-3',
    title: 'Encompass connector',
    description: 'REST + OAuth integration',
    priority: 'high',
    dueDate: '2025-12-31',
    week: 'Week 3',
    dateRange: 'Dec 29-Jan 2',
    tags: ['Week 3', 'December 2025', 'LOS Connectors', 'Encompass', 'OAuth'],
    status: 'Backlogs',
  },
  {
    id: 'w3-4',
    title: 'Calyx connector',
    description: 'Database access implementation',
    priority: 'high',
    dueDate: '2026-01-01',
    week: 'Week 3',
    dateRange: 'Dec 29-Jan 2',
    tags: ['Week 3', 'January 2026', 'LOS Connectors', 'Calyx', 'Database'],
    status: 'Backlogs',
  },
  {
    id: 'w3-5',
    title: 'MeridianLink connector',
    description: 'API integration',
    priority: 'high',
    dueDate: '2026-01-02',
    week: 'Week 3',
    dateRange: 'Dec 29-Jan 2',
    tags: ['Week 3', 'January 2026', 'LOS Connectors', 'MeridianLink', 'API'],
    status: 'Backlogs',
  },

  // Week 4: Vendors & Security (Jan 5-9, 2026)
  {
    id: 'w4-1',
    title: 'Vendor connector framework',
    description: 'Generic vendor connector pattern',
    priority: 'high',
    dueDate: '2026-01-05',
    week: 'Week 4',
    dateRange: 'Jan 5-9',
    tags: ['Week 4', 'January 2026', 'Vendors', 'Framework', 'Connector Pattern'],
    status: 'Backlogs',
  },
  {
    id: 'w4-2',
    title: 'Credit bureau integration scaffold',
    description: 'Experian, Equifax, TransUnion integration',
    priority: 'high',
    dueDate: '2026-01-06',
    week: 'Week 4',
    dateRange: 'Jan 5-9',
    tags: ['Week 4', 'January 2026', 'Vendors', 'Credit Bureau', 'Experian', 'Equifax', 'TransUnion'],
    status: 'Backlogs',
  },
  {
    id: 'w4-3',
    title: 'Encryption implementation',
    description: 'KMS, field-level encryption',
    priority: 'high',
    dueDate: '2026-01-07',
    week: 'Week 4',
    dateRange: 'Jan 5-9',
    tags: ['Week 4', 'January 2026', 'Security', 'Encryption', 'KMS', 'AWS'],
    status: 'Backlogs',
  },
  {
    id: 'w4-4',
    title: 'SOC 2 controls',
    description: 'Audit logging and compliance controls',
    priority: 'high',
    dueDate: '2026-01-08',
    week: 'Week 4',
    dateRange: 'Jan 5-9',
    tags: ['Week 4', 'January 2026', 'Security', 'SOC 2', 'Compliance', 'Audit'],
    status: 'Backlogs',
  },
  {
    id: 'w4-5',
    title: 'Security testing',
    description: 'Penetration testing and vulnerability assessment',
    priority: 'medium',
    dueDate: '2026-01-09',
    week: 'Week 4',
    dateRange: 'Jan 5-9',
    tags: ['Week 4', 'January 2026', 'Security', 'Testing', 'Penetration Testing'],
    status: 'Backlogs',
  },

  // Week 5: RAG & AI (Jan 12-16, 2026)
  {
    id: 'w5-1',
    title: 'Document processing pipeline',
    description: 'Upload, extract, normalize, chunk documents',
    priority: 'high',
    dueDate: '2026-01-12',
    week: 'Week 5',
    dateRange: 'Jan 12-16',
    tags: ['Week 5', 'January 2026', 'RAG', 'AI', 'Document Processing', 'Pipeline'],
    status: 'Backlogs',
  },
  {
    id: 'w5-2',
    title: 'Embedding generation',
    description: 'OpenAI embeddings for document chunks',
    priority: 'high',
    dueDate: '2026-01-13',
    week: 'Week 5',
    dateRange: 'Jan 12-16',
    tags: ['Week 5', 'January 2026', 'RAG', 'AI', 'Embeddings', 'OpenAI'],
    status: 'Backlogs',
  },
  {
    id: 'w5-3',
    title: 'Pinecone integration',
    description: 'Vector database setup and indexing',
    priority: 'high',
    dueDate: '2026-01-14',
    week: 'Week 5',
    dateRange: 'Jan 12-16',
    tags: ['Week 5', 'January 2026', 'RAG', 'AI', 'Pinecone', 'Vector Database'],
    status: 'Backlogs',
  },
  {
    id: 'w5-4',
    title: 'RAG prompt engineering',
    description: 'Optimize prompts for accurate responses',
    priority: 'medium',
    dueDate: '2026-01-15',
    week: 'Week 5',
    dateRange: 'Jan 12-16',
    tags: ['Week 5', 'January 2026', 'RAG', 'AI', 'Prompt Engineering'],
    status: 'Backlogs',
  },
  {
    id: 'w5-5',
    title: 'Cohi voice AI integration',
    description: 'Gemini Live API integration',
    priority: 'high',
    dueDate: '2026-01-16',
    week: 'Week 5',
    dateRange: 'Jan 12-16',
    tags: ['Week 5', 'January 2026', 'AI', 'Voice', 'Cohi', 'Gemini'],
    status: 'Backlogs',
  },

  // Week 6: Launch Prep (Jan 19-23, 2026)
  {
    id: 'w6-1',
    title: 'Automated onboarding system',
    description: '30-minute onboarding flow implementation',
    priority: 'high',
    dueDate: '2026-01-19',
    week: 'Week 6',
    dateRange: 'Jan 19-23',
    tags: ['Week 6', 'January 2026', 'Launch Prep', 'Onboarding', 'UX'],
    status: 'Backlogs',
  },
  {
    id: 'w6-2',
    title: 'Video training platform',
    description: 'Training videos with quizzes',
    priority: 'medium',
    dueDate: '2026-01-20',
    week: 'Week 6',
    dateRange: 'Jan 19-23',
    tags: ['Week 6', 'January 2026', 'Launch Prep', 'Training', 'Documentation'],
    status: 'Backlogs',
  },
  {
    id: 'w6-3',
    title: 'Documentation',
    description: 'API docs, runbooks, user guides',
    priority: 'medium',
    dueDate: '2026-01-21',
    week: 'Week 6',
    dateRange: 'Jan 19-23',
    tags: ['Week 6', 'January 2026', 'Launch Prep', 'Documentation', 'API Docs'],
    status: 'Backlogs',
  },
  {
    id: 'w6-4',
    title: 'Performance testing',
    description: 'Load testing and optimization',
    priority: 'high',
    dueDate: '2026-01-22',
    week: 'Week 6',
    dateRange: 'Jan 19-23',
    tags: ['Week 6', 'January 2026', 'Launch Prep', 'Testing', 'Performance'],
    status: 'Backlogs',
  },
  {
    id: 'w6-5',
    title: 'Go/no-go review',
    description: 'Final polish and launch readiness review',
    priority: 'high',
    dueDate: '2026-01-23',
    week: 'Week 6',
    dateRange: 'Jan 19-23',
    tags: ['Week 6', 'January 2026', 'Launch Prep', 'Review', 'Launch'],
    status: 'Backlogs',
  },
];

// Jira JSON Export Format
function exportJiraJSON(tasks: Task[]): string {
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
                text: task.description,
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `\n\nWeek: ${task.week}\nDate Range: ${task.dateRange}\nDue Date: ${task.dueDate}`,
              },
            ],
          },
        ],
      },
      issuetype: { name: 'Task' },
      priority: {
        name: task.priority === 'high' ? 'Highest' : task.priority === 'medium' ? 'High' : 'Medium',
      },
      duedate: task.dueDate,
      labels: task.tags || [],
      components: [{ name: 'Backend' }, { name: 'Infrastructure' }],
      customfield_10020: task.week, // Sprint field (adjust based on your Jira setup)
      status: { name: task.status === 'Backlogs' ? 'To Do' : task.status },
    },
  }));

  return JSON.stringify({ issues: jiraIssues }, null, 2);
}

// Trello JSON Export Format
function exportTrelloJSON(tasks: Task[]): string {
  const trelloCards = tasks.map((task, index) => ({
    name: task.title,
    desc: `${task.description}\n\nWeek: ${task.week}\nDate Range: ${task.dateRange}\nDue Date: ${task.dueDate}`,
    due: task.dueDate ? `${task.dueDate}T17:00:00.000Z` : null,
    idList: task.status, // Would need actual list ID in Trello
    pos: index,
    labels: (task.tags || []).map((tag, idx) => ({
      name: tag,
      color: ['blue', 'green', 'orange', 'red', 'purple', 'yellow'][idx % 6],
    })),
    checklists: [
      {
        name: 'Task Details',
        checkItems: [
          { name: `Week: ${task.week}`, pos: 0 },
          { name: `Date Range: ${task.dateRange}`, pos: 1 },
          { name: `Priority: ${task.priority}`, pos: 2 },
        ],
      },
    ],
  }));

  return JSON.stringify({ cards: trelloCards }, null, 2);
}

// Generic JSON Export (Detailed)
function exportGenericJSON(tasks: Task[]): string {
  const exportData = {
    exportDate: new Date().toISOString(),
    project: 'Coheus v2 Backend',
    dateRange: {
      start: '2025-12-15',
      end: '2026-01-23',
    },
    totalTasks: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate,
      status: task.status,
      week: task.week,
      dateRange: task.dateRange,
      tags: task.tags,
      metadata: {
        createdAt: new Date().toISOString(),
        syncCompatible: {
          jira: true,
          trello: true,
          asana: true,
          monday: true,
        },
      },
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

// Jira CSV Export Format
function exportJiraCSV(tasks: Task[]): string {
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
    'Week',
    'Date Range',
  ];

  const rows = tasks.map((task) => [
    task.title,
    'Task',
    task.description.replace(/"/g, '""'),
    task.priority === 'high' ? 'High' : task.priority === 'medium' ? 'Medium' : 'Low',
    task.dueDate,
    (task.tags || []).join(';'),
    'Backend',
    task.week,
    task.status,
    task.week,
    task.dateRange,
  ]);

  const csvRows = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );

  return csvRows.join('\n');
}

// Trello CSV Export Format
function exportTrelloCSV(tasks: Task[]): string {
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
    'Tags',
  ];

  const rows = tasks.map((task) => [
    task.title,
    task.status,
    task.description.replace(/"/g, '""'),
    task.dueDate,
    (task.tags || []).join(','),
    `Week: ${task.week}; Date Range: ${task.dateRange}; Priority: ${task.priority}`,
    task.priority,
    task.week,
    task.dateRange,
    (task.tags || []).join(';'),
  ]);

  const csvRows = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );

  return csvRows.join('\n');
}

// Generic CSV Export (Detailed)
function exportGenericCSV(tasks: Task[]): string {
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
    'Created At',
  ];

  const rows = tasks.map((task) => [
    task.id,
    task.title,
    task.description.replace(/"/g, '""'),
    task.priority,
    task.dueDate,
    task.status,
    task.week,
    task.dateRange,
    (task.tags || []).join(';'),
    new Date().toISOString(),
  ]);

  const csvRows = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );

  return csvRows.join('\n');
}

// Write files
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const outputDir = join(process.cwd(), 'exports');

try {
  // Create exports directory if it doesn't exist
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Export JSON files
  writeFileSync(
    join(outputDir, 'agileplan-tasks-jira.json'),
    exportJiraJSON(allTasks),
    'utf-8'
  );
  console.log('✅ Exported: agileplan-tasks-jira.json');

  writeFileSync(
    join(outputDir, 'agileplan-tasks-trello.json'),
    exportTrelloJSON(allTasks),
    'utf-8'
  );
  console.log('✅ Exported: agileplan-tasks-trello.json');

  writeFileSync(
    join(outputDir, 'agileplan-tasks-detailed.json'),
    exportGenericJSON(allTasks),
    'utf-8'
  );
  console.log('✅ Exported: agileplan-tasks-detailed.json');

  // Export CSV files
  writeFileSync(
    join(outputDir, 'agileplan-tasks-jira.csv'),
    exportJiraCSV(allTasks),
    'utf-8'
  );
  console.log('✅ Exported: agileplan-tasks-jira.csv');

  writeFileSync(
    join(outputDir, 'agileplan-tasks-trello.csv'),
    exportTrelloCSV(allTasks),
    'utf-8'
  );
  console.log('✅ Exported: agileplan-tasks-trello.csv');

  writeFileSync(
    join(outputDir, 'agileplan-tasks-detailed.csv'),
    exportGenericCSV(allTasks),
    'utf-8'
  );
  console.log('✅ Exported: agileplan-tasks-detailed.csv');

  console.log(`\n📊 Exported ${allTasks.length} tasks`);
  console.log(`📁 Files saved to: ${outputDir}`);
  console.log('\n📋 Export Summary:');
  console.log('  - Jira JSON: Ready for Jira CSV/JSON import');
  console.log('  - Trello JSON: Ready for Trello Power-Up import');
  console.log('  - Detailed JSON: Complete task data with metadata');
  console.log('  - Jira CSV: Import via Jira CSV importer');
  console.log('  - Trello CSV: Import via Trello CSV importer');
  console.log('  - Detailed CSV: Complete task data');
} catch (error) {
  console.error('❌ Export failed:', error);
  process.exit(1);
}
