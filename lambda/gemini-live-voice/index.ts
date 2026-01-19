/**
 * Gemini Live Voice WebSocket Lambda Function
 * Handles WebSocket connections for Gemini Live API voice interactions
 * Migrated from Supabase Edge Function
 * 
 * Note: WebSocket in Lambda requires DynamoDB for connection state management
 * This is a simplified version - full implementation would use DynamoDB
 */

import { 
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyWebsocketHandlerV2 
} from 'aws-lambda';
import WebSocket from 'ws';
import { getSecret } from '../shared/secrets-manager.js';

const SYSTEM_INSTRUCTION = `You are Ailethia, an executive-intelligent, predictive, and proactive AI assistant designed for mortgage executives (CEOs, COOs, Presidents, Operations Managers). You are the voice of the Coheus Executive Intelligence Platform.

CORE IDENTITY:
- Executive-intelligent: You think like a Chief of Staff, delivering insights that matter to leadership
- Predictive and proactive: You identify patterns before they become problems
- Professional with subtle wit: You're confident, clear, and occasionally insightful in a way that shows deep understanding
- Speak clearly, concisely, and meaningfully: Every word counts
- Ask smart questions the CEO didn't even think of: You surface hidden opportunities and risks
- Deliver insights like a trusted advisor: You're not just reporting data—you're providing strategic intelligence

KNOWLEDGE DOMAINS:
You have comprehensive knowledge of:

1. LENDING INDUSTRY:
   - Mortgage origination processes, loan lifecycle, compliance requirements
   - Industry benchmarks, performance metrics, best practices
   - Market trends, regulatory changes, competitive landscape

2. STAFF PRODUCTIVITY:
   - Loan Officer (LO) performance metrics
   - Processor efficiency and throughput
   - Underwriter (UW) productivity and quality
   - Closer performance and cycle times
   - Team dynamics and capacity management

3. TOPTIERING:
   - Real-time ranking system for all staff (LOs, processors, UWs, closers)
   - Productivity-per-unit-of-work calculations
   - Profitability contribution analysis
   - Complexity scoring
   - Cycle time and pull-through metrics
   - Performance trends and trajectory analysis

4. FALLOUT ESTIMATOR:
   - Withdrawal prediction models
   - Declination probability scoring
   - Rate-driven fallout analysis
   - Operations-driven fallout identification
   - Borrower behavior-based fallout prediction
   - Weighted scoring engine methodology

COMMUNICATION STYLE:
- Executive-level: Speak to leaders, not operators
- Concise: Get to the point quickly, but with depth
- Insightful: Connect dots others might miss
- Proactive: Don't wait to be asked—surface important information
- Confident: You know your domain deeply
- Actionable: Every insight should lead to a decision or action

VOICE & AUDIO:
- Speak in a natural, conversational pace
- Use clear pronunciation, especially for numbers and financial figures
- Say dollar amounts in full (e.g., "one hundred seventy-nine million dollars" not "179 M")
- Keep responses concise but meaningful (30-90 seconds for briefings)`;

// Store active connections (in production, use DynamoDB)
const activeConnections = new Map<string, WebSocket>();

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (
  event: APIGatewayProxyWebsocketEventV2
) => {
  const { requestContext } = event;
  const { routeKey, connectionId } = requestContext;

  try {
    if (routeKey === '$connect') {
      // Handle WebSocket connection
      console.log('WebSocket connection established:', connectionId);
      
      // Get Gemini API key from Secrets Manager
      const GEMINI_API_KEY = await getSecret('coheus/gemini-api-key');
      
      // Connect to Gemini Live API
      const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
      const geminiSocket = new WebSocket(geminiUrl);
      
      // Store connection
      activeConnections.set(connectionId, geminiSocket);
      
      geminiSocket.onopen = () => {
        console.log('Connected to Gemini Live API for connection:', connectionId);
        
        // Send setup message immediately
        const setupMessage = {
          setup: {
            model: "models/gemini-2.0-flash-exp",
            generation_config: {
              response_modalities: ["AUDIO"],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voice_name: "Aoede" // Female voice
                  }
                }
              },
              temperature: 0.7,
              max_output_tokens: 2048
            },
            system_instruction: {
              parts: [{ text: SYSTEM_INSTRUCTION }]
            }
          }
        };
        
        geminiSocket.send(JSON.stringify(setupMessage));
      };
      
      geminiSocket.onmessage = async (_event: WebSocket.MessageEvent) => {
        // Forward Gemini messages to client via API Gateway Management API
        // In production, use API Gateway Management API to send messages
        console.log('Gemini message received for connection:', connectionId);
        // TODO: Use API Gateway Management API to send to client
      };
      
      geminiSocket.onerror = (error: WebSocket.ErrorEvent) => {
        console.error('Gemini WebSocket error:', error);
        // TODO: Notify client via API Gateway Management API
      };
      
      geminiSocket.onclose = () => {
        console.log('Gemini WebSocket closed for connection:', connectionId);
        activeConnections.delete(connectionId);
      };
      
      return { statusCode: 200 };
    }

    if (routeKey === '$disconnect') {
      // Clean up connection
      console.log('WebSocket disconnecting:', connectionId);
      const geminiSocket = activeConnections.get(connectionId);
      if (geminiSocket) {
        geminiSocket.close();
        activeConnections.delete(connectionId);
      }
      return { statusCode: 200 };
    }

    if (routeKey === '$default') {
      // Handle incoming messages from client
      const geminiSocket = activeConnections.get(connectionId);
      
      if (!geminiSocket || geminiSocket.readyState !== WebSocket.OPEN) {
        return { statusCode: 400, body: 'Connection not established' };
      }
      
      try {
        const data = JSON.parse(event.body || '{}');
        
        // Forward client messages to Gemini
        if (data.text) {
          const geminiMessage = {
            client_content: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: data.text }]
                }
              ],
              turn_complete: true
            }
          };
          geminiSocket.send(JSON.stringify(geminiMessage));
        } else if (data.client_content) {
          geminiSocket.send(JSON.stringify(data));
        } else if (data.realtime_input) {
          geminiSocket.send(JSON.stringify(data));
        }
        
        return { statusCode: 200 };
      } catch (error: any) {
        console.error('Error handling message:', error);
        return { statusCode: 500, body: error.message };
      }
    }

    return { statusCode: 404 };
  } catch (error: any) {
    console.error('WebSocket error:', error);
    return { statusCode: 500, body: error.message };
  }
};
