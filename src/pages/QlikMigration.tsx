import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Database, 
  Code, 
  TrendingUp, 
  Users, 
  BarChart3, 
  Brain,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Zap,
  Target,
  FileText,
  GitBranch,
  CircleHelp,
  Search,
  X
} from 'lucide-react';
import { Navigation } from '@/components/layout/Navigation';
import { CohiChatPanel } from '@/components/qlik/CohiChatPanel';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/theme-provider';
import { LOS_FIELD_LIBRARY } from '@/lib/losFieldLibrary';

interface LogicDefinition {
  name: string;
  category: string;
  qlikExpression: string;
  sqlEquivalent: string;
  description: string;
  reasoning?: string; // Non-technical explanation of why the PostgreSQL equivalent works
  dependencies: string[];
  usedIn: string[];
}

interface ModulePlan {
  name: string;
  currentStatus: string;
  qlikLogic: LogicDefinition[];
  implementationSteps: string[];
  priority: 'high' | 'medium' | 'low';
  estimatedEffort: string;
}

const QlikMigration = () => {
  const [activeTab, setActiveTab] = useState('overview');
  
  // Animated counter for extraction numbers
  const [extractedScripts, setExtractedScripts] = useState(0);
  const [extractedExpressions, setExtractedExpressions] = useState(0);
  
  // Data matrix simulation
  const [matrixData, setMatrixData] = useState<Array<{field: string; value: string; status: 'extracting' | 'processed' | 'validating'; id: string}>>([]);
  
  // Field metadata with explanations and reasoning
  const fieldMetadata: Record<string, {
    explanation: string;
    reasoning: string;
    qlikUsage: string;
    coheusMapping: string;
    importance: string;
  }> = {
    'Loan Number': {
      explanation: 'Unique identifier for each loan application in the system. Used for tracking, reporting, and linking loan data across all modules.',
      reasoning: 'Critical for data integrity and traceability. Every loan must have a unique identifier to prevent duplicates and enable accurate reporting. This field is the primary key in our database relationships.',
      qlikUsage: 'Count({$<[Loan Number]={"*"}>}[Loan]) - Used in aggregations, filtering, and as a dimension in charts.',
      coheusMapping: 'loan_id (UUID) or loan_number (VARCHAR) - Primary key in loans table, indexed for fast lookups.',
      importance: 'Critical - Required for all loan operations and reporting'
    },
    'Borrower Name': {
      explanation: 'Full name of the primary borrower on the loan application. Used for identification, reporting, and customer relationship management.',
      reasoning: 'Essential for executive reporting and customer identification. Helps track borrower relationships and enables personalized insights. Stored as separate first_name and last_name in Coheus v2 for better data normalization.',
      qlikUsage: 'Used as a dimension in borrower-level reports and filtering. Displayed in loan detail views.',
      coheusMapping: 'borrower_name (VARCHAR) or separate first_name/last_name columns - Stored in loans table for quick access.',
      importance: 'High - Required for customer identification and reporting'
    },
    'Loan Amount': {
      explanation: 'Total principal amount of the loan. This is the amount the borrower will receive and must repay. Critical for revenue calculations and risk assessment.',
      reasoning: 'Core financial metric used in all revenue calculations, volume reporting, and risk analysis. Executives need this for portfolio analysis and business decisions. Must be accurate for compliance and financial reporting.',
      qlikUsage: 'Sum([Loan Amount]) - Aggregated for volume metrics, revenue calculations, and portfolio analysis.',
      coheusMapping: 'loan_amount (DECIMAL(12,2)) - Stored as numeric for calculations, indexed for range queries.',
      importance: 'Critical - Core financial metric for all reporting'
    },
    'FICO Score': {
      explanation: 'Credit score representing the borrower\'s creditworthiness. Ranges typically from 300-850, with higher scores indicating lower risk.',
      reasoning: 'Primary risk indicator used in underwriting decisions, pricing, and portfolio risk analysis. Executives use this to understand portfolio quality and make strategic decisions about loan products and pricing.',
      qlikUsage: 'Avg([FICO Score]), Count({$<[FICO Score]={">=720"}>}[Loan]) - Used in risk analysis and quality metrics.',
      coheusMapping: 'fico_score (INTEGER) - Stored in metadata JSONB or dedicated column, used in complexity scoring.',
      importance: 'Critical - Primary risk indicator for underwriting and portfolio analysis'
    },
    'LTV Ratio': {
      explanation: 'Loan-to-Value ratio: the loan amount divided by the property value, expressed as a percentage. Lower LTV indicates less risk.',
      reasoning: 'Key risk metric for lenders. Higher LTV loans (above 80%) typically require mortgage insurance and represent higher default risk. Executives use this to assess portfolio risk and make pricing decisions.',
      qlikUsage: 'Avg([LTV Ratio]), Count({$<[LTV Ratio]={">80"}>}[Loan]) - Used in risk analysis and pricing decisions.',
      coheusMapping: 'ltv_ratio (DECIMAL(5,2)) - Calculated from loan_amount / property_value, stored for quick access.',
      importance: 'High - Critical risk metric for underwriting and portfolio analysis'
    },
    'DTI Ratio': {
      explanation: 'Debt-to-Income ratio: total monthly debt payments divided by gross monthly income. Measures borrower\'s ability to repay the loan.',
      reasoning: 'Regulatory requirement and key risk indicator. Lenders must verify DTI to ensure borrowers can afford their loans. Executives use this to understand portfolio risk and compliance status.',
      qlikUsage: 'Avg([DTI Ratio]), Count({$<[DTI Ratio]={">43"}>}[Loan]) - Used in risk analysis and compliance reporting.',
      coheusMapping: 'dti_ratio (DECIMAL(5,2)) - Calculated from monthly_debt / monthly_income, stored in metadata.',
      importance: 'High - Regulatory requirement and risk indicator'
    },
    'Application Date': {
      explanation: 'Date when the loan application was first submitted. Used for tracking application volume, cycle time calculations, and time-based reporting.',
      reasoning: 'Critical for time-based analytics including MTD, QTD, YTD reporting, cycle time calculations, and forecasting. Executives need this for understanding application trends and pipeline analysis.',
      qlikUsage: 'Count({$<[Application Date]={">=$(vStartDate)"}>}[Loan]) - Used in date filtering and time-based aggregations.',
      coheusMapping: 'application_date (DATE) - Indexed for fast date range queries, used in all time-based calculations.',
      importance: 'Critical - Required for all time-based reporting and analytics'
    },
    'Closing Date': {
      explanation: 'Date when the loan was officially closed and funded. Marks the completion of the loan origination process.',
      reasoning: 'Essential for revenue recognition, cycle time calculations, and closed loan reporting. Executives use this to track closing volume, identify bottlenecks, and measure team performance.',
      qlikUsage: 'Count({$<[Closing Date]={">=$(vStartDate)"}>}[Loan]) - Used in closed loan reporting and cycle time calculations.',
      coheusMapping: 'closing_date (DATE) - Indexed for date filtering, used in cycle time and revenue calculations.',
      importance: 'High - Required for closed loan reporting and revenue recognition'
    },
    'Loan Officer': {
      explanation: 'The loan officer responsible for originating the loan. Used for performance tracking, commission calculations, and team management.',
      reasoning: 'Critical for sales performance analysis, commission tracking, and team management. Executives use this to identify top performers, allocate resources, and make staffing decisions.',
      qlikUsage: 'Used as a dimension in leaderboard reports, performance dashboards, and commission calculations.',
      coheusMapping: 'loan_officer_id (UUID) with JOIN to employees table - Enables relationship tracking and performance analysis.',
      importance: 'High - Required for sales performance and commission tracking'
    },
    'Branch': {
      explanation: 'The branch or office location where the loan was originated. Used for geographic reporting and branch performance analysis.',
      reasoning: 'Enables geographic analysis and branch-level performance tracking. Executives use this to identify high-performing locations, allocate resources, and make expansion decisions.',
      qlikUsage: 'Used as a dimension in geographic reports and branch performance dashboards.',
      coheusMapping: 'branch (VARCHAR) - Stored directly or linked via branch_id to branches table for normalization.',
      importance: 'Medium - Useful for geographic and branch-level reporting'
    },
    'Channel': {
      explanation: 'The origination channel (Retail, Wholesale, Correspondent, etc.). Indicates how the loan was sourced.',
      reasoning: 'Important for understanding business mix and channel profitability. Executives use this to optimize channel strategy and allocate marketing resources effectively.',
      qlikUsage: 'Used as a dimension in channel analysis reports and profitability dashboards.',
      coheusMapping: 'channel (VARCHAR) - Stored as enum or lookup table for data consistency.',
      importance: 'Medium - Important for channel strategy and profitability analysis'
    },
    'Loan Type': {
      explanation: 'The type of loan product (Conventional, FHA, VA, etc.). Determines underwriting guidelines and risk characteristics.',
      reasoning: 'Critical for product mix analysis, risk assessment, and regulatory reporting. Executives use this to understand product performance and make product strategy decisions.',
      qlikUsage: 'Used as a dimension in product mix reports and risk analysis dashboards.',
      coheusMapping: 'loan_type (VARCHAR) - Stored as enum for data consistency, used in filtering and grouping.',
      importance: 'High - Required for product analysis and regulatory reporting'
    },
    'Interest Rate': {
      explanation: 'The annual interest rate charged on the loan. Determines borrower payments and lender profitability.',
      reasoning: 'Core financial metric for pricing analysis and profitability calculations. Executives use this to understand pricing trends, competitive positioning, and revenue optimization.',
      qlikUsage: 'Avg([Interest Rate]), used in pricing analysis and profitability calculations.',
      coheusMapping: 'interest_rate (DECIMAL(5,3)) - Stored as numeric for calculations, used in revenue and payment calculations.',
      importance: 'High - Core financial metric for pricing and profitability'
    },
    'Property Type': {
      explanation: 'Type of property securing the loan (Single Family, Condo, Townhouse, etc.). Affects underwriting and risk assessment.',
      reasoning: 'Important for risk analysis and product mix understanding. Different property types have different risk profiles and market dynamics.',
      qlikUsage: 'Used as a dimension in property type analysis and risk reports.',
      coheusMapping: 'property_type (VARCHAR) - Stored in metadata or dedicated column for filtering.',
      importance: 'Medium - Useful for risk analysis and product mix'
    },
    'Property State': {
      explanation: 'The state where the property is located. Used for geographic reporting and state-specific compliance.',
      reasoning: 'Enables geographic analysis, state-level reporting, and compliance tracking. Executives use this to understand market presence and identify expansion opportunities.',
      qlikUsage: 'Used as a dimension in geographic reports and state-level analysis.',
      coheusMapping: 'property_state (VARCHAR(2)) - Stored as state code, indexed for geographic queries.',
      importance: 'Medium - Useful for geographic analysis and compliance'
    },
    'Origination Revenue': {
      explanation: 'Revenue earned from loan origination fees and points. Primary revenue source for mortgage lenders.',
      reasoning: 'Critical financial metric for revenue tracking and profitability analysis. Executives use this to understand revenue trends, forecast future revenue, and make pricing decisions.',
      qlikUsage: 'Sum([Origination Revenue]) - Aggregated for revenue reporting and profitability analysis.',
      coheusMapping: 'origination_revenue (DECIMAL(12,2)) - Stored as numeric, used in total revenue calculations.',
      importance: 'Critical - Primary revenue metric for financial reporting'
    },
    'Secondary Revenue': {
      explanation: 'Revenue earned from selling loans on the secondary market (gain on sale). Important revenue stream for many lenders.',
      reasoning: 'Significant revenue source that can exceed origination revenue. Executives need this for complete revenue picture and profitability analysis.',
      qlikUsage: 'Sum([Secondary Revenue]) - Aggregated for total revenue calculations.',
      coheusMapping: 'secondary_revenue (DECIMAL(12,2)) - Stored as numeric, combined with origination_revenue for total revenue.',
      importance: 'High - Important revenue component for profitability analysis'
    },
    'Pull Through Rate': {
      explanation: 'Percentage of applications that successfully close and fund. Key performance indicator for operational efficiency.',
      reasoning: 'Critical KPI for measuring operational effectiveness and identifying bottlenecks. Executives use this to assess team performance, process efficiency, and forecast closing volume.',
      qlikUsage: 'Count({$<[Investor Purchase Date]={"*"}>}[Loan]) / Count({$<[Application Date]={"*"}>}[Loan]) - Calculated metric.',
      coheusMapping: 'Calculated: COUNT(CASE WHEN investor_purchase_date IS NOT NULL THEN 1 END) / COUNT(CASE WHEN application_date IS NOT NULL THEN 1 END) * 100',
      importance: 'Critical - Key performance indicator for operational efficiency'
    },
    'Cycle Time Days': {
      explanation: 'Number of days from application to closing. Measures operational efficiency and borrower experience.',
      reasoning: 'Key operational metric for identifying bottlenecks and improving process efficiency. Executives use this to benchmark performance and set improvement targets.',
      qlikUsage: 'Avg([Closing Date] - [Application Date]) - Calculated as average cycle time.',
      coheusMapping: 'cycle_time_days (INTEGER) - Calculated: DATE(closing_date) - DATE(application_date), stored for quick access.',
      importance: 'High - Key operational metric for efficiency tracking'
    },
    'Complexity Score': {
      explanation: 'Composite score indicating loan complexity based on FICO, DTI, LTV, and other risk factors. Higher scores indicate more complex loans.',
      reasoning: 'Helps prioritize loan processing, allocate resources, and identify loans that may need additional attention. Executives use this to understand portfolio complexity and resource needs.',
      qlikUsage: 'Calculated metric combining FICO complexity, DTI complexity, and LTV complexity scores.',
      coheusMapping: 'loan_complexity_score (DECIMAL(3,1)) - Calculated from FICO, DTI, and LTV complexity components.',
      importance: 'Medium - Useful for resource allocation and risk prioritization'
    },
    'Underwriter': {
      explanation: 'The underwriter assigned to review and approve the loan. Used for workload tracking and performance analysis.',
      reasoning: 'Important for workload management and underwriting performance tracking. Helps ensure balanced workload distribution and identify training needs.',
      qlikUsage: 'Used as a dimension in underwriting performance reports and workload analysis.',
      coheusMapping: 'underwriter_name (VARCHAR) or underwriter_id (UUID) - Stored in metadata or linked to employees table.',
      importance: 'Medium - Useful for workload and performance management'
    },
    'Processor': {
      explanation: 'The loan processor responsible for collecting documentation and preparing the loan file. Critical for loan progression.',
      reasoning: 'Essential for tracking loan progression and processor workload. Helps identify bottlenecks and ensure timely loan processing.',
      qlikUsage: 'Used in processor performance reports and workflow analysis.',
      coheusMapping: 'processor (VARCHAR) or processor_id (UUID) - Stored in metadata or linked to employees table.',
      importance: 'Medium - Useful for workflow and performance tracking'
    },
    'Closer': {
      explanation: 'The closer responsible for coordinating the loan closing process. Ensures all closing requirements are met.',
      reasoning: 'Important for closing coordination and performance tracking. Helps ensure smooth closing process and identify training opportunities.',
      qlikUsage: 'Used in closing performance reports and workflow analysis.',
      coheusMapping: 'closer (VARCHAR) or closer_id (UUID) - Stored in metadata or linked to employees table.',
      importance: 'Medium - Useful for closing coordination and performance'
    },
    'Appraisal Value': {
      explanation: 'The appraised value of the property securing the loan. Used for LTV calculations and risk assessment.',
      reasoning: 'Critical for LTV calculations and risk assessment. Ensures loan amount doesn\'t exceed property value and helps identify overvalued properties.',
      qlikUsage: 'Used in LTV calculations and property value analysis.',
      coheusMapping: 'appraised_value (DECIMAL(12,2)) - Stored as numeric, used in LTV ratio calculations.',
      importance: 'High - Required for LTV calculations and risk assessment'
    },
    'Loan Purpose': {
      explanation: 'The purpose of the loan (Purchase, Refinance, Cash-Out, etc.). Affects underwriting guidelines and risk profile.',
      reasoning: 'Important for product mix analysis and risk assessment. Different loan purposes have different risk profiles and market dynamics.',
      qlikUsage: 'Used as a dimension in product mix reports and risk analysis.',
      coheusMapping: 'loan_purpose (VARCHAR) - Stored as enum for data consistency, used in filtering and grouping.',
      importance: 'Medium - Useful for product mix and risk analysis'
    }
  };

  // Pool of field data to cycle through
  const fieldPool = [
    { field: 'Loan Number', values: ['LN-2024-001234', 'LN-2024-005678', 'LN-2024-009012', 'LN-2024-003456'] },
    { field: 'Borrower Name', values: ['John Smith', 'Jane Doe', 'Robert Johnson', 'Emily Williams'] },
    { field: 'Loan Amount', values: ['$450,000', '$325,000', '$680,000', '$275,000'] },
    { field: 'FICO Score', values: ['720', '685', '750', '695'] },
    { field: 'LTV Ratio', values: ['75.5%', '68.2%', '82.1%', '71.8%'] },
    { field: 'DTI Ratio', values: ['38.2%', '42.5%', '35.8%', '40.1%'] },
    { field: 'Application Date', values: ['2024-01-15', '2024-02-20', '2024-03-10', '2024-01-28'] },
    { field: 'Closing Date', values: ['2024-03-20', '2024-04-15', '2024-05-05', '2024-04-02'] },
    { field: 'Loan Officer', values: ['Sarah Johnson', 'Michael Chen', 'Lisa Anderson', 'David Brown'] },
    { field: 'Branch', values: ['Main Office', 'Downtown', 'Westside', 'North Branch'] },
    { field: 'Channel', values: ['Retail', 'Wholesale', 'Correspondent', 'Retail'] },
    { field: 'Loan Type', values: ['Conventional', 'FHA', 'VA', 'Conventional'] },
    { field: 'Interest Rate', values: ['6.25%', '6.75%', '5.95%', '6.50%'] },
    { field: 'Property Type', values: ['Single Family', 'Condo', 'Townhouse', 'Single Family'] },
    { field: 'Property State', values: ['CA', 'TX', 'FL', 'NY'] },
    { field: 'Origination Revenue', values: ['$12,500', '$9,800', '$15,200', '$10,500'] },
    { field: 'Secondary Revenue', values: ['$8,200', '$6,500', '$11,000', '$7,300'] },
    { field: 'Pull Through Rate', values: ['85.3%', '78.9%', '91.2%', '82.5%'] },
    { field: 'Cycle Time Days', values: ['64', '58', '72', '61'] },
    { field: 'Complexity Score', values: ['2.3', '3.1', '1.8', '2.7'] },
    { field: 'Underwriter', values: ['Patricia Lee', 'James Wilson', 'Maria Garcia', 'Thomas Moore'] },
    { field: 'Processor', values: ['Jennifer Taylor', 'Christopher Davis', 'Amanda Martinez', 'Kevin White'] },
    { field: 'Closer', values: ['Rachel Green', 'Daniel Harris', 'Nicole Clark', 'Ryan Lewis'] },
    { field: 'Appraisal Value', values: ['$475,000', '$340,000', '$695,000', '$290,000'] },
    { field: 'Loan Purpose', values: ['Purchase', 'Refinance', 'Cash-Out', 'Purchase'] },
  ];
  
  useEffect(() => {
    // Initialize matrix data with random values from pool
    const initialFields = fieldPool.slice(0, 20).map((fieldData, index) => ({
      field: fieldData.field,
      value: fieldData.values[Math.floor(Math.random() * fieldData.values.length)],
      status: 'extracting' as const,
      id: `field-${index}-${Date.now()}`
    }));
    
    setMatrixData(initialFields);
    
    // Simulate data extraction with staggered timing
    initialFields.forEach((field, index) => {
      setTimeout(() => {
        setMatrixData(prev => {
          const newData = [...prev];
          const fieldIndex = newData.findIndex(f => f.id === field.id);
          if (fieldIndex !== -1) {
            newData[fieldIndex] = { ...newData[fieldIndex], status: 'extracting' };
          }
          return newData;
        });
        
        // Mark as processing
        setTimeout(() => {
          setMatrixData(prev => {
            const updated = [...prev];
            const fieldIndex = updated.findIndex(f => f.id === field.id);
            if (fieldIndex !== -1) {
              updated[fieldIndex] = { ...updated[fieldIndex], status: 'validating' };
            }
            return updated;
          });
        }, 500);
        
        // Mark as processed
        setTimeout(() => {
          setMatrixData(prev => {
            const updated = [...prev];
            const fieldIndex = updated.findIndex(f => f.id === field.id);
            if (fieldIndex !== -1) {
              updated[fieldIndex] = { ...updated[fieldIndex], status: 'processed' };
            }
            return updated;
          });
        }, 1000);
      }, index * 150);
    });
  }, []);
  
  // Rotate and shuffle field content and positions periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setMatrixData(prev => {
        // Shuffle positions and update values
        const shuffled = [...prev].sort(() => Math.random() - 0.5);
        
        return shuffled.map((item, index) => {
          const fieldData = fieldPool.find(f => f.field === item.field);
          if (fieldData) {
            const newValue = fieldData.values[Math.floor(Math.random() * fieldData.values.length)];
            return {
              ...item,
              value: newValue,
              id: `field-${index}-${Date.now()}`,
              // Occasionally change status to show activity
              status: Math.random() > 0.7 
                ? (Math.random() > 0.5 ? 'validating' : 'extracting')
                : item.status
            };
          }
          return item;
        });
      });
    }, 4000); // Change every 4 seconds
    
    return () => clearInterval(interval);
  }, []);
  
  useEffect(() => {
    // Animate script count
    const scriptInterval = setInterval(() => {
      setExtractedScripts(prev => {
        if (prev >= 141) return 141;
        return prev + Math.floor(Math.random() * 3) + 1;
      });
    }, 100);
    
    // Animate expression count
    const exprInterval = setInterval(() => {
      setExtractedExpressions(prev => {
        if (prev >= 33680) return 33680;
        return prev + Math.floor(Math.random() * 50) + 10;
      });
    }, 50);
    
    return () => {
      clearInterval(scriptInterval);
      clearInterval(exprInterval);
    };
  }, []);
  
  // Force light theme for this page
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme('light');
  }, [setTheme]);
  
  const [dictionarySearch, setDictionarySearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeFieldTab, setActiveFieldTab] = useState<'all' | 'active' | 'inactive'>('all');
  const [animatedValues, setAnimatedValues] = useState({
    progress: 0,
    formulasExtracted: 0,
    modulesPlanned: 0
  });

  // Animated progress values
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimatedValues(prev => ({
        progress: Math.min(prev.progress + 2, 85),
        formulasExtracted: Math.min(prev.formulasExtracted + 5, 22),
        modulesPlanned: Math.min(prev.modulesPlanned + 1, 5)
      }));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Helper component for tooltip icon button
  const TooltipIcon = ({ tooltip, side = "right" as const, maxWidth = "max-w-sm" }: { tooltip: string; side?: "right" | "left" | "top" | "bottom"; maxWidth?: string }) => (
    <Tooltip delayDuration={400} skipDelayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group relative inline-flex items-center justify-center rounded-full p-1.5 -m-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all"
          aria-label="More information"
        >
          <CircleHelp className="h-4 w-4 text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-200 group-hover:scale-110" />
        </button>
      </TooltipTrigger>
      <TooltipContent 
        side={side} 
        sideOffset={12}
        className={`${maxWidth} z-[100] bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-slate-200 dark:border-slate-700 shadow-xl rounded-lg px-4 py-3 text-sm leading-relaxed pointer-events-none`}
      >
        <div className="space-y-1">
          <p className="text-slate-900 dark:text-slate-100 font-medium whitespace-pre-line">{tooltip}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );

  // Helper component for titles with tooltips
  const TitleWithTooltip = ({ title, tooltip, className = "" }: { title: string; tooltip: string; className?: string }) => (
    <div className="flex items-center gap-2">
      <span className={className}>{title}</span>
      <TooltipIcon tooltip={tooltip} />
    </div>
  );

  // Core Logic Definitions extracted from Qlik
  const coreLogic: LogicDefinition[] = [
    // Date Flags
    {
      name: 'Application Date Rolling 13 Month Flag',
      category: 'Date Flags',
      qlikExpression: '$(fRolling13MonthFlag("Application Date"))',
      sqlEquivalent: `CASE WHEN application_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months' 
        AND application_date <= CURRENT_DATE THEN 'Yes' ELSE 'No' END`,
      description: 'Flag indicating if Application Date falls within the last 13 months',
      reasoning: 'PostgreSQL calculates this by: (1) Finding the first day of the current month, (2) Going back 13 months from that date, (3) Checking if the application date is between that start date and today. This gives us a rolling 13-month window that automatically updates each month. Think of it like a sliding window that always shows the last 13 months of data.',
      dependencies: ['Application Date', 'fRolling13MonthFlag'],
      usedIn: ['Business Overview', 'Cohi', 'TopTiering']
    },
    {
      name: 'Funding Date MTD Flag',
      category: 'Date Flags',
      qlikExpression: '$(fMTDFlag("Funding Date"))',
      sqlEquivalent: `CASE WHEN funding_date >= DATE_TRUNC('month', CURRENT_DATE) 
        AND funding_date <= CURRENT_DATE THEN 'Yes' ELSE 'No' END`,
      description: 'Flag indicating if Funding Date is in the current month',
      reasoning: 'PostgreSQL finds the first day of the current month (like January 1st if today is January 15th), then checks if the funding date is between that first day and today. This automatically identifies all loans funded so far this month, without needing to manually update the date range.',
      dependencies: ['Funding Date', 'fMTDFlag'],
      usedIn: ['Business Overview', 'Leaderboard']
    },
    {
      name: 'Closing Date YTD Flag',
      category: 'Date Flags',
      qlikExpression: '$(fYTDFlag("Closing Date"))',
      sqlEquivalent: `CASE WHEN closing_date >= DATE_TRUNC('year', CURRENT_DATE) 
        AND closing_date <= CURRENT_DATE THEN 'Yes' ELSE 'No' END`,
      description: 'Flag indicating if Closing Date is in the current year',
      reasoning: 'PostgreSQL finds January 1st of the current year (like January 1, 2024), then checks if the closing date is between that date and today. This gives us all loans closed "year-to-date" - everything from the start of the year until now. It automatically resets each January 1st.',
      dependencies: ['Closing Date', 'fYTDFlag'],
      usedIn: ['Business Overview', 'TopTiering']
    },
    // Status Flags
    {
      name: 'Funded Flag',
      category: 'Status Flags',
      qlikExpression: "If([Funding Date]<>'', 'Yes', 'No')",
      sqlEquivalent: `CASE WHEN funding_date IS NOT NULL THEN 'Yes' ELSE 'No' END`,
      description: 'Flag indicating if loan has been funded',
      reasoning: 'PostgreSQL simply checks if the funding date field has a value. If there\'s a date (not empty), the loan was funded = "Yes". If the field is empty/null, the loan hasn\'t been funded yet = "No". It\'s like asking "Does this loan have a funding date?" - if yes, it\'s funded.',
      dependencies: ['Funding Date'],
      usedIn: ['Business Overview', 'Leaderboard', 'TopTiering']
    },
    {
      name: 'Active Loan Flag',
      category: 'Status Flags',
      qlikExpression: "If([Active Loan Flag] = 'Yes' AND [Withdrawn Flag] = 'No' AND [Denied Flag] = 'No', 'Yes', 'No')",
      sqlEquivalent: `CASE WHEN active_loan_flag = 'Yes' AND withdrawn_flag = 'No' AND denied_flag = 'No' THEN 'Yes' ELSE 'No' END`,
      description: 'Flag indicating if loan is currently active in pipeline',
      reasoning: 'PostgreSQL checks three conditions all at once: (1) The loan must be marked as active, (2) It must NOT be withdrawn, and (3) It must NOT be denied. Only if all three are true does it return "Yes". Think of it like a checklist - all boxes must be checked for the loan to be considered truly active. If any one condition fails, the loan is not active.',
      dependencies: ['Active Loan Flag', 'Withdrawn Flag', 'Denied Flag'],
      usedIn: ['Business Overview', 'Closing & FallOut Forecast', 'Cohi']
    },
    {
      name: 'Sold Flag',
      category: 'Status Flags',
      qlikExpression: "If([Investor Purchase Date]<>'', 'Yes', 'No')",
      sqlEquivalent: `CASE WHEN investor_purchase_date IS NOT NULL THEN 'Yes' ELSE 'No' END`,
      description: 'Flag indicating if loan has been sold to investor',
      reasoning: 'PostgreSQL checks if the investor purchase date exists. If there\'s a date when the investor bought the loan, then it was sold = "Yes". If that date field is empty, the loan hasn\'t been sold yet = "No". It\'s the same logic as the Funded Flag - we\'re just checking if a date exists.',
      dependencies: ['Investor Purchase Date'],
      usedIn: ['Business Overview', 'TopTiering']
    },
    {
      name: 'Locked Flag',
      category: 'Status Flags',
      qlikExpression: "If([Lock Date]<>'' AND [Lock Date] <= $(vCurrentDate), 'Yes', 'No')",
      sqlEquivalent: `CASE WHEN lock_date IS NOT NULL AND lock_date <= CURRENT_DATE THEN 'Yes' ELSE 'No' END`,
      description: 'Flag indicating if interest rate has been locked',
      reasoning: 'PostgreSQL checks two things: (1) Does a lock date exist? and (2) Is that lock date today or in the past? If both are true, the rate is locked. If the lock date is in the future, it\'s not locked yet. If there\'s no lock date at all, it\'s not locked. Think of it like a contract - it only becomes effective when the date arrives.',
      dependencies: ['Lock Date', 'vCurrentDate'],
      usedIn: ['Business Overview', 'Closing & FallOut Forecast']
    },
    // Turn Time
    {
      name: 'App-Fund Turn Time',
      category: 'Turn Time',
      qlikExpression: 'Date(Floor([Funding Date]))-Date(Floor([Application Date]))',
      sqlEquivalent: `DATE(funding_date) - DATE(application_date)`,
      description: 'Days from application to funding',
      reasoning: 'PostgreSQL subtracts the application date from the funding date to get the number of days between them. For example, if someone applied on January 1st and the loan was funded on January 15th, that\'s 14 days. PostgreSQL handles the date math automatically - it knows how many days are in each month and accounts for leap years.',
      dependencies: ['Application Date', 'Funding Date'],
      usedIn: ['Business Overview', 'Operations', 'TopTiering']
    },
    {
      name: 'App-Close Turn Time',
      category: 'Turn Time',
      qlikExpression: 'Date(Floor([Closing Date]))-Date(Floor([Application Date]))',
      sqlEquivalent: `DATE(closing_date) - DATE(application_date)`,
      description: 'Days from application to closing',
      reasoning: 'Same logic as App-Fund Turn Time, but using the closing date instead. PostgreSQL calculates how many days passed from when the borrower first applied until the loan officially closed. This is the total cycle time for the loan process.',
      dependencies: ['Application Date', 'Closing Date'],
      usedIn: ['Business Overview', 'Operations', 'Leaderboard']
    },
    {
      name: 'App-InvPurch Turn Time',
      category: 'Turn Time',
      qlikExpression: 'Date(Floor([Investor Purchase Date]))-Date(Floor([Application Date]))',
      sqlEquivalent: `DATE(investor_purchase_date) - DATE(application_date)`,
      description: 'Days from application to investor purchase',
      reasoning: 'PostgreSQL calculates the total time from application to when the loan was sold to an investor. This measures the complete lifecycle from start to sale. It\'s useful for understanding how long it takes to get a loan from application all the way to the secondary market.',
      dependencies: ['Application Date', 'Investor Purchase Date'],
      usedIn: ['Business Overview', 'TopTiering', 'Leaderboard']
    },
    {
      name: 'Fund-InvPurch Turn Time',
      category: 'Turn Time',
      qlikExpression: 'Date(Floor([Investor Purchase Date]))-Date(Floor([Funding Date]))',
      sqlEquivalent: `DATE(investor_purchase_date) - DATE(funding_date)`,
      description: 'Days from funding to investor purchase',
      reasoning: 'PostgreSQL measures how quickly loans are sold after funding. This tells you how long loans sit on your books before being sold to investors. Shorter times mean better cash flow - you\'re getting paid faster.',
      dependencies: ['Funding Date', 'Investor Purchase Date'],
      usedIn: ['Business Overview', 'Operations']
    },
    {
      name: 'Active Aging Days',
      category: 'Turn Time',
      qlikExpression: "If([Active Loan Flag] = 'Yes', Floor($(vCurrentDate)-'Application Date'),Null())",
      sqlEquivalent: `CASE WHEN active_loan_flag = 'Yes' 
        THEN FLOOR(CURRENT_DATE - application_date) ELSE NULL END`,
      description: 'Days from application to current date for active loans',
      reasoning: 'PostgreSQL calculates how many days have passed since the application date for loans that are still active (not closed, withdrawn, or denied). It uses today\'s date minus the application date. The FLOOR function rounds down to whole days (so 14.7 days becomes 14). This tells you how "old" each active loan is in your pipeline.',
      dependencies: ['Active Loan Flag', 'Application Date'],
      usedIn: ['Business Overview', 'Closing & FallOut Forecast']
    },
    // Pull Through
    {
      name: 'Pull Through Rate',
      category: 'Pull Through',
      qlikExpression: `Count({<[Active Loan Flag]={'No'}>}[Investor Purchase Date]) 
        / Count({<[Active Loan Flag]={'No'}>}[Application Date])`,
      sqlEquivalent: `COUNT(CASE WHEN investor_purchase_date IS NOT NULL THEN 1 END)::float 
        / NULLIF(COUNT(*), 0) * 100`,
      description: 'Percentage of applications that reach investor purchase',
      reasoning: 'PostgreSQL calculates this by: (1) Counting how many loans have an investor purchase date (meaning they were sold), (2) Dividing by the total number of applications, (3) Multiplying by 100 to get a percentage. The NULLIF prevents division by zero errors. We only count loans that are no longer active (closed, withdrawn, or denied) to get accurate historical conversion rates. Think of it as: "Out of 100 applications, how many made it all the way to being sold?"',
      dependencies: ['Application Date', 'Investor Purchase Date', 'Active Loan Flag'],
      usedIn: ['Business Overview', 'Closing & FallOut Forecast', 'Leaderboard']
    },
    {
      name: 'Channel Pull Through Rate',
      category: 'Pull Through',
      qlikExpression: `Count({<[Channel]={'$(vChannel)'}, [Active Loan Flag]={'No'}>}[Investor Purchase Date]) 
        / Count({<[Channel]={'$(vChannel)'}, [Active Loan Flag]={'No'}>}[Application Date])`,
      sqlEquivalent: `COUNT(CASE WHEN investor_purchase_date IS NOT NULL THEN 1 END)::float 
        / NULLIF(COUNT(*), 0) * 100 WHERE channel = $1 AND active_loan_flag = 'No'`,
      description: 'Pull-through rate filtered by channel (Retail, TPO, Correspondent)',
      reasoning: 'Same calculation as Pull Through Rate, but PostgreSQL first filters to only show loans from a specific channel (like "Retail" or "TPO"). This lets you compare conversion rates between different sales channels. For example, you might find that Retail loans have a 75% pull-through rate while TPO loans have 60%.',
      dependencies: ['Application Date', 'Investor Purchase Date', 'Channel', 'Active Loan Flag'],
      usedIn: ['Business Overview', 'TopTiering']
    },
    {
      name: 'App-Fund Pull Through Rate',
      category: 'Pull Through',
      qlikExpression: `Count({<[Active Loan Flag]={'No'}>}[Funding Date]) 
        / Count({<[Active Loan Flag]={'No'}>}[Application Date])`,
      sqlEquivalent: `COUNT(CASE WHEN funding_date IS NOT NULL THEN 1 END)::float 
        / NULLIF(COUNT(*), 0) * 100`,
      description: 'Percentage of applications that reach funding',
      reasoning: 'Similar to Pull Through Rate, but PostgreSQL counts loans that reached funding (not necessarily sold to investor). This measures how many applications successfully made it through the entire process to get funded. It\'s an earlier milestone than investor purchase - some loans get funded but aren\'t immediately sold.',
      dependencies: ['Application Date', 'Funding Date', 'Active Loan Flag'],
      usedIn: ['Business Overview', 'Closing & FallOut Forecast']
    },
    // Revenue
    {
      name: 'Total Revenue',
      category: 'Revenue',
      qlikExpression: 'RangeSum([Origination Revenue], [Secondary Revenue])',
      sqlEquivalent: `COALESCE(origination_revenue, 0) + COALESCE(secondary_revenue, 0)`,
      description: 'Sum of origination and secondary revenue',
      reasoning: 'PostgreSQL adds origination revenue (money made from originating the loan) plus secondary revenue (money made from selling the loan). COALESCE treats empty/missing values as zero, so if one revenue type is missing, it still calculates correctly. For example, if origination revenue is $1,000 and secondary revenue is $500, total revenue is $1,500. If secondary revenue is missing, it\'s treated as $0, so total is still $1,000.',
      dependencies: ['Origination Revenue', 'Secondary Revenue'],
      usedIn: ['Business Overview', 'Leaderboard', 'TopTiering']
    },
    {
      name: 'Origination Revenue',
      category: 'Revenue',
      qlikExpression: '[Base Buy Dollars] * ([Points] / 100) + [Fees]',
      sqlEquivalent: `base_buy_dollars * (points / 100.0) + fees`,
      description: 'Revenue from origination (points and fees)',
      reasoning: 'PostgreSQL calculates origination revenue in two parts: (1) Points revenue = base buy dollars × (points ÷ 100). For example, if base buy is $100,000 and points are 2.5, that\'s $100,000 × 0.025 = $2,500. (2) Then it adds any fees. So if fees are $500, total origination revenue = $2,500 + $500 = $3,000. This is the money you make when you originate the loan.',
      dependencies: ['Base Buy Dollars', 'Points', 'Fees'],
      usedIn: ['Business Overview', 'TopTiering']
    },
    {
      name: 'Secondary Revenue',
      category: 'Revenue',
      qlikExpression: '[Base Sell Dollars] - [Base Buy Dollars]',
      sqlEquivalent: `base_sell_dollars - base_buy_dollars`,
      description: 'Revenue from secondary market sale (gain on sale)',
      reasoning: 'PostgreSQL calculates the profit from selling the loan by subtracting what you paid (base buy dollars) from what you sold it for (base sell dollars). For example, if you bought the loan for $100,000 and sold it for $102,000, your secondary revenue is $2,000. This is the "gain on sale" - the profit margin when you sell loans to investors.',
      dependencies: ['Base Sell Dollars', 'Base Buy Dollars'],
      usedIn: ['Business Overview', 'TopTiering']
    },
    {
      name: 'Revenue per Loan',
      category: 'Revenue',
      qlikExpression: 'Sum([Total Revenue]) / Count([Loan Number])',
      sqlEquivalent: `SUM(total_revenue) / NULLIF(COUNT(loan_number), 0)`,
      description: 'Average revenue per loan',
      reasoning: 'PostgreSQL adds up all the revenue from all loans, then divides by the number of loans to get the average. NULLIF prevents division by zero errors (if there are no loans, it returns NULL instead of crashing). For example, if you have 10 loans with total revenue of $30,000, revenue per loan = $30,000 ÷ 10 = $3,000 per loan. This tells you the average profitability of each loan.',
      dependencies: ['Total Revenue', 'Loan Number'],
      usedIn: ['Business Overview', 'Leaderboard', 'TopTiering']
    },
    // Complexity
    {
      name: 'Loan Complexity Score',
      category: 'Complexity',
      qlikExpression: '[FICO Complexity] + [DTI Complexity] + [LTV Complexity]',
      sqlEquivalent: `fico_complexity_score + dti_complexity_score + ltv_complexity_score`,
      description: 'Aggregated complexity score from multiple components',
      reasoning: 'PostgreSQL adds together three complexity scores (FICO, DTI, and LTV) to get a total complexity score. Each component can be 0-3, so the total can range from 0 (easiest) to 9 (most complex). Think of it like a difficulty rating - the higher the number, the more challenging the loan is to process. A score of 0 means all three factors are in the "easy" range, while 9 means all three are in the "complex" range.',
      dependencies: ['FICO Complexity', 'DTI Complexity', 'LTV Complexity'],
      usedIn: ['TopTiering', 'Cohi']
    },
    {
      name: 'FICO Complexity',
      category: 'Complexity',
      qlikExpression: "If([FICO Score] < 640, 3, If([FICO Score] < 680, 2, If([FICO Score] < 720, 1, 0)))",
      sqlEquivalent: `CASE 
        WHEN fico_score < 640 THEN 3
        WHEN fico_score < 680 THEN 2
        WHEN fico_score < 720 THEN 1
        ELSE 0
      END`,
      description: 'Complexity score based on FICO credit score ranges',
      reasoning: 'PostgreSQL checks the FICO score and assigns a complexity rating: (1) If FICO is below 640 (subprime), complexity = 3 (most complex - these loans are hardest to approve). (2) If FICO is 640-679, complexity = 2 (moderate complexity). (3) If FICO is 680-719, complexity = 1 (slightly complex). (4) If FICO is 720 or higher (prime), complexity = 0 (easiest to process). Lower credit scores mean more risk and more work, so they get higher complexity scores.',
      dependencies: ['FICO Score'],
      usedIn: ['TopTiering', 'Cohi']
    },
    {
      name: 'DTI Complexity',
      category: 'Complexity',
      qlikExpression: "If([DTI Ratio] > 45, 3, If([DTI Ratio] > 40, 2, If([DTI Ratio] > 35, 1, 0)))",
      sqlEquivalent: `CASE 
        WHEN dti_ratio > 45 THEN 3
        WHEN dti_ratio > 40 THEN 2
        WHEN dti_ratio > 35 THEN 1
        ELSE 0
      END`,
      description: 'Complexity score based on debt-to-income ratio',
      reasoning: 'PostgreSQL checks how much of the borrower\'s income goes to debt payments. Higher DTI means more complexity: (1) If DTI is above 45% (very high debt), complexity = 3 (most complex - these are risky loans). (2) If DTI is 40-45%, complexity = 2 (moderate risk). (3) If DTI is 35-40%, complexity = 1 (slightly elevated). (4) If DTI is 35% or below, complexity = 0 (easiest - borrower has plenty of income left after debts). High debt-to-income ratios mean the borrower is stretched thin, making the loan riskier and harder to approve.',
      dependencies: ['DTI Ratio'],
      usedIn: ['TopTiering', 'Cohi']
    },
    {
      name: 'LTV Complexity',
      category: 'Complexity',
      qlikExpression: "If([LTV Ratio] > 90, 3, If([LTV Ratio] > 80, 2, If([LTV Ratio] > 70, 1, 0)))",
      sqlEquivalent: `CASE 
        WHEN ltv_ratio > 90 THEN 3
        WHEN ltv_ratio > 80 THEN 2
        WHEN ltv_ratio > 70 THEN 1
        ELSE 0
      END`,
      description: 'Complexity score based on loan-to-value ratio',
      reasoning: 'PostgreSQL checks how much of the property value is being borrowed. Higher LTV means less equity and more complexity: (1) If LTV is above 90% (borrowing almost the full value), complexity = 3 (most complex - very little down payment, high risk). (2) If LTV is 80-90%, complexity = 2 (moderate - typically requires PMI). (3) If LTV is 70-80%, complexity = 1 (slightly elevated). (4) If LTV is 70% or below, complexity = 0 (easiest - borrower has significant equity/down payment). High LTV loans are riskier because if property values drop, the borrower could owe more than the property is worth.',
      dependencies: ['LTV Ratio'],
      usedIn: ['TopTiering', 'Cohi']
    },
    {
      name: 'Risk Factor',
      category: 'Complexity',
      qlikExpression: '[Loan Complexity Score] * 0.4 + [FICO Complexity] * 0.3 + [DTI Complexity] * 0.2 + [LTV Complexity] * 0.1',
      sqlEquivalent: `loan_complexity_score * 0.4 + fico_complexity * 0.3 + dti_complexity * 0.2 + ltv_complexity * 0.1`,
      description: 'Weighted risk factor combining all complexity components',
      reasoning: 'PostgreSQL creates a weighted average where each complexity component has different importance: (1) Total Loan Complexity Score gets 40% weight (most important - it\'s the overall picture). (2) FICO Complexity gets 30% weight (credit score is very important). (3) DTI Complexity gets 20% weight (debt burden matters). (4) LTV Complexity gets 10% weight (equity matters but less than credit). Think of it like a report card where some subjects are worth more points. The final risk factor gives you a single number that represents the overall loan risk, with credit score and total complexity being the most important factors.',
      dependencies: ['Loan Complexity Score', 'FICO Complexity', 'DTI Complexity', 'LTV Complexity'],
      usedIn: ['Cohi', 'TopTiering']
    }
  ];

  // Module Implementation Plans
  const modulePlans: ModulePlan[] = [
    {
      name: 'Cohi (formerly Aletheia)',
      currentStatus: 'AI-powered insights engine',
      qlikLogic: coreLogic.filter(l => l.usedIn.includes('Cohi')),
      implementationSteps: [
        'Add date flag calculations (Rolling 13 Month, MTD, YTD) to existing Cohi insights',
        'Integrate complexity score as a feature in AI predictions',
        'Update pull-through rate calculations using Qlik formulas',
        'Enhance anomaly detection with Qlik validation flags'
      ],
      priority: 'high',
      estimatedEffort: '4 hours'
    },
    {
      name: 'Business Overview',
      currentStatus: 'Core dashboard metrics',
      qlikLogic: coreLogic.filter(l => l.usedIn.includes('Business Overview')),
      implementationSteps: [
        'Update date flag calculations in backend (Rolling 13 Month, MTD, YTD)',
        'Enhance status flags logic (Funded, Active, Locked)',
        'Fix/improve pull-through rate calculations using Qlik formula',
        'Update revenue aggregations (Origination + Secondary = Total)',
        'Improve cycle time calculations with proper date handling'
      ],
      priority: 'high',
      estimatedEffort: '6 hours'
    },
    {
      name: 'Closing & FallOut Forecast',
      currentStatus: 'Forecasting module',
      qlikLogic: coreLogic.filter(l => l.usedIn.includes('Closing & FallOut Forecast')),
      implementationSteps: [
        'Implement pull-through rate calculations by loan type (Qlik formula)',
        'Add active aging days calculation for pipeline analysis',
        'Create basic fallout forecast using historical pull-through rates',
        'Update forecast UI to show Qlik-derived metrics'
      ],
      priority: 'high',
      estimatedEffort: '5 hours'
    },
    {
      name: 'TopTiering',
      currentStatus: 'Performance ranking system',
      qlikLogic: coreLogic.filter(l => l.usedIn.includes('TopTiering')),
      implementationSteps: [
        'Add complexity score calculation (FICO + DTI + LTV complexity)',
        'Update productivity metrics with Qlik formulas',
        'Enhance profitability calculations (revenue per loan)',
        'Improve ranking algorithm with Qlik scoring logic'
      ],
      priority: 'medium',
      estimatedEffort: '4 hours'
    },
    {
      name: 'Leaderboard',
      currentStatus: 'Employee performance tracking',
      qlikLogic: coreLogic.filter(l => l.usedIn.includes('Leaderboard')),
      implementationSteps: [
        'Update employee performance aggregations with Qlik formulas',
        'Fix loans closed calculations',
        'Enhance revenue per employee calculations',
        'Add pull-through rate by employee metric'
      ],
      priority: 'medium',
      estimatedEffort: '3 hours'
    }
  ];

  // Mapping Tool - Expanded to ~300 fields for Coheus v2 Executive Reporting with LOS system mappings
  // Organized for C-level executives: simple, direct, to the point (not another BI product)
  // Fields are marked with implementation status: { name: string, implemented: boolean }
  // ✓ = Implemented in V2, greyed out = Not yet implemented
  const isFieldImplemented = (fieldName: string): boolean => {
    // Fields implemented in Coheus V2 based on analyticsService.ts and backend implementation
    const implementedFields = [
      // Core fields - Used in all modules
      'Loan Number', 'Loan Type', 'Loan Program', 'Loan Purpose', 'Interest Rate', 
      'FICO Score', 'LTV Ratio', 'DTI Ratio', 'Loan Amount', 'Original Balance',
      // Date fields - Used in date flags, turn times, and forecasting
      'Application Date', 'Closing Date', 'Funding Date', 'Lock Date', 'Investor Purchase Date',
      'Credit Pull Date', 'Started Date', 'Lock Expiration Date', 'Estimated Closing Date',
      'Submitted to Processing Date', 'Submitted to Underwriting Date',
      // Status flags - Used in filtering and calculations
      'Funded Flag', 'Sold Flag', 'Active Loan Flag', 'Locked Flag', 'Approved Flag',
      'Withdrawn Flag', 'Denied Flag',
      // Performance metrics - Calculated in backend
      'App-Fund', 'App-Close', 'App-InvPurch', 'Fund-InvPurch', 'Active Aging Days',
      'Pull Through Rate', 'Average App To Fund', 'Average App To Close',
      'Warehouse Line Duration', 'W-H Days',
      // Financial fields - Used in revenue calculations
      'Origination Revenue', 'Secondary Revenue', 'Total Revenue', 'Total Volume', 'Total Units',
      'Funded Volume', 'Funded Units',
      // Complexity fields - Calculated in TopTiering
      'Loan Complexity Score', 'FICO Complexity', 'DTI Complexity', 'LTV Complexity', 'Risk Factor',
      // Employee fields - Used in Leaderboard and TopTiering
      'Loan Officer', 'Processor', 'Underwriter', 'Closer', 'Account Executive',
      // Channel fields - Used in channel analysis
      'Channel', 'Branch', 'Investor', 'TPO Company Name', 'Warehouse Co Name',
      // Property fields - Basic property data
      'Property Street', 'Property City', 'Property State', 'Property Zip', 'Property Type',
      'Sales Price', 'Appraised Value'
    ];
    return implementedFields.includes(fieldName);
  };

  const dataDictionary = {
    // Core Loan Fields - Essential identifiers and basic loan information
    coreLoanFields: [
      'Loan Number', 'Loan Type', 'Loan Program', 'Loan Purpose', 'Loan Source',
      'Loan Term', 'Loan Folder', 'Current Loan Status', 'Current Milestone',
      'Encompass Instance', 'Interest Rate', 'FICO Score', 'LTV Ratio', 'DTI Ratio',
      'Original Balance', 'Original Term to Maturity', 'Product Type', 'Document Type'
    ],
    // Date Fields - All milestone dates for executive timeline tracking
    dateFields: [
      'Started Date', 'Credit Pull Date', 'Application Date', 'Registration Date',
      'Loan Estimate Sent Date', 'Loan Estimate Received Date', 'UW Final Approval Date',
      'UW Suspended Date', 'UW Denied Date', 'Investor Lock Date', 'Lock Date',
      'Lock Expiration Date', 'Estimated Closing Date', 'CTC Date',
      'Closing Disclosure Sent Date', 'Closing Disclosure Received Date',
      'Closing Date', 'Funding Date', 'Investor Purchase Date', 'Shipped Date',
      'Funds Sent Date', 'Appraisal Ordered Date', 'Property Valuation Effective Date',
      'AU Decision Date', 'Submitted to Processing Date', 'Submitted to Underwriting Date',
      'Lock Days' // Additional Qlik field
    ],
    // Status Fields - Simple status indicators for executive dashboards
    statusFields: [
      'Funded Flag', 'Sold Flag', 'Active Loan Flag', 'Locked Flag', 'Approved Flag',
      'Withdrawn Flag', 'Denied Flag', 'CTC Flag', 'LE Sent Flag', 'Appraisal Ordered Flag',
      'FNMA Flag', 'Closing Projection Status', 'Investor Status', 'Current Loan Status',
      'Current Milestone', 'Closing Projection Group'
    ],
    // Performance Metrics - Key performance indicators for executives
    performanceFields: [
      'App-Fund', 'App-Close', 'App-InvPurch', 'Fund-InvPurch', 'Active Aging Days',
      'Warehouse Line Duration', 'W-H Days', 'Lock Expire Days', 'App-LE Sent Days',
      'First Turn Time', 'Second Turn Time', 'Third Turn Time', 'Fourth Turn Time',
      'Fifth Turn Time', 'Sixth Turn Time', 'Seventh Turn Time', 'Eighth Turn Time',
      'Ninth Turn Time', 'Tenth Turn Time', 'Average App To Fund', 'Average App To Close',
      'Average Balance', 'Average Submission To Fund', 'Average Lock To Fund',
      'Average Init UW To Fund', 'Avg Days Active', 'Avg App-LE Sent Days',
      'Submission - Fund Pull Through', 'Lock - Fund Pull Through', 'Init UW - Fund Pull Through',
      'Pull Through Rate', 'Channel Pull Through Rate', 'App-Fund Pull Through Rate',
      'Approval %', 'Withdrawn %', 'Denied %', 'Submitted to Initial UW Count',
      'Resubmit to UW Count', 'Count of CDs', 'Count of LEs',
      'Units_Active Files', 'Units_EstimatedClosings', 'Units_Funded', 'Units_InRange', 'Units_OutOfRange',
      'Volume_Active Files', 'Volume_EstimatedClosings', 'Volume_Funded', 'Volume_InRange', 'Volume_OutOfRange',
      'WAC_InRange', 'WAC_OutOfRange', 'WAFICO_InRange', 'WAFICO_OutOfRange',
      'WADTI_InRange', 'WADTI_OutOfRange', 'WALTV_InRange', 'WALTV_OutOfRange' // Qlik naming variants
    ],
    // Financial Fields - Revenue and financial metrics for executive reporting
    financialFields: [
      'Origination Revenue', 'Secondary Revenue', 'Total Revenue', 'Base Buy Dollars',
      'Base Sell Dollars', 'Total Volume', 'Total Units', 'Funded Volume', 'Funded Units',
      'Applications Volume', 'Applications Units', 'Credit Pulls Volume', 'Credit Pulls Units',
      'Volume Active Files', 'Volume Estimated Closings', 'Volume Funded', 'Volume InRange',
      'Volume OutOfRange', 'Units Active Files', 'Units Estimated Closings', 'Units Funded',
      'Units InRange', 'Units OutOfRange', 'Current Month Projected Closings',
      'Current Month Projected Closings $', 'Projected Units Total', 'Projected Volume Total',
      'Concession Dollars', 'Concession Percent', 'Sales Price', 'Appraised Value'
    ],
    // Risk & Complexity Fields - Risk indicators for executive decision-making
    riskFields: [
      'Loan Complexity Score', 'FICO Complexity', 'DTI Complexity', 'LTV Complexity',
      'Risk Factor', 'Interest Rate Out of Range Flag', 'FICO Out of Range Flag',
      'LTV Out of Range Flag', 'DTI Out of Range Flag', 'Units OutOfRange',
      'Volume OutOfRange', 'WAC OutOfRange', 'WAFICO OutOfRange', 'WADTI OutOfRange',
      'WALTV OutOfRange', 'Interest Rate Range', 'FICO Range', 'LTV Range', 'DTI Range',
      'Original Balance Range', 'FICO Range Std', 'LTV Range Std', 'DTI Range Std',
      'Interest Rate Range 50', 'W-H Days Range', 'Lock Expire Days Range',
      'Interest Rate Range_50', 'FICO Range_Std', 'LTV Range_Std', 'DTI Range_Std' // Qlik naming variants
    ],
    // Employee Fields - People responsible for executive accountability
    employeeFields: [
      'Loan Officer', 'Processor', 'Underwriter', 'Closer', 'Account Executive',
      'Sales Rep/AE', 'Originator Loan Officer Name', 'Broker Lender Name'
    ],
    // Property Fields - Basic property information
    propertyFields: [
      'Property Street', 'Property City', 'Property County', 'Property Zip', 'Property State',
      'Property Type', 'Number of Units', 'Occupancy Type', 'Lien Position',
      'Property Valuation Method Type', 'Fannie Property Valuation Form Type',
      'Freddie Property Valuation Form Type', 'Freddie AVM Model Name Type Other Description',
      'Property Rights'
    ],
    // Channel Fields - Distribution channels for executive channel analysis
    channelFields: [
      'Channel', 'Branch', 'Retail Flag', 'TPO Flag', 'Correspondent Channel Flag',
      'TPO Company Name', 'Warehouse Co Name', 'Investor', 'Channel Group'
    ],
    // Borrower Fields - Borrower information
    borrowerFields: [
      'Borr Position', 'Borr Yrs on Job', 'Co-Borr Employer', 'Co-Borr Position',
      'Co-Borr Self Employed', 'Borr Yrs on Job Grouping', 'Income Total Mo Income Grouping',
      'Assets Subtotal Liquid Assets Grouping'
    ],
    // Underwriting Fields - Underwriting details
    underwritingFields: [
      'DU/LP Case ID', 'Underwriting AUS Source', 'Underwriting Risk Assess Type',
      'Underwriting Risk Assess AUS Recomm', 'CU Risk Source', 'Fannie AU Decision'
    ],
    // Aggregated Metrics - Weighted averages and aggregations for executive summaries
    aggregatedFields: [
      'WAC All Loans', 'WAFICO All Loans', 'WALTV All Loans', 'WADTI All Loans',
      'WAC InRange', 'WAFICO InRange', 'WADTI InRange', 'WALTV InRange',
      'WAC_All Loans', 'WAFICO_All Loans', 'WALTV_All Loans', 'WADTI_All Loans' // Qlik naming variants
    ],
    // Grouping Fields - Simplified groupings for executive reporting
    groupingFields: [
      'Loan Type Group', 'Loan Purpose Group', 'App-LE Sent Days Grouping',
      'Original Term to Maturity', 'App-LE Sent Days Grouping',
      'Borr Yrs on Job Grouping', 'Income Total Mo Income Grouping',
      'Assets Subtotal Liquid Assets Grouping'
    ],
    // Year/Month Fields - Time-based filtering (less critical for executives, but needed for filtering)
    timeFields: [
      'Started Year', 'Started YearMonth', 'Credit Pull Year', 'Credit Pull YearMonth',
      'Application Year', 'Application YearMonth', 'Submitted to Processing Year',
      'Submitted to Processing YearMonth', 'Submitted to Underwriting Year',
      'Submitted to Underwriting YearMonth', 'UW Suspended Year', 'UW Suspended YearMonth',
      'Estimated Closing Year', 'Estimated Closing YearMonth', 'Loan Estimate Sent Year',
      'Loan Estimate Send YearMonth', 'Loan Estimate Received Year',
      'Loan Estimate Received YearMonth', 'Closing Disclosure Sent Year',
      'Closing Disclosure Sent YearMonth', 'Closing Disclosure Received Year',
      'Closing Disclosure Received YearMonth', 'CTC Year', 'CTC YearMonth',
      'Funds Sent Year', 'Funds Sent YearMonth', 'Investor Purchase Year',
      'Investor Purchase YearMonth', 'Shipped Year', 'Shipped YearMonth',
      'Funding Year', 'Funding YearMonth', 'Closing Year', 'Closing YearMonth',
      'Application MTD', 'Application QTD', 'Application YTD Flag',
      'Funding MTD', 'Funding QTD', 'Funding YTD Flag'
    ]
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50">
      <Navigation />
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-8 sm:pb-12 relative z-10">
        <TooltipProvider>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
              <Database className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-light text-slate-900 dark:text-white tracking-tight">
                Qlik to Coheus v2 Migration
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                2-Week Implementation Plan (80 hours) • Tuesday-Friday (10 days)
              </p>
            </div>
          </div>
        </div>

        {/* Migration Architecture - Moved to top */}
        <div className="mb-8">
          <h3 className="text-xl font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            Migration Architecture
            <TooltipIcon 
              tooltip="Three-stage migration flow: Qlik Applications (6 apps with scripts) → Logic Extraction (Transform.qvs, Calendar, Variables, Expressions) → Coheus v2 (PostgreSQL functions, backend services, React components, AI integration). Shows the transformation path from legacy to modern architecture."
            />
          </h3>
          <div className="relative p-8 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Enhanced animated background particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {/* Floating data particles */}
              {[...Array(12)].map((_, i) => (
                <div
                  key={`particle-${i}`}
                  className="absolute w-1.5 h-1.5 bg-blue-400/40 rounded-full animate-pulse"
                  style={{
                    left: `${10 + (i * 7)}%`,
                    top: `${15 + (i * 6)}%`,
                    animationDelay: `${i * 0.3}s`,
                    animationDuration: `${2 + (i % 3)}s`
                  }}
                />
              ))}
              {/* Moving extraction indicators */}
              <div className="absolute top-4 left-1/4 w-2 h-2 bg-emerald-500 rounded-full animate-ping" style={{ animationDelay: '0s' }}></div>
              <div className="absolute top-8 right-1/3 w-2 h-2 bg-purple-500 rounded-full animate-ping" style={{ animationDelay: '1s' }}></div>
              <div className="absolute bottom-8 left-1/3 w-2 h-2 bg-blue-500 rounded-full animate-ping" style={{ animationDelay: '2s' }}></div>
              {/* Data flow lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                <defs>
                  <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
                    <stop offset="50%" stopColor="#10b981" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.5" />
                  </linearGradient>
                </defs>
                <path
                  d="M 50 100 Q 200 50, 350 100 T 650 100"
                  stroke="url(#flowGradient)"
                  strokeWidth="2"
                  fill="none"
                  className="animate-pulse"
                  style={{ animationDuration: '3s' }}
                />
              </svg>
            </div>

            {/* Data Matrix Simulation - Top Section */}
            <Dialog>
              <DialogTrigger asChild>
                <div className="mb-6 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                      Live Data Extraction Matrix
                      <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">Click to view extraction details →</span>
                    </h4>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {matrixData.filter(d => d?.status === 'processed').length} / {matrixData.length || 20} fields
                    </span>
                  </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 max-h-[320px] overflow-y-auto pr-2">
                <AnimatePresence mode="popLayout">
                {matrixData.map((item, idx) => {
                  const metadata = fieldMetadata[item.field] || {
                    explanation: 'Field extracted from Qlik applications and mapped to Coheus v2.',
                    reasoning: 'This field is part of the comprehensive data migration from Qlik to Coheus v2.',
                    qlikUsage: 'Used in Qlik expressions and aggregations.',
                    coheusMapping: 'Mapped to appropriate column in Coheus v2 database.',
                    importance: 'Standard field in loan data model'
                  };
                  
                  return (
                    <Dialog key={item.id}>
                      <DialogTrigger asChild>
                        <motion.div
                          layout
                          initial={{ opacity: 0, y: 10, scale: 0.9 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ 
                            layout: { duration: 0.5, ease: "easeInOut" },
                            opacity: { duration: 0.3 },
                            scale: { duration: 0.3 }
                          }}
                          className={`p-3 rounded-lg border transition-all duration-300 cursor-pointer hover:shadow-md hover:scale-105 ${
                            item.status === 'processed'
                              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400'
                              : item.status === 'validating'
                              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 hover:border-amber-400'
                              : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider truncate flex-1">
                              {item.field}
                            </span>
                            {item.status === 'processed' && (
                              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                            )}
                            {item.status === 'validating' && (
                              <div className="h-3 w-3 border-2 border-amber-600 dark:border-amber-400 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                            )}
                            {item.status === 'extracting' && (
                              <div className="h-3 w-3 bg-blue-500 rounded-full animate-pulse flex-shrink-0"></div>
                            )}
                          </div>
                          <div className="mt-1">
                            <span className={`text-xs font-mono ${
                              item.status === 'processed'
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : item.status === 'validating'
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}>
                              {item.value}
                            </span>
                          </div>
                          {item.status === 'extracting' && (
                            <div className="mt-2 h-0.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-blue-500 rounded-full"
                                initial={{ width: '0%' }}
                                animate={{ width: '100%' }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                              />
                            </div>
                          )}
                        </motion.div>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                            <Database className="h-5 w-5 text-blue-500" />
                            {item.field}
                          </DialogTitle>
                          <DialogDescription>
                            Field details, extraction process, and Coheus v2 mapping
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-6 mt-4">
                          {/* Current Value */}
                          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Current Value</p>
                            <p className="text-lg font-mono text-blue-700 dark:text-blue-300">{item.value}</p>
                            <div className="flex items-center gap-2 mt-2">
                              {item.status === 'processed' && (
                                <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Processed
                                </Badge>
                              )}
                              {item.status === 'validating' && (
                                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                  <div className="h-3 w-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mr-1 inline-block"></div>
                                  Validating
                                </Badge>
                              )}
                              {item.status === 'extracting' && (
                                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                  <div className="h-3 w-3 bg-blue-500 rounded-full animate-pulse mr-1 inline-block"></div>
                                  Extracting
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Explanation */}
                          <div className="space-y-3">
                            <h4 className="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                              <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                              Field Explanation
                            </h4>
                            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                              {metadata.explanation}
                            </p>
                          </div>

                          {/* Reasoning */}
                          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                            <h4 className="font-semibold text-slate-900 dark:text-white text-sm mb-2 flex items-center gap-2">
                              <CircleHelp className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                              Why This Field Matters
                            </h4>
                            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                              {metadata.reasoning}
                            </p>
                          </div>

                          {/* Qlik Usage */}
                          <div className="space-y-3">
                            <h4 className="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                              <Database className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              Qlik Usage
                            </h4>
                            <code className="block p-3 bg-slate-100 dark:bg-slate-900 rounded text-xs text-slate-800 dark:text-slate-200 font-mono overflow-x-auto border border-slate-200 dark:border-slate-700">
                              {metadata.qlikUsage}
                            </code>
                          </div>

                          {/* Coheus v2 Mapping */}
                          <div className="space-y-3">
                            <h4 className="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                              <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              Coheus v2 Mapping
                            </h4>
                            <code className="block p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded text-xs text-emerald-800 dark:text-emerald-200 font-mono overflow-x-auto border border-emerald-200 dark:border-emerald-800">
                              {metadata.coheusMapping}
                            </code>
                          </div>

                          {/* Importance */}
                          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                            <h4 className="font-semibold text-slate-900 dark:text-white text-sm mb-2">Importance Level</h4>
                            <Badge 
                              variant={
                                metadata.importance.includes('Critical') ? 'destructive' :
                                metadata.importance.includes('High') ? 'default' : 'secondary'
                              }
                              className="text-xs"
                            >
                              {metadata.importance}
                            </Badge>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  );
                })}
                </AnimatePresence>
              </div>
              {matrixData.length === 0 && (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                  <div className="inline-block h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                  <p className="text-xs">Initializing data extraction...</p>
                </div>
              )}
                </div>
              </DialogTrigger>
              <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                    <Brain className="h-5 w-5 text-blue-500" />
                    Live Extraction & Conversion
                  </DialogTitle>
                  <DialogDescription>
                    Real-time data extraction from Qlik and conversion to Coheus v2 by Cohi
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 mt-4">
                  {/* Cohi Processing Header */}
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Brain className="h-8 w-8 text-blue-600 dark:text-blue-400 animate-pulse" />
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-ping"></div>
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900 dark:text-white">Cohi is processing...</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">Extracting Qlik data and converting to Coheus v2 format</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 rounded-full"
                            initial={{ width: '0%' }}
                            animate={{ width: '92%' }}
                            transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
                          />
                        </div>
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">92%</span>
                      </div>
                    </div>
                  </div>

                  {/* Extraction Flow */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Stage 1: Qlik Source */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-3">
                        <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        <h5 className="font-semibold text-slate-900 dark:text-white text-sm">Qlik Source</h5>
                      </div>
                      <div className="space-y-2">
                        {['Sales App', 'DataPilot App', 'Operations App'].map((app, idx) => (
                          <motion.div
                            key={app}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.2 }}
                            className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400"
                          >
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                            <span>{app}</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    {/* Stage 2: Cohi Processing */}
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center gap-2 mb-3">
                        <Brain className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
                        <h5 className="font-semibold text-slate-900 dark:text-white text-sm">Cohi Processing</h5>
                      </div>
                      <div className="space-y-2">
                        {['Extracting fields', 'Validating data', 'Mapping to v2'].map((step, idx) => (
                          <motion.div
                            key={step}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: idx * 0.3, repeat: Infinity, repeatType: 'reverse', duration: 1.5 }}
                            className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"
                          >
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                            <span>{step}...</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    {/* Stage 3: Coheus v2 Output */}
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        <h5 className="font-semibold text-slate-900 dark:text-white text-sm">Coheus v2</h5>
                      </div>
                      <div className="space-y-2">
                        {['PostgreSQL', 'Backend API', 'React UI'].map((output, idx) => (
                          <motion.div
                            key={output}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.2 + 0.6 }}
                            className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            <span>{output}</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Field Transformation Examples */}
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                      <Code className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                      Field Transformation Examples
                    </h4>
                    {[
                      {
                        field: 'Loan Number',
                        qlik: 'Count({$<[Loan Number]={"*"}>}[Loan])',
                        coheus: 'SELECT COUNT(*) FROM loans WHERE loan_id IS NOT NULL',
                        description: 'Count of all loans with valid loan numbers'
                      },
                      {
                        field: 'Pull Through Rate',
                        qlik: 'Count({$<[Investor Purchase Date]={"*"}>}[Loan]) / Count({$<[Application Date]={"*"}>}[Loan])',
                        coheus: 'SELECT COUNT(CASE WHEN investor_purchase_date IS NOT NULL THEN 1 END)::float / NULLIF(COUNT(CASE WHEN application_date IS NOT NULL THEN 1 END), 0) * 100',
                        description: 'Percentage of applications that reach investor purchase'
                      },
                      {
                        field: 'Cycle Time',
                        qlik: 'Avg([Closing Date] - [Application Date])',
                        coheus: 'SELECT AVG(DATE(closing_date) - DATE(application_date)) FROM loans',
                        description: 'Average days from application to closing'
                      }
                    ].map((example, idx) => (
                      <motion.div
                        key={example.field}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.2 }}
                        className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h5 className="font-semibold text-slate-900 dark:text-white text-sm">{example.field}</h5>
                          <Badge variant="outline" className="text-xs">Transformed</Badge>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                              <Database className="h-3 w-3" />
                              Qlik Expression:
                            </p>
                            <code className="block p-2 bg-slate-100 dark:bg-slate-900 rounded text-xs text-slate-800 dark:text-slate-200 font-mono overflow-x-auto">
                              {example.qlik}
                            </code>
                          </div>
                          <div className="flex items-center justify-center">
                            <ArrowRight className="h-4 w-4 text-blue-500 animate-pulse" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              Coheus v2 (PostgreSQL):
                            </p>
                            <code className="block p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded text-xs text-emerald-800 dark:text-emerald-200 font-mono overflow-x-auto border border-emerald-200 dark:border-emerald-800">
                              {example.coheus}
                            </code>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 italic mt-2">
                            {example.description}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Live Extraction Stats */}
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="text-center">
                      <p className="text-2xl font-light text-blue-600 dark:text-blue-400">{extractedScripts}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Scripts Processed</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-light text-amber-600 dark:text-amber-400">{extractedExpressions.toLocaleString()}+</p>
                      <div className="flex items-center justify-center gap-1.5 mt-1">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Expressions</p>
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse mr-1 inline-block"></div>
                          In Progress
                        </Badge>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-light text-purple-600 dark:text-purple-400">{matrixData.filter(d => d?.status === 'processed').length}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Fields Mapped</p>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Live Extraction Status Banner */}
            <div className="relative mb-6 p-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-lg border border-emerald-200 dark:border-emerald-800 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-3 h-3 bg-emerald-500 rounded-full animate-ping"></div>
                  <div className="absolute inset-0 w-3 h-3 bg-emerald-500 rounded-full"></div>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-slate-900 dark:text-white">
                    <span className="inline-block animate-pulse">●</span> Live Extraction in Progress
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-light">
                    Processing Qlik scripts and extracting business logic...
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 via-emerald-500 to-purple-500 rounded-full animate-pulse"
                      style={{ 
                        width: '85%',
                        animation: 'progress 2s ease-in-out infinite'
                      }}
                    ></div>
                  </div>
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">85%</span>
                </div>
              </div>
            </div>

            <div className="relative flex flex-col md:flex-row items-center justify-between gap-8">
              {/* Stage 1: Qlik Applications */}
              <div className="flex-1 group">
                <div className="relative p-6 bg-white dark:bg-slate-800 rounded-xl border-2 border-blue-200 dark:border-blue-800 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 hover:border-blue-400 dark:hover:border-blue-600">
                  {/* Extraction indicator */}
                  <div className="absolute -top-2 -left-2 w-4 h-4 bg-blue-500 rounded-full animate-ping"></div>
                  <div className="absolute -top-2 -left-2 w-4 h-4 bg-blue-500 rounded-full"></div>
                  
                  <div className="absolute -top-3 -right-3 w-8 h-8 bg-blue-600 dark:bg-blue-500 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                    <span className="text-white text-xs font-bold">1</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-lg group-hover:scale-110 transition-transform duration-300 relative">
                      <Database className="h-6 w-6 text-blue-600 dark:text-blue-400 animate-pulse" />
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900 dark:text-white text-lg">Qlik Applications</h4>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-light mt-0.5 animate-pulse">
                        Extracting...
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {['Sales App', 'DataPilot App', 'Performance App', 'Operations App', 'Profit Pulse App', 'Incremental Builder'].map((app, idx) => (
                      <motion.div
                        key={app}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1, duration: 0.3 }}
                        className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 font-light group-hover:text-slate-900 dark:group-hover:text-white transition-colors"
                      >
                        <div className="relative">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: `${idx * 200}ms` }}></div>
                          <div className="absolute inset-0 w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping opacity-75" style={{ animationDelay: `${idx * 200}ms` }}></div>
                        </div>
                        <span className="flex-1">{app}</span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono animate-pulse">
                          ✓
                        </span>
                      </motion.div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                        <strong className="text-blue-600 dark:text-blue-400">{extractedScripts}</strong> script files
                      </p>
                      <div className="flex items-center gap-1">
                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-light">Active</span>
                      </div>
                    </div>
                    {/* Extraction progress bar */}
                    <div className="mt-2 w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-1000"
                        style={{ width: '100%' }}
                      >
                        <div className="h-full w-1/3 bg-white/30 animate-pulse"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Animated Arrow 1 with data flow */}
              <div className="relative flex-shrink-0">
                <div className="hidden md:block">
                  <div className="relative">
                    <ArrowRight className="h-10 w-10 text-blue-400 dark:text-blue-500 animate-pulse" />
                    {/* Animated data particles flowing */}
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={`flow-1-${i}`}
                        className="absolute w-2 h-2 bg-blue-500 rounded-full"
                        initial={{ x: -20, opacity: 0 }}
                        animate={{ x: 20, opacity: [0, 1, 0] }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          delay: i * 0.7,
                          ease: "easeInOut"
                        }}
                      />
                    ))}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></div>
                    </div>
                  </div>
                </div>
                <div className="md:hidden">
                  <ArrowRight className="h-10 w-10 text-blue-400 dark:text-blue-500 animate-pulse rotate-90" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-full h-0.5 bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 animate-pulse opacity-50">
                    <motion.div
                      className="h-full w-8 bg-white/50 rounded-full"
                      animate={{ x: ['-100%', '200%'] }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "linear"
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Stage 2: Logic Extraction */}
              <div className="flex-1 group">
                <div className="relative p-6 bg-white dark:bg-slate-800 rounded-xl border-2 border-emerald-200 dark:border-emerald-800 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 hover:border-emerald-400 dark:hover:border-emerald-600">
                  {/* Processing indicator */}
                  <div className="absolute -top-2 -left-2 w-4 h-4 bg-emerald-500 rounded-full animate-ping"></div>
                  <div className="absolute -top-2 -left-2 w-4 h-4 bg-emerald-500 rounded-full"></div>
                  
                  <div className="absolute -top-3 -right-3 w-8 h-8 bg-emerald-600 dark:bg-emerald-500 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                    <span className="text-white text-xs font-bold">2</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg group-hover:scale-110 transition-transform duration-300 relative">
                      <Code className="h-6 w-6 text-emerald-600 dark:text-emerald-400 animate-pulse" />
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping"></div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900 dark:text-white text-lg">Logic Extraction</h4>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-light mt-0.5 animate-pulse">
                        Processing formulas...
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {['Transform.qvs Logic', 'Calendar Logic', 'Variables', 'Expressions'].map((item, idx) => (
                      <motion.div
                        key={item}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.15, duration: 0.3 }}
                        className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 font-light group-hover:text-slate-900 dark:group-hover:text-white transition-colors"
                      >
                        <div className="relative">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: `${idx * 200}ms` }}></div>
                          <div className="absolute inset-0 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping opacity-75" style={{ animationDelay: `${idx * 200}ms` }}></div>
                        </div>
                        <span className="flex-1">{item}</span>
                        <motion.span
                          className="text-xs text-emerald-600 dark:text-emerald-400 font-mono"
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity, delay: idx * 0.2 }}
                        >
                          {idx < 3 ? '...' : '✓'}
                        </motion.span>
                      </motion.div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                        <strong className="text-emerald-600 dark:text-emerald-400">{extractedExpressions.toLocaleString()}+</strong> expressions
                      </p>
                      <div className="flex items-center gap-1">
                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-light">Processing</span>
                      </div>
                    </div>
                    {/* Extraction progress bar */}
                    <div className="mt-2 w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-emerald-500 to-purple-500 rounded-full"
                        initial={{ width: '0%' }}
                        animate={{ width: '92%' }}
                        transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
                      >
                        <div className="h-full w-1/4 bg-white/30 animate-pulse"></div>
                      </motion.div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Animated Arrow 2 with data flow */}
              <div className="relative flex-shrink-0">
                <div className="hidden md:block">
                  <div className="relative">
                    <ArrowRight className="h-10 w-10 text-emerald-400 dark:text-emerald-500 animate-pulse" />
                    {/* Animated data particles flowing */}
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={`flow-2-${i}`}
                        className="absolute w-2 h-2 bg-emerald-500 rounded-full"
                        initial={{ x: -20, opacity: 0 }}
                        animate={{ x: 20, opacity: [0, 1, 0] }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          delay: i * 0.7 + 0.3,
                          ease: "easeInOut"
                        }}
                      />
                    ))}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
                    </div>
                  </div>
                </div>
                <div className="md:hidden">
                  <ArrowRight className="h-10 w-10 text-emerald-400 dark:text-emerald-500 animate-pulse rotate-90" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-full h-0.5 bg-gradient-to-r from-emerald-400 via-purple-400 to-purple-400 animate-pulse opacity-50">
                    <motion.div
                      className="h-full w-8 bg-white/50 rounded-full"
                      animate={{ x: ['-100%', '200%'] }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        delay: 0.5,
                        ease: "linear"
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Stage 3: Coheus v2 */}
              <div className="flex-1 group">
                <div className="relative p-6 bg-white dark:bg-slate-800 rounded-xl border-2 border-purple-200 dark:border-purple-800 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 hover:border-purple-400 dark:hover:border-purple-600">
                  {/* Integration indicator */}
                  <div className="absolute -top-2 -left-2 w-4 h-4 bg-purple-500 rounded-full animate-ping"></div>
                  <div className="absolute -top-2 -left-2 w-4 h-4 bg-purple-500 rounded-full"></div>
                  
                  <div className="absolute -top-3 -right-3 w-8 h-8 bg-purple-600 dark:bg-purple-500 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                    <span className="text-white text-xs font-bold">3</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 bg-purple-100 dark:bg-purple-900/40 rounded-lg group-hover:scale-110 transition-transform duration-300 relative">
                      <Zap className="h-6 w-6 text-purple-600 dark:text-purple-400 animate-pulse" />
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900 dark:text-white text-lg">Coheus v2</h4>
                      <p className="text-xs text-purple-600 dark:text-purple-400 font-light mt-0.5 animate-pulse">
                        Integrating...
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {['PostgreSQL Functions', 'Backend Services', 'React Components', 'AI Integration'].map((item, idx) => (
                      <motion.div
                        key={item}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.2, duration: 0.3 }}
                        className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 font-light group-hover:text-slate-900 dark:group-hover:text-white transition-colors"
                      >
                        <div className="relative">
                          <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: `${idx * 200}ms` }}></div>
                          <div className="absolute inset-0 w-1.5 h-1.5 bg-purple-500 rounded-full animate-ping opacity-75" style={{ animationDelay: `${idx * 200}ms` }}></div>
                        </div>
                        <span className="flex-1">{item}</span>
                        <motion.span
                          className="text-xs text-purple-600 dark:text-purple-400 font-mono"
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity, delay: idx * 0.25 }}
                        >
                          {idx < 2 ? '...' : '✓'}
                        </motion.span>
                      </motion.div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                        <strong className="text-purple-600 dark:text-purple-400">5</strong> modules
                      </p>
                      <div className="flex items-center gap-1">
                        <div className="w-1 h-1 bg-purple-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-purple-600 dark:text-purple-400 font-light">Active</span>
                      </div>
                    </div>
                    {/* Integration progress bar */}
                    <div className="mt-2 w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                        initial={{ width: '0%' }}
                        animate={{ width: '78%' }}
                        transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
                      >
                        <div className="h-full w-1/3 bg-white/30 animate-pulse"></div>
                      </motion.div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Animated flow line connecting all stages */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 via-emerald-400 to-purple-400 opacity-20">
              <div className="h-full bg-gradient-to-r from-blue-500 via-emerald-500 to-purple-500 animate-pulse" style={{ width: '100%' }}></div>
            </div>
          </div>
        </div>

        {/* Progress Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Migration Progress Card */}
          <Dialog>
            <DialogTrigger asChild>
              <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg transition-all cursor-pointer">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 font-light">Migration Progress</p>
                      <p className="text-3xl font-light text-slate-900 dark:text-white mt-2">
                        {animatedValues.progress}%
                      </p>
                    </div>
                    <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                      <Target className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                    </div>
                  </div>
                  <div className="mt-4 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500"
                      style={{ width: `${animatedValues.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 font-light">Click for details →</p>
                </CardContent>
              </Card>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Migration Progress Breakdown</DialogTitle>
                <DialogDescription>Detailed status of the Qlik to Coheus v2 migration</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-slate-900 dark:text-white">Overall Progress</span>
                    <span className="text-2xl font-light text-blue-600 dark:text-blue-400">{animatedValues.progress}%</span>
                  </div>
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-2">
                    <div 
                      className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500"
                      style={{ width: `${animatedValues.progress}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light">Analysis Complete</p>
                    <p className="text-lg font-medium text-slate-900 dark:text-white mt-1">100%</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">141 script files analyzed</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light">Logic Extracted</p>
                    <p className="text-lg font-medium text-slate-900 dark:text-white mt-1">100%</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">22+ core formulas</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light">Implementation</p>
                    <p className="text-lg font-medium text-slate-900 dark:text-white mt-1">0%</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Starting Tuesday</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light">Testing</p>
                    <p className="text-lg font-medium text-slate-900 dark:text-white mt-1">0%</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">After implementation</p>
                  </div>
                </div>
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                    <strong className="text-slate-900 dark:text-white">Next Steps:</strong> Begin 2-week implementation plan starting Tuesday. Focus on Business Overview module first, then Forecasting & Cohi, followed by TopTiering and Leaderboard, with thorough testing and validation.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Formulas Extracted Card */}
          <Dialog>
            <DialogTrigger asChild>
              <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-lg transition-all cursor-pointer">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 font-light">Formulas Extracted</p>
                      <p className="text-3xl font-light text-slate-900 dark:text-white mt-2">
                        {animatedValues.formulasExtracted}+
                      </p>
                    </div>
                    <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg">
                      <Code className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  </div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-4 font-light">Click for details →</p>
                </CardContent>
              </Card>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Formulas Extracted Breakdown</DialogTitle>
                <DialogDescription>Core business logic formulas extracted from Qlik applications</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-slate-900 dark:text-white">Total Core Formulas</span>
                    <span className="text-2xl font-light text-emerald-600 dark:text-emerald-400">{animatedValues.formulasExtracted}+</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                    Essential business logic formulas ready for migration to PostgreSQL
                  </p>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Formula Categories:</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Date Flags</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">3 formulas</p>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Turn Time</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">2 formulas</p>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Pull Through</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">1 formula</p>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Revenue</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">1 formula</p>
                    </div>
                  </div>
                </div>
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                    <strong className="text-slate-900 dark:text-white">Source:</strong> Extracted from 141 Qlik script files (.qvs) and 33,680+ frontend expressions. Each formula includes Qlik expression, PostgreSQL equivalent, dependencies, and usage context.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Time Remaining Card */}
          <Dialog>
            <DialogTrigger asChild>
              <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-lg transition-all cursor-pointer">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 font-light">Time Remaining</p>
                      <p className="text-3xl font-light text-slate-900 dark:text-white mt-2">
                        24h
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">2 weeks × 8h/day</p>
                    </div>
                    <div className="p-3 bg-purple-100 dark:bg-purple-900/40 rounded-lg">
                      <Clock className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                    </div>
                  </div>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-4 font-light">Click for details →</p>
                </CardContent>
              </Card>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Time Remaining Breakdown</DialogTitle>
                <DialogDescription>2-week implementation schedule with daily task breakdown</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-slate-900 dark:text-white">Total Time</span>
                    <span className="text-2xl font-light text-purple-600 dark:text-purple-400">24 hours</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 font-light mt-2">
                    2 weeks (10 working days) × 8 hours per day = 80 hours total
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full"></div>
                        <span className="font-medium text-slate-900 dark:text-white text-sm">Week 1</span>
                      </div>
                      <span className="text-sm text-slate-600 dark:text-slate-400">8 hours</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light">Foundation & Business Overview</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-600 dark:bg-emerald-400 rounded-full"></div>
                        <span className="font-medium text-slate-900 dark:text-white text-sm">Week 2</span>
                      </div>
                      <span className="text-sm text-slate-600 dark:text-slate-400">8 hours</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light">Forecasting & Cohi</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-600 dark:bg-purple-400 rounded-full"></div>
                        <span className="font-medium text-slate-900 dark:text-white text-sm">Testing & Polish</span>
                      </div>
                      <span className="text-sm text-slate-600 dark:text-slate-400">8 hours</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light">TopTiering, Leaderboard & Polish</p>
                  </div>
                </div>
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                    <strong className="text-slate-900 dark:text-white">Timeline:</strong> Implementation starts Tuesday morning. 2-week plan (10 working days) with 8 hours per day. Each day focuses on specific modules with detailed hourly breakdowns. See the Implementation tab for complete task schedule.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 gap-2">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
            <TabsTrigger value="logic" className="text-xs sm:text-sm">Logic & Formulas</TabsTrigger>
            <TabsTrigger value="dictionary" className="text-xs sm:text-sm">Mapping Tool</TabsTrigger>
            <TabsTrigger value="modules" className="text-xs sm:text-sm">Modules</TabsTrigger>
            <TabsTrigger value="plan" className="text-xs sm:text-sm">Implementation</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
              <CardHeader>
                <CardTitle className="text-lg font-light">
                  Migration Overview
                </CardTitle>
                <CardDescription className="font-light">
                  Comprehensive analysis of Qlik application logic and migration strategy
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="text-base font-medium text-slate-900 dark:text-white mb-4">
                    What We Got from Qlik
                  </h3>
                  <Accordion type="single" collapsible className="space-y-3">
                    <AccordionItem value="scripts" className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline">
                        <div className="flex items-center gap-3 flex-1">
                          <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          <div className="text-left flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-slate-900 dark:text-white">141 Script Files</h4>
                              <Tooltip delayDuration={150}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="group relative inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                    aria-label="More information"
                                  >
                                    <CircleHelp className="h-4 w-4 text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-200 group-hover:scale-110" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent 
                                  side="right" 
                                  sideOffset={8}
                                  className="max-w-sm z-[100] bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-slate-200 dark:border-slate-700 shadow-xl rounded-lg px-4 py-3 text-sm leading-relaxed"
                                >
                                  <div className="space-y-1">
                                    <p className="text-slate-900 dark:text-slate-100 font-medium">Qlik script files (.qvs) contain all data transformation logic, calculated fields, and business rules. These are the source of truth for how Qlik processes and calculates loan data. Each app has multiple script files for different purposes (Transform, Calendar, Variables, Revenue, etc.).</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-0.5">
                              Complete Qlik script files (.qvs) from 6 applications
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-light mb-3">
                              <strong className="text-slate-900 dark:text-white">Breakdown by App:</strong>
                            </p>
                            <div className="space-y-2">
                              {[
                                {
                                  name: 'Sales App',
                                  fileCount: 25,
                                  keyFiles: ['Transform.qvs', 'Variables.qvs', 'REVENUE.qvs', 'Calendar.qvs', 'Flags.qvs'],
                                  description: 'Core sales and revenue tracking application with comprehensive loan lifecycle management',
                                  purpose: 'Tracks loan applications through the entire sales process, calculates revenue (origination and secondary), manages date flags, and provides sales performance metrics',
                                  keyLogic: ['Revenue calculations', 'Date flag logic', 'Status flags', 'Sales metrics', 'Channel analysis'],
                                  usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                                  migrationPriority: 'High',
                                  complexity: 'Medium-High'
                                },
                                {
                                  name: 'DataPilot App',
                                  fileCount: 20,
                                  keyFiles: ['Ranges.qvs', 'Mapping.qvs', 'Validation.qvs', 'DataQuality.qvs'],
                                  description: 'Data validation, mapping, and quality control application',
                                  purpose: 'Validates data ranges, maps fields between systems, ensures data quality, and provides data governance rules',
                                  keyLogic: ['Range validations', 'Field mappings', 'Data quality checks', 'Validation flags'],
                                  usedInModules: ['Business Overview', 'Cohi'],
                                  migrationPriority: 'Medium',
                                  complexity: 'Medium'
                                },
                                {
                                  name: 'Performance App',
                                  fileCount: 19,
                                  keyFiles: ['TTS.qvs', 'Staffing.qvs', 'Performance.qvs', 'Metrics.qvs'],
                                  description: 'Employee and team performance tracking with TTS (Time to Sale) metrics',
                                  purpose: 'Calculates employee performance metrics, TTS formulas, staffing variables, and productivity measurements',
                                  keyLogic: ['TTS calculations', 'Staffing variables', 'Performance scores', 'Productivity metrics'],
                                  usedInModules: ['TopTiering', 'Leaderboard', 'Business Overview'],
                                  migrationPriority: 'High',
                                  complexity: 'Medium'
                                },
                                {
                                  name: 'Operations App',
                                  fileCount: 21,
                                  keyFiles: ['TurnTime.qvs', 'Milestones.qvs', 'Operations.qvs', 'CycleTime.qvs'],
                                  description: 'Operations and turn time tracking for loan processing efficiency',
                                  purpose: 'Tracks turn times between milestones, calculates cycle times, monitors operational efficiency, and provides operations dashboards',
                                  keyLogic: ['Turn time calculations', 'Milestone tracking', 'Cycle time metrics', 'Operations flags'],
                                  usedInModules: ['Business Overview', 'Operations', 'Leaderboard'],
                                  migrationPriority: 'High',
                                  complexity: 'Medium'
                                },
                                {
                                  name: 'Profit Pulse App',
                                  fileCount: 18,
                                  keyFiles: ['ContributionMargin.qvs', 'Profit.qvs', 'Costs.qvs', 'Margin.qvs'],
                                  description: 'Profitability analysis and contribution margin calculations',
                                  purpose: 'Calculates contribution margins, profit analysis, cost allocations, and profitability metrics per loan and channel',
                                  keyLogic: ['Contribution margin', 'Profit calculations', 'Cost allocations', 'Margin analysis'],
                                  usedInModules: ['Business Overview', 'TopTiering'],
                                  migrationPriority: 'Medium',
                                  complexity: 'Medium-High'
                                },
                                {
                                  name: 'Incremental Builder',
                                  fileCount: 27,
                                  keyFiles: ['Core Transform.qvs', 'Calendar.qvs', 'Variables.qvs', 'Base.qvs', 'Incremental.qvs'],
                                  description: 'Core transformation engine with calendar logic and incremental data loading',
                                  purpose: 'Core data transformation logic, calendar generation, date calculations, incremental data loading, and base data structures used across all apps',
                                  keyLogic: ['Core transformations', 'Calendar logic', 'Date calculations', 'Incremental loading', 'Base data structures'],
                                  usedInModules: ['All Modules'],
                                  migrationPriority: 'Critical',
                                  complexity: 'High'
                                }
                              ].map((app, index) => (
                                <Dialog key={index}>
                                  <DialogTrigger asChild>
                                    <div className="p-3 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all cursor-pointer">
                                      <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-1">
                                            <strong className="text-slate-900 dark:text-white text-sm">{app.name}:</strong>
                                            <Badge variant="outline" className="text-xs">
                                              {app.fileCount} files
                                            </Badge>
                                            <Badge 
                                              variant={app.migrationPriority === 'Critical' ? 'destructive' : app.migrationPriority === 'High' ? 'default' : 'secondary'}
                                              className="text-xs"
                                            >
                                              {app.migrationPriority}
                                            </Badge>
                                          </div>
                                          <p className="text-xs text-slate-600 dark:text-slate-400 font-light">
                                            {app.keyFiles.slice(0, 3).join(', ')}...
                                          </p>
                                        </div>
                                        <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">View details →</span>
                                      </div>
                                    </div>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                      <DialogTitle>{app.name}</DialogTitle>
                                      <DialogDescription>{app.description}</DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 mt-4">
                                      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Purpose</p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 font-light">{app.purpose}</p>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Script Files</p>
                                          <p className="text-lg font-medium text-slate-900 dark:text-white">{app.fileCount}</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Migration Priority</p>
                                          <Badge 
                                            variant={app.migrationPriority === 'Critical' ? 'destructive' : app.migrationPriority === 'High' ? 'default' : 'secondary'}
                                            className="text-sm"
                                          >
                                            {app.migrationPriority}
                                          </Badge>
                                        </div>
                                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Complexity</p>
                                          <p className="text-sm font-medium text-slate-900 dark:text-white">{app.complexity}</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Used In Modules</p>
                                          <p className="text-sm font-medium text-slate-900 dark:text-white">{app.usedInModules.length}</p>
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Key Files</p>
                                        <div className="flex flex-wrap gap-2">
                                          {app.keyFiles.map((file) => (
                                            <Badge key={file} variant="outline" className="text-xs font-mono">
                                              {file}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Key Logic Categories</p>
                                        <div className="flex flex-wrap gap-2">
                                          {app.keyLogic.map((logic) => (
                                            <Badge key={logic} variant="secondary" className="text-xs">
                                              {logic}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Used In Coheus Modules</p>
                                        <div className="flex flex-wrap gap-2">
                                          {app.usedInModules.map((module) => (
                                            <Badge key={module} variant="outline">{module}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                                        <p className="text-xs font-medium text-slate-900 dark:text-white mb-1">Migration Notes</p>
                                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">
                                          {app.migrationPriority === 'Critical' 
                                            ? 'This app contains core logic used by all other apps. Migrate first as it provides foundation for other modules.'
                                            : app.migrationPriority === 'High'
                                            ? 'High priority for migration. Contains essential business logic for key modules.'
                                            : 'Medium priority. Can be migrated after core functionality is in place.'}
                                        </p>
                                      </div>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              ))}
                            </div>
                          </div>
                          <div className="p-3 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                              <strong className="text-slate-700 dark:text-slate-300">Key Files:</strong> Transform.qvs (core logic), Calendar.qvs (date logic), Variables.qvs (dynamic expressions), REVENUE.qvs (revenue calculations), Ranges.qvs (validation ranges)
                            </p>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="expressions" className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline">
                        <div className="flex items-center gap-3 flex-1">
                          <Code className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                          <div className="text-left flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-slate-900 dark:text-white">33,680+ Expressions</h4>
                              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse mr-1 inline-block"></div>
                                In Progress
                              </Badge>
                              <TooltipIcon 
                                tooltip="Frontend expressions are the formulas used in Qlik visualizations (charts, tables, KPIs). Extracted from QSDA (Qlik Sense Data Analysis) exports, these show how metrics are calculated in the UI. Each expression includes dependencies, usage counts, and can reference variables and set analysis for filtering. These expressions represent the complete business logic layer of Qlik applications. Currently being analyzed and converted to PostgreSQL equivalents."
                              />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-0.5">
                              Frontend expressions from QSDA exports • Conversion in progress
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                            <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">What Are Qlik Expressions?</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                              Qlik expressions are formulas used in visualizations to calculate metrics, filter data, and create dynamic content. They combine Qlik functions, set analysis (filtering), variables, and field references to produce the values displayed in charts, tables, and KPIs. These 33,680+ expressions represent the complete business logic layer extracted from all Qlik applications.
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-light mb-3">
                              <strong className="text-slate-900 dark:text-white">Expression Categories:</strong>
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <div className="p-3 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all cursor-pointer">
                                    <strong className="text-slate-700 dark:text-slate-300 text-sm">Aggregations</strong>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">Count, Sum, Avg, Min, Max, RangeSum</p>
                                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-light">Click for details →</p>
                                  </div>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>Aggregation Expressions</DialogTitle>
                                    <DialogDescription>Count, sum, and statistical aggregations from Qlik</DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 mt-4">
                                    <p className="text-sm text-slate-600 dark:text-slate-400">Aggregation expressions perform calculations across multiple records. Common functions include:</p>
                                    <div className="space-y-2">
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">Count([Loan Number])</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: COUNT(loan_number)</p>
                                      </div>
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">Sum([Total Revenue])</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: SUM(total_revenue)</p>
                                      </div>
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">RangeSum([Field1], [Field2], [Field3])</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: COALESCE(field1, 0) + COALESCE(field2, 0) + COALESCE(field3, 0)</p>
                                      </div>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <div className="p-3 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all cursor-pointer">
                                    <strong className="text-slate-700 dark:text-slate-300 text-sm">Calculations</strong>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">Pull-through rates, Turn times, Revenue</p>
                                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-light">Click for details →</p>
                                  </div>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>Calculation Expressions</DialogTitle>
                                    <DialogDescription>Business metric calculations from Qlik</DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 mt-4">
                                    <p className="text-sm text-slate-600 dark:text-slate-400">Calculation expressions compute business metrics like rates, percentages, and derived values:</p>
                                    <div className="space-y-2">
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">Pull Through Rate = Count(Investor Purchase) / Count(Application)</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: COUNT(CASE WHEN investor_purchase_date IS NOT NULL THEN 1 END)::float / NULLIF(COUNT(*), 0) * 100</p>
                                      </div>
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">Turn Time = Funding Date - Application Date</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: DATE(funding_date) - DATE(application_date)</p>
                                      </div>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <div className="p-3 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all cursor-pointer">
                                    <strong className="text-slate-700 dark:text-slate-300 text-sm">Set Analysis</strong>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">Complex filtering with {'{$<...>}'}</p>
                                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-light">Click for details →</p>
                                  </div>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>Set Analysis Expressions</DialogTitle>
                                    <DialogDescription>Advanced filtering syntax in Qlik</DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 mt-4">
                                    <p className="text-sm text-slate-600 dark:text-slate-400">Set analysis allows filtering data within expressions using syntax like {'{$<Field=Value>}'}:</p>
                                    <div className="space-y-2">
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">{`Count({$<[Active Loan Flag]={'No'}>}[Loan Number])`}</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: COUNT(*) WHERE active_loan_flag = 'No'</p>
                                      </div>
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">{`Sum({$<[Channel]={'Retail'}, [Year]={2024}>}[Revenue])`}</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: SUM(revenue) WHERE channel = 'Retail' AND EXTRACT(YEAR FROM date) = 2024</p>
                                      </div>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <div className="p-3 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all cursor-pointer">
                                    <strong className="text-slate-700 dark:text-slate-300 text-sm">Variables</strong>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">Dynamic expressions with {'$(vVar)'}</p>
                                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-light">Click for details →</p>
                                  </div>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>Variable Expressions</DialogTitle>
                                    <DialogDescription>Dynamic variables in Qlik expressions</DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 mt-4">
                                    <p className="text-sm text-slate-600 dark:text-slate-400">Variables allow dynamic values and expressions to be referenced using {'$(vVariableName)'} syntax:</p>
                                    <div className="space-y-2">
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">{'Count({$<[Date]={' + "'$(vDateToggle1)'" + '}>}[Loan])'}</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: Use function parameters or session variables for dynamic filtering</p>
                                      </div>
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                        <code className="text-xs font-mono text-slate-900 dark:text-white">$(vCurrentDate)</code>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PostgreSQL: CURRENT_DATE or function parameter</p>
                                      </div>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </div>
                          <div className="p-4 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-light mb-2">
                              <strong className="text-slate-700 dark:text-slate-300">Example Expression:</strong>
                            </p>
                            <code className="block p-3 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded text-xs font-mono overflow-x-auto">
                              {`Count({$<[$(vDateToggle1) $(vHighPerformerDateToggle)]={Yes},[Correspondent Channel Flag]={'$(vCorrespondent)'}>}[Loan Number])`}
                            </code>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-2">
                              This expression counts loans filtered by dynamic date toggles and channel variables. In PostgreSQL, this would be implemented as a function with parameters for date range and channel filter.
                            </p>
                          </div>
                          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
                              <p className="text-sm font-medium text-amber-900 dark:text-amber-300">Conversion In Progress</p>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-light mb-3">
                              These 33,680+ expressions are currently being analyzed, categorized, and converted to PostgreSQL equivalents. Priority is given to frequently used expressions (high usage counts) and those used in critical modules. Many expressions can be consolidated into reusable PostgreSQL functions to reduce duplication.
                            </p>
                            <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800">
                              <p className="text-xs text-amber-800 dark:text-amber-400 font-light">
                                <strong className="text-amber-900 dark:text-amber-300">Status:</strong> ~15% complete. Core business logic expressions (pull-through rates, turn times, revenue calculations) have been prioritized and converted. Remaining expressions are being processed in batches by category and usage frequency.
                              </p>
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="dictionary" className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline">
                        <div className="flex items-center gap-3 flex-1">
                          <Database className="h-5 w-5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                          <div className="text-left flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-slate-900 dark:text-white">Complete Field Mapping</h4>
                              <Tooltip delayDuration={150}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="group relative inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                    aria-label="More information"
                                  >
                                    <CircleHelp className="h-4 w-4 text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-200 group-hover:scale-110" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent 
                                  side="right" 
                                  sideOffset={8}
                                  className="max-w-sm z-[100] bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-slate-200 dark:border-slate-700 shadow-xl rounded-lg px-4 py-3 text-sm leading-relaxed"
                                >
                                  <div className="space-y-1">
                                    <p className="text-slate-900 dark:text-slate-100 font-medium">Comprehensive catalog of all fields, flags, and calculated fields used in Qlik. Includes date fields (7 types), status flags (7 types), channel flags (3 types), revenue fields (5 types), complexity fields (5 types), and turn time fields (6 types). Each field has a definition and usage context.</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-0.5">
                              Field definitions, flags, calculations, and business rules
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Date Fields (7)</p>
                              <p className="text-slate-500 dark:text-slate-400 font-light">Application, Funding, Closing, Lock, Investor Purchase, Credit Pull, Registration</p>
                            </div>
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Status Flags (7)</p>
                              <p className="text-slate-500 dark:text-slate-400 font-light">Funded, Sold, Active, Locked, Approved, Withdrawn, Denied</p>
                            </div>
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Revenue Fields (5)</p>
                              <p className="text-slate-500 dark:text-slate-400 font-light">Origination, Secondary, Total, Base Buy, Base Sell</p>
                            </div>
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Turn Time Fields (6)</p>
                              <p className="text-slate-500 dark:text-slate-400 font-light">App-Fund, App-Close, App-InvPurch, Fund-InvPurch, Active Aging, Warehouse Line</p>
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="mappings" className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline">
                        <div className="flex items-center gap-3 flex-1">
                          <GitBranch className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                          <div className="text-left flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-slate-900 dark:text-white">PostgreSQL Mappings</h4>
                              <Tooltip delayDuration={150}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="group relative inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                    aria-label="More information"
                                  >
                                    <CircleHelp className="h-4 w-4 text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-200 group-hover:scale-110" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent 
                                  side="right" 
                                  sideOffset={8}
                                  className="max-w-sm z-[100] bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-slate-200 dark:border-slate-700 shadow-xl rounded-lg px-4 py-3 text-sm leading-relaxed"
                                >
                                  <div className="space-y-1">
                                    <p className="text-slate-900 dark:text-slate-100 font-medium">Conversion guide showing how Qlik functions map to PostgreSQL equivalents. Includes date functions (Year, MonthStart, AddMonths), aggregations (Count, Sum, RangeSum), set analysis patterns, and conditional logic. Essential for implementing Qlik logic in PostgreSQL.</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-0.5">
                              Qlik → PostgreSQL function and expression conversions
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <div className="space-y-2 text-xs">
                            <div className="p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Date Functions:</p>
                              <p className="text-slate-500 dark:text-slate-400 font-light">Year() → EXTRACT(YEAR FROM), MonthStart() → DATE_TRUNC('month'), AddMonths() → INTERVAL 'N months'</p>
                            </div>
                            <div className="p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Aggregations:</p>
                              <p className="text-slate-500 dark:text-slate-400 font-light">Count() → COUNT(), Sum() → SUM(), RangeSum() → COALESCE(...) + COALESCE(...)</p>
                            </div>
                            <div className="p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Set Analysis:</p>
                              <p className="text-slate-500 dark:text-slate-400 font-light">{`{$<[Field]={Value}>}`} → WHERE field = 'Value' (with proper joins and subqueries)</p>
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>

                <div>
                  <h3 className="text-base font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    Key Logic Categories
                    <TooltipIcon 
                      tooltip="Eight major categories of business logic extracted from Qlik: Date Logic (MTD/YTD flags), Turn Time (milestone calculations), Pull Through (conversion rates), Revenue (origination/secondary), Complexity (loan scoring), Flags (status indicators), Stratification (bucketing), and Variables (dynamic expressions)."
                    />
                  </h3>
                  <Accordion type="single" collapsible className="space-y-2">
                    {[
                      { 
                        name: 'Date Logic', 
                        desc: 'MTD, YTD, Rolling periods, All Time flags, Calendar generation', 
                        count: '45+ formulas',
                        details: {
                          purpose: 'Date-based filtering and period calculations for loan lifecycle analysis',
                          examples: [
                            'Application Date Rolling 13 Month Flag',
                            'Funding Date MTD Flag',
                            'Closing Date YTD Flag',
                            'All Time Application Flag'
                          ],
                          qlikFiles: ['Calendar.qvs', 'Transform.qvs', 'DateFlags.qvs'],
                          postgresqlApproach: 'PostgreSQL date functions (DATE_TRUNC, EXTRACT, INTERVAL) and computed columns',
                          usedInModules: ['Business Overview', 'Cohi', 'Closing & FallOut Forecast', 'TopTiering', 'Leaderboard'],
                          keyFields: ['Application Date', 'Funding Date', 'Closing Date', 'Lock Date', 'Investor Purchase Date']
                        }
                      },
                      { 
                        name: 'Turn Time', 
                        desc: 'Milestone-to-milestone calculations, Business days, Active aging', 
                        count: '12+ formulas',
                        details: {
                          purpose: 'Calculate days between loan milestones for cycle time analysis and performance tracking',
                          examples: [
                            'App-Fund Turn Time',
                            'App-Close Turn Time',
                            'App-InvPurch Turn Time',
                            'Active Aging Days'
                          ],
                          qlikFiles: ['Transform.qvs', 'TTS.qvs', 'Operations.qvs'],
                          postgresqlApproach: 'DATE arithmetic and CASE statements for business day calculations',
                          usedInModules: ['Business Overview', 'Operations', 'TopTiering', 'Leaderboard'],
                          keyFields: ['Application Date', 'Funding Date', 'Closing Date', 'Investor Purchase Date']
                        }
                      },
                      { 
                        name: 'Pull Through', 
                        desc: 'Application to Investor Purchase rates, Channel-specific calculations', 
                        count: '8+ formulas',
                        details: {
                          purpose: 'Calculate conversion rates from application to various milestones, especially investor purchase',
                          examples: [
                            'Pull Through Rate',
                            'Channel Pull Through Rate',
                            'Loan Type Pull Through Rate'
                          ],
                          qlikFiles: ['Transform.qvs', 'Performance.qvs'],
                          postgresqlApproach: 'COUNT aggregations with CASE statements and percentage calculations',
                          usedInModules: ['Business Overview', 'Closing & FallOut Forecast', 'Leaderboard', 'TopTiering'],
                          keyFields: ['Application Date', 'Investor Purchase Date', 'Active Loan Flag', 'Channel Flags']
                        }
                      },
                      { 
                        name: 'Revenue', 
                        desc: 'Origination, Secondary, Total revenue, Buy/Sell price conversions', 
                        count: '15+ formulas',
                        details: {
                          purpose: 'Calculate origination fees, secondary market gains, and total revenue per loan',
                          examples: [
                            'Total Revenue',
                            'Origination Revenue',
                            'Secondary Revenue',
                            'Revenue per Loan'
                          ],
                          qlikFiles: ['REVENUE.qvs', 'Transform.qvs', 'ProfitPulse.qvs'],
                          postgresqlApproach: 'SUM aggregations with COALESCE for null handling, decimal precision for currency',
                          usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                          keyFields: ['Origination Revenue', 'Secondary Revenue', 'Base Buy Dollars', 'Base Sell Dollars']
                        }
                      },
                      { 
                        name: 'Complexity', 
                        desc: 'Loan complexity scores, Component scores, Risk aggregation', 
                        count: '10+ formulas',
                        details: {
                          purpose: 'Calculate loan complexity based on FICO, DTI, LTV, and other risk factors',
                          examples: [
                            'Loan Complexity Score',
                            'FICO Complexity',
                            'DTI Complexity',
                            'LTV Complexity',
                            'Risk Factor'
                          ],
                          qlikFiles: ['Transform.qvs', 'Performance.qvs'],
                          postgresqlApproach: 'Weighted scoring algorithms using CASE statements and mathematical formulas',
                          usedInModules: ['Cohi', 'TopTiering', 'Business Overview'],
                          keyFields: ['Loan Complexity Score', 'FICO Complexity', 'DTI Complexity', 'LTV Complexity', 'Risk Factor']
                        }
                      },
                      { 
                        name: 'Flags', 
                        desc: 'Status flags (Funded, Active, Locked), Channel flags, Validation flags', 
                        count: '20+ formulas',
                        details: {
                          purpose: 'Boolean flags indicating loan status, channel classification, and validation states',
                          examples: [
                            'Funded Flag',
                            'Active Loan Flag',
                            'Locked Flag',
                            'Retail Flag',
                            'TPO Flag'
                          ],
                          qlikFiles: ['Transform.qvs', 'Flags.qvs'],
                          postgresqlApproach: 'BOOLEAN columns with computed values based on date and status fields',
                          usedInModules: ['Business Overview', 'Closing & FallOut Forecast', 'Cohi', 'TopTiering', 'Leaderboard'],
                          keyFields: ['Funded Flag', 'Sold Flag', 'Active Loan Flag', 'Locked Flag', 'Channel Flags']
                        }
                      },
                      { 
                        name: 'Stratification', 
                        desc: 'Year stratification, Range categorizations, Loan amount buckets', 
                        count: '18+ formulas',
                        details: {
                          purpose: 'Categorize loans into buckets for analysis (year, amount ranges, etc.)',
                          examples: [
                            'Application Year Stratification',
                            'Loan Amount Buckets',
                            'FICO Range Categories',
                            'DTI Range Categories'
                          ],
                          qlikFiles: ['Transform.qvs', 'Ranges.qvs'],
                          postgresqlApproach: 'CASE statements for bucket assignments, EXTRACT for year stratification',
                          usedInModules: ['Business Overview', 'TopTiering', 'Cohi'],
                          keyFields: ['Application Date', 'Loan Amount', 'FICO Score', 'DTI Ratio']
                        }
                      },
                      { 
                        name: 'Variables', 
                        desc: 'Date toggles, Channel filters, Scorecard variables, Configuration', 
                        count: '50+ variables',
                        details: {
                          purpose: 'Dynamic variables for filtering, date range selection, and configuration',
                          examples: [
                            'vDateToggle1 (MTD/YTD/All Time)',
                            'vHighPerformerDateToggle',
                            'vCorrespondent (Channel filter)',
                            'vCurrentDate',
                            'vFiscalYearStart'
                          ],
                          qlikFiles: ['Variables.qvs', 'Transform.qvs'],
                          postgresqlApproach: 'Function parameters, session variables, or configuration tables',
                          usedInModules: ['All Modules'],
                          keyFields: ['Dynamic - varies by variable']
                        }
                      }
                    ].map((category) => (
                      <AccordionItem key={category.name} value={category.name.toLowerCase().replace(' ', '-')} className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800/50">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="flex items-center justify-between flex-1">
                            <div className="flex items-center gap-3">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Badge variant="outline" className="font-medium cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                                    {category.name}
                                  </Badge>
                                </DialogTrigger>
                                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                                  <DialogHeader>
                                    <DialogTitle>{category.name} Category</DialogTitle>
                                    <DialogDescription>{category.desc}</DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 mt-4">
                                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Purpose</p>
                                      <p className="text-sm text-slate-600 dark:text-slate-400 font-light">{category.details.purpose}</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Formula Count</p>
                                        <p className="text-lg font-medium text-slate-900 dark:text-white">{category.count}</p>
                                      </div>
                                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Qlik Source Files</p>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {category.details.qlikFiles.map((file: string) => (
                                            <Badge key={file} variant="outline" className="text-xs">{file}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">PostgreSQL Implementation Approach</p>
                                      <p className="text-sm text-slate-600 dark:text-slate-400 font-light">{category.details.postgresqlApproach}</p>
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Example Formulas</p>
                                      <div className="space-y-2">
                                        {category.details.examples.map((example: string, idx: number) => (
                                          <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700">
                                            <code className="text-xs text-slate-900 dark:text-white font-mono">{example}</code>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Used In Modules</p>
                                      <div className="flex flex-wrap gap-2">
                                        {category.details.usedInModules.map((module: string) => (
                                          <Badge key={module} variant="secondary">{module}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Key Fields</p>
                                      <div className="flex flex-wrap gap-2">
                                        {category.details.keyFields.map((field: string) => (
                                          <Badge key={field} variant="outline" className="text-xs">{field}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                              <span className="text-xs text-slate-500 dark:text-slate-400 font-light">
                                {category.count}
                              </span>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-3">
                          <div className="space-y-3">
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                              {category.desc}
                            </p>
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-light mb-2">
                                <strong className="text-slate-700 dark:text-slate-300">Purpose:</strong> {category.details.purpose}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-light mb-2">
                                <strong className="text-slate-700 dark:text-slate-300">Examples:</strong> {category.details.examples.slice(0, 3).join(', ')}
                              </p>
                              <p className="text-xs text-blue-600 dark:text-blue-400 font-light">
                                Click category badge for full details →
                              </p>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Logic & Formulas Tab */}
          <TabsContent value="logic" className="space-y-6">
            <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
              <CardHeader>
                <CardTitle className="text-lg font-light">
                  <TitleWithTooltip 
                    title="Core Logic & Formulas"
                    tooltip="Essential business formulas extracted from Qlik with both original Qlik expressions and PostgreSQL equivalents. Each formula includes dependencies, usage context, and implementation notes. Click any formula card to view full details in a modal."
                  />
                </CardTitle>
                <CardDescription className="font-light">
                  Extracted business logic from Qlik with Qlik expressions and PostgreSQL equivalents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {coreLogic.map((logic, index) => (
                    <Dialog key={index}>
                      <DialogTrigger asChild>
                        <div 
                          className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer relative"
                        >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-1">
                                {logic.name}
                                <TooltipIcon 
                                  tooltip={`${logic.name}\n\n${logic.description}\n\nCategory: ${logic.category}\nUsed in: ${logic.usedIn.join(', ')}`}
                                />
                              </h4>
                              <Badge variant="outline" className="text-xs">
                                {logic.category}
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-light mb-2">
                              {logic.description}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1 ml-2">
                            {logic.usedIn.map((module) => (
                              <Badge key={module} variant="secondary" className="text-xs">
                                {module}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Qlik Expression</p>
                            <code className="block p-2 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded text-xs font-mono overflow-x-auto line-clamp-2">
                              {logic.qlikExpression}
                            </code>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">PostgreSQL Equivalent</p>
                            <code className="block p-2 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded text-xs font-mono overflow-x-auto line-clamp-2">
                              {logic.sqlEquivalent}
                            </code>
                          </div>
                        </div>
                        {logic.dependencies.length > 0 && (
                          <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-medium">Dependencies:</span> {logic.dependencies.join(', ')}
                            </p>
                          </div>
                        )}
                        <div className="mt-3 text-center">
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            Click to view full details →
                          </span>
                        </div>
                      </div>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>{logic.name}</DialogTitle>
                          <DialogDescription>{logic.description}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 mt-4">
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Category</p>
                            <Badge variant="outline">{logic.category}</Badge>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Used In Modules</p>
                            <div className="flex flex-wrap gap-2">
                              {logic.usedIn.map((module) => (
                                <Badge key={module} variant="secondary">{module}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Qlik Expression</p>
                            <code className="block p-4 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded text-sm font-mono overflow-x-auto">
                              {logic.qlikExpression}
                            </code>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">PostgreSQL Equivalent</p>
                            <code className="block p-4 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded text-sm font-mono overflow-x-auto">
                              {logic.sqlEquivalent}
                            </code>
                          </div>
                          {logic.reasoning && (
                            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                              <p className="text-sm font-medium text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                                <CircleHelp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                Why This PostgreSQL Equivalent Works
                              </p>
                              <p className="text-sm text-slate-700 dark:text-slate-300 font-light leading-relaxed">
                                {logic.reasoning}
                              </p>
                            </div>
                          )}
                          {logic.dependencies.length > 0 && (
                            <div>
                              <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Dependencies</p>
                              <div className="flex flex-wrap gap-2">
                                {logic.dependencies.map((dep) => (
                                  <Badge key={dep} variant="outline">{dep}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                            <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">Implementation Notes</p>
                            <p className="text-sm text-blue-700 dark:text-blue-300 font-light">
                              This formula should be implemented as a PostgreSQL function or computed column depending on usage frequency. 
                              Consider indexing if used in WHERE clauses frequently.
                            </p>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Mapping Tool Tab */}
          <TabsContent value="dictionary" className="space-y-6">
            {/* Summary and Search Section */}
            <Card className="border-slate-200 dark:border-slate-700 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900">
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-white mb-2">
                      Mapping Tool Summary
                    </CardTitle>
                    <CardDescription className="text-base">
                      Complete field mapping from Qlik to Coheus v2 with LOS system equivalents (ICE Encompass, MeridianLink, Calyx, etc.)
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                        {Object.values(dataDictionary).reduce((total, fields) => total + fields.length, 0)}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400 font-light">
                        Total Fields
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                        {Object.keys(dataDictionary).length}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400 font-light">
                        Categories
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Category Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
                  {Object.entries(dataDictionary).map(([category, fields]) => (
                    <button
                      key={category}
                      onClick={() => {
                        setSelectedCategory(selectedCategory === category ? null : category);
                        setTimeout(() => {
                          const element = document.getElementById(`category-${category}`);
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                        }, 100);
                      }}
                      className={`p-3 rounded-lg border transition-all text-left ${
                        selectedCategory === category
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-blue-300 dark:hover:border-blue-700'
                      }`}
                    >
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                        {category.replace(/([A-Z])/g, ' $1').trim()}
                      </div>
                      <div className="text-xl font-bold text-slate-900 dark:text-white">
                        {fields.length}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400 dark:text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search fields by name, category, or description..."
                    value={dictionarySearch}
                    onChange={(e) => setDictionarySearch(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {dictionarySearch && (
                    <button
                      onClick={() => setDictionarySearch('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  )}
                </div>
                {dictionarySearch && (
                  <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                    {(() => {
                      const filteredCount = Object.entries(dataDictionary).reduce((count, [category, fields]) => {
                        const matchingFields = fields.filter((field: string) => {
                          const matchesSearch = field.toLowerCase().includes(dictionarySearch.toLowerCase()) ||
                            category.toLowerCase().includes(dictionarySearch.toLowerCase());
                          if (!matchesSearch) return false;
                          if (activeFieldTab === 'all') return true;
                          const implemented = isFieldImplemented(field);
                          return activeFieldTab === 'active' ? implemented : !implemented;
                        });
                        return count + matchingFields.length;
                      }, 0);
                      return `${filteredCount} field${filteredCount !== 1 ? 's' : ''} found`;
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active/Inactive Field Tabs */}
            <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
              <CardContent className="pt-6">
                <Tabs value={activeFieldTab} onValueChange={(value) => setActiveFieldTab(value as 'all' | 'active' | 'inactive')}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="all">
                      All Fields
                      <Badge variant="secondary" className="ml-2">
                        {Object.values(dataDictionary).reduce((total, fields) => total + fields.length, 0)}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="active">
                      Active
                      <Badge variant="secondary" className="ml-2">
                        {Object.values(dataDictionary).reduce((total, fields) => 
                          total + fields.filter((field: string) => isFieldImplemented(field)).length, 0
                        )}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="inactive">
                      Inactive
                      <Badge variant="secondary" className="ml-2">
                        {Object.values(dataDictionary).reduce((total, fields) => 
                          total + fields.filter((field: string) => !isFieldImplemented(field)).length, 0
                        )}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardContent>
            </Card>

            {/* Fields Grid and Cohi Chat Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Fields Grid - Takes 2 columns on large screens */}
              <div className="lg:col-span-2 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(dataDictionary)
                .filter(([category, fields]) => {
                  if (selectedCategory && selectedCategory !== category) return false;
                  if (!dictionarySearch) return true;
                  const searchLower = dictionarySearch.toLowerCase();
                  return category.toLowerCase().includes(searchLower) ||
                    fields.some((field: string) => field.toLowerCase().includes(searchLower));
                })
                .map(([category, fields]) => (
                <Card 
                  key={category} 
                  id={`category-${category}`}
                  className={`border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 ${
                    selectedCategory === category ? 'ring-2 ring-blue-500' : ''
                  }`}
                >
                  <CardHeader>
                    <CardTitle className="text-base font-light capitalize">
                      <Tooltip delayDuration={200}>
                        <div className="flex items-center gap-2">
                          <span>{category.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <TooltipIcon 
                            tooltip={
                              category === 'coreLoanFields' ? 'Essential loan identifiers and basic information: Loan Number, Loan Type, Loan Program, Loan Purpose, Interest Rate, FICO Score, LTV Ratio, DTI Ratio. Core fields for executive reporting and loan identification.' :
                              category === 'dateFields' ? 'All milestone dates throughout the loan lifecycle: Application, Funding, Closing, Lock dates plus all regulatory and processing milestones. Used for timeline tracking and executive dashboards.' :
                              category === 'statusFields' ? 'Simple status indicators for executive dashboards: Funded, Sold, Active, Locked, Approved, Withdrawn, Denied flags plus CTC, LE Sent, and other status indicators. Direct status reporting for C-level executives.' :
                              category === 'performanceFields' ? 'Key performance metrics for executives: Turn times (App-Fund, App-Close), Pull-through rates, Cycle times, Approval rates. Simple, direct performance indicators without complex BI calculations.' :
                              category === 'financialFields' ? 'Financial metrics for executive reporting: Revenue (Origination, Secondary, Total), Volume (Total, Funded, Applications), Projected closings, Concession amounts. Direct financial reporting for C-level executives.' :
                              category === 'riskFields' ? 'Risk and complexity indicators: Loan Complexity Score, FICO/DTI/LTV complexity, Out of Range flags, Risk Factor. Simple risk indicators for executive decision-making.' :
                              category === 'employeeFields' ? 'People responsible for loan processing: Loan Officer, Processor, Underwriter, Closer, Account Executive. Automatically extracted from CSV uploads with field name mapping support. Stored in metadata JSONB column for flexible persona/actor tracking. Used for executive accountability and performance tracking.' :
                              category === 'propertyFields' ? 'Basic property information: Address, Property Type, Number of Units, Occupancy Type, Property Valuation details. Essential property data for executive reporting.' :
                              category === 'channelFields' ? 'Distribution channels: Channel, Branch, Retail/TPO/Correspondent flags, TPO Company, Warehouse Company, Investor. Channel analysis for executive reporting.' :
                              category === 'borrowerFields' ? 'Borrower information: Position, Years on Job, Co-Borrower details, Income and Asset groupings. Borrower data for executive analysis.' :
                              category === 'underwritingFields' ? 'Underwriting details: DU/LP Case ID, AUS Source, Risk Assessment Type, AU Decision, CU Risk Source. Underwriting information for executive reporting.' :
                              category === 'aggregatedFields' ? 'Weighted averages and aggregations: WAC (Weighted Average Coupon), WAFICO, WALTV, WADTI for all loans and in-range loans. Executive-level aggregations for summary reporting.' :
                              category === 'groupingFields' ? 'Simplified groupings for executive reporting: Loan Type Group, Loan Purpose Group, Turn Time groupings. Grouped data for executive dashboards.' :
                              category === 'timeFields' ? 'Time-based filtering fields: Year and YearMonth fields for all dates, MTD/QTD/YTD flags. Used for time-based filtering in executive reports (less critical for direct executive viewing).' :
                              'Field category for loan data dictionary'
                            }
                          />
                        </div>
                      </Tooltip>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 pb-3 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {fields.length} field{fields.length !== 1 ? 's' : ''}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {category.replace(/([A-Z])/g, ' $1').trim()}
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2 max-h-[600px] overflow-y-auto">
                      {fields
                        .filter((field: string) => {
                          // Apply active/inactive filter
                          if (activeFieldTab !== 'all') {
                            const implemented = isFieldImplemented(field);
                            if (activeFieldTab === 'active' && !implemented) return false;
                            if (activeFieldTab === 'inactive' && implemented) return false;
                          }
                          // Apply search filter
                          if (!dictionarySearch) return true;
                          const searchLower = dictionarySearch.toLowerCase();
                          return field.toLowerCase().includes(searchLower) ||
                            category.toLowerCase().includes(searchLower);
                        })
                        .map((field: string, index: number) => {
                          const implemented = isFieldImplemented(field);
                        // Helper function to get LOS field mappings
                        const getLOSMappings = (fieldName: string): Record<string, string> => {
                          const losMappings: Record<string, Record<string, string>> = {
                            'Application Date': {
                              'ICE Encompass': 'Fields.15',
                              'MeridianLink': 'ApplicationDate',
                              'Calyx Point': 'ApplicationDate',
                              'BytePro': 'ApplicationDate',
                              'Floify': 'application_date'
                            },
                            'Funding Date': {
                              'ICE Encompass': 'Fields.1234',
                              'MeridianLink': 'FundingDate',
                              'Calyx Point': 'FundingDate',
                              'BytePro': 'FundingDate',
                              'Floify': 'funding_date'
                            },
                            'Closing Date': {
                              'ICE Encompass': 'Fields.1235',
                              'MeridianLink': 'ClosingDate',
                              'Calyx Point': 'ClosingDate',
                              'BytePro': 'ClosingDate',
                              'Floify': 'closing_date'
                            },
                            'Lock Date': {
                              'ICE Encompass': 'Fields.1236',
                              'MeridianLink': 'LockDate',
                              'Calyx Point': 'LockDate',
                              'BytePro': 'LockDate',
                              'Floify': 'lock_date'
                            },
                            'Loan Number': {
                              'ICE Encompass': 'Fields.3',
                              'MeridianLink': 'LoanNumber',
                              'Calyx Point': 'LoanNumber',
                              'BytePro': 'LoanNumber',
                              'Floify': 'loan_number'
                            },
                            'Loan Type': {
                              'ICE Encompass': 'Fields.19',
                              'MeridianLink': 'LoanType',
                              'Calyx Point': 'LoanType',
                              'BytePro': 'LoanType',
                              'Floify': 'loan_type'
                            },
                            'Loan Program': {
                              'ICE Encompass': 'Fields.20',
                              'MeridianLink': 'LoanProgram',
                              'Calyx Point': 'LoanProgram',
                              'BytePro': 'LoanProgram',
                              'Floify': 'loan_program'
                            },
                            'Interest Rate': {
                              'ICE Encompass': 'Fields.1237',
                              'MeridianLink': 'InterestRate',
                              'Calyx Point': 'InterestRate',
                              'BytePro': 'InterestRate',
                              'Floify': 'interest_rate'
                            },
                            'FICO Score': {
                              'ICE Encompass': 'Fields.1238',
                              'MeridianLink': 'FICOScore',
                              'Calyx Point': 'FICOScore',
                              'BytePro': 'FICOScore',
                              'Floify': 'fico_score'
                            },
                            'LTV Ratio': {
                              'ICE Encompass': 'Fields.1239',
                              'MeridianLink': 'LTV',
                              'Calyx Point': 'LTV',
                              'BytePro': 'LTV',
                              'Floify': 'ltv_ratio'
                            },
                            'DTI Ratio': {
                              'ICE Encompass': 'Fields.1240',
                              'MeridianLink': 'DTI',
                              'Calyx Point': 'DTI',
                              'BytePro': 'DTI',
                              'Floify': 'dti_ratio'
                            },
                            'Loan Amount': {
                              'ICE Encompass': 'Fields.11',
                              'MeridianLink': 'LoanAmount',
                              'Calyx Point': 'LoanAmount',
                              'BytePro': 'LoanAmount',
                              'Floify': 'loan_amount'
                            },
                            'Property Address': {
                              'ICE Encompass': 'Fields.13',
                              'MeridianLink': 'PropertyAddress',
                              'Calyx Point': 'PropertyAddress',
                              'BytePro': 'PropertyAddress',
                              'Floify': 'property_address'
                            },
                            'Loan Officer': {
                              'ICE Encompass': 'Fields.1241',
                              'MeridianLink': 'LoanOfficer',
                              'Calyx Point': 'LoanOfficer',
                              'BytePro': 'LoanOfficer',
                              'Floify': 'loan_officer'
                            },
                            'Processor': {
                              'ICE Encompass': 'Fields.1242',
                              'MeridianLink': 'Processor',
                              'Calyx Point': 'Processor',
                              'BytePro': 'Processor',
                              'Floify': 'processor'
                            },
                            'Underwriter': {
                              'ICE Encompass': 'Fields.1243',
                              'MeridianLink': 'Underwriter',
                              'Calyx Point': 'Underwriter',
                              'BytePro': 'Underwriter',
                              'Floify': 'underwriter'
                            },
                            'Closer': {
                              'ICE Encompass': 'Fields.1246',
                              'MeridianLink': 'Closer',
                              'Calyx Point': 'Closer',
                              'BytePro': 'Closer',
                              'Floify': 'closer'
                            },
                            'Account Executive': {
                              'ICE Encompass': 'Fields.1247',
                              'MeridianLink': 'AccountExecutive',
                              'Calyx Point': 'AccountExecutive',
                              'BytePro': 'AccountExecutive',
                              'Floify': 'account_executive'
                            },
                            'Channel': {
                              'ICE Encompass': 'Fields.1244',
                              'MeridianLink': 'Channel',
                              'Calyx Point': 'Channel',
                              'BytePro': 'Channel',
                              'Floify': 'channel'
                            },
                            'Investor': {
                              'ICE Encompass': 'Fields.1245',
                              'MeridianLink': 'Investor',
                              'Calyx Point': 'Investor',
                              'BytePro': 'Investor',
                              'Floify': 'investor'
                            }
                          };
                          
                          // Return mappings if found, otherwise check LOS field library
                          if (losMappings[fieldName]) {
                            return losMappings[fieldName];
                          }
                          
                          // Try to find field in LOS field library by display name or aliases
                          const libraryField = LOS_FIELD_LIBRARY.find(field => 
                            field.displayName === fieldName || 
                            field.aliases?.includes(fieldName) ||
                            field.sourceKey === fieldName.toLowerCase().replace(/\s+/g, '_')
                          );
                          
                          // Generate mappings - use library field ID if available
                          const fieldKey = fieldName.toLowerCase().replace(/\s+/g, '_');
                          const encompassFieldId = libraryField?.encompassFieldId;
                          
                          // For calculated/derived fields (like Warehouse Line Duration), indicate it's calculated
                          const isCalculatedField = fieldName.includes('Duration') || 
                                                    fieldName.includes('Days') || 
                                                    fieldName.includes('-') ||
                                                    fieldName.includes('Flag') ||
                                                    fieldName.includes('Range');
                          
                          // Determine ICE Encompass field display
                          let iceEncompassField: string;
                          if (encompassFieldId) {
                            // Use actual field ID from library
                            iceEncompassField = encompassFieldId;
                          } else if (isCalculatedField) {
                            // Calculated/derived fields
                            iceEncompassField = '(Calculated - Derived from other fields)';
                          } else if (libraryField) {
                            // Field exists in library but no field ID configured
                            iceEncompassField = '(Field ID not configured - Contact admin)';
                          } else {
                            // Field not found in library at all
                            iceEncompassField = '(Field ID not found - Contact admin)';
                          }
                          
                          return {
                            'ICE Encompass': iceEncompassField,
                            'MeridianLink': fieldName.replace(/\s+/g, ''),
                            'Calyx Point': fieldName.replace(/\s+/g, ''),
                            'BytePro': fieldName.replace(/\s+/g, ''),
                            'Floify': fieldKey
                          };
                        };

                        // Generate field details based on category and field name
                        const getFieldDetails = (cat: string, fieldName: string) => {
                          if (cat === 'dateFields') {
                            const details: Record<string, any> = {
                              'Application Date': {
                                description: 'Date when the loan application was first submitted by the borrower',
                                dataType: 'DATE',
                                qlikUsage: 'Used in date flag calculations (MTD, YTD, Rolling 13 Month), turn time calculations, and pipeline analysis',
                                postgresqlMapping: 'application_date DATE',
                                usedInModules: ['Business Overview', 'Cohi', 'Closing & FallOut Forecast', 'TopTiering'],
                                example: '2024-01-15',
                                losMappings: getLOSMappings('Application Date')
                              },
                              'Funding Date': {
                                description: 'Date when the loan was funded and disbursed to the borrower',
                                dataType: 'DATE',
                                qlikUsage: 'Used in pull-through rate calculations, revenue recognition, and cycle time metrics',
                                postgresqlMapping: 'funding_date DATE',
                                usedInModules: ['Business Overview', 'Leaderboard', 'TopTiering'],
                                example: '2024-02-20',
                                losMappings: getLOSMappings('Funding Date')
                              },
                              'Closing Date': {
                                description: 'Date when the loan officially closed and was recorded',
                                dataType: 'DATE',
                                qlikUsage: 'Used in closing forecasts, revenue calculations, and performance metrics',
                                postgresqlMapping: 'closing_date DATE',
                                usedInModules: ['Business Overview', 'Closing & FallOut Forecast', 'Leaderboard'],
                                example: '2024-02-18',
                                losMappings: getLOSMappings('Closing Date')
                              },
                              'Lock Date': {
                                description: 'Date when the interest rate was locked for the loan',
                                dataType: 'DATE',
                                qlikUsage: 'Used in lock expiration tracking, pricing analysis, and pipeline management',
                                postgresqlMapping: 'lock_date DATE',
                                usedInModules: ['Business Overview', 'Closing & FallOut Forecast'],
                                example: '2024-01-25'
                              },
                              'Investor Purchase Date': {
                                description: 'Date when the loan was sold to an investor',
                                dataType: 'DATE',
                                qlikUsage: 'Used in pull-through calculations, secondary revenue recognition, and investor reporting',
                                postgresqlMapping: 'investor_purchase_date DATE',
                                usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                                example: '2024-03-01'
                              },
                              'Credit Pull Date': {
                                description: 'Date when the credit report was pulled for the application',
                                dataType: 'DATE',
                                qlikUsage: 'Used in credit age calculations, risk assessment, and compliance tracking',
                                postgresqlMapping: 'credit_pull_date DATE',
                                usedInModules: ['Business Overview', 'Cohi'],
                                example: '2024-01-10'
                              },
                              'Registration Date': {
                                description: 'Date when the loan was registered in the system',
                                dataType: 'DATE',
                                qlikUsage: 'Used in system tracking, data quality checks, and audit trails',
                                postgresqlMapping: 'registration_date DATE',
                                usedInModules: ['Business Overview'],
                                example: '2024-01-12'
                              }
                            };
                            const defaultDetails = { description: 'Date field for loan lifecycle tracking', dataType: 'DATE', qlikUsage: 'Used in date calculations', postgresqlMapping: 'date_field DATE', usedInModules: ['Business Overview'], example: '2024-01-01', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          if (cat === 'statusFlags') {
                            const details: Record<string, any> = {
                              'Funded Flag': {
                                description: 'Indicates whether the loan has been funded',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in filtering funded loans, revenue calculations, and completion metrics',
                                postgresqlMapping: 'funded_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'Leaderboard', 'TopTiering'],
                                example: 'TRUE'
                              },
                              'Sold Flag': {
                                description: 'Indicates whether the loan has been sold to an investor',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in secondary market analysis, revenue recognition, and investor reporting',
                                postgresqlMapping: 'sold_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'TopTiering'],
                                example: 'TRUE'
                              },
                              'Active Loan Flag': {
                                description: 'Indicates whether the loan is currently active in the pipeline',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in pipeline analysis, forecasting, and active loan counts',
                                postgresqlMapping: 'active_loan_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'Closing & FallOut Forecast', 'Cohi'],
                                example: 'TRUE'
                              },
                              'Locked Flag': {
                                description: 'Indicates whether the interest rate has been locked',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in lock tracking, pricing analysis, and pipeline management',
                                postgresqlMapping: 'locked_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'Closing & FallOut Forecast'],
                                example: 'TRUE'
                              },
                              'Approved Flag': {
                                description: 'Indicates whether the loan has been approved by underwriting',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in approval rate calculations, pipeline analysis, and risk assessment',
                                postgresqlMapping: 'approved_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'TopTiering'],
                                example: 'TRUE'
                              },
                              'Withdrawn Flag': {
                                description: 'Indicates whether the borrower withdrew the application',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in fallout analysis, conversion rate calculations, and pipeline management',
                                postgresqlMapping: 'withdrawn_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'Closing & FallOut Forecast'],
                                example: 'FALSE'
                              },
                              'Denied Flag': {
                                description: 'Indicates whether the loan application was denied',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in denial rate analysis, risk assessment, and compliance reporting',
                                postgresqlMapping: 'denied_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'Cohi'],
                                example: 'FALSE'
                              }
                            };
                            const defaultDetails = { description: 'Status flag for loan state tracking', dataType: 'BOOLEAN', qlikUsage: 'Used in filtering and analysis', postgresqlMapping: 'status_flag BOOLEAN', usedInModules: ['Business Overview'], example: 'TRUE', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          if (cat === 'channelFlags') {
                            const details: Record<string, any> = {
                              'Retail Flag': {
                                description: 'Indicates whether the loan originated through the retail channel (direct borrower)',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in channel-specific analysis, revenue attribution, and performance comparisons',
                                postgresqlMapping: 'retail_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                                example: 'TRUE'
                              },
                              'TPO Flag': {
                                description: 'Indicates whether the loan originated through TPO (Third Party Originator) channel',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in channel performance analysis, commission calculations, and partner reporting',
                                postgresqlMapping: 'tpo_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'TopTiering'],
                                example: 'FALSE'
                              },
                              'Correspondent Channel Flag': {
                                description: 'Indicates whether the loan originated through the correspondent channel',
                                dataType: 'BOOLEAN',
                                qlikUsage: 'Used in channel-specific metrics, pull-through analysis, and channel comparisons',
                                postgresqlMapping: 'correspondent_channel_flag BOOLEAN DEFAULT FALSE',
                                usedInModules: ['Business Overview', 'TopTiering'],
                                example: 'FALSE'
                              }
                            };
                            const defaultDetails = { description: 'Channel flag for loan origin classification', dataType: 'BOOLEAN', qlikUsage: 'Used in channel analysis', postgresqlMapping: 'channel_flag BOOLEAN', usedInModules: ['Business Overview'], example: 'TRUE', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          if (cat === 'revenueFields') {
                            const details: Record<string, any> = {
                              'Origination Revenue': {
                                description: 'Revenue generated at loan origination from points and fees',
                                dataType: 'DECIMAL(10,2)',
                                qlikUsage: 'Used in revenue calculations, profitability analysis, and performance metrics',
                                postgresqlMapping: 'origination_revenue DECIMAL(10,2) DEFAULT 0.00',
                                usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                                example: '1250.50'
                              },
                              'Secondary Revenue': {
                                description: 'Revenue from selling the loan to an investor (gain on sale)',
                                dataType: 'DECIMAL(10,2)',
                                qlikUsage: 'Used in secondary market analysis, total revenue calculations, and profitability metrics',
                                postgresqlMapping: 'secondary_revenue DECIMAL(10,2) DEFAULT 0.00',
                                usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                                example: '3500.75'
                              },
                              'Total Revenue': {
                                description: 'Sum of origination and secondary revenue per loan',
                                dataType: 'DECIMAL(10,2)',
                                qlikUsage: 'Used in revenue aggregations, performance dashboards, and financial reporting',
                                postgresqlMapping: 'total_revenue DECIMAL(10,2) GENERATED ALWAYS AS (origination_revenue + secondary_revenue) STORED',
                                usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                                example: '4751.25'
                              },
                              'Base Buy Dollars': {
                                description: 'Purchase price paid to acquire the loan (base buy price)',
                                dataType: 'DECIMAL(12,2)',
                                qlikUsage: 'Used in revenue calculations, margin analysis, and cost basis tracking',
                                postgresqlMapping: 'base_buy_dollars DECIMAL(12,2) DEFAULT 0.00',
                                usedInModules: ['Business Overview', 'TopTiering'],
                                example: '250000.00'
                              },
                              'Base Sell Dollars': {
                                description: 'Sale price received when selling the loan to an investor',
                                dataType: 'DECIMAL(12,2)',
                                qlikUsage: 'Used in secondary revenue calculations, gain/loss analysis, and investor reporting',
                                postgresqlMapping: 'base_sell_dollars DECIMAL(12,2) DEFAULT 0.00',
                                usedInModules: ['Business Overview', 'TopTiering'],
                                example: '253500.75'
                              }
                            };
                            const defaultDetails = { description: 'Revenue field for financial calculations', dataType: 'DECIMAL(10,2)', qlikUsage: 'Used in revenue analysis', postgresqlMapping: 'revenue_field DECIMAL(10,2)', usedInModules: ['Business Overview'], example: '0.00', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          if (cat === 'complexityFields') {
                            const details: Record<string, any> = {
                              'Loan Complexity Score': {
                                description: 'Aggregated complexity score combining FICO, DTI, and LTV complexity components',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in loan difficulty assessment, performance scoring, and risk analysis',
                                postgresqlMapping: 'loan_complexity_score INTEGER DEFAULT 0',
                                usedInModules: ['TopTiering', 'Cohi', 'Business Overview'],
                                example: '6'
                              },
                              'FICO Complexity': {
                                description: 'Complexity score based on FICO credit score (0-3 scale, higher = more complex)',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in credit risk assessment, complexity scoring, and loan categorization',
                                postgresqlMapping: 'fico_complexity INTEGER DEFAULT 0',
                                usedInModules: ['TopTiering', 'Cohi'],
                                example: '2'
                              },
                              'DTI Complexity': {
                                description: 'Complexity score based on debt-to-income ratio (0-3 scale, higher = more complex)',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in affordability analysis, complexity scoring, and risk assessment',
                                postgresqlMapping: 'dti_complexity INTEGER DEFAULT 0',
                                usedInModules: ['TopTiering', 'Cohi'],
                                example: '1'
                              },
                              'LTV Complexity': {
                                description: 'Complexity score based on loan-to-value ratio (0-3 scale, higher = more complex)',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in equity analysis, complexity scoring, and risk assessment',
                                postgresqlMapping: 'ltv_complexity INTEGER DEFAULT 0',
                                usedInModules: ['TopTiering', 'Cohi'],
                                example: '3'
                              },
                              'Risk Factor': {
                                description: 'Weighted risk factor combining all complexity components with business rules',
                                dataType: 'DECIMAL(5,2)',
                                qlikUsage: 'Used in risk assessment, AI predictions, and loan prioritization',
                                postgresqlMapping: 'risk_factor DECIMAL(5,2) DEFAULT 0.00',
                                usedInModules: ['Cohi', 'TopTiering'],
                                example: '2.40'
                              }
                            };
                            const defaultDetails = { description: 'Complexity field for loan scoring', dataType: 'INTEGER', qlikUsage: 'Used in complexity analysis', postgresqlMapping: 'complexity_field INTEGER', usedInModules: ['TopTiering'], example: '0', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          if (cat === 'turnTimeFields') {
                            const details: Record<string, any> = {
                              'App-Fund': {
                                description: 'Number of days from application date to funding date',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in cycle time analysis, performance metrics, and efficiency tracking',
                                postgresqlMapping: 'app_fund_turn_time INTEGER GENERATED ALWAYS AS (DATE(funding_date) - DATE(application_date)) STORED',
                                usedInModules: ['Business Overview', 'Operations', 'TopTiering', 'Leaderboard'],
                                example: '35'
                              },
                              'App-Close': {
                                description: 'Number of days from application date to closing date',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in closing cycle analysis, forecasting, and performance tracking',
                                postgresqlMapping: 'app_close_turn_time INTEGER GENERATED ALWAYS AS (DATE(closing_date) - DATE(application_date)) STORED',
                                usedInModules: ['Business Overview', 'Operations', 'Leaderboard'],
                                example: '33'
                              },
                              'App-InvPurch': {
                                description: 'Number of days from application date to investor purchase date',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in pull-through analysis, secondary market timing, and performance metrics',
                                postgresqlMapping: 'app_invpurch_turn_time INTEGER GENERATED ALWAYS AS (DATE(investor_purchase_date) - DATE(application_date)) STORED',
                                usedInModules: ['Business Overview', 'TopTiering', 'Leaderboard'],
                                example: '45'
                              },
                              'Fund-InvPurch': {
                                description: 'Number of days from funding date to investor purchase date',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in secondary market timing analysis and warehouse line duration tracking',
                                postgresqlMapping: 'fund_invpurch_turn_time INTEGER GENERATED ALWAYS AS (DATE(investor_purchase_date) - DATE(funding_date)) STORED',
                                usedInModules: ['Business Overview', 'Operations'],
                                example: '10'
                              },
                              'Active Aging Days': {
                                description: 'Number of days from application date to current date for active loans',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in pipeline analysis, forecasting, and active loan management',
                                postgresqlMapping: 'active_aging_days INTEGER GENERATED ALWAYS AS (CASE WHEN active_loan_flag THEN FLOOR(CURRENT_DATE - application_date) ELSE NULL END) STORED',
                                usedInModules: ['Business Overview', 'Closing & FallOut Forecast', 'Cohi'],
                                example: '28'
                              },
                              'Warehouse Line Duration': {
                                description: 'Number of days the loan was held on warehouse line (funding to investor purchase)',
                                dataType: 'INTEGER',
                                qlikUsage: 'Used in warehouse line utilization, cost analysis, and risk management',
                                postgresqlMapping: 'warehouse_line_duration INTEGER GENERATED ALWAYS AS (DATE(investor_purchase_date) - DATE(funding_date)) STORED',
                                usedInModules: ['Business Overview', 'Operations'],
                                example: '10'
                              }
                            };
                            const defaultDetails = { description: 'Turn time field for cycle time calculations', dataType: 'INTEGER', qlikUsage: 'Used in turn time analysis', postgresqlMapping: 'turn_time_field INTEGER', usedInModules: ['Business Overview'], example: '0', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Core Loan Fields
                          if (cat === 'coreLoanFields') {
                            const details: Record<string, any> = {
                              'Loan Number': { description: 'Unique identifier for the loan', dataType: 'VARCHAR(50)', qlikUsage: 'Primary key for loan identification', postgresqlMapping: 'loan_number VARCHAR(50) PRIMARY KEY', usedInModules: ['All Modules'], example: 'LN-2024-001234' },
                              'Loan Type': { description: 'Type of loan (Conventional, FHA, VA, etc.)', dataType: 'VARCHAR(50)', qlikUsage: 'Loan classification for filtering and grouping', postgresqlMapping: 'loan_type VARCHAR(50)', usedInModules: ['Business Overview', 'TopTiering'], example: 'Conventional' },
                              'Loan Program': { description: 'Specific loan program name', dataType: 'VARCHAR(100)', qlikUsage: 'Program-level analysis', postgresqlMapping: 'loan_program VARCHAR(100)', usedInModules: ['Business Overview'], example: '30-Year Fixed' },
                              'Loan Purpose': { description: 'Purpose of the loan (Purchase, Refinance, etc.)', dataType: 'VARCHAR(50)', qlikUsage: 'Purpose-based analysis', postgresqlMapping: 'loan_purpose VARCHAR(50)', usedInModules: ['Business Overview', 'TopTiering'], example: 'Purchase' },
                              'Interest Rate': { description: 'Loan interest rate percentage', dataType: 'DECIMAL(5,3)', qlikUsage: 'Pricing analysis and risk assessment', postgresqlMapping: 'interest_rate DECIMAL(5,3)', usedInModules: ['Business Overview', 'TopTiering'], example: '6.750' },
                              'FICO Score': { description: 'Borrower credit score', dataType: 'INTEGER', qlikUsage: 'Credit risk assessment', postgresqlMapping: 'fico_score INTEGER', usedInModules: ['Business Overview', 'TopTiering', 'Cohi'], example: '720' },
                              'LTV Ratio': { description: 'Loan-to-value ratio percentage', dataType: 'DECIMAL(5,2)', qlikUsage: 'Equity and risk analysis', postgresqlMapping: 'ltv_ratio DECIMAL(5,2)', usedInModules: ['Business Overview', 'TopTiering'], example: '80.00' },
                              'DTI Ratio': { description: 'Debt-to-income ratio percentage', dataType: 'DECIMAL(5,2)', qlikUsage: 'Affordability analysis', postgresqlMapping: 'dti_ratio DECIMAL(5,2)', usedInModules: ['Business Overview', 'TopTiering'], example: '36.50' }
                            };
                            const defaultDetails = { description: 'Core loan field for executive reporting', dataType: 'VARCHAR', qlikUsage: 'Used in loan identification and basic reporting', postgresqlMapping: `${fieldName.toLowerCase().replace(/\s+/g, '_')} VARCHAR`, usedInModules: ['Business Overview'], example: 'N/A', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Performance Fields
                          if (cat === 'performanceFields') {
                            const details: Record<string, any> = {
                              'Pull Through Rate': { description: 'Percentage of applications that reach funding', dataType: 'DECIMAL(5,2)', qlikUsage: 'Key performance metric for executives', postgresqlMapping: 'pull_through_rate DECIMAL(5,2)', usedInModules: ['Business Overview', 'Closing & FallOut Forecast', 'Leaderboard'], example: '75.50' },
                              'Average App To Fund': { description: 'Average days from application to funding', dataType: 'INTEGER', qlikUsage: 'Cycle time metric for executives', postgresqlMapping: 'avg_app_to_fund INTEGER', usedInModules: ['Business Overview', 'Operations'], example: '35' },
                              'Average App To Close': { description: 'Average days from application to closing', dataType: 'INTEGER', qlikUsage: 'Closing cycle time for executives', postgresqlMapping: 'avg_app_to_close INTEGER', usedInModules: ['Business Overview', 'Operations'], example: '33' },
                              'Approval %': { description: 'Percentage of loans approved', dataType: 'DECIMAL(5,2)', qlikUsage: 'Approval rate for executive reporting', postgresqlMapping: 'approval_percent DECIMAL(5,2)', usedInModules: ['Business Overview', 'TopTiering'], example: '85.00' }
                            };
                            const defaultDetails = { description: 'Performance metric for executive reporting', dataType: 'DECIMAL(5,2)', qlikUsage: 'Used in performance dashboards', postgresqlMapping: `${fieldName.toLowerCase().replace(/\s+/g, '_')} DECIMAL(5,2)`, usedInModules: ['Business Overview'], example: '0.00', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Financial Fields
                          if (cat === 'financialFields') {
                            const details: Record<string, any> = {
                              'Total Volume': { description: 'Total loan volume in dollars', dataType: 'DECIMAL(15,2)', qlikUsage: 'Primary financial metric for executives', postgresqlMapping: 'total_volume DECIMAL(15,2)', usedInModules: ['Business Overview', 'Leaderboard', 'TopTiering'], example: '125000000.00' },
                              'Total Units': { description: 'Total number of loans', dataType: 'INTEGER', qlikUsage: 'Loan count for executive reporting', postgresqlMapping: 'total_units INTEGER', usedInModules: ['Business Overview', 'Leaderboard'], example: '500' },
                              'Funded Volume': { description: 'Volume of funded loans', dataType: 'DECIMAL(15,2)', qlikUsage: 'Funded volume for executives', postgresqlMapping: 'funded_volume DECIMAL(15,2)', usedInModules: ['Business Overview', 'Leaderboard'], example: '100000000.00' },
                              'Funded Units': { description: 'Number of funded loans', dataType: 'INTEGER', qlikUsage: 'Funded count for executives', postgresqlMapping: 'funded_units INTEGER', usedInModules: ['Business Overview', 'Leaderboard'], example: '400' },
                              'Current Month Projected Closings': { description: 'Projected closings for current month', dataType: 'INTEGER', qlikUsage: 'Forecast for executives', postgresqlMapping: 'current_month_projected_closings INTEGER', usedInModules: ['Closing & FallOut Forecast'], example: '50' },
                              'Current Month Projected Closings $': { description: 'Projected closing volume for current month', dataType: 'DECIMAL(15,2)', qlikUsage: 'Forecast volume for executives', postgresqlMapping: 'current_month_projected_closings_dollars DECIMAL(15,2)', usedInModules: ['Closing & FallOut Forecast'], example: '12500000.00' }
                            };
                            const defaultDetails = { description: 'Financial metric for executive reporting', dataType: 'DECIMAL(15,2)', qlikUsage: 'Used in financial dashboards', postgresqlMapping: `${fieldName.toLowerCase().replace(/\s+/g, '_')} DECIMAL(15,2)`, usedInModules: ['Business Overview'], example: '0.00', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Employee Fields (Persona/Actor Fields)
                          if (cat === 'employeeFields') {
                            const details: Record<string, any> = {
                              'Loan Officer': { 
                                description: 'Primary loan officer responsible for the loan. Extracted from CSV with automatic field mapping. Stored in metadata and linked to employees table via loan_officer_id. Automatically creates employee records if not exists.', 
                                dataType: 'VARCHAR(100) or UUID (if linked to employees table)', 
                                qlikUsage: 'Performance tracking and accountability', 
                                postgresqlMapping: 'loan_officer_id UUID REFERENCES employees(id), metadata->>\'loan_officer_name\' VARCHAR(100)', 
                                usedInModules: ['Leaderboard', 'TopTiering', 'Business Overview', 'Cohi'], 
                                example: 'John Smith',
                                extraction: 'Extracted from loan_officer_name, loan_officer, originator_name fields. Automatically creates employee records if not exists.',
                                csvFields: ['loan_officer_name', 'loan_officer', 'originator_name', 'loan_officer_id']
                              },
                              'Processor': { 
                                description: 'Loan processor assigned to the loan. Extracted from CSV and stored in metadata. Supports multiple field name variations for compatibility with different LOS systems.', 
                                dataType: 'VARCHAR(100)', 
                                qlikUsage: 'Processor performance tracking', 
                                postgresqlMapping: 'metadata->>\'processor\' VARCHAR(100)', 
                                usedInModules: ['Leaderboard', 'Operations'], 
                                example: 'Jane Doe',
                                extraction: 'Extracted from processor, processor_name, processorName, assigned_processor, assignedProcessor fields.',
                                csvFields: ['processor', 'processor_name', 'processorName', 'assigned_processor', 'assignedProcessor']
                              },
                              'Underwriter': { 
                                description: 'Underwriter assigned to the loan. Extracted from CSV and stored in metadata. Used for underwriting performance analysis and accountability.', 
                                dataType: 'VARCHAR(100)', 
                                qlikUsage: 'Underwriting performance tracking', 
                                postgresqlMapping: 'metadata->>\'underwriter_name\' VARCHAR(100)', 
                                usedInModules: ['Leaderboard', 'Operations'], 
                                example: 'Bob Johnson',
                                extraction: 'Extracted from underwriter_name, underwriter, underwriterName, uw_name, uwName, assigned_underwriter, assignedUnderwriter fields.',
                                csvFields: ['underwriter_name', 'underwriter', 'underwriterName', 'uw_name', 'uwName', 'assigned_underwriter', 'assignedUnderwriter']
                              },
                              'Closer': { 
                                description: 'Closer assigned to the loan. Extracted from CSV and stored in metadata. Used for closing performance tracking and cycle time analysis.', 
                                dataType: 'VARCHAR(100)', 
                                qlikUsage: 'Closing performance tracking', 
                                postgresqlMapping: 'metadata->>\'closer\' VARCHAR(100)', 
                                usedInModules: ['Leaderboard', 'Operations'], 
                                example: 'Alice Williams',
                                extraction: 'Extracted from closer, closer_name, closerName, assigned_closer, assignedCloser fields.',
                                csvFields: ['closer', 'closer_name', 'closerName', 'assigned_closer', 'assignedCloser']
                              },
                              'Account Executive': {
                                description: 'Account Executive or Sales Rep assigned to the loan. Extracted from CSV and stored in metadata. Used for sales performance tracking.',
                                dataType: 'VARCHAR(100)',
                                qlikUsage: 'Sales and account executive performance tracking',
                                postgresqlMapping: 'metadata->>\'account_executive\' VARCHAR(100)',
                                usedInModules: ['Leaderboard', 'TopTiering'],
                                example: 'Mike Davis',
                                extraction: 'Extracted from account_executive, accountExecutive, ae, ae_name, aeName, sales_rep, salesRep, sales_rep_ae, salesRepAe fields.',
                                csvFields: ['account_executive', 'accountExecutive', 'ae', 'ae_name', 'aeName', 'sales_rep', 'salesRep', 'sales_rep_ae', 'salesRepAe']
                              }
                            };
                            const defaultDetails = { 
                              description: 'Employee or persona field for accountability tracking. Automatically extracted from CSV uploads with field name mapping support. Stored in metadata JSONB column.', 
                              dataType: 'VARCHAR(100)', 
                              qlikUsage: 'Performance tracking', 
                              postgresqlMapping: `metadata->>'${fieldName.toLowerCase().replace(/\s+/g, '_')}' VARCHAR(100)`, 
                              usedInModules: ['Leaderboard'], 
                              example: 'Employee Name', 
                              losMappings: getLOSMappings(fieldName),
                              extraction: 'Extracted from CSV with automatic field mapping. Stored in metadata JSONB column.'
                            };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Property Fields
                          if (cat === 'propertyFields') {
                            const details: Record<string, any> = {
                              'Property State': { description: 'State where property is located', dataType: 'VARCHAR(2)', qlikUsage: 'Geographic analysis', postgresqlMapping: 'property_state VARCHAR(2)', usedInModules: ['Business Overview'], example: 'CA' },
                              'Property Type': { description: 'Type of property (Single Family, Condo, etc.)', dataType: 'VARCHAR(50)', qlikUsage: 'Property type analysis', postgresqlMapping: 'property_type VARCHAR(50)', usedInModules: ['Business Overview'], example: 'Single Family' },
                              'Number of Units': { description: 'Number of units in the property', dataType: 'INTEGER', qlikUsage: 'Property classification', postgresqlMapping: 'number_of_units INTEGER', usedInModules: ['Business Overview'], example: '1' },
                              'Sales Price': { description: 'Property sales price', dataType: 'DECIMAL(12,2)', qlikUsage: 'Property value analysis', postgresqlMapping: 'sales_price DECIMAL(12,2)', usedInModules: ['Business Overview'], example: '500000.00' },
                              'Appraised Value': { description: 'Property appraised value', dataType: 'DECIMAL(12,2)', qlikUsage: 'Property valuation analysis', postgresqlMapping: 'appraised_value DECIMAL(12,2)', usedInModules: ['Business Overview'], example: '510000.00' }
                            };
                            const defaultDetails = { description: 'Property field for executive reporting', dataType: 'VARCHAR', qlikUsage: 'Used in property analysis', postgresqlMapping: `${fieldName.toLowerCase().replace(/\s+/g, '_')} VARCHAR`, usedInModules: ['Business Overview'], example: 'N/A', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Channel Fields
                          if (cat === 'channelFields') {
                            const details: Record<string, any> = {
                              'Channel': { description: 'Distribution channel (Retail, TPO, Correspondent)', dataType: 'VARCHAR(50)', qlikUsage: 'Channel analysis for executives', postgresqlMapping: 'channel VARCHAR(50)', usedInModules: ['Business Overview', 'TopTiering'], example: 'Retail' },
                              'Branch': { description: 'Branch location', dataType: 'VARCHAR(100)', qlikUsage: 'Branch-level analysis', postgresqlMapping: 'branch VARCHAR(100)', usedInModules: ['Business Overview', 'Leaderboard'], example: 'Main Office' },
                              'Investor': { description: 'Investor purchasing the loan', dataType: 'VARCHAR(100)', qlikUsage: 'Investor analysis', postgresqlMapping: 'investor VARCHAR(100)', usedInModules: ['Business Overview', 'TopTiering'], example: 'Fannie Mae' }
                            };
                            const defaultDetails = { description: 'Channel field for executive reporting', dataType: 'VARCHAR', qlikUsage: 'Used in channel analysis', postgresqlMapping: `${fieldName.toLowerCase().replace(/\s+/g, '_')} VARCHAR`, usedInModules: ['Business Overview'], example: 'N/A', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Risk Fields (expanding complexityFields to riskFields)
                          if (cat === 'riskFields') {
                            const details: Record<string, any> = {
                              'Loan Complexity Score': { description: 'Aggregated complexity score (0-9 scale)', dataType: 'INTEGER', qlikUsage: 'Risk assessment for executives', postgresqlMapping: 'loan_complexity_score INTEGER DEFAULT 0', usedInModules: ['TopTiering', 'Cohi', 'Business Overview'], example: '6' },
                              'FICO Out of Range Flag': { description: 'Flag indicating FICO score is outside acceptable range', dataType: 'BOOLEAN', qlikUsage: 'Risk indicator for executives', postgresqlMapping: 'fico_out_of_range_flag BOOLEAN DEFAULT FALSE', usedInModules: ['Business Overview', 'Cohi'], example: 'FALSE' },
                              'LTV Out of Range Flag': { description: 'Flag indicating LTV is outside acceptable range', dataType: 'BOOLEAN', qlikUsage: 'Risk indicator for executives', postgresqlMapping: 'ltv_out_of_range_flag BOOLEAN DEFAULT FALSE', usedInModules: ['Business Overview', 'Cohi'], example: 'FALSE' },
                              'DTI Out of Range Flag': { description: 'Flag indicating DTI is outside acceptable range', dataType: 'BOOLEAN', qlikUsage: 'Risk indicator for executives', postgresqlMapping: 'dti_out_of_range_flag BOOLEAN DEFAULT FALSE', usedInModules: ['Business Overview', 'Cohi'], example: 'FALSE' }
                            };
                            const defaultDetails = { description: 'Risk indicator for executive reporting', dataType: 'BOOLEAN', qlikUsage: 'Used in risk analysis', postgresqlMapping: `${fieldName.toLowerCase().replace(/\s+/g, '_')} BOOLEAN`, usedInModules: ['Business Overview'], example: 'FALSE', losMappings: getLOSMappings(fieldName) };
                            return details[fieldName] ? { ...details[fieldName], losMappings: getLOSMappings(fieldName) } : defaultDetails;
                          }
                          // Default fallback for all other categories
                          return {
                            description: `${fieldName} field from ${cat} - Mapped to Coheus v2 for executive reporting`,
                            dataType: cat.includes('Flag') || cat.includes('statusFields') ? 'BOOLEAN' : cat.includes('Revenue') || cat.includes('financialFields') ? 'DECIMAL(15,2)' : cat.includes('Fields') && (cat.includes('Date') || cat.includes('dateFields')) ? 'DATE' : cat.includes('Fields') && (cat.includes('Year') || cat.includes('YearMonth') || cat.includes('timeFields')) ? 'VARCHAR(20)' : 'VARCHAR',
                            qlikUsage: 'Used in Qlik calculations, mapped to Coheus v2 for simplified executive reporting',
                            postgresqlMapping: `${fieldName.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_').replace(/\$/g, 'dollar')} ${cat.includes('Flag') || cat.includes('statusFields') ? 'BOOLEAN' : cat.includes('Revenue') || cat.includes('financialFields') ? 'DECIMAL(15,2)' : cat.includes('Fields') && (cat.includes('Date') || cat.includes('dateFields')) ? 'DATE' : cat.includes('Fields') && (cat.includes('Year') || cat.includes('YearMonth') || cat.includes('timeFields')) ? 'VARCHAR(20)' : 'VARCHAR'}`,
                            usedInModules: ['Business Overview'],
                            example: 'N/A',
                            losMappings: getLOSMappings(fieldName)
                          };
                        };

                        const fieldDetails = getFieldDetails(category, field);
                        
                        return (
                          <Dialog key={index}>
                            <DialogTrigger asChild>
                              <div 
                                className={`p-3 rounded border transition-all cursor-pointer ${
                                  implemented
                                    ? 'bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                                    : 'bg-slate-100/50 dark:bg-slate-900/30 border-slate-300/50 dark:border-slate-700/50 hover:border-slate-400 dark:hover:border-slate-600 opacity-60'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {implemented && (
                                      <span className="text-emerald-600 dark:text-emerald-400 font-bold text-base flex-shrink-0" title="Implemented in V2">✓</span>
                                    )}
                                    <code className={`text-sm font-mono flex-1 truncate ${
                                      implemented 
                                        ? 'text-slate-900 dark:text-white' 
                                        : 'text-slate-500 dark:text-slate-500'
                                    }`}>{field}</code>
                                  </div>
                                  <span className={`text-xs flex-shrink-0 ${
                                    implemented 
                                      ? 'text-blue-600 dark:text-blue-400' 
                                      : 'text-slate-400 dark:text-slate-600'
                                  }`}>View details →</span>
                                </div>
                              </div>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <div className="flex items-center gap-2">
                                  <DialogTitle className="font-mono">{field}</DialogTitle>
                                  {implemented && (
                                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                                      <span className="mr-1">✓</span> V2 Implemented
                                    </Badge>
                                  )}
                                  {!implemented && (
                                    <Badge variant="outline" className="text-slate-500 dark:text-slate-400">
                                      Not Yet Implemented
                                    </Badge>
                                  )}
                                </div>
                                <DialogDescription>{fieldDetails.description}</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 mt-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Data Type</p>
                                    <code className="text-sm text-slate-900 dark:text-white font-mono">{fieldDetails.dataType}</code>
                                  </div>
                                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Example Value</p>
                                    <code className="text-sm text-slate-900 dark:text-white font-mono">{fieldDetails.example}</code>
                                  </div>
                                </div>
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                  <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Qlik Usage</p>
                                  <p className="text-sm text-slate-600 dark:text-slate-400 font-light">{fieldDetails.qlikUsage}</p>
                                </div>
                                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                  <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">PostgreSQL Mapping</p>
                                  <code className="block text-sm text-slate-900 dark:text-white font-mono bg-white dark:bg-slate-800 p-2 rounded mt-2">
                                    {fieldDetails.postgresqlMapping}
                                  </code>
                                </div>
                                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                                  <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Used In Modules</p>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {fieldDetails.usedInModules.map((module: string) => (
                                      <Badge key={module} variant="secondary">{module}</Badge>
                                    ))}
                                  </div>
                                </div>
                                {fieldDetails.extraction && (
                                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                                    <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">CSV Extraction</p>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 font-light mb-3">{fieldDetails.extraction}</p>
                                    {fieldDetails.csvFields && (
                                      <div className="mt-3">
                                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Supported CSV Field Names:</p>
                                        <div className="flex flex-wrap gap-1.5">
                                          {fieldDetails.csvFields.map((csvField: string) => (
                                            <code key={csvField} className="text-xs text-slate-900 dark:text-white font-mono bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                                              {csvField}
                                            </code>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {fieldDetails.losMappings && (
                                  <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                                    <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">LOS System Field Mappings</p>
                                    <div className="space-y-2">
                                      {Object.entries(fieldDetails.losMappings).map(([losSystem, fieldName]) => {
                                        // For ICE Encompass, ensure we display the field ID# format (e.g., "Fields.1236")
                                        const displayValue = losSystem === 'ICE Encompass' 
                                          ? (fieldName as string).startsWith('Fields.') 
                                            ? fieldName as string 
                                            : `Fields.${fieldName}`
                                          : fieldName as string;
                                        
                                        return (
                                          <div key={losSystem} className="flex items-center justify-between py-2 px-3 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{losSystem}</span>
                                            <code className="text-xs text-slate-900 dark:text-white font-mono bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">
                                              {displayValue}
                                            </code>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 font-light">
                                      Reference field names for mapping data from your LOS system to Coheus v2
                                    </p>
                                  </div>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
                </div>
              </div>
              
              {/* Cohi Chat Panel - Takes 1 column on large screens */}
              <div className="lg:col-span-1">
                <CohiChatPanel 
                  qlikContext={{
                    totalFields: Object.values(dataDictionary).reduce((total, fields) => total + fields.length, 0),
                    implementedFields: Object.values(dataDictionary).reduce((total, fields) => 
                      total + fields.filter((field: string) => isFieldImplemented(field)).length, 0
                    ),
                    currentCategory: selectedCategory,
                    searchQuery: dictionarySearch,
                    dataDictionary: dataDictionary
                  }}
                />
              </div>
            </div>
          </TabsContent>

          {/* Modules Tab */}
          <TabsContent value="modules" className="space-y-6">
            {modulePlans.map((module, index) => (
              <Card key={index} className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-light">
                        <Tooltip delayDuration={200}>
                          <div className="flex items-center gap-2">
                            <span>{module.name}</span>
                            <TooltipIcon 
                              tooltip={`${module.name}\n\n${module.currentStatus}\n\n${
                                module.name === 'Cohi (formerly Aletheia)' ? 'AI-powered insights engine that provides predictive analytics, anomaly detection, and business intelligence. Migrating Qlik complexity scores and pull-through patterns to enhance AI predictions.' :
                                module.name === 'Business Overview' ? 'Core dashboard showing key metrics: active loans, closed loans, cycle times, pull-through rates, revenue, and credit pulls. Foundation metrics for executive decision-making.' :
                                module.name === 'Closing & FallOut Forecast' ? 'Forecasting module that predicts loan closings and fallouts based on historical pull-through rates, active aging, and pipeline analysis. Critical for capacity planning.' :
                                module.name === 'TopTiering' ? 'Performance ranking system that scores employees based on productivity (loans closed), profitability (revenue), and complexity (loan difficulty). Uses weighted scoring algorithms from Qlik.' :
                                'Employee performance tracking showing loans closed, revenue generated, pull-through rates, and cycle times. Motivational tool for loan officers with ranking and delta calculations.'
                              }`}
                            />
                          </div>
                        </Tooltip>
                      </CardTitle>
                      <CardDescription className="font-light mt-1">
                        {module.currentStatus}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={module.priority === 'high' ? 'destructive' : 'secondary'}
                      >
                        {module.priority.toUpperCase()}
                      </Badge>
                      <Badge variant="outline">
                        {module.estimatedEffort}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Accordion type="single" collapsible className="space-y-2">
                    <AccordionItem value="qlik-logic" className="border border-slate-200 dark:border-slate-700 rounded-lg">
                      <AccordionTrigger className="px-3 py-2 hover:no-underline">
                    <Tooltip delayDuration={200}>
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
                        Qlik Logic to Migrate ({module.qlikLogic.length} formulas)
                        <TooltipIcon tooltip="Specific Qlik formulas and logic that need to be migrated to this module. Each formula includes Qlik expression, PostgreSQL equivalent, dependencies, and implementation context. Click any formula to view full details." />
                      </h4>
                    </Tooltip>
                      </AccordionTrigger>
                      <AccordionContent className="px-3 pb-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                          {module.qlikLogic.map((logic, idx) => (
                            <Dialog key={idx}>
                              <DialogTrigger asChild>
                                <div 
                                  className="p-3 bg-slate-50 dark:bg-slate-800/30 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer"
                                >
                                  <p className="text-xs font-medium text-slate-900 dark:text-white mb-1">{logic.name}</p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 font-light mb-2">
                                    {logic.category}
                                  </p>
                                  <p className="text-xs text-slate-400 dark:text-slate-500 font-light line-clamp-2">
                                    {logic.description}
                                  </p>
                                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-light">
                                    Click to view details →
                                  </p>
                                </div>
                              </DialogTrigger>
                              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>{logic.name}</DialogTitle>
                                  <DialogDescription>{logic.description}</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 mt-4">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Qlik Expression</p>
                                      <code className="block p-3 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded text-xs font-mono overflow-x-auto">
                                        {logic.qlikExpression}
                                      </code>
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">PostgreSQL Equivalent</p>
                                      <code className="block p-3 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded text-xs font-mono overflow-x-auto">
                                        {logic.sqlEquivalent}
                                      </code>
                                    </div>
                                  </div>
                                  {logic.reasoning && (
                                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                                        <CircleHelp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                        Why This PostgreSQL Equivalent Works
                                      </p>
                                      <p className="text-sm text-slate-700 dark:text-slate-300 font-light leading-relaxed">
                                        {logic.reasoning}
                                      </p>
                                    </div>
                                  )}
                                  {logic.dependencies.length > 0 && (
                                    <div>
                                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">Dependencies</p>
                                      <div className="flex flex-wrap gap-2">
                                        {logic.dependencies.map((dep) => (
                                          <Badge key={dep} variant="outline">{dep}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </DialogContent>
                            </Dialog>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  <div>
                    <Tooltip delayDuration={200}>
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                        Implementation Steps
                        <TooltipIcon tooltip="Step-by-step implementation plan for migrating Qlik logic to this module. Each step includes specific tasks, estimated time, and dependencies. Follow in order for best results." />
                      </h4>
                    </Tooltip>
                    <ol className="space-y-2">
                      {module.implementationSteps.map((step, idx) => (
                        <li key={idx} className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mt-0.5">
                            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{idx + 1}</span>
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-400 font-light flex-1">
                            {step}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Implementation Plan Tab */}
          <TabsContent value="plan" className="space-y-6">
            <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
              <CardHeader>
                  <CardTitle className="text-lg font-light">
                  <TitleWithTooltip 
                    title="2-Week Implementation Plan"
                    tooltip="Detailed day-by-day implementation schedule for the 2-week plan (80 hours total, 10 working days). Week 1 focuses on foundation, Business Overview, and Forecasting. Week 2 focuses on Cohi, TopTiering, Leaderboard, testing, and polish. Each day has hour-by-hour breakdowns with specific tasks."
                  />
                </CardTitle>
                <CardDescription className="font-light">
                  Comprehensive 80-hour implementation (8 hours/day × 10 days) • Starting Tuesday
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Week 1 */}
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 rounded-lg border-2 border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-3 bg-blue-600 dark:bg-blue-500 rounded-lg">
                        <span className="text-white font-bold text-base">Week 1</span>
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Foundation & Core Modules</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400 font-light">Days 1-5: Database setup, Business Overview, Forecasting</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800 text-base px-4 py-2">40 hours</Badge>
                    </div>
                  </div>

                  {/* Day 1 - Tuesday */}
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-blue-600 dark:bg-blue-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 1</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Tuesday - Database Foundation & Migration Setup
                            <TooltipIcon tooltip="Day 1 establishes the foundation: Create database migration file with all computed columns, PostgreSQL functions for date flags, indexes for performance, and initial testing framework." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: Critical</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Database</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Database className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Create database migration file with computed columns for date flags (Rolling 13 Month, MTD, YTD) - PostgreSQL functions</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Database className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Add computed columns for status flags (Funded, Active, Locked, Sold, Withdrawn, Denied)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Database className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4:</strong> Add computed columns for turn time calculations (App-Fund, App-Close, App-InvPurch, etc.)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Database className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 5:</strong> Add computed columns for revenue (Total Revenue = Origination + Secondary)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Database className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 6:</strong> Create indexes on all computed columns for performance optimization</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Create PostgreSQL functions for date flag calculations (fRolling13MonthFlag, fMTDFlag, fYTDFlag)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Test migration file, verify computed columns work correctly</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 2 - Wednesday */}
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-emerald-600 dark:bg-emerald-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 2</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Wednesday - Business Overview Backend
                            <TooltipIcon tooltip="Day 2 implements Business Overview backend: Update service functions to use new computed columns, implement pull-through rate calculations, revenue aggregations, and cycle time improvements." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: High</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Business Overview</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Update getBusinessOverviewMetrics() to use date flag computed columns and filters</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Implement pull-through rate calculations using Qlik formula in service layer</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4:</strong> Update revenue aggregations (use Total Revenue computed column)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 5-6:</strong> Improve cycle time calculations using turn time computed columns</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Update API endpoint to return new metrics with Qlik formulas</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Test Business Overview API endpoints and verify calculations</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 3 - Thursday */}
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-purple-600 dark:bg-purple-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 3</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Thursday - Business Overview Frontend & Closing Forecast Backend
                            <TooltipIcon tooltip="Day 3 updates Business Overview React components and implements Closing & FallOut Forecast backend service with pull-through rate calculations by loan type." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: High</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Frontend + Forecast</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Update Business Overview React components to display new Qlik-derived metrics</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Create getClosingFalloutForecast() service function</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4:</strong> Implement pull-through rate calculations by loan type (Qlik formula)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 5:</strong> Add active aging days calculation for pipeline analysis</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 6-7:</strong> Create basic fallout forecast using historical pull-through rates</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Create/update API endpoint for Closing & FallOut Forecast</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 4 - Friday */}
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-amber-600 dark:bg-amber-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 4</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Friday - Closing Forecast Frontend & Cohi Backend
                            <TooltipIcon tooltip="Day 4 updates Closing Forecast frontend and starts Cohi (Aletheia) backend integration with date flags and complexity scores." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: High</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Forecast + Cohi</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Update ClosingFalloutForecast.tsx component to use new API endpoint</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Rename Aletheia components to Cohi (directory and all imports)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4-5:</strong> Update Cohi insights API to use date flag calculations (Rolling 13 Month, MTD, YTD)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 6:</strong> Integrate complexity score as feature in Cohi AI predictions</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Update pull-through rate calculations in Cohi insights</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Test Cohi insights with new Qlik formulas</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 5 - Monday Week 2 */}
                  <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-indigo-600 dark:bg-indigo-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 5</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Monday - Cohi Frontend & Testing
                            <TooltipIcon tooltip="Day 5 completes Cohi frontend updates and performs initial testing of all Week 1 work." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: High</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Cohi + Test</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-3:</strong> Update all Cohi frontend components (CohiInsightsPanel, CohiPromptsCard, etc.)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4:</strong> Update useCohiData hook (renamed from useAletheiaData)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 5-6:</strong> Integration testing: Business Overview, Closing Forecast, Cohi</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Fix bugs and issues found in testing</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Document Week 1 progress and prepare for Week 2</span>
                      </li>
                    </ul>
                  </div>

                  {/* Week 2 */}
                  <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-slate-800 dark:to-slate-900 rounded-lg border-2 border-emerald-200 dark:border-emerald-800 mt-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-3 bg-emerald-600 dark:bg-emerald-500 rounded-lg">
                        <span className="text-white font-bold text-base">Week 2</span>
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Performance Modules & Polish</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400 font-light">Days 6-10: TopTiering, Leaderboard, Validation, Testing, Deployment</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800 text-base px-4 py-2">40 hours</Badge>
                    </div>
                  </div>

                  {/* Day 6 - Tuesday Week 2 */}
                  <div className="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-teal-600 dark:bg-teal-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 6</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Tuesday - TopTiering Backend
                            <TooltipIcon tooltip="Day 6 implements TopTiering backend: Complexity score calculations, productivity metrics, profitability calculations, and ranking algorithm updates." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: Medium</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">TopTiering</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Add complexity score calculation (FICO + DTI + LTV complexity) - computed column</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Update getTopTieringRankings() service function with complexity scoring</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4-5:</strong> Update productivity metrics with Qlik formulas (turn times, volume per employee)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 6:</strong> Enhance profitability calculations (revenue per loan using Total Revenue)</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Improve ranking algorithm with Qlik scoring logic</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Test TopTiering API endpoint and verify rankings</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 7 - Wednesday Week 2 */}
                  <div className="p-4 bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-rose-600 dark:bg-rose-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 7</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Wednesday - TopTiering Frontend & Leaderboard Backend
                            <TooltipIcon tooltip="Day 7 updates TopTiering frontend and implements Leaderboard backend with employee performance aggregations." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: Medium</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">TopTiering + Leaderboard</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Update LoanFunnelView component to display new TopTiering metrics</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Update getLeaderboardData() service function with Qlik formulas</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Users className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4-5:</strong> Fix loans closed calculations using Qlik formulas</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Users className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 6:</strong> Enhance revenue per employee calculations</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Users className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Add pull-through rate by employee metric to Leaderboard</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Test Leaderboard API endpoint</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 8 - Thursday Week 2 */}
                  <div className="p-4 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-200 dark:border-violet-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-violet-600 dark:bg-violet-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 8</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Thursday - Leaderboard Frontend & Validation Setup
                            <TooltipIcon tooltip="Day 8 updates Leaderboard frontend and sets up validation framework to compare Qlik outputs vs PostgreSQL results." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: Medium</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Leaderboard + Validation</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Update LeaderBoardSection component to display new metrics</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Code className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Create qlikValidation.ts utility for comparing Qlik vs PostgreSQL results</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4-5:</strong> Create validation test suite for date flags, turn times, pull-through rates</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 6:</strong> Run validation tests against sample Qlik output data</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Fix any discrepancies found in validation</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Document validation results and create validation report</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 9 - Friday Week 2 */}
                  <div className="p-4 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg border border-cyan-200 dark:border-cyan-800">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-cyan-600 dark:bg-cyan-500 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 9</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Friday - Performance Optimization & Error Handling
                            <TooltipIcon tooltip="Day 9 focuses on performance optimization, error handling for edge cases, and comprehensive testing across all modules." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: High</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Optimization</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1:</strong> Performance benchmarking: Compare query times to Qlik performance</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 2:</strong> Optimize slow queries, add missing indexes</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> Add NULL checks and validation in all formulas</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4:</strong> Handle edge cases: future dates, division by zero, negative turn times</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 5-6:</strong> Comprehensive integration testing across all 5 modules</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Fix bugs and issues found in comprehensive testing</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <FileText className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Create rollback migration file and feature flag system</span>
                      </li>
                    </ul>
                  </div>

                  {/* Day 10 - Monday Week 3 */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-slate-300 dark:border-slate-600">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-slate-700 dark:bg-slate-600 rounded-lg">
                        <span className="text-white font-medium text-sm">Day 10</span>
                      </div>
                      <div className="flex-1">
                        <Tooltip delayDuration={200}>
                          <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                            Monday - Final Testing, Documentation & Deployment Prep
                            <TooltipIcon tooltip="Day 10: Final validation testing, documentation updates, deployment preparation, and production readiness check." />
                          </h3>
                        </Tooltip>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-light">8 hours • Priority: Critical</p>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-800">Final</Badge>
                    </div>
                    <ul className="space-y-2 ml-12">
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 1-2:</strong> Final validation: Compare all calculations with Qlik outputs</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 3:</strong> End-to-end testing: All modules working together</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 4:</strong> Update all documentation with new formulas and mappings</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 5:</strong> Create deployment checklist and runbook</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Zap className="h-4 w-4 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 6:</strong> Performance final check: Ensure all queries meet Qlik performance targets</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 7:</strong> Final bug fixes and polish</span>
                      </li>
                      <li className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Target className="h-4 w-4 text-slate-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <span><strong>Hour 8:</strong> Production readiness review and sign-off preparation</span>
                      </li>
                    </ul>
                  </div>

                  {/* Summary */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3 mb-3">
                      <Target className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                      <h3 className="font-medium text-slate-900 dark:text-white">2-Week Plan Summary</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 font-light">Total Hours</p>
                        <p className="text-lg font-medium text-slate-900 dark:text-white">80h</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 font-light">Working Days</p>
                        <p className="text-lg font-medium text-slate-900 dark:text-white">10 days</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 font-light">Modules Updated</p>
                        <p className="text-lg font-medium text-slate-900 dark:text-white">5</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 font-light">Fields Migrated</p>
                        <p className="text-lg font-medium text-slate-900 dark:text-white">~300</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </TooltipProvider>
      </div>
    </div>
  );
};

export default QlikMigration;
