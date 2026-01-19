# Coheus Lambda Functions

This directory contains AWS Lambda functions migrated from Supabase Edge Functions.

## Structure

```
lambda/
├── shared/                    # Shared utilities
│   ├── secrets-manager.ts     # AWS Secrets Manager helper
│   ├── kms-encryption.ts      # AWS KMS encryption helper
│   └── database.ts            # RDS PostgreSQL connection helper
├── ailethia-briefing/         # HTTP: Generate briefing scripts
├── stripe-checkout/           # HTTP: Create Stripe checkout sessions
├── stripe-webhook/            # HTTP: Handle Stripe webhooks
├── seed-demo-data/            # HTTP: Seed demo data
├── gemini-tts/                # HTTP: Text-to-speech conversion
├── gemini-live-voice/         # WebSocket: Gemini Live API proxy
├── aletheia-realtime/        # WebSocket: OpenAI Realtime API (Aletheia)
├── maylin-realtime/           # WebSocket: OpenAI Realtime API (Maylin)
└── serverless.yml             # Serverless Framework configuration
```

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Serverless Framework installed: `npm install -g serverless`
3. AWS Secrets Manager secrets created (see `infrastructure/aws/secrets-setup.sh`)
4. API Gateway REST and WebSocket APIs created

### Deploy with Serverless Framework

```bash
cd lambda
npm install
serverless deploy --stage prod
```

### Manual Deployment

1. Build each Lambda function:
```bash
cd lambda/{function-name}
npm install
npm run build  # If TypeScript compilation is needed
zip -r function.zip . -x "*.git*" "node_modules/.cache/*"
```

2. Upload to AWS Lambda via AWS Console or CLI

## Environment Variables

Set these in AWS Lambda console or via Serverless Framework:

- `AWS_REGION`: AWS region (default: us-east-1)
- `KMS_KEY_ID`: KMS key ID or alias (default: alias/coheus-encryption)
- `DB_HOST`: RDS endpoint
- `DB_NAME`: Database name
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password (from Secrets Manager or SSM)
- `SITE_URL`: Frontend URL for redirects
- `FRONTEND_URL`: Frontend URL for CORS

## Secrets Manager

All API keys are stored in AWS Secrets Manager:

- `coheus/gemini-api-key`
- `coheus/openai-api-key`
- `coheus/ai-gateway-api-key`
- `coheus/stripe-secret-key`
- `coheus/stripe-webhook-secret`

## WebSocket Functions

WebSocket functions require DynamoDB for connection state management. The `coheus-websocket-connections` table is created automatically by the Serverless Framework configuration.

## Testing

Test Lambda functions locally using SAM CLI or Serverless Offline:

```bash
serverless offline
```

## Migration Notes

- All functions migrated from Deno (Supabase Edge Functions) to Node.js 20
- Database queries use `pg` library instead of Supabase client
- Authentication uses JWT tokens from Express backend
- API keys fetched from Secrets Manager at runtime
- WebSocket connections managed via API Gateway WebSocket API
