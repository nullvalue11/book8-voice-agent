import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { buildSystemPrompt } from './agentConfig.js';
import { getBusinessProfile } from './businessProfiles.js';
import { getCallState, upsertCallState, clearCallState } from './src/state/callState.js';
import { extractFields } from './src/services/nluExtract.js';
import { bestEffortPost } from './src/utils/bestEffortPost.js';

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key, Book8 agent API key, and model from environment variables.
// Note: Realtime API uses "gpt-realtime" model. For Chat Completions API, you could use "gpt-4o" or "gpt-4o-mini"
const { OPENAI_API_KEY, BOOK8_AGENT_API_KEY, OPENAI_MODEL } = process.env;
const REALTIME_MODEL = OPENAI_MODEL || "gpt-realtime";

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.register(fastifyCors, {
    origin: true, // Allow all origins
    credentials: true
});

// Constants
const VOICE = 'alloy';
const TEMPERATURE = 0.8; // Controls the randomness of the AI's responses
const PORT = process.env.PORT || 5050; // Allow dynamic port assignment
const DEFAULT_BUSINESS_HANDLE = process.env.DEFAULT_BUSINESS_HANDLE || 'waismofit';

// List of Event Types to log to the console. See the OpenAI Realtime API Documentation: https://platform.openai.com/docs/api-reference/realtime
const LOG_EVENT_TYPES = [
    'error',
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
    'session.updated'
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Optional: track "first turn" by CallSid to enforce greeting rule
const seenCallSids = new Set();

// Track turn index per call for deterministic IDs
const callTurnIndices = new Map();

// Get or increment turn index for a call
function getTurnIndex(callSid) {
  if (!callSid) return 0;
  const current = callTurnIndices.get(callSid) || 0;
  callTurnIndices.set(callSid, current + 1);
  return current;
}

// Get Core API URL for internal endpoints
const CORE_API_URL = process.env.CORE_API_URL || process.env.BOOK8_CORE_API_URL || 'https://book8-core-api.onrender.com';

// Helper functions for booking tools
async function callCheckAvailability({ date, timezone, durationMinutes }) {
  try {
    const response = await fetch('https://api.book8.com/api/agent/check-availability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentApiKey: BOOK8_AGENT_API_KEY,
        date,
        timezone,
        durationMinutes
      })
    });
    return await response.json();
  } catch (error) {
    console.error('[callCheckAvailability] Error:', error);
    return { available: false, error: error.message };
  }
}

async function callBookAppointment({ start, guestName, guestEmail, guestPhone }) {
  try {
    const response = await fetch('https://api.book8.com/api/agent/book', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentApiKey: BOOK8_AGENT_API_KEY,
        start,
        guestName,
        guestEmail,
        guestPhone: guestPhone || null
      })
    });
    return await response.json();
  } catch (error) {
    console.error('[callBookAppointment] Error:', error);
    return { ok: false, error: error.message };
  }
}

// Health check endpoint
fastify.get('/health', async (request, reply) => {
    return reply.send({ ok: true, service: "book8-voice-agent" });
});

/**
 * POST /api/agent-chat
 * Body:
 * {
 *   businessId: "waismofit",
 *   callSid: "...",
 *   text: "user's message text",
 *   messages: [{role:"user",content:"..."}, ...], // optional, for backward compatibility
 *   callerPhone: "+1...",
 *   toPhone: "+1..."
 * }
 */
