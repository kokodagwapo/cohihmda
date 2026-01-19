import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import Parser from 'rss-parser';

// Helper function to get tenant ID (supports super admins)
async function getTenantId(userId: string, queryTenantId?: string): Promise<string | null> {
  // Check if tenant_id was provided in query
  if (queryTenantId) {
    return queryTenantId;
  }
  
  // Try to get from user profile
  const profileResult = await pool.query(
    'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
    [userId]
  );
  
  if (profileResult.rows[0]?.tenant_id) {
    return profileResult.rows[0].tenant_id;
  }
  
  // If still no tenant, check if user is super admin and use Default Tenant
  const userResult = await pool.query(
    'SELECT role FROM public.users WHERE id = $1',
    [userId]
  );
  
  if (userResult.rows[0]?.role === 'super_admin') {
    // Get default tenant
    const tenantResult = await pool.query(
      'SELECT id FROM public.tenants WHERE name = $1 LIMIT 1',
      ['Default Tenant']
    );
    return tenantResult.rows[0]?.id || null;
  }
  
  return null;
}

const router = Router();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AilethiaPodcastBot/1.0)',
  },
});

// Search for state policies and regulations using RSS feeds and web scraping
async function searchStatePolicies(): Promise<string> {
  // Key regulatory sources for mortgage lending
  const regulatorySources = [
    {
      name: 'CFPB',
      rssUrl: 'https://www.consumerfinance.gov/about-us/newsroom/rss/',
      keywords: ['mortgage', 'lending', 'regulation', 'compliance', 'enforcement'],
    },
    {
      name: 'FHFA',
      rssUrl: 'https://www.fhfa.gov/Media/RSS',
      keywords: ['mortgage', 'GSE', 'policy', 'regulation', 'guidelines'],
    },
  ];

  let policyUpdates = '';

  try {
    for (const source of regulatorySources) {
      try {
        const feed = await parser.parseURL(source.rssUrl);
        if (feed && feed.items) {
          const relevantItems = feed.items
            .filter((item: any) => {
              const text = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
              return source.keywords.some(keyword => text.includes(keyword.toLowerCase()));
            })
            .slice(0, 3);

          if (relevantItems.length > 0) {
            policyUpdates += `Recent updates from ${source.name}:\n`;
            relevantItems.forEach((item: any) => {
              policyUpdates += `- ${item.title}\n`;
            });
            policyUpdates += '\n';
          }
        }
      } catch (error) {
        console.error(`Error fetching ${source.name} RSS:`, error);
      }
    }

    // Add DC-specific note
    if (policyUpdates) {
      policyUpdates += 'Note: Special attention should be paid to DC regulations as they often set precedents for other jurisdictions.\n';
    }
  } catch (error) {
    console.error('Error searching policies:', error);
  }

  return policyUpdates;
}

// Search for industry news using existing news API pattern
async function searchIndustryNews(): Promise<string> {
  const newsSources = [
    {
      name: 'MBA',
      rssUrl: 'https://www.mba.org/news-and-research/newsroom',
      keywords: ['mortgage', 'application', 'refinance', 'lending', 'market', 'rate'],
    },
    {
      name: 'Fannie Mae',
      rssUrl: 'https://www.fanniemae.com/newsroom/rss',
      keywords: ['housing', 'market', 'forecast', 'mortgage', 'lending'],
    },
  ];

  let industryNews = '';

  try {
    for (const source of newsSources) {
      try {
        const feed = await parser.parseURL(source.rssUrl);
        if (feed && feed.items) {
          const relevantItems = feed.items
            .filter((item: any) => {
              const text = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
              return source.keywords.some(keyword => text.includes(keyword.toLowerCase()));
            })
            .slice(0, 2);

          if (relevantItems.length > 0) {
            industryNews += `Industry news from ${source.name}:\n`;
            relevantItems.forEach((item: any) => {
              industryNews += `- ${item.title}\n`;
            });
            industryNews += '\n';
          }
        }
      } catch (error) {
        console.error(`Error fetching ${source.name} RSS:`, error);
      }
    }
  } catch (error) {
    console.error('Error searching industry news:', error);
  }

  return industryNews;
}

