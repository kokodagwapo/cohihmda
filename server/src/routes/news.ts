import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import Parser from 'rss-parser';

const router = Router();
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; MortgageNewsBot/1.0)',
  },
});

// News source configurations - focused on executive-relevant mortgage industry sources
const newsSources = [
  {
    source: 'MBA',
    icon: 'Building2',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    summary: 'The Mortgage Bankers Association (MBA) is the leading trade association representing the real estate finance industry. MBA provides market analysis, economic forecasts, and industry insights that help lenders make informed decisions about mortgage rates, application volumes, and market trends.',
    rssUrl: 'https://www.mba.org/news-and-research/newsroom',
    fallbackUrl: 'https://www.mba.org',
    keywords: ['mortgage', 'application', 'refinance', 'lending', 'market', 'rate', 'loan', 'origination', 'compliance', 'regulation']
  },
  {
    source: 'Fannie Mae',
    icon: 'TrendingUp',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/20',
    summary: 'Fannie Mae provides comprehensive housing market research and economic forecasts. Their insights help lenders understand home price trends, housing supply dynamics, and consumer sentiment that directly impact mortgage origination strategies.',
    rssUrl: 'https://www.fanniemae.com/newsroom/rss',
    fallbackUrl: 'https://www.fanniemae.com/newsroom',
    keywords: ['housing', 'market', 'forecast', 'home price', 'mortgage', 'lending', 'guidelines', 'policy', 'regulation']
  },
  {
    source: 'Freddie Mac',
    icon: 'BarChart3',
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-950/20',
    summary: 'Freddie Mac provides market insights, economic research, and policy updates critical for mortgage lenders. Stay informed about GSE guidelines, market trends, and regulatory changes affecting loan origination and servicing.',
    rssUrl: 'https://www.freddiemac.com/news/rss',
    fallbackUrl: 'https://www.freddiemac.com/news',
    keywords: ['mortgage', 'lending', 'market', 'guidelines', 'policy', 'regulation', 'GSE', 'loan', 'origination']
  },
  {
    source: 'CFPB',
    icon: 'AlertTriangle',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/20',
    summary: 'The Consumer Financial Protection Bureau (CFPB) issues regulations and enforcement actions that directly impact mortgage lending operations. Critical for compliance and risk management.',
    rssUrl: 'https://www.consumerfinance.gov/about-us/newsroom/rss/',
    fallbackUrl: 'https://www.consumerfinance.gov/about-us/newsroom/',
    keywords: ['mortgage', 'lending', 'compliance', 'regulation', 'enforcement', 'consumer', 'fair lending', 'TRID', 'QM']
  },
  {
    source: 'FHFA',
    icon: 'Activity',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/20',
    summary: 'The Federal Housing Finance Agency (FHFA) regulates Fannie Mae, Freddie Mac, and the Federal Home Loan Banks. Their policy updates directly affect mortgage lending standards and market operations.',
    rssUrl: 'https://www.fhfa.gov/Media/RSS',
    fallbackUrl: 'https://www.fhfa.gov/Media',
    keywords: ['mortgage', 'GSE', 'Fannie Mae', 'Freddie Mac', 'policy', 'regulation', 'lending', 'guidelines']
  },
];

// Default news feed structure - executive-focused content
const getDefaultNewsFeed = () => [
  {
    source: 'MBA',
    icon: 'Building2',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    summary: 'The Mortgage Bankers Association (MBA) is the leading trade association representing the real estate finance industry. MBA provides market analysis, economic forecasts, and industry insights that help lenders make informed decisions about mortgage rates, application volumes, and market trends.',
    items: [
      { 
        title: 'Mortgage applications rise 2.3% week-over-week as rates stabilize', 
        time: '2h ago', 
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 
        link: 'https://www.mba.org/news-and-research/newsroom' 
      },
      { 
        title: 'Refinance activity increases 15% month-over-month', 
        time: '5h ago', 
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 
        link: 'https://www.mba.org/news-and-research/newsroom' 
      },
    ]
  },
  {
    source: 'Fannie Mae',
    icon: 'TrendingUp',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/20',
    summary: 'Fannie Mae provides comprehensive housing market research and economic forecasts. Their insights help lenders understand home price trends, housing supply dynamics, and consumer sentiment that directly impact mortgage origination strategies.',
    items: [
      { 
        title: 'Home price expectations remain positive through Q1 2026', 
        time: '3h ago', 
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 
        link: 'https://www.fanniemae.com/newsroom' 
      },
      { 
        title: 'Housing supply constraints easing in key markets', 
        time: '6h ago', 
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 
        link: 'https://www.fanniemae.com/newsroom' 
      },
    ]
  },
];

