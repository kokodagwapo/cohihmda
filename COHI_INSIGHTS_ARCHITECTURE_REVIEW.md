# Cohi Insights Architecture Review

## Overview
Cohi Insights is an executive intelligence system that provides AI-powered insights and voice briefings for mortgage executives. It integrates with RAG (Retrieval-Augmented Generation) and supports both OpenAI and Gemini Live API for voice generation.

## Architecture Components

### 1. Frontend Components

#### CohiPromptsCard (`src/components/dashboard/CohiPromptsCard.tsx`)
- **Purpose**: Displays AI-generated insights in a rotating card format
- **Features**:
  - Rotates through insight sets every 6 seconds
  - Supports pinning/unpinning insights
  - Groups insights by priority (high, medium, standard)
  - Color-coded by type (success, info, warning, error)
  - Integrates with `CohiBriefingControls` for voice briefings

#### CohiBriefingControls (`src/components/Cohi/CohiBriefingControls.tsx`)
- **Purpose**: Controls voice briefing generation and playback
- **Key Features**:
  - WebSocket connection to backend (`/ws/Cohi`)
  - Real-time audio playback (PCM16 format, 24kHz sample rate)
  - Speech recognition for voice input (Web Speech API)
  - Text chat interface for follow-up questions
  - Audio context management for seamless playback

#### useCohiData Hook (`src/hooks/useCohiData.ts`)
- **Purpose**: Fetches insights from backend API
- **Data Flow**:
  1. Calls `/api/dashboard/insights?dateFilter={filter}`
  2. Maps API response to `CohiInsight` format
  3. Falls back to demo data if API fails
  4. Also fetches funnel data for briefing context

### 2. Backend Services

#### Insights Generation (`server/src/services/dashboard/analyticsService.ts`)
- **Function**: `getInsights()`
- **Process**:
  1. Queries loan data with Qlik-derived computed fields (flags, turn times, revenue)
  2. Calculates business metrics (active loans, cycle time, pull-through rate)
  3. Generates insights from multiple sources:
     - Business Overview (revenue, active loans, cycle time)
     - Loan Funnel (conversion rates, fallout data)
     - Leaderboard (employee performance)
     - Industry News (external context)
  4. Returns structured insights with priority, type, and reasoning

#### WebSocket Service (`server/src/services/websocket.ts`)
- **Purpose**: Manages real-time voice conversations
- **Supported Providers**:
  - **OpenAI Realtime API**: `gpt-4o-mini-realtime-preview-2024-12-17`
  - **Gemini Live API**: `models/gemini-2.0-flash-exp`
- **Connection Flow**:
  1. Client connects to `/ws/Cohi?token={jwt}`
  2. Backend authenticates user and loads tenant RAG settings
  3. Backend connects to chosen AI provider (OpenAI or Gemini)
  4. Backend forwards messages bidirectionally
  5. Audio streams are forwarded in real-time

#### RAG Integration (`server/src/routes/rag.ts`)
- **Settings Management**:
  - Stores tenant-specific RAG settings in `public.rag_settings` table
  - Includes: API keys, allowed topics, conversation rules, knowledge base links
  - Personality customization (tone, style, custom instructions)
- **Document Processing**:
  - Upload → Extract (AWS Textract) → Chunk (512 tokens, 20% overlap)
  - Embed → Index (Pinecone/vector database)
  - Used for context retrieval during conversations

### 3. Voice Generation Flow

#### OpenAI Realtime API Path
```
Client → Backend WebSocket → OpenAI Realtime API
         (session.update)    (PCM16 audio stream)
         (conversation.item) ← (response.audio.delta)
```

**Configuration**:
- Voice: `alloy` (neutral, reliable)
- Audio Format: `pcm16`
- Modalities: `['text', 'audio']`
- System Prompt: `Cohi_SYSTEM_PROMPT` (executive intelligence persona)

#### Gemini Live API Path
```
Client → Backend WebSocket → Gemini Live API
         (setup message)    (PCM audio stream)
         (client_content)   ← (server_content with model_turn)
```

**Configuration**:
- Model: `models/gemini-2.0-flash-exp` (or tenant-configured)
- Voice: `Aoede` (default) or tenant-configured
- Response Modalities: `["AUDIO"]`
- System Instruction: Built dynamically from RAG settings

