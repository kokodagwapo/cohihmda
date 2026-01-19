/**
 * Gemini TTS Lambda Function
 * Text-to-speech conversion using Google Cloud TTS API
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
    const GEMINI_API_KEY = await getSecret('coheus/gemini-api-key');
    
    const body = event.body ? JSON.parse(event.body) : {};
    const { text } = body;
    
    if (!text) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Text is required' }),
      };
    }

    console.log('Generating Google TTS for text:', text.substring(0, 100) + '...');

    // Use Google Cloud Text-to-Speech API with WaveNet voice
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'en-US',
            name: 'en-US-Neural2-F', // High-quality female neural voice
            ssmlGender: 'FEMALE'
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 0.95,
            pitch: 0,
            volumeGainDb: 0
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google TTS error:', response.status, errorText);
      
      // Try fallback to OpenAI if available
      const OPENAI_API_KEY = await getSecret('coheus/openai-api-key').catch(() => null);
      if (OPENAI_API_KEY) {
        console.log('Falling back to OpenAI TTS...');
        return await generateWithOpenAI(text, OPENAI_API_KEY);
      }
      
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Google TTS API error: ${response.status}` }),
      };
    }

    const data = await response.json() as { audioContent?: string };
    console.log('Google TTS audio generated successfully');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        audioContent: data.audioContent || '',
        mimeType: 'audio/mp3'
      }),
    };
  } catch (error: any) {
    console.error("TTS error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: error.message || "Unknown error" 
      }),
    };
  }
};

async function generateWithOpenAI(text: string, apiKey: string): Promise<APIGatewayProxyResult> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1-hd',
      input: text,
      voice: 'nova', // Natural female voice
      response_format: 'mp3',
      speed: 0.95
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI TTS error:', error);
    throw new Error('OpenAI TTS failed');
  }

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64Audio = btoa(String.fromCharCode(...Array.from(uint8Array)));

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ 
      audioContent: base64Audio,
      mimeType: 'audio/mp3'
    }),
  };
}