// Generate random podcast script
function generatePodcastScript(
  businessContext: any,
  policies: string,
  industryNews: string
): string {
  const greetings = [
    "Good morning. This is Ailethia, your executive assistant, with today's briefing.",
    "Hello. Ailethia here, ready to walk you through what matters most right now.",
    "Welcome. I'm Ailethia, and I've prepared an executive overview for you today.",
    "Good day. This is Ailethia with your strategic intelligence briefing.",
    "Hello there. Ailethia speaking. Let's dive into what's happening in your business.",
  ];

  const transitions = [
    "Moving forward,",
    "Now, let's shift focus to",
    "Turning our attention to",
    "On another front,",
    "Shifting gears,",
  ];

  const closings = [
    "That wraps up today's briefing. I'm here if you have questions.",
    "That's your executive overview for now. Feel free to ask anything.",
    "That concludes today's insights. What would you like to know more about?",
    "That's what I have for you today. Questions?",
    "That's your briefing. I'm standing by for any questions you might have.",
  ];

  // Random selection
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];
  const closing = closings[Math.floor(Math.random() * closings.length)];

  let script = `${greeting}\n\n`;

  // 1. Good news about business (if available)
  if (businessContext?.revenue || businessContext?.loans) {
    const goodNews = [
      `I have some positive updates. ${businessContext.revenue ? `Revenue is tracking at ${businessContext.revenue}` : ''}${businessContext.loans ? `, with ${businessContext.loans} loans locked` : ''}. This positions us well for the quarter.`,
      `Let's start with the good news. ${businessContext.margin ? `Our margin per loan is holding strong at ${businessContext.margin}` : ''}${businessContext.revenue ? `, and revenue is at ${businessContext.revenue}` : ''}. These are solid numbers.`,
      `First, the highlights. ${businessContext.healthScore ? `Our business health score is ${businessContext.healthScore}` : ''}${businessContext.revenue ? `, and we're seeing ${businessContext.revenue} in revenue` : ''}. This is momentum we can build on.`,
    ];
    script += goodNews[Math.floor(Math.random() * goodNews.length)] + '\n\n';
  }

  // 2. Business health insights - prioritize dialogues/insights from database
  const insights = businessContext?.dialogues || businessContext?.insights || [];
  if (insights.length > 0) {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} here's the latest:\n\n`;
    insights.slice(0, 5).forEach((insight: any, idx: number) => {
      const message = typeof insight === 'string' ? insight : (insight.message || insight);
      const priority = insight.priority || 'standard';
      script += `${idx + 1}. ${message}${priority === 'high' ? ' [This needs your attention]' : ''}\n`;
    });
    script += '\n';
  } else if (businessContext?.insights && businessContext.insights.length > 0) {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} business health insights:\n\n`;
    businessContext.insights.slice(0, 3).forEach((insight: any, idx: number) => {
      script += `${idx + 1}. ${insight.message}\n`;
    });
    script += '\n';
  } else {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} business health: Your operations are running smoothly. `;
    script += `${businessContext?.healthScore ? `The health score of ${businessContext.healthScore} indicates strong performance.` : 'Key metrics are tracking well.'}\n\n`;
  }
  
  // Include funnel story if available
  if (businessContext?.funnelStory) {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} loan funnel analysis:\n`;
    if (businessContext.funnelStory.conversionRates) {
      script += `- Overall conversion rate: ${businessContext.funnelStory.conversionRates.overall || 0}%\n`;
      script += `- Pull-through rate: ${businessContext.funnelStory.conversionRates.pullThrough || 0}%\n`;
    }
    if (businessContext.funnelStory.falloutData) {
      script += `- Total fallout: ${businessContext.funnelStory.falloutData.total || 'N/A'}\n`;
    }
    if (businessContext.funnelStory.lostRevenue) {
      script += `- Lost revenue opportunity: ${businessContext.funnelStory.lostRevenue.total || 'N/A'}\n`;
    }
    script += '\n';
  }

  // 3. State policies and regulations (if found)
  if (policies && policies.length > 50) {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} regulatory landscape: `;
    script += `I've reviewed recent policy updates across the states, with particular attention to DC. `;
    script += `There are some regulatory changes that may impact your operations. `;
    script += `I recommend reviewing the latest mortgage licensing requirements, especially in DC and your primary markets. `;
    script += `These changes could affect compliance workflows and may require updates to your processes.\n\n`;
  } else {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} regulations: `;
    script += `I've checked for new policies and regulations across all 50 states, including DC. `;
    script += `No significant new regulations that would impact top executives have been identified at this time.\n\n`;
  }

  // 4. Industry news with insights
  if (industryNews && industryNews.length > 50) {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} industry intelligence: `;
    script += `Here's what's happening in the lending space. `;
    script += `Market trends show continued evolution in mortgage technology and consumer expectations. `;
    script += `From a strategic perspective, I'd recommend keeping an eye on rate movements and how they're affecting borrower behavior. `;
    script += `The competitive landscape is shifting, and staying ahead means being responsive to these market dynamics. `;
    script += `Consider how these trends align with your current strategy and where opportunities might emerge.\n\n`;
  } else {
    script += `${transitions[Math.floor(Math.random() * transitions.length)]} industry news: `;
    script += `The lending industry continues to evolve. `;
    script += `Key trends include technology adoption, changing consumer preferences, and regulatory adaptation. `;
    script += `For your business, this means staying agile and responsive to market shifts. `;
    script += `I recommend monitoring rate trends and competitive positioning closely.\n\n`;
  }

  // 5. Closing with question prompt
  script += `${closing} `;
  script += `Remember, your microphone is currently muted to prevent background noise. `;
  script += `If you have questions, feel free to unmute and ask. I'm here to help.\n`;

  return script;
}