### 4. Briefing Generation Process

#### Step-by-Step Flow

1. **User Clicks "Start Briefing"**:
   - `CohiBriefingControls.startBriefing()` called
   - WebSocket connection established to backend
   - Audio context initialized and pre-warmed

2. **Backend Connection**:
   - Loads tenant RAG settings from database
   - Determines AI provider (OpenAI or Gemini)
   - Connects to chosen provider's WebSocket API
   - Sends system prompt with executive intelligence persona

3. **Briefing Request Sent**:
   - Client sends briefing prompt with:
     - Time-based greeting (based on user timezone)
     - Key insights from `briefingContext.dialogues`
     - Funnel analysis data (conversion rates, fallout, lost revenue)
     - Executive name (if provided)
   - Prompt includes instructions:
     - No stage directions
     - Proper financial pronunciation
     - Dynamic structure (never repeat)
     - Industry news integration

4. **AI Response Generation**:
   - AI provider generates audio stream
   - Backend forwards audio chunks to client
   - Client decodes base64 PCM16 → Float32Array
   - Audio played via Web Audio API

5. **Follow-up Interactions**:
   - User can use voice input (Web Speech API)
   - Or text chat interface
   - Messages sent to AI provider via WebSocket
   - Responses streamed back as audio

### 5. RAG Settings Integration

#### Dynamic System Prompt Construction
The system prompt is built from:
1. **Base Cohi Identity**: Executive intelligence persona
2. **RAG Settings**:
   - `allowed_topics`: Topics the AI can discuss
   - `conversation_rules`: Behavioral guidelines
   - `knowledge_base_links`: Reference resources
   - `personality_tone`: professional, friendly, executive, consultative, analytical
   - `personality_style`: concise, detailed, conversational, formal
   - `personality_custom`: Custom instructions
3. **Context-Specific Knowledge**:
   - V2 Backend Architecture (if `context=v2`)
   - Qlik Migration (if `context=qlik`)
   - Default: Executive Intelligence for mortgage industry

#### Example System Prompt Structure
```
You are Cohi, an executive-intelligent AI assistant...

[Base Identity & Rules]

[Allowed Topics from RAG Settings]

[Conversation Rules from RAG Settings]

[Knowledge Base Links from RAG Settings]

[Personality Description from RAG Settings]

[Context-Specific Knowledge if applicable]
```

### 6. Data Flow Diagram

```
┌─────────────────┐
│  Dashboard.tsx  │
│  (Insights UI)  │
└────────┬────────┘
         │
         ├─→ useCohiData() ──→ GET /api/dashboard/insights
         │                                    │
         │                                    ├─→ analyticsService.getInsights()
         │                                    │   (Queries loans, calculates metrics)
         │                                    │
         │                                    └─→ Returns structured insights
         │
         └─→ CohiBriefingControls
                    │
                    ├─→ WebSocket /ws/Cohi
                    │         │
                    │         ├─→ websocket.ts
                    │         │   (Loads RAG settings, connects to AI provider)
                    │         │
                    │         ├─→ OpenAI Realtime API
                    │         │   OR
                    │         └─→ Gemini Live API
                    │
                    └─→ Audio Playback (Web Audio API)
```

### 7. Key Features

#### Insights Display
- **Rotation**: Automatically cycles through insight sets
- **Pinning**: Users can pin important insights
- **Priority Sorting**: High priority insights shown first
- **Type Classification**: Success, info, warning, error
- **Source Tracking**: Insights tagged by source (business_overview, loan_funnel, etc.)

#### Voice Briefing
- **Real-time Streaming**: Audio streams as it's generated
- **Low Latency**: Pre-warmed audio context for faster playback
- **Bidirectional**: Supports both voice and text input
- **Context-Aware**: Includes dashboard data in briefing prompt
- **Personalized**: Uses user timezone for greetings, executive name

#### RAG Integration
- **Tenant-Specific**: Each tenant has their own RAG settings
- **Customizable**: Topics, rules, personality all configurable
- **Knowledge Base**: Links to external documentation
- **Vector Search**: Document embeddings stored for semantic search (future enhancement)