fastify.post('/api/agent-chat', async (request, reply) => {
  try {
    const { businessId, callSid, text, messages } = request.body;

    if (!businessId) {
      return reply.status(400).send({ ok: false, error: "businessId is required" });
    }

    // Get user text from either 'text' field or last message
    let userText = text;
    if (!userText && Array.isArray(messages) && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      userText = lastMessage.content || lastMessage.text || '';
    }
    if (!userText) {
      return reply.status(400).send({ ok: false, error: "text or messages with content is required" });
    }

    // Get turn index for this call
    const turnIndex = getTurnIndex(callSid);

    // 1️⃣ Transcript event - caller turn (STT result)
    if (callSid) {
      bestEffortPost(`${CORE_API_URL}/internal/calls/transcript`, {
        turnId: `${callSid}:caller:${turnIndex}`,
        callSid,
        role: 'caller',
        text: userText,
        turnIndex,
        timestamp: new Date().toISOString()
      }).catch(() => {}); // Already logged in bestEffortPost
    }

    // Load business profile (with error handling)
    let profile;
    try {
      profile = await getBusinessProfile(businessId);
    } catch (error) {
      console.error('[agent-chat] Error loading business profile:', error);
      // Use a minimal fallback profile
      profile = {
        name: businessId,
        services: [],
        defaultServices: [],
        timezone: 'America/Toronto'
      };
    }
    
    const services = profile.services || profile.defaultServices || [];

    // Load per-call state
    const state = getCallState(callSid) || {
      step: "greeting",          // greeting | service | datetime | contact | confirm | done
      service: null,
      date: null,
      time: null,
      name: null,
      email: null,
      phone: null
    };

    // Run NLU extraction (with error handling)
    let extracted;
    try {
      extracted = await extractFields({
        businessName: profile.name || businessId,
        services,
        userText
      });
    } catch (error) {
      console.error('[agent-chat] Error in NLU extraction:', error);
      // Use default extraction on error
      extracted = {
        intent: "other",
        service: null,
        date: null,
        time: null,
        timezone: null,
        name: null,
        email: null,
        phone: null,
        confirmation: null
      };
    }
    
    // Track LLM usage from NLU extraction
    let llmTokens = 0;
    if (extracted._usage) {
      llmTokens = (extracted._usage.prompt_tokens || 0) + (extracted._usage.completion_tokens || 0);
      delete extracted._usage; // Remove from extracted data
    }

    // Merge extracted into state (only overwrite if value exists)
    const next = upsertCallState(callSid, {
      step: state.step,
      service: extracted.service ?? state.service,
      date: extracted.date ?? state.date,
      time: extracted.time ?? state.time,
      name: extracted.name ?? state.name,
      email: extracted.email ?? state.email,
      phone: extracted.phone ?? state.phone
    });

    // Deterministic conversation flow:

    let replyText = '';
    let toolEvents = [];

    // 1) If user asked services:
    if (extracted.intent === "ask_services") {
      const short = services.slice(0, 2).map(s => s.name).join(" or ");
      replyText = `We offer ${short}. Which one would you like?`;
    }
    // 2) If no service selected:
    else if (!next.service) {
      const serviceOptions = services.slice(0, 2).map(s => s.name).join(" or ");
      replyText = `Sure. Do you want ${serviceOptions}?`;
    }
    // 3) Need date/time:
    else if (!next.date || !next.time) {
      replyText = `Great. What day and time works for you?`;
    }
    // 4) Need contact:
    else if (!next.name || (!next.email && !next.phone)) {
      replyText = `Perfect. What's your name, and can I get your email or phone number?`;
    }
    // 5) Now you can book:
    else {
      const serviceDuration = services.find(s => s.name === next.service)?.durationMinutes || 
                               services.find(s => s.name === next.service)?.duration || 30;
      const timezone = next.timezone || profile.timezone || 'America/Toronto';
      
      // Call check_availability
      const checkResult = await callCheckAvailability({
        date: next.date,
        timezone: timezone,
        durationMinutes: serviceDuration
      });

      // 2️⃣ Tool event - check_availability
      if (callSid) {
        const toolIndex = toolEvents.length;
        const toolEventId = `${callSid}:tool:check_availability:${toolIndex}`;
        toolEvents.push({ eventId: toolEventId, toolName: 'check_availability' });
        
        bestEffortPost(`${CORE_API_URL}/internal/calls/tool`, {
          eventId: toolEventId,
          callSid,
          toolName: 'check_availability',
          toolIndex,
          input: { date: next.date, timezone, durationMinutes: serviceDuration },
          output: checkResult,
          timestamp: new Date().toISOString()
        }).catch(() => {});
      }

      // If availability check succeeded, book the appointment
      if (checkResult && checkResult.available) {
        const bookingResult = await callBookAppointment({
          start: `${next.date}T${next.time}`,
          guestName: next.name,
          guestEmail: next.email,
          guestPhone: next.phone
        });

        // 2️⃣ Tool event - book_appointment
        if (callSid) {
          const toolIndex = toolEvents.length;
          const toolEventId = `${callSid}:tool:book_appointment:${toolIndex}`;
          toolEvents.push({ eventId: toolEventId, toolName: 'book_appointment' });
          
          bestEffortPost(`${CORE_API_URL}/internal/calls/tool`, {
            eventId: toolEventId,
            callSid,
            toolName: 'book_appointment',
            toolIndex,
            input: { start: `${next.date}T${next.time}`, guestName: next.name, guestEmail: next.email, guestPhone: next.phone },
            output: bookingResult,
            timestamp: new Date().toISOString()
          }).catch(() => {});
        }

        if (bookingResult && bookingResult.ok) {
          replyText = `Perfect! I've booked ${next.service} on ${next.date} at ${next.time} for ${next.name}. You'll receive a confirmation shortly.`;
          clearCallState(callSid);
        } else {
          replyText = `I'm having trouble booking that right now. Please try again or contact us directly.`;
        }
      } else {
        replyText = `I'm sorry, that time slot isn't available. Would you like to try a different day or time?`;
      }
    }

    // 1️⃣ Transcript event - agent reply
    if (callSid && replyText) {
      bestEffortPost(`${CORE_API_URL}/internal/calls/transcript`, {
        turnId: `${callSid}:agent:${turnIndex}`,
        callSid,
        role: 'agent',
        text: replyText,
        turnIndex,
        timestamp: new Date().toISOString()
      }).catch(() => {});
    }

    // 3️⃣ Usage deltas - LLM tokens and TTS characters (MVP-accurate)
    if (callSid && replyText) {
      bestEffortPost(`${CORE_API_URL}/internal/calls/usage`, {
        callSid,
        llmTokens: llmTokens, // From OpenAI response usage
        ttsCharacters: replyText.length, // replyText.length
        timestamp: new Date().toISOString()
      }).catch(() => {});
    }
    
    return reply.send({ ok: true, reply: replyText, state: next });
  } catch (err) {
    console.error('[book8-voice-agent] /api/agent-chat error:', err);
    console.error('[book8-voice-agent] Error stack:', err.stack);
    
    // Return a user-friendly error message instead of crashing
    const errorReply = "I'm having trouble accessing the scheduling system right now. Please try again later.";
    
    // Try to emit error transcript if we have callSid
    try {
      const { callSid } = request.body || {};
      if (callSid) {
        const turnIndex = getTurnIndex(callSid);
        bestEffortPost(`${CORE_API_URL}/internal/calls/transcript`, {
          turnId: `${callSid}:agent:${turnIndex}`,
          callSid,
          role: 'agent',
          text: errorReply,
          turnIndex,
          timestamp: new Date().toISOString()
        }).catch(() => {});
      }
    } catch (transcriptError) {
      console.error('[book8-voice-agent] Error emitting error transcript:', transcriptError);
    }
    
    return reply.status(500).send({ 
      ok: false, 
      reply: errorReply,
      error: err.message 
    });
  }
});

