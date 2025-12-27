# Debugging "Application Error Occurred" Issue

## Step 1: Check Render Logs for book8-voice-agent

1. Go to Render Dashboard → `book8-voice-agent` service
2. Click on "Logs" tab
3. Filter by timestamp matching the error
4. Look for:
   - `[agent-chat] ERROR` entries (with request IDs)
   - Stack traces
   - HTTP status codes (400, 500, etc.)
   - Timeout errors
   - Network errors

**What to look for:**
- Request ID logs showing where the error occurred
- Error messages with stack traces
- API call failures (check_availability, book_appointment)
- Business profile loading errors
- NLU extraction errors

## Step 2: Add Logging in Gateway

The gateway code (book8-voice-gateway) needs logging around the voice-agent call.

**Add this logging in the gateway where it calls `/api/agent-chat`:**

```javascript
const VOICE_AGENT_BASE_URL = process.env.VOICE_AGENT_BASE_URL || 'https://book8-voice-agent.onrender.com';
const agentUrl = `${VOICE_AGENT_BASE_URL}/api/agent-chat`;

console.log('[gateway] Calling voice-agent:', {
  url: agentUrl,
  method: 'POST',
  body: {
    businessId: request.body.businessId,
    callSid: request.body.callSid,
    hasText: !!request.body.text
  }
});

const startTime = Date.now();
try {
  const response = await fetch(agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request.body),
    timeout: 30000 // 30 second timeout
  });

  const responseTime = Date.now() - startTime;
  const status = response.status;
  
  console.log('[gateway] Voice-agent response:', {
    status,
    statusText: response.statusText,
    responseTime: `${responseTime}ms`,
    headers: Object.fromEntries(response.headers.entries())
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[gateway] Voice-agent error response:', {
      status,
      body: errorText.substring(0, 500) // First 500 chars
    });
    throw new Error(`Voice-agent returned ${status}: ${errorText.substring(0, 200)}`);
  }

  const json = await response.json();
  console.log('[gateway] Voice-agent success:', {
    ok: json.ok,
    hasReply: !!json.reply,
    replyLength: json.reply?.length || 0
  });
  
  return json;
} catch (error) {
  const responseTime = Date.now() - startTime;
  console.error('[gateway] Voice-agent call failed:', {
    error: error.message,
    responseTime: `${responseTime}ms`,
    isTimeout: error.name === 'AbortError' || error.message.includes('timeout'),
    isNetworkError: error.message.includes('fetch') || error.message.includes('network')
  });
  throw error;
}
```

## Step 3: Verify Gateway Environment Variables

In Render → `book8-voice-gateway` → Environment:

**Required variables:**
- `VOICE_AGENT_BASE_URL` (or similar) should be:
  - `https://book8-voice-agent.onrender.com` (production)
  - NOT `http://localhost:5050`
  - NOT an old/deleted service URL

**Verify the agent service has:**
- `CORE_API_URL` or `BOOK8_CORE_API_URL` → `https://book8-core-api.onrender.com`
- `OPENAI_API_KEY` → Your OpenAI API key
- `BOOK8_AGENT_API_KEY` → Your Book8 agent API key
- `DEFAULT_BUSINESS_HANDLE` → `waismofit` (or your default)

## Step 4: Test the Endpoint Directly

Test the voice-agent endpoint directly to isolate the issue:

```powershell
$body = @{
  businessId = "waismofit"
  callSid = "TEST-$(Get-Date -Format 'yyyyMMddHHmmss')"
  text = "Hello, I want to book an appointment"
} | ConvertTo-Json

$response = Invoke-RestMethod `
  -Uri "https://book8-voice-agent.onrender.com/api/agent-chat" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body `
  -ErrorAction Stop

$response | ConvertTo-Json -Depth 10
```

**Expected response:**
```json
{
  "ok": true,
  "reply": "Thanks for calling Wais Mo Fitness...",
  "state": { ... }
}
```

**If you get an error:**
- Check the Render logs for the request ID
- Look for the detailed error logs we added

## Common Issues

### 1. Timeout
- Gateway timeout < agent processing time
- Solution: Increase gateway timeout or optimize agent

### 2. JSON Parse Error
- Agent returns HTML (404/500 page) instead of JSON
- Solution: Check agent is deployed and route exists

### 3. Network Error
- Gateway can't reach agent URL
- Solution: Verify `VOICE_AGENT_BASE_URL` is correct

### 4. Business Profile Error
- Core API returns 404 or error
- Solution: Check agent logs for `[getBusinessProfile]` errors

### 5. NLU Extraction Error
- OpenAI API fails or times out
- Solution: Check `OPENAI_API_KEY` and API quota

## Current Logging in Voice-Agent

The voice-agent now logs:
- ✅ Request received (with request ID)
- ✅ Request body details
- ✅ Business profile loading
- ✅ NLU extraction
- ✅ check_availability calls
- ✅ book_appointment calls
- ✅ Success/error responses with timing
- ✅ Startup configuration

All logs include a unique `[requestId]` for tracing a single request through the logs.