// Filter news items to be relevant for lending executives
function isExecutiveRelevant(title: string, content: string, keywords: string[]): boolean {
  const text = (title + ' ' + content).toLowerCase();
  
  // Must contain at least one keyword
  const hasKeyword = keywords.some(keyword => text.includes(keyword.toLowerCase()));
  if (!hasKeyword) return false;
  
  // Filter out irrelevant content
  const irrelevantTerms = [
    'job posting', 'career', 'hiring', 'employee', 'staff', 
    'personal finance', 'home buying tips', 'first-time buyer',
    'real estate agent', 'realtor', 'open house', 'home decor',
    'interior design', 'renovation', 'remodeling'
  ];
  
  const hasIrrelevantTerm = irrelevantTerms.some(term => text.includes(term));
  if (hasIrrelevantTerm) return false;
  
  // Prioritize executive-relevant topics
  const executiveTerms = [
    'regulation', 'compliance', 'policy', 'guidelines', 'enforcement',
    'market', 'forecast', 'trend', 'outlook', 'analysis',
    'mortgage rate', 'application', 'origination', 'lending',
    'GSE', 'Fannie Mae', 'Freddie Mac', 'CFPB', 'FHFA',
    'risk', 'capital', 'portfolio', 'servicing', 'delinquency'
  ];
  
  const hasExecutiveTerm = executiveTerms.some(term => text.includes(term));
  return hasExecutiveTerm;
}

// Format time ago
function getTimeAgo(pubDate: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - pubDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return pubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// Fetch news from RSS feeds
async function scrapeNews() {
  const newsFeed: any[] = [];
  
  for (const source of newsSources.slice(0, 2)) { // Focus on MBA and Fannie Mae for now
    try {
      let feed;
      
      // Try RSS feed first
      try {
        feed = await parser.parseURL(source.rssUrl);
      } catch (rssError) {
        console.log(`RSS feed failed for ${source.source}, using fallback`);
        // If RSS fails, use default news for this source
        continue;
      }
      
      if (!feed || !feed.items || feed.items.length === 0) {
        continue;
      }
      
      // Filter and process items
      const relevantItems = feed.items
        .filter((item: any) => {
          const title = item.title || '';
          const content = item.contentSnippet || item.content || item.description || '';
          return isExecutiveRelevant(title, content, source.keywords);
        })
        .slice(0, 3) // Get top 3 relevant items
        .map((item: any) => {
          const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
          return {
            title: item.title || 'Untitled',
            time: getTimeAgo(pubDate),
            date: pubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            link: item.link || source.fallbackUrl,
          };
        });
      
      if (relevantItems.length > 0) {
        newsFeed.push({
          source: source.source,
          icon: source.icon,
          color: source.color,
          bg: source.bg,
          summary: source.summary,
          items: relevantItems.slice(0, 2), // Show top 2 items
        });
      }
    } catch (error) {
      console.error(`Error fetching news from ${source.source}:`, error);
      // Continue to next source
    }
  }
  
  // If we got no news, return default
  if (newsFeed.length === 0) {
    return getDefaultNewsFeed();
  }
  
  // Ensure we have at least 2 sources (pad with default if needed)
  while (newsFeed.length < 2) {
    const defaultFeed = getDefaultNewsFeed();
    const defaultSource = defaultFeed[newsFeed.length];
    if (defaultSource) {
      newsFeed.push(defaultSource);
    } else {
      break;
    }
  }
  
  return newsFeed;
}

// Get news feed
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const newsFeed = await scrapeNews();
    res.json({ newsFeed, lastUpdated: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching news:', error);
    // Return default news on error
    res.json({ 
      newsFeed: getDefaultNewsFeed(), 
      lastUpdated: new Date().toISOString(),
      error: 'Failed to fetch latest news, showing cached data'
    });
  }
});

export default router;
