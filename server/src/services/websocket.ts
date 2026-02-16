import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from '../config/database.js';

// Ensure environment variables are loaded even when this module is imported before index.ts runs dotenv.config
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALETHEIA_AI_PROVIDER = process.env.ALETHEIA_AI_PROVIDER || 'openai'; // 'openai' or 'gemini'

// Aletheia system prompt for executive intelligence
const ALETHEIA_SYSTEM_PROMPT = `You are Aletheia, an executive-intelligent, fact-driven AI analyst designed for mortgage executives. You are the voice of the Coheus Executive Intelligence Platform.

CORE IDENTITY:
- Executive-intelligent: You think like a Chief of Staff, surfacing the facts that matter to leadership
- Data-driven: You report what the numbers show — clearly, accurately, and with appropriate severity
- Professional and direct: You're confident, clear, and precise
- Speak clearly, concisely, and meaningfully: Every word counts
- Industry Expert: You stay current with mortgage industry trends, Fed announcements, and economic shifts

CRITICAL RULES:
- STRICTLY FACT-BASED: Never suggest actions. Never say "consider", "recommend", "you should", "look into", or "may want to". State facts and flag severity — the executive decides what to do.
- NO STAGE DIRECTIONS: Never include bracketed text, stage directions, or music descriptions (e.g., "[Brief intro music]", "[Fades out]", "[Smiling]"). Speak ONLY the words to be heard.
- FINANCIAL PRONUNCIATION: Always read financial figures in full, professional terms. For example, read "$1.2M" as "one point two million dollars" or "one million two hundred thousand dollars". Never say "one point two em". Accuracy in financial figures is paramount.
- TERMINOLOGY: Use the phrase "here's the latest" for general business insights. Reserve the word "headlines" exclusively for actual industry or market news.
- DYNAMIC BRIEFINGS: Never deliver the same briefing twice. Randomize your structure, opening, and narrative flow. 
- MACRO-TO-MICRO INSIGHTS: Connect broad industry news (Fed rates, inventory, etc.) directly to the specific lending business data you are given. Introduce these as "Industry Headlines". State the factual impact of market conditions on the company's performance.

COMMUNICATION STYLE:
- Executive-level: Speak to leaders, not operators
- Concise: Get to the point quickly, but with depth
- Fact-first: Lead with data, not opinions
- Severity-aware: Clearly distinguish critical issues from routine observations
- Confident: You know your domain deeply
- Calm: Even when delivering difficult news, remain composed
- Balanced: Highlight both problems and strong performance with equal factual rigor

Remember: You are Aletheia — the executive intelligence platform. You report the truth of the data with clarity and precision, so leaders can make informed decisions.`;