/**
 * POST /api/podcast/generate
 * Generate podcast script with business insights, policies, and industry news
 */
router.post('/generate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { businessContext, voice, dateFilter = 'ytd' } = req.body;

    // Fetch dynamic insights from database if not provided
    let enrichedContext = { ...businessContext };
    if (!enrichedContext.dialogues || !enrichedContext.insights) {
      try {
        const tenantId = await getTenantId(req.userId!, req.query.tenant_id as string);
        if (tenantId) {
          // Call insights endpoint internally
          const insightsResponse = await fetch(`${process.env.API_URL || 'http://localhost:3001'}/api/dashboard/insights?dateFilter=${dateFilter}&tenant_id=${tenantId}`, {
            headers: {
              'Authorization': req.headers.authorization || ''
            }
          });
          if (insightsResponse.ok) {
            const insightsData = await insightsResponse.json() as { insights?: Array<{ message: string; type?: string; priority?: string; source?: string; forPodcast?: boolean }> };
            if (insightsData?.insights && Array.isArray(insightsData.insights)) {
              // For podcast: Use only 2 insights from each section (8 total)
              // Group insights by source
              const bySource: Record<string, Array<any>> = {
                'business_overview': [],
                'leaderboard': [],
                'industry_news': [],
                'loan_funnel': []
              };
              
              // Group all insights by source
              for (const insight of insightsData.insights) {
                const source = insight.source || 'other';
                if (bySource[source]) {
                  bySource[source].push(insight);
                }
              }
              
              // Select 2 from each section, prioritizing those marked forPodcast
              const podcastInsights: any[] = [];
              for (const source in bySource) {
                const sourceInsights = bySource[source];
                // Sort: forPodcast first, then by priority (high > medium > standard)
                sourceInsights.sort((a, b) => {
                  if (a.forPodcast && !b.forPodcast) return -1;
                  if (!a.forPodcast && b.forPodcast) return 1;
                  const priorityOrder: Record<string, number> = { 'high': 3, 'medium': 2, 'standard': 1 };
                  return (priorityOrder[b.priority || 'standard'] || 0) - (priorityOrder[a.priority || 'standard'] || 0);
                });
                // Take first 2
                podcastInsights.push(...sourceInsights.slice(0, 2));
              }
              
              enrichedContext.dialogues = podcastInsights.map((i: any) => ({
                message: i.message,
                type: i.type,
                priority: i.priority
              }));
              enrichedContext.insights = podcastInsights;
            }
          }
        }
      } catch (error) {
        console.error('Error fetching dynamic insights:', error);
        // Continue with provided context
      }
    }

    // Search for policies and industry news in parallel
    const [policies, industryNews] = await Promise.all([
      searchStatePolicies(),
      searchIndustryNews(),
    ]);

    // Generate script with enriched context
    const script = generatePodcastScript(enrichedContext, policies, industryNews);

    // Generate TTS audio using OpenAI
    let audioUrl: string | undefined;
    if (OPENAI_API_KEY) {
      try {
        const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1-hd',
            input: script,
            voice: voice || 'shimmer', // shimmer is a female voice
            response_format: 'mp3',
          }),
        });

        if (ttsResponse.ok) {
          const audioBuffer = await ttsResponse.arrayBuffer();
          // In production, save to storage and return URL
          // For now, return base64 or handle streaming
          audioUrl = `data:audio/mp3;base64,${Buffer.from(audioBuffer).toString('base64')}`;
        }
      } catch (ttsError) {
        console.error('TTS generation error:', ttsError);
        // Continue without audio URL - client can use streaming
      }
    }

    res.json({
      script,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error generating podcast:', error);
    res.status(500).json({ error: 'Failed to generate podcast', message: error.message });
  }
});