### 8. Configuration Points

#### Environment Variables
- `Cohi_AI_PROVIDER`: `'openai'` or `'gemini'` (default: `'openai'`)
- `OPENAI_API_KEY`: Fallback API key (can be overridden by tenant settings)
- `GEMINI_API_KEY`: Fallback API key (can be overridden by tenant settings)

#### Database Tables
- `public.rag_settings`: Tenant-specific RAG configuration
- `public.loans`: Loan data (source for insights)
- `public.employees`: Employee data (for leaderboard insights)

#### RAG Settings Fields
- `openai_api_key`: Tenant-specific OpenAI API key (encrypted)
- `gemini_api_key`: Tenant-specific Gemini API key (encrypted)
- `voice_model`: Model to use (e.g., `models/gemini-2.0-flash-exp`)
- `voice_name`: Voice name (e.g., `Aoede`)
- `allowed_topics`: Newline-separated list of allowed topics
- `conversation_rules`: Newline-separated list of rules
- `knowledge_base_links`: Newline-separated list of URLs
- `personality_tone`: `professional` | `friendly` | `executive` | `consultative` | `analytical`
- `personality_style`: `concise` | `detailed` | `conversational` | `formal`
- `personality_custom`: Free-form custom instructions

### 9. Audio Processing

#### PCM16 Decoding
```typescript
// Base64 → Binary → Int16Array → Float32Array
const binaryString = atob(base64);
const bytes = new Uint8Array(binaryString.length);
for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
const int16Data = new Int16Array(bytes.buffer);
const float32Data = new Float32Array(int16Data.length);
for (let i = 0; i < int16Data.length; i++) {
  float32Data[i] = int16Data[i] / 32768.0; // Normalize to [-1, 1]
}
```

#### Audio Playback
- **Sample Rate**: 24kHz (both OpenAI and Gemini)
- **Format**: PCM16 (16-bit signed integers)
- **Queue Management**: Tracks active audio sources for cleanup
- **Timing**: Uses `nextStartTimeRef` to prevent audio overlap

### 10. Security & Compliance

#### Authentication
- JWT token required for WebSocket connection
- Token validated before establishing AI provider connection
- Tenant isolation enforced via `tenant_id` from user profile

#### API Key Management
- Tenant-specific API keys stored encrypted in database
- Fallback to environment variables if tenant key not set
- SOC 2 compliance: API key access logged

#### Data Privacy
- Insights generated from tenant-specific loan data
- No cross-tenant data leakage
- RAG settings isolated per tenant

### 11. Error Handling

#### Frontend
- Graceful fallback to demo insights if API fails
- WebSocket reconnection logic
- Audio context suspension/resume handling
- User-friendly error toasts

#### Backend
- Database connection error handling
- AI provider connection failures
- WebSocket close code handling (1000 = normal, 1008 = unauthorized, 1011 = server error)

### 12. Future Enhancements

#### RAG Vector Search
- Currently: RAG settings provide context via system prompt
- Future: Semantic search over document embeddings
- Implementation: Query Pinecone/vector DB with user question, inject top results into prompt

#### Multi-turn Conversations
- Currently: Briefing is single-turn, follow-ups are separate
- Future: Maintain conversation context across turns
- Implementation: Store conversation history, include in system prompt

#### Insight Personalization
- Currently: Insights based on aggregate data
- Future: Personalized insights based on user role, preferences
- Implementation: User preference table, role-based filtering

## Summary

Cohi Insights is a sophisticated executive intelligence system that:
1. **Generates Insights**: From loan data using Qlik-derived formulas
2. **Displays Insights**: In a rotating, interactive card interface
3. **Provides Voice Briefings**: Via WebSocket to OpenAI/Gemini Live APIs
4. **Integrates RAG**: Through tenant-specific settings and knowledge base
5. **Supports Interactions**: Voice and text input for follow-up questions

The architecture is modular, with clear separation between:
- Frontend (React components, hooks)
- Backend (Express routes, WebSocket service)
- AI Providers (OpenAI, Gemini)
- Data Layer (PostgreSQL, vector database)

This design allows for easy extension, customization, and maintenance.