// Route for Twilio to handle incoming calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
    // Capture caller phone number from Twilio request
    const callerPhone = request.body?.From || request.query?.From || null;
    
    // Get business ID from query parameter or body (supports both businessId and handle for compatibility)
    const businessId = request.query?.businessId || request.body?.businessId || 
                       request.query?.handle || request.body?.handle || 
                       DEFAULT_BUSINESS_HANDLE;
    
    // Build query parameters for WebSocket connection
    const params = new URLSearchParams();
    if (callerPhone) params.append('callerPhone', callerPhone);
    params.append('businessId', businessId);
    
    const streamUrl = `wss://${request.headers.host}/media-stream?${params.toString()}`;
    
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="Google.en-US-Chirp3-HD-Aoede">Please wait while we connect your call to the A. I. voice assistant, powered by Twilio and the Open A I Realtime API</Say>
                              <Pause length="1"/>
                              <Say voice="Google.en-US-Chirp3-HD-Aoede">O.K. you can start talking!</Say>
                              <Connect>
                                  <Stream url="${streamUrl}" />
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, async (connection, req) => {
        console.log('Client connected');

        // Extract caller phone and business ID from query parameters
        const callerPhone = req.query?.callerPhone || null;
        const businessId = req.query?.businessId || req.query?.handle || DEFAULT_BUSINESS_HANDLE;
        
        // Build system prompt for this business (async - fetch from API)
        let systemMessage = '';
        try {
            systemMessage = await buildSystemPrompt(businessId);
        } catch (error) {
            console.error('Error building system prompt:', error);
            // Fallback to a default message if buildSystemPrompt fails
            systemMessage = `You are a professional AI phone receptionist. Help callers book appointments.`;
        }
        
        // Request body context for tool handlers (from gateway)
        const requestBody = {
            callerPhone: callerPhone
        };
        
        // Connection-specific state
        let streamSid = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;

        const openAiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}&temperature=${TEMPERATURE}`, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            }
        });

        // Control initial session with OpenAI
        const initializeSession = () => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    type: 'realtime',
                    model: REALTIME_MODEL,
                    output_modalities: ["audio"],
                    audio: {
                        input: { format: { type: 'audio/pcmu' }, turn_detection: { type: "server_vad" } },
                        output: { format: { type: 'audio/pcmu' }, voice: VOICE },
                    },
                    instructions: systemMessage,
                },
            };

            console.log('Sending session update:', JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));

            // Uncomment the following line to have AI speak first:
            // sendInitialConversationItem();
        };

        // Send initial conversation item if AI talks first
        const sendInitialConversationItem = () => {
            const initialConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Greet the user with "Hello there! I am an AI voice assistant powered by Twilio and the OpenAI Realtime API. You can ask me for facts, jokes, or anything you can imagine. How can I help you?"'
                        }
                    ]
                }
            };

            if (SHOW_TIMING_MATH) console.log('Sending initial conversation item:', JSON.stringify(initialConversationItem));
            openAiWs.send(JSON.stringify(initialConversationItem));
            openAiWs.send(JSON.stringify({ type: 'response.create' }));
        };

        // Handle interruption when the caller's speech starts
        const handleSpeechStartedEvent = () => {
            if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
                if (SHOW_TIMING_MATH) console.log(`Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`);

                if (lastAssistantItem) {
                    const truncateEvent = {
                        type: 'conversation.item.truncate',
                        item_id: lastAssistantItem,
                        content_index: 0,
                        audio_end_ms: elapsedTime
                    };
                    if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent));
                    openAiWs.send(JSON.stringify(truncateEvent));
                }

                connection.send(JSON.stringify({
                    event: 'clear',
                    streamSid: streamSid
                }));

                // Reset
                markQueue = [];
                lastAssistantItem = null;
                responseStartTimestampTwilio = null;
            }
        };

        // Send mark messages to Media Streams so we know if and when AI response playback is finished
        const sendMark = (connection, streamSid) => {
            if (streamSid) {
                const markEvent = {
                    event: 'mark',
                    streamSid: streamSid,
                    mark: { name: 'responsePart' }
                };
                connection.send(JSON.stringify(markEvent));
                markQueue.push('responsePart');
            }
        };

        // Handle book_appointment tool call
        const handleBookAppointment = async (toolCall, responseId) => {
            try {
                const args = JSON.parse(toolCall.function.arguments);

                const guestPhone =
                    (args.guestPhone && args.guestPhone.trim()) ||
                    requestBody.callerPhone ||  // from gateway
                    null;

                const bookingPayload = {
                    agentApiKey: BOOK8_AGENT_API_KEY,
                    start: args.start,
                    guestName: args.guestName,
                    guestEmail: args.guestEmail,
                    guestPhone
                };

                // Make API call to Book8
                const apiResponse = await fetch('https://api.book8.com/api/agent/book', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(bookingPayload)
                });

                const result = await apiResponse.json();

                // Submit tool output back to OpenAI
                const submitToolOutput = {
                    type: 'response.submit_tool_outputs',
                    response_id: responseId,
                    tool_outputs: [{
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(result)
                    }]
                };

                openAiWs.send(JSON.stringify(submitToolOutput));
            } catch (error) {
                console.error('Error handling book_appointment tool:', error);
                
                // Submit error as tool output
                const submitToolOutput = {
                    type: 'response.submit_tool_outputs',
                    response_id: responseId,
                    tool_outputs: [{
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message })
                    }]
                };

                openAiWs.send(JSON.stringify(submitToolOutput));
            }
        };

        // Open event for OpenAI WebSocket
        openAiWs.on('open', () => {
            console.log('Connected to the OpenAI Realtime API');
            setTimeout(initializeSession, 100);
        });

        // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);

                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(`Received event: ${response.type}`, response);
                }

                if (response.type === 'response.output_audio.delta' && response.delta) {
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: response.delta }
                    };
                    connection.send(JSON.stringify(audioDelta));

                    // First delta from a new response starts the elapsed time counter
                    if (!responseStartTimestampTwilio) {
                        responseStartTimestampTwilio = latestMediaTimestamp;
                        if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
                    }

                    if (response.item_id) {
                        lastAssistantItem = response.item_id;
                    }
                    
                    sendMark(connection, streamSid);
                }

                if (response.type === 'input_audio_buffer.speech_started') {
                    handleSpeechStartedEvent();
                }

                // Handle tool calls (function calls)
                // OpenAI Realtime API uses response.requires_action for tool calls
                if (response.type === 'response.requires_action') {
                    const toolCalls = response.response?.required_action?.submit_tool_outputs?.tool_calls || [];
                    const responseId = response.response?.id;
                    
                    for (const toolCall of toolCalls) {
                        if (toolCall.type === 'function' && toolCall.function?.name === 'book_appointment') {
                            handleBookAppointment(toolCall, responseId);
                        }
                    }
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error, 'Raw message:', data);
            }
        });

        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;
                        if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Incoming stream has started', streamSid);

                        // Reset start and media timestamp on a new stream
                        responseStartTimestampTwilio = null; 
                        latestMediaTimestamp = 0;
                        break;
                    case 'mark':
                        if (markQueue.length > 0) {
                            markQueue.shift();
                        }
                        break;
                    default:
                        console.log('Received non-media event:', data.event);
                        break;
                }
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', message);
            }
        });

        // Handle connection close
        connection.on('close', () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log('Client disconnected.');
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
        });

        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
        });
    });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});