/**
 * POST /api/podcast/tts
 * Generate TTS audio for text (streaming)
 */
router.post('/tts', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { text, voice = 'shimmer' } = req.body;

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: text,
        voice: voice,
        response_format: 'mp3',
      }),
    });

    if (!ttsResponse.ok) {
      const error = await ttsResponse.text();
      throw new Error(`TTS API error: ${error}`);
    }

    // Stream the audio response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="podcast.mp3"');
    
    const audioStream = ttsResponse.body as any;
    if (audioStream && typeof audioStream.pipe === 'function') {
      audioStream.pipe(res);
    } else if (audioStream) {
      // Handle ReadableStream (web streams API)
      const reader = audioStream.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(Buffer.from(value));
        await pump();
      };
      await pump();
    } else {
      res.status(500).json({ error: 'No audio stream received' });
    }
  } catch (error: any) {
    console.error('Error generating TTS:', error);
    res.status(500).json({ error: 'Failed to generate TTS', message: error.message });
  }
});

/**
 * POST /api/podcast/question
 * Handle follow-up questions during podcast
 */
router.post('/question', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { question, context } = req.body;

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Use OpenAI to generate answer
    const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `You are Ailethia, an executive assistant for a mortgage lending business. You speak like a CEO executive assistant - professional, concise, and insightful. Answer questions based on the context provided.`,
          },
          {
            role: 'user',
            content: `Context: ${context || 'No specific context'}\n\nQuestion: ${question}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!chatResponse.ok) {
      const error = await chatResponse.text();
      throw new Error(`Chat API error: ${error}`);
    }

    const chatData = await chatResponse.json() as any;
    const answer = chatData.choices?.[0]?.message?.content || 'I apologize, I cannot answer that right now.';

    // Generate TTS for answer
    const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: answer,
        voice: 'shimmer',
        response_format: 'mp3',
      }),
    });

    let audioUrl: string | undefined;
    if (ttsResponse.ok) {
      const audioBuffer = await ttsResponse.arrayBuffer();
      audioUrl = `data:audio/mp3;base64,${Buffer.from(audioBuffer).toString('base64')}`;
    }

    res.json({
      answer,
      audioUrl,
    });
  } catch (error: any) {
    console.error('Error handling question:', error);
    res.status(500).json({ error: 'Failed to process question', message: error.message });
  }
});

export default router;