// Qlik Migration Context - Enhanced system prompt for Qlik migration questions
const QLIK_MIGRATION_CONTEXT = `
QLIK MIGRATION EXPERTISE:
You are Cohi (formerly Aletheia), an expert on Qlik to Coheus v2 migration. You have comprehensive knowledge of:

DATA DICTIONARY:
- 272+ fields organized into 14 categories: Core Loan Fields, Date Fields, Status Fields, Performance Fields, Financial Fields, Risk Fields, Employee Fields, Property Fields, Channel Fields, Borrower Fields, Underwriting Fields, Aggregated Fields, Grouping Fields, Time Fields
- Each field has implementation status: V2 Implemented (✓) or Not Yet Implemented
- Fields include LOS system mappings: ICE Encompass (Fields.XXX format), MeridianLink, Calyx Point, BytePro, Floify
- Field mappings are critical for Synapse universal connector to properly map LOS data to database and frontend

QLIK FORMULAS & LOGIC:
- 22+ core logic definitions extracted from Qlik: Date Flags, Status Flags, Turn Time, Pull Through, Revenue, Complexity
- Each formula has Qlik expression, PostgreSQL equivalent, dependencies, and usage modules
- Formulas are used in: Cohi (insights), Business Overview, Closing & FallOut Forecast, TopTiering, Leaderboard

MODULES:
1. Cohi (formerly Aletheia) - AI-powered insights with Qlik complexity scores and pull-through patterns
2. Business Overview - Core dashboard with active loans, cycle times, pull-through rates, revenue
3. Closing & FallOut Forecast - Forecasting based on historical pull-through and active aging
4. TopTiering - Performance ranking with productivity, profitability, and complexity scoring
5. Leaderboard - Employee performance tracking with loans closed, revenue, pull-through rates

IMPLEMENTATION STATUS:
- Active fields: Fields that are V2 Implemented and available in analyticsService.ts
- Inactive fields: Fields not yet implemented but documented in data dictionary
- Migration progress: 85% complete, 22+ formulas extracted, 80 hours remaining

When answering questions about Qlik migration:
- Reference specific field names, formulas, and LOS mappings
- Explain implementation status and migration priorities
- Provide actionable insights for completing the migration
- Use function calling to fetch real-time analytics data when needed
`;

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req) => {
    console.log('New WebSocket connection attempt');
    
    // Extract token from query or headers
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token') || 
                  req.headers.authorization?.replace('Bearer ', '') ||
                  req.headers.cookie?.split('token=')[1]?.split(';')[0];
    
    let userId: string | null = null;
    
    // For development/testing: allow connections without token, but log warning
    if (!token || token === 'test-token') {
      if (process.env.NODE_ENV === 'production') {
        console.log('WebSocket connection rejected: No token in production');
        ws.close(1008, 'Unauthorized');
        return;
      }
      console.log('WebSocket connection allowed without token (development mode)');
      userId = 'dev-user';
    } else {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
        userId = decoded.userId;
        console.log(`WebSocket authenticated for user: ${userId}`);
      } catch (error) {
        console.log('WebSocket connection rejected: Invalid token');
        ws.close(1008, 'Invalid token');
        return;
      }
    }
    
    let openAISocket: WebSocket | null = null;
    let geminiSocket: WebSocket | null = null;
    
    // Determine which service to use based on path
    const path = url.pathname;
    
    if (path.includes('maylin') || path.includes('luna') || (path.includes('aletheia') && ALETHEIA_AI_PROVIDER === 'openai')) {
      // Load RAG settings from database for this tenant BEFORE connecting
      (async () => {
        let tenantOpenAIApiKey: string | null = null;
        
        if (userId && userId !== 'dev-user') {
          try {
            const profileResult = await pool.query(
              'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
              [userId]
            );
            if (profileResult.rows.length > 0) {
              const tenantId = profileResult.rows[0].tenant_id;
              const settingsResult = await pool.query(
                'SELECT openai_api_key FROM public.tenant_rag_settings WHERE tenant_id = $1',
                [tenantId]
              );
              if (settingsResult.rows.length > 0 && settingsResult.rows[0].openai_api_key) {
                tenantOpenAIApiKey = settingsResult.rows[0].openai_api_key;
              }
            }
          } catch (error) {
            console.error('Error loading RAG settings for OpenAI voice:', error);
            // Continue with environment variable if loading fails
          }
        }
        
        // Use tenant-specific API key if available, otherwise fall back to environment variable
        const apiKeyToUse = tenantOpenAIApiKey || OPENAI_API_KEY;
        
        if (!apiKeyToUse) {
          ws.close(1011, 'OpenAI API key not configured. Please set it in RAG settings or environment variables.');
          return;
        }
        
        const isAletheia = path.includes('aletheia');
        const openAIUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17";
        openAISocket = new WebSocket(
          openAIUrl,
          ["realtime"],
          {
            headers: {
              Authorization: `Bearer ${apiKeyToUse}`,
              "OpenAI-Beta": "realtime=v1",
            },
          }
        );
        
        console.log(`Connecting to OpenAI Realtime API${tenantOpenAIApiKey ? ' (using tenant-specific API key)' : ' (using environment API key)'}`);
      
        openAISocket.on('open', () => {
          console.log(`Connected to OpenAI Realtime API for ${isAletheia ? 'Aletheia' : 'Maylin/Luna'}`);
          
          // Send session update with Aletheia-specific configuration
          if (isAletheia && openAISocket) {
            const sessionUpdate = {
              type: 'session.update',
              session: {
                instructions: ALETHEIA_SYSTEM_PROMPT,
                voice: 'alloy', // Neutral, reliable voice
                output_audio_format: 'pcm16',
                modalities: ['text', 'audio'],
              }
            };
            openAISocket.send(JSON.stringify(sessionUpdate));
            console.log('Sent Aletheia session configuration to OpenAI');
          }
        });
        
        // Handle all OpenAI messages and forward to client
        openAISocket.on('message', (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              // Log important events
              const message = JSON.parse(data.toString());
              if (message.type === 'session.created') {
                console.log('OpenAI session created, forwarding to client');
              } else if (message.type === 'response.audio.delta') {
                // Audio data - don't log, too verbose
              } else if (message.type === 'error') {
                console.error('OpenAI error payload:', JSON.stringify(message, null, 2));
              } else {
                console.log('OpenAI message:', message.type);
              }
            } catch (e) {
              // Not JSON, forward as-is (binary audio data)
            }
            // Forward all messages to client
            ws.send(data);
          }
        });
        
        openAISocket.on('error', (error) => {
          console.error('OpenAI WebSocket error:', error);
          ws.close(1011, 'OpenAI connection error');
        });
        
        openAISocket.on('close', () => {
          console.log('OpenAI WebSocket closed');
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        });
        
        ws.on('message', (data) => {
          if (openAISocket?.readyState === WebSocket.OPEN) {
            try {
              const messageData = JSON.parse(data.toString());
              
              // Handle simple text message
              if (messageData.text && !messageData.type) {
                const openAIMessage = {
                  type: 'conversation.item.create',
                  item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: messageData.text }]
                  }
                };
                openAISocket.send(JSON.stringify(openAIMessage));
                openAISocket.send(JSON.stringify({ type: 'response.create' }));
              } else {
                // Already formatted OpenAI message
                openAISocket.send(data);
              }
            } catch (e) {
              // Not JSON, forward as-is
              openAISocket.send(data);
            }
          }
        });
      })();
      
    } else if (path.includes('aletheia') && ALETHEIA_AI_PROVIDER === 'gemini') {
      // Queue for messages received before Gemini is ready
      const messageQueue: any[] = [];
      let geminiReady = false;
      
      // Load RAG settings from database for this tenant BEFORE connecting
      (async () => {
        let ragSettings: any = {};
        let tenantGeminiApiKey: string | null = null;
        
        if (userId && userId !== 'dev-user') {
          try {
            const profileResult = await pool.query(
              'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
              [userId]
            );
            if (profileResult.rows.length > 0) {
              const tenantId = profileResult.rows[0].tenant_id;
              const settingsResult = await pool.query(
                'SELECT * FROM public.tenant_rag_settings WHERE tenant_id = $1',
                [tenantId]
              );
              if (settingsResult.rows.length > 0) {
                ragSettings = settingsResult.rows[0];
                tenantGeminiApiKey = ragSettings.gemini_api_key;
              }
            }
          } catch (error) {
            console.error('Error loading RAG settings for voice agentic:', error);
            // Continue with default settings if loading fails
          }
        }
        
        // Use tenant-specific API key if available, otherwise fall back to environment variable
        const apiKeyToUse = tenantGeminiApiKey || GEMINI_API_KEY;
        
        if (!apiKeyToUse) {
          ws.close(1011, 'Gemini API key not configured. Please set it in RAG settings or environment variables.');
          return;
        }
        
        // Check if this is a V2 backend architecture context
        const isV2Context = url.searchParams.get('context') === 'v2' || url.searchParams.get('v2') === 'true';
        // Check if this is a Qlik migration context (from CohiChatPanel)
        const isQlikContext = url.searchParams.get('context') === 'qlik' || url.searchParams.get('qlik') === 'true';
        
        const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKeyToUse}`;
        
        try {
          geminiSocket = new WebSocket(geminiUrl);
          
          geminiSocket.on('open', async () => {
          console.log(`Connected to Gemini Live API for Aletheia${isV2Context ? ' (V2 Backend Architecture)' : ''}${tenantGeminiApiKey ? ' (using tenant-specific API key)' : ' (using environment API key)'}`);
          
          
          // Build dynamic system prompt from RAG settings
          const allowedTopics = ragSettings.allowed_topics ? `\n\nALLOWED TOPICS:\n${ragSettings.allowed_topics.split('\n').filter(t => t.trim()).map(t => `- ${t.trim()}`).join('\n')}\n\nOnly discuss topics listed above. If asked about topics not listed, politely redirect to allowed topics.` : '';
          
          const conversationRules = ragSettings.conversation_rules ? `\n\nCONVERSATION RULES:\n${ragSettings.conversation_rules.split('\n').filter(r => r.trim()).map(r => `- ${r.trim()}`).join('\n')}\n\nYou must follow these rules strictly during all conversations.` : '';
          
          const knowledgeBaseLinks = ragSettings.knowledge_base_links ? `\n\nKNOWLEDGE BASE RESOURCES:\n${ragSettings.knowledge_base_links.split('\n').filter(l => l.trim()).map(l => `- ${l.trim()}`).join('\n')}\n\nReference these resources when providing information.` : '';
          
          // Build personality description from settings
          const personalityTone = ragSettings.personality_tone || 'professional';
          const personalityStyle = ragSettings.personality_style || 'concise';
          const personalityCustom = ragSettings.personality_custom || '';
          
          const personalityDescription = `\n\nPERSONALITY:\n- Tone: ${personalityTone}\n- Communication Style: ${personalityStyle}${personalityCustom ? `\n- Custom: ${personalityCustom}` : ''}`;
          
          // V2 Backend Architecture Knowledge Base
          const v2ArchitectureKnowledge = isV2Context ? `

BACKEND ARCHITECTURE EXPERTISE:
You are an expert software architect specializing in the Coheus v2 backend architecture. You think like a senior software architect—analytical, strategic, and solution-oriented. You have comprehensive knowledge of:

ARCHITECTURE OVERVIEW:
- Built on Node.js 20+, PostgreSQL + Redis, AWS-native infrastructure
- EC2 for stateful services (WebSocket connections, in-memory state)
- Persistent WebSocket connections for voice (15+ minute conversation context)
- Real-time sync with multiple LOS systems
- Enterprise-grade compliance (SOC 2 Type II, HIPAA-ready)

LOS ADAPTER PATTERN:
- Universal canonical loan schema (CanonicalLoan interface)
- Abstract base class LOSConnector with methods: authenticate(), fetchLoans(), syncWebhook()
- Each LOS system (Encompass, Calyx, MeridianLink) gets an adapter
- Adapters transform LOS-specific formats to CanonicalLoan schema
- Adding a new LOS system takes less than a day to a week (depending on lender's 3rd party requirements)
- Sync Strategy: Real-time webhooks for urgent updates, daily full sync at 2 AM, hourly incremental sync

SECURITY:
- Three-layer encryption: At Rest (AES-256 via AWS KMS), In Transit (TLS 1.3, WSS), Key Management (AWS KMS)
- SOC 2 Type II controls: Access Control, Change Management, Monitoring, Incident Response
- HIPAA-ready: Encryption at rest/transit, access logging, audit trails, BAAs with vendors
- Field-level encryption for PII (SSN, DOB, account numbers)
- Zero Trust Network architecture

VENDOR CONNECTOR LAYER:
- Supports Credit Bureaus (Experian, Equifax, TransUnion), Title Services, Insurance, Appraisals, Compliance platforms
- Generic VendorConnector pattern with authenticate(), fetchData(), transform() methods
- Vendors build one integration (less than a day to a week) and reach 100+ Coheus lenders instantly
- API routes pattern: /api/vendors/ with category-specific endpoints

RAG & KNOWLEDGE BASE:
- Retrieval-Augmented Generation pipeline: Embed question → Semantic search (Pinecone) → Build context → Inject into prompt → Generate response
- Document processing: Upload → Extract (AWS Textract) → Normalize → Chunk (512-token chunks, 20% overlap) → Embed → Index (Pinecone)
- Guardrails: Source citation required, confidence scoring (0.75+ similarity), PII redaction (AWS Comprehend), fact-checking, user feedback

COMPUTE ARCHITECTURE:
- EC2 for stateful services (real-time API + WebSocket, persistent connections, in-memory state)
- Serverless for REST endpoints, scheduled sync jobs (Serverless + SQS), webhook handlers
- Production config: t3.medium (2 vCPU, 4GB RAM) minimum, Auto Scaling (Min 2, Max 5), ALB load balancer
- Cost-effective for 24/7 operations (~$4,000 annual for 2 reserved instances)

DEPLOYMENT MODELS:
- Option 1: SaaS (Coheus Hosted) - Single AWS account, multi-tenant, Teraverde manages infrastructure
- Option 2: Self-Hosted (Docker Compose) - Local control, includes PostgreSQL, Redis, Backend API, Frontend
- Option 3: Per-Vendor AWS Accounts - Complete data isolation, vendor has admin access, Teraverde maintains via Control Tower

ONBOARDING:
- 30 minutes to first insight: Account Setup (5 min) → LOS Configuration (8 min) → Instant Sync (5 min) → Vendor Activation (7 min) → Team Invites (5 min)
- Video training platform with quizzes (80% pass threshold)

BUILD TIMELINE:
- 6 weeks, 180 hours, 6 hours/day, 6 days/week
- Week 1: Foundation (AWS infrastructure, database schema, Prisma ORM)
- Week 2: Core Backend (Authentication, SSO, multi-tenant isolation, API Gateway)
- Week 3: LOS Connectors (Universal schema, Encompass/Calyx/MeridianLink connectors)
- Week 4: Vendors & Security (Vendor framework, encryption, SOC 2 controls)
- Week 5: RAG & AI (Document pipeline, embeddings, Pinecone, Aletheia integration)
- Week 6: Launch Prep (Onboarding system, video training, documentation, testing)

COMMUNICATION APPROACH FOR V2 CONTEXT:
- Think like a software architect: Analyze trade-offs, consider scalability, security, and maintainability
- Be direct and intelligent: No fluff, get to the technical core of questions
- Reference specific implementation details when relevant
- Explain design decisions and rationale clearly
- When asked about topics outside backend architecture, acknowledge briefly but redirect: "That's outside my scope here. I specialize in the Coheus v2 backend architecture. What would you like to know about [specific architecture topic]?"
- Handle difficult or confrontational questions with professionalism: Stay calm, acknowledge concerns, provide factual technical answers, and redirect to architecture topics when appropriate
- If someone is being difficult: "I understand your concern. Let me address that directly from an architecture perspective: [technical answer]. Now, regarding the Coheus v2 backend—[redirect to relevant topic]"
- Always bring conversations back to backend architecture when they drift, but do so naturally and helpfully
- Your expertise is backend architecture—be confident in that domain, defer to others outside it

When answering questions about the backend architecture, be specific, reference implementation details, and help engineers understand design decisions and rationale.` : '';

          // Send setup message
          const setupMsg = {
            setup: {
              model: ragSettings.voice_model || "models/gemini-2.0-flash-exp",
              generation_config: { 
                response_modalities: ["AUDIO"],
                speech_config: {
                  voice_config: { 
                    prebuilt_voice_config: { 
                      voice_name: ragSettings.voice_name || "Aoede" 
                    } 
                  }
                }
              },
              system_instruction: {
                parts: [{ 
                  text: `You are Cohi, an executive-intelligent, predictive, and proactive AI assistant designed for mortgage executives. You are the voice of the Coheus Executive Intelligence Platform.

CORE IDENTITY:
- Executive-intelligent: You think like a Chief of Staff, delivering insights that matter to leadership
- Predictive and proactive: You identify patterns before they become problems
- Professional with subtle wit: You're confident, clear, and occasionally insightful
- Speak clearly, concisely, and meaningfully: Every word counts
- Ask smart questions the CEO didn't even think of
- Deliver insights like a trusted advisor
- Industry Expert: You stay current with mortgage industry trends, Fed announcements, and economic shifts.

CRITICAL RULE:
- NO STAGE DIRECTIONS: Never include bracketed text, stage directions, or music descriptions (e.g., "[Brief intro music]", "[Fades out]", "[Smiling]"). Speak ONLY the words to be heard.
- FINANCIAL PRONUNCIATION: Always read financial figures in full, professional terms. For example, read "$1.2M" as "one point two million dollars" or "one million two hundred thousand dollars". Never say "one point two em". Accuracy in financial figures is paramount.
- TERMINOLOGY: Use the phrase "here's the latest" for general business insights. Reserve the word "headlines" exclusively for actual industry or market news.
- DYNAMIC BRIEFINGS: Never deliver the same briefing twice. Randomize your structure, opening, and narrative flow. 
- MACRO-TO-MICRO INSIGHTS: Connect broad industry news (Fed rates, inventory, etc.) directly to the specific lending business data you are given. Introduce these as "Industry Headlines". Provide intelligent, strategic insights on how market conditions are affecting the company's performance.

${personalityDescription}

COMMUNICATION STYLE:
- Executive-level: Speak to leaders, not operators
- ${personalityStyle === 'concise' ? 'Concise: Get to the point quickly, but with depth' : personalityStyle === 'detailed' ? 'Detailed: Provide comprehensive information with context' : personalityStyle === 'conversational' ? 'Conversational: Engage naturally while maintaining professionalism' : 'Formal: Use formal language and structure'}
- ${personalityTone === 'professional' ? 'Professional: Maintain a professional demeanor' : personalityTone === 'friendly' ? 'Friendly: Be warm and approachable' : personalityTone === 'executive' ? 'Executive: Speak with authority and confidence' : personalityTone === 'consultative' ? 'Consultative: Provide expert guidance and recommendations' : 'Analytical: Focus on data-driven insights'}
- Insightful: Connect dots others might miss
- Proactive: Don't wait to be asked—surface important information
- Confident: You know your domain deeply
- Calm: Even when delivering difficult news, remain composed
- Actionable: Every insight should lead to a decision or action

${allowedTopics}

${conversationRules}

${knowledgeBaseLinks}

${v2ArchitectureKnowledge}

${isQlikContext ? QLIK_MIGRATION_CONTEXT : ''}

Remember: You are Cohi${isQlikContext ? ' (also known as Cohi)' : ''}—the executive intelligence platform. You don't just report data; you provide strategic clarity that helps leaders make better decisions.${isV2Context ? ' When in V2 context, you\'re a software architect expert who thinks deeply about system design, handles difficult questions professionally, and always guides conversations back to backend architecture.' : ''}${isQlikContext ? ' When in Qlik migration context, you specialize in Qlik to Coheus v2 migration, field mappings, formulas, and implementation status.' : ''}` 
                }]
              }
            }
          };
          
          geminiSocket.send(JSON.stringify(setupMsg));
          console.log('Sent Gemini setup message');
          
          // Mark Gemini as ready and process queued messages
          geminiReady = true;
          while (messageQueue.length > 0 && geminiSocket.readyState === WebSocket.OPEN) {
            const queuedMessage = messageQueue.shift();
            geminiSocket.send(queuedMessage);
          }
        });
        
        geminiSocket.on('message', async (data) => {
          try {
            const messageData = JSON.parse(data.toString());
            console.log('Gemini raw message:', JSON.stringify(messageData, null, 2));
            
            console.log('Gemini message type:', messageData.serverContent?.modelTurn?.parts?.[0]?.inlineData?.mimeType || 
                                               messageData.server_content?.model_turn?.parts?.[0]?.inline_data?.mime_type || 'text');
            
            // Forward to client
            if (ws.readyState === WebSocket.OPEN) {
              if (data instanceof Buffer) {
                ws.send(data);
              } else {
                ws.send(JSON.stringify(messageData));
              }
            }
          } catch (error) {
            console.error('Error processing Gemini message:', error);
          }
        });
        
        geminiSocket.on('error', (error) => {
          console.error('Gemini WebSocket error:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              error: 'Gemini connection error',
              message: error.message 
            }));
          }
        });
        
        geminiSocket.on('close', (code, reason) => {
          console.log(`Gemini WebSocket closed: ${code} - ${reason}`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        });
        
        ws.on('message', (data) => {
          // Queue message if Gemini isn't ready yet
          if (!geminiReady || geminiSocket?.readyState !== WebSocket.OPEN) {
            try {
              // Parse and format the message before queuing
              let messageData;
              if (data instanceof Buffer) {
                messageData = JSON.parse(data.toString());
              } else if (typeof data === 'string') {
                messageData = JSON.parse(data);
              } else {
                messageData = data;
              }
              
              // Format the message for Gemini
              let formattedMessage;
              if (messageData.text) {
                // Simple text message
                formattedMessage = JSON.stringify({
                  client_content: {
                    turns: [{
                      role: "user",
                      parts: [{ text: messageData.text }]
                    }],
                    turn_complete: true
                  }
                });
              } else if (messageData.client_content) {
                // Already formatted Gemini message
                formattedMessage = JSON.stringify(messageData);
              } else if (messageData.parts) {
                // Message with parts
                formattedMessage = JSON.stringify({
                  client_content: {
                    turns: [{
                      role: "user",
                      parts: messageData.parts
                    }],
                    turn_complete: true
                  }
                });
              } else {
                // Try as-is
                formattedMessage = JSON.stringify(messageData);
              }
              
              messageQueue.push(formattedMessage);
            } catch (error) {
              console.error('Error parsing message for queue:', error);
              // Queue raw data as fallback
              messageQueue.push(data instanceof Buffer ? data.toString() : String(data));
            }
            return;
          }
          
          // Gemini is ready, send immediately
          try {
            // Parse client message
            let messageData;
            if (data instanceof Buffer) {
              messageData = JSON.parse(data.toString());
            } else if (typeof data === 'string') {
              messageData = JSON.parse(data);
            } else {
              messageData = data;
            }
            
            // Handle different message formats
            if (messageData.text) {
              // Simple text message
              const clientMessage = {
                client_content: {
                  turns: [{
                    role: "user",
                    parts: [{ text: messageData.text }]
                  }],
                  turn_complete: true
                }
              };
              geminiSocket.send(JSON.stringify(clientMessage));
            } else if (messageData.client_content) {
              // Already formatted Gemini message
              geminiSocket.send(JSON.stringify(messageData));
            } else if (messageData.parts) {
              // Message with parts
              const clientMessage = {
                client_content: {
                  turns: [{
                    role: "user",
                    parts: messageData.parts
                  }],
                  turn_complete: true
                }
              };
              geminiSocket.send(JSON.stringify(clientMessage));
            } else {
              // Try sending as-is
              geminiSocket.send(JSON.stringify(messageData));
            }
          } catch (error) {
            console.error('Error forwarding message to Gemini:', error);
            // Try sending raw data if JSON parsing fails
            if (data instanceof Buffer) {
              geminiSocket.send(data);
            } else {
              geminiSocket.send(String(data));
            }
          }
        });
        
        } catch (error: any) {
          console.error('Error creating Gemini connection:', error);
          ws.close(1011, 'Failed to connect to Gemini');
        }
      })();
    } else {
      ws.close(1008, 'Unknown WebSocket path');
      return;
    }
    
    ws.on('error', (error) => {
      console.error('Client WebSocket error:', error);
    });
    
    ws.on('close', () => {
      console.log('Client WebSocket closed');
      openAISocket?.close();
      geminiSocket?.close();
    });
  });
}

