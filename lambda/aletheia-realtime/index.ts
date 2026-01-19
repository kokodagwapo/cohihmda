/**
 * Aletheia Realtime WebSocket Lambda Function
 * Handles WebSocket connections for OpenAI Realtime API (Aletheia)
 * Migrated from Supabase Edge Function
 */

import { 
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyWebsocketHandlerV2 
} from 'aws-lambda';
import WebSocket from 'ws';
import { getSecret } from '../shared/secrets-manager.js';

// Store active connections (in production, use DynamoDB)
const activeConnections = new Map<string, WebSocket>();

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (
  event: APIGatewayProxyWebsocketEventV2
) => {
  const { requestContext } = event;
  const { routeKey, connectionId } = requestContext;

  try {
    if (routeKey === '$connect') {
      console.log('Aletheia WebSocket connection established:', connectionId);
      
      // Get OpenAI API key from Secrets Manager
      const OPENAI_API_KEY = await getSecret('coheus/openai-api-key');
      
      // Connect to OpenAI Realtime API
      const openaiUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01`;
      const openaiSocket = new WebSocket(openaiUrl, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });
      
      activeConnections.set(connectionId, openaiSocket);
      
      openaiSocket.onopen = () => {
        console.log('Connected to OpenAI Realtime API for Aletheia:', connectionId);
      };
      
      openaiSocket.onmessage = async (_event: WebSocket.MessageEvent) => {
        // Forward OpenAI messages to client via API Gateway Management API
        console.log('OpenAI message received for Aletheia connection:', connectionId);
        // TODO: Use API Gateway Management API to send to client
      };
      
      openaiSocket.onerror = (error: WebSocket.ErrorEvent) => {
        console.error('OpenAI WebSocket error:', error);
      };
      
      openaiSocket.onclose = () => {
        console.log('OpenAI WebSocket closed for Aletheia:', connectionId);
        activeConnections.delete(connectionId);
      };
      
      return { statusCode: 200 };
    }

    if (routeKey === '$disconnect') {
      console.log('Aletheia WebSocket disconnecting:', connectionId);
      const openaiSocket = activeConnections.get(connectionId);
      if (openaiSocket) {
        openaiSocket.close();
        activeConnections.delete(connectionId);
      }
      return { statusCode: 200 };
    }

    if (routeKey === '$default') {
      const openaiSocket = activeConnections.get(connectionId);
      
      if (!openaiSocket || openaiSocket.readyState !== WebSocket.OPEN) {
        return { statusCode: 400, body: 'Connection not established' };
      }
      
      try {
        // Forward client messages to OpenAI
        openaiSocket.send(event.body || '');
        return { statusCode: 200 };
      } catch (error: any) {
        console.error('Error handling Aletheia message:', error);
        return { statusCode: 500, body: error.message };
      }
    }

    return { statusCode: 404 };
  } catch (error: any) {
    console.error('Aletheia WebSocket error:', error);
    return { statusCode: 500, body: error.message };
  }
};
