# Required Environment Variables for book8-voice-agent

## Required (Service will fail without these):
- ✅ `OPENAI_API_KEY` - OpenAI API key (required, service exits if missing)

## Highly Recommended:
- ✅ `BOOK8_AGENT_API_KEY` - Book8 agent API key (needed for booking API calls)
- ✅ `CORE_API_URL` OR `BOOK8_CORE_API_URL` - Core API URL for fetching business profiles
  - Defaults to: `https://book8-core-api.onrender.com` if neither is set
  - Both are checked, so either one works

## Optional (have defaults):
- `PORT` - Server port (defaults to `5050`)
- `DEFAULT_BUSINESS_HANDLE` - Default business ID (defaults to `waismofit`)
- `OPENAI_MODEL` - OpenAI model for Realtime API (defaults to `gpt-realtime`)
- `BOOK8_NLU_MODEL` - Model for NLU extraction (defaults to `gpt-4o-mini`)

## Gateway Configuration (book8-voice-gateway-1):
The gateway needs:
- ✅ `VOICE_AGENT_URL` - Should be: `https://book8-voice-agent.onrender.com/api/agent-chat`
- ✅ `BOOK8_CORE_API_URL` - Should be: `https://book8-core-api.onrender.com`

## Issues Found:
1. ✅ Fixed: `businessProfiles.js` now checks both `CORE_API_URL` and `BOOK8_CORE_API_URL` (was only checking `CORE_API_URL`)

