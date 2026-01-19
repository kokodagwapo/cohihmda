# Coheus - Intelligence Platform

## Overview
Coheus is a React + TypeScript frontend application with an Express.js backend for delivering real-time insights to lending leaders. The frontend is built with Vite and uses shadcn/ui components.

## Project Structure
- `/src` - React frontend source code
  - `/components` - UI components including shadcn/ui
  - `/pages` - Page components
  - `/hooks` - Custom React hooks
  - `/lib` - Utility libraries
  - `/services` - API service modules
- `/server` - Express.js backend
  - `/src` - Backend source code
  - `/src/routes` - API route handlers
  - `/src/services` - Backend services
- `/public` - Static assets
- `/docs` - Built frontend output (for static hosting)

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express, PostgreSQL
- **Styling**: Tailwind CSS with tailwindcss-animate

## Development
- Frontend runs on port 5000 (`npm run dev`)
- Backend runs on port 3001 (`npm run dev:backend`)
- Full stack: `npm run dev:all`

## Deployment
- Static deployment configured to serve from `/docs` directory
- Build command: `npm run build`
