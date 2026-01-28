/**
 * Cohi Briefing Lambda Function
 * Generates executive briefing scripts via AI Gateway
 * Migrated from Supabase Edge Function
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSecret } from '../shared/secrets-manager.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    // Get API key from Secrets Manager
    const AI_GATEWAY_API_KEY = await getSecret('coheus/ai-gateway-api-key');
    
    const body = event.body ? JSON.parse(event.body) : {};
    const { businessContext, type = 'briefing' } = body;
    
    console.log('Generating Cohi briefing:', { type, hasContext: !!businessContext });

    // Build context from business data
    let contextPrompt = '';
    if (businessContext) {
      // Format dialogues/insights array properly
      if (businessContext.dialogues && Array.isArray(businessContext.dialogues)) {
        const dialoguesText = businessContext.dialogues
          .map((d: any, idx: number) => {
            const message = typeof d === 'string' ? d : (d.message || d);
            const priority = d.priority || 'standard';
            const type = d.type || 'info';
            return `${idx + 1}. ${message}${priority === 'high' ? ' [URGENT]' : ''}`;
          })
          .join('\n');
        contextPrompt += `\nKey Business Insights (Here's the latest):\n${dialoguesText}\n`;
      } else if (businessContext.dialogues && typeof businessContext.dialogues === 'string') {
        contextPrompt += `\nKey Business Insights:\n${businessContext.dialogues}\n`;
      }
      
      // Format funnel story with detailed metrics
      if (businessContext.funnelStory) {
        const funnel = businessContext.funnelStory;
        let funnelText = '\nLoan Funnel Analysis:\n';
        
        if (funnel.conversionRates) {
          funnelText += `- Overall Conversion Rate: ${funnel.conversionRates.overall || 0}%\n`;
          funnelText += `- Pull-Through Rate: ${funnel.conversionRates.pullThrough || 0}%\n`;
        }
        
        if (funnel.falloutData) {
          funnelText += `- Total Fallout: ${funnel.falloutData.total || 0} loans\n`;
          if (funnel.falloutData.byReason) {
            funnelText += `- Top Fallout Reasons: ${Object.entries(funnel.falloutData.byReason)
              .slice(0, 3)
              .map(([reason, count]: [string, any]) => `${reason} (${count})`)
              .join(', ')}\n`;
          }
        }
        
        if (funnel.lostRevenue) {
          funnelText += `- Lost Revenue Opportunity: $${(funnel.lostRevenue.total || 0).toLocaleString()}\n`;
        }
        
        contextPrompt += funnelText + '\n';
      }
      
      if (businessContext.revenue) {
        contextPrompt += `- Revenue: ${businessContext.revenue}\n`;
      }
      if (businessContext.loans) {
        contextPrompt += `- Loans in Pipeline: ${businessContext.loans}\n`;
      }
      if (businessContext.margin) {
        contextPrompt += `- Margin: ${businessContext.margin}\n`;
      }
      if (businessContext.healthScore) {
        contextPrompt += `- Health Score: ${businessContext.healthScore}%\n`;
      }
      if (businessContext.insights?.length) {
        contextPrompt += `\nAdditional Insights:\n${businessContext.insights.map((i: any) => `- ${i.message}`).join('\n')}\n`;
      }
      if (businessContext.previousContext) {
        contextPrompt += `\nPrevious conversation context:\n${businessContext.previousContext}\n`;
      }
      if (businessContext.question) {
        contextPrompt += `\nUser question: ${businessContext.question}\n`;
      }
    }

    const systemPrompt = `You are Cohi, the executive intelligence voice of the Coheus platform for mortgage industry leaders. 
    
Your role: Deliver concise, executive-level briefings that sound natural when read aloud.

Style Guidelines:
- Speak like a trusted Chief of Staff giving a morning briefing
- Be warm but professional, confident but not arrogant
- Use natural pauses (commas) for speech rhythm
- Keep sentences short and punchy for clarity
- Highlight what matters most first
- Connect data to business impact
- Use executive language: "positioned for", "signals indicate", "trajectory shows"

${contextPrompt}

Generate a ${type === 'briefing' ? '60-90 second executive briefing' : 'brief response'} that would sound natural when spoken aloud.`;

    let userPrompt: string;
    
    if (type === 'question' && businessContext?.question) {
      userPrompt = `The user is asking a follow-up question: "${businessContext.question}"
      
Please provide a helpful, concise response based on your knowledge of the business context and the previous conversation. Keep your response natural and conversational, suitable for being spoken aloud.`;
    } else {
      userPrompt = `Generate today's executive intelligence briefing. 

CRITICAL INSTRUCTIONS:
- Do not include any stage directions, music descriptions, or bracketed text
- Start immediately with a warm, professional greeting based on the time of day
- Pronounce financial figures properly in full words (e.g., "$179M" as "one hundred and seventy-nine million dollars"). Never use abbreviations like "em" or "kay"
- RANDOMIZE YOUR OPENING AND STRUCTURE: Vary your tone, greeting, and how you present the data to keep it fresh and engaging each day
- TERMINOLOGY: For your internal business insights, use the phrase "here's the latest" instead of "the headlines". Reserve the word "headlines" exclusively for industry news
- INCLUDE INDUSTRY NEWS: Incorporate a relevant current event or trend from the mortgage and lending industry (e.g., Fed rate decisions, market inventory shifts, regulatory changes). Refer to this as "Today's Industry Headlines"
- PROVIDE INTELLIGENT INSIGHTS: Relate the industry news directly to the business data provided. How does the macro environment impact these specific figures?
- Cover the key business insights first (introduced as "here's the latest")
- If funnel data is available, transition to Loan Funnel analysis with specific metrics
- End with one key recommendation or strategic question
- Keep the briefing to 60-90 seconds when spoken
- Use executive terminology: "positioned for", "signals indicate", "trajectory shows", "we're seeing", "this suggests"`;
    }

    // Call AI Gateway
    const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || "https://api.openai.com/v1/chat/completions";
    const response = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return {
          statusCode: 429,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        };
      }
      if (response.status === 402) {
        return {
          statusCode: 402,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Payment required. Please add credits to continue." }),
        };
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const script = data.choices?.[0]?.message?.content || '';
    
    console.log('Generated briefing script:', script.substring(0, 100) + '...');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        script,
        generatedAt: new Date().toISOString()
      }),
    };
  } catch (error: any) {
    console.error("Cohi briefing error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: error.message || "Unknown error" 
      }),
    };
  }
};
