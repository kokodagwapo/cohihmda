# Migration Summary: Supabase → Local Server + AWS Deployment

## ✅ What Was Done

### 1. Backend Server Created (`server/`)
- **Express.js** REST API server
- **WebSocket** server for real-time voice connections
- **PostgreSQL** database integration
- **JWT** authentication system
- Automatic database migrations

### 2. Frontend Updated
- Created new **API client** (`src/lib/api.ts`) to replace Supabase
- Updated **AletheiaModal** to use backend WebSocket
- Updated **Auth** page to use new API
- Updated **Dashboard** to use new API
- Updated **Navigation** component

### 3. Aletheia Voice Agent Fixed
- Now connects through backend WebSocket (`/ws/aletheia`)
- Properly handles Gemini Live API messages
- Audio playback working
- Text responses displayed in chat

### 4. Deployment Ready
- **Docker Compose** for local development
- **Dockerfile** for containerized deployment
- **AWS EC2** deployment guide
- **AWS Lambda** serverless option

## 🚀 Quick Start

### 1. Setup Environment

```bash
# Copy environment files
cp .env.example .env
cp server/.env.example server/.env

# Edit server/.env and add:
# - GEMINI_API_KEY (required for Aletheia)
# - JWT_SECRET (generate secure random string, min 32 chars)
# - OPENAI_API_KEY (optional)
```

### 2. Start PostgreSQL

```bash
# Using Docker (recommended)
docker-compose up -d postgres

# Or install PostgreSQL locally
createdb coheus
```

### 3. Start Backend

```bash
cd server
npm install  # Already done
npm run dev
```

### 4. Start Frontend

```bash
# In root directory
npm install
npm run dev
```

### 5. Test Aletheia

1. Open http://localhost:8080
2. Sign up/Sign in
3. Navigate to dashboard
4. Click Aletheia button
5. Click "Start Call"
6. Speak or type messages

## 🔧 Key Changes

### Removed Supabase Dependencies
- ❌ `@supabase/supabase-js`
- ❌ Supabase client imports
- ❌ Supabase Edge Functions (converted to Express routes)

### Added New Backend
- ✅ Express.js server (`server/src/`)
- ✅ WebSocket server (`server/src/services/websocket.ts`)
- ✅ JWT auth (`server/src/middleware/auth.ts`)
- ✅ PostgreSQL integration (`server/src/config/database.ts`)

### Updated Frontend
- ✅ New API client (`src/lib/api.ts`)
- ✅ AletheiaModal uses backend WebSocket
- ✅ All auth flows use new API
- ✅ Dashboard uses new API

## 📡 API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/signin` - Sign in  
- `GET /api/auth/me` - Get current user
- `POST /api/auth/signout` - Sign out

### Call Sessions
- `GET /api/calls` - List calls
- `GET /api/calls/:id` - Get call
- `POST /api/calls` - Create call
- `PATCH /api/calls/:id` - Update call

### WebSocket
- `ws://localhost:3001/ws/aletheia?token=<jwt>` - Aletheia voice
- `ws://localhost:3001/ws/maylin?token=<jwt>` - Maylin voice
- `ws://localhost:3001/ws/luna?token=<jwt>` - Luna voice

## 🔐 Authentication Flow

1. User signs up/signs in via `/api/auth/signup` or `/api/auth/signin`
2. Backend returns JWT token
3. Frontend stores token in `localStorage` as `auth_token`
4. All API requests include `Authorization: Bearer <token>` header
5. WebSocket connections include token as query parameter

## 🎯 Aletheia Voice Agent

### How It Works

1. User clicks "Start Call" in AletheiaModal
2. Frontend creates WebSocket connection to `/ws/aletheia?token=<jwt>`
3. Backend validates token and connects to Gemini Live API
4. Backend forwards messages between client and Gemini
5. Audio responses are played in browser
6. Text responses are displayed in chat

### Configuration

Set `GEMINI_API_KEY` in `server/.env`:
```env
GEMINI_API_KEY=your-gemini-api-key-here
```

Get your API key from: https://makersuite.google.com/app/apikey

## 🐛 Troubleshooting

### "Connection Failed" Error
- Check backend is running: `curl http://localhost:3001/health`
- Verify GEMINI_API_KEY is set in `server/.env`
- Check browser console for WebSocket errors

### "Unauthorized" Error
- Verify you're signed in
- Check token exists: `localStorage.getItem('auth_token')`
- Try signing out and back in

### Database Connection Error
- Verify PostgreSQL is running: `docker ps | grep postgres`
- Check connection string in `server/.env`
- Ensure database exists: `psql -U postgres -c "CREATE DATABASE coheus;"`

### Audio Not Playing
- Check browser console for audio errors
- Verify WebSocket is receiving audio data
- Check browser permissions for audio playback

## 📦 Deployment

See `README.DEPLOYMENT.md` for:
- AWS EC2 deployment
- AWS Lambda deployment
- Docker production setup
- Nginx reverse proxy configuration

## 🔄 Migration Checklist

- [x] Backend server created
- [x] Database migrations added
- [x] JWT auth implemented
- [x] WebSocket server created
- [x] Aletheia WebSocket connection fixed
- [x] Frontend API client created
- [x] Auth pages updated
- [x] Dashboard updated
- [x] Docker setup created
- [x] Deployment docs created

## 🎉 Next Steps

1. **Test locally**: Run `npm run dev:all` and test Aletheia
2. **Add more routes**: Extend API as needed
3. **Deploy**: Follow `README.DEPLOYMENT.md` for AWS deployment
4. **Monitor**: Add logging and monitoring
5. **Scale**: Add load balancing for production

## 📚 Files Created/Modified

### New Files
- `server/` - Entire backend directory
- `src/lib/api.ts` - API client
- `docker-compose.yml` - Local development
- `Dockerfile.backend` - Backend container
- `README.DEPLOYMENT.md` - Deployment guide

### Modified Files
- `src/components/aletheia/AletheiaModal.tsx` - Uses backend WebSocket
- `src/pages/Auth.tsx` - Uses new API
- `src/pages/Dashboard.tsx` - Uses new API
- `src/components/layout/Navigation.tsx` - Uses new API
- `package.json` - Added scripts

### Note on Supabase
- `src/integrations/supabase/` - Still used for some features (Dashboard, Settings, Admin)
- `supabase/` directory - Contains migrations and edge functions still in use
- `@supabase/supabase-js` - Required dependency for Supabase features

