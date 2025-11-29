# HIPAA Pharmacy Bot - System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PATIENT CALL                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TWILIO (BAA COVERED)                          │
│  • Receives call                                                 │
│  • Speech-to-text transcription                                  │
│  • Text-to-speech playback                                       │
│  • ✅ CAN HANDLE PHI                                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP POST with transcript
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BACKEND (FastAPI)                              │
│  • ✅ CAN HANDLE PHI                                            │
│  • Stores PHI in session (in-memory → Redis in prod)            │
│                                                                  │
│  ┌────────────────────────────────────────────────────┐         │
│  │  1. PHI SANITIZER (phi_sanitizer.py)              │         │
│  │     • Extract PHI (phone, email, address, meds)   │         │
│  │     • Store in CallSession (backend only)         │         │
│  │     • Replace with tokens: [PHONE_PROVIDED]       │         │
│  └───────────────────┬────────────────────────────────┘         │
│                      │                                           │
│                      ▼                                           │
│  ┌────────────────────────────────────────────────────┐         │
│  │  2. CONVERSATION ENGINE (conversation_engine.py)   │         │
│  │     • Load Bland flow JSON                         │         │
│  │     • Track current node/state                     │         │
│  │     • Determine next transition                    │         │
│  └───────────────────┬────────────────────────────────┘         │
│                      │                                           │
│                      ▼                                           │
│  ┌────────────────────────────────────────────────────┐         │
│  │  3. SESSION STORE (models.py)                      │         │
│  │     • CallSession with PHI fields                  │         │
│  │     • In-memory dict (dev)                         │         │
│  │     • TODO: Redis with encryption (prod)           │         │
│  └────────────────────────────────────────────────────┘         │
└────────────────────────────┬────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
            ▼                                 ▼
┌───────────────────────┐         ┌──────────────────────┐
│   GPT (gpt_client.py) │         │ ElevenLabs           │
│                       │         │ (tts_client.py)      │
│  ❌ NO PHI ALLOWED   │         │                      │
│  ✅ Only sanitized   │         │  ❌ NO PHI ALLOWED  │
│     transcripts       │         │  ✅ Only PHI-free   │
│  ✅ PHI-free context │         │     text             │
│                       │         │                      │
│  Returns:             │         │  Returns:            │
│  • User intent        │         │  • MP3 audio file    │
│  • PHI-free reply     │         │                      │
└───────────────────────┘         └──────────────────────┘
            │                                 │
            └────────────────┬────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     RESPONSE ASSEMBLY                            │
│  • Combine reply text + TTS audio                               │
│  • Generate TwiML with <Play> or <Say>                          │
│  • Return to Twilio                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                        Back to Twilio
                             │
                             ▼
                        Patient hears response
```

---

## Data Flow: Example Call

### Step 1: Call Starts
```
Patient → Dials Twilio number
Twilio → POST /voice/incoming
Backend → Creates CallSession
         Gets greeting from conversation_engine
         Generates TTS via ElevenLabs (PHI-free greeting)
         Returns TwiML with <Gather>
Twilio → Plays greeting, listens for speech
```

### Step 2: Patient Speaks
```
Patient → "My phone number is 555-123-4567"
Twilio → Transcribes to text
         POST /voice/next with SpeechResult
```

### Step 3: Backend Processing
```
Backend receives: "My phone number is 555-123-4567"
         ↓
PHI Sanitizer:
  Detects: 555-123-4567 (phone pattern)
  Stores: session.raw_phone_number = "555-123-4567"  ← Backend only!
  Sanitizes: "My phone number is [PHONE_NUMBER_PROVIDED]"
         ↓
GPT Client:
  Input: "[PHONE_NUMBER_PROVIDED]" + context  ← No real PHI!
  Output: {"intent": "provided_info", 
           "reply": "Thank you, I've recorded that."}
         ↓
Conversation Engine:
  Current node: "collect_contact"
  Intent: "provided_info"
  Next node: "collect_insurance"
  Next prompt: "We can send a secure link..."
         ↓
TTS Client:
  Input: "Thank you... [next prompt]"  ← Validated PHI-free
  Output: generated_audio.mp3
         ↓
TwiML Generator:
  Returns: <Response><Gather><Play>audio.mp3</Play></Gather></Response>
```

### Step 4: Twilio Plays Response
```
Twilio → Plays audio
         Listens for next input
         Repeats loop
```

---

## PHI Protection at Each Layer

| Layer | Sees PHI? | Protection Method |
|-------|-----------|-------------------|
| **Twilio** | ✅ Yes | BAA agreement |
| **Backend FastAPI** | ✅ Yes | Encrypted storage (prod) |
| **CallSession** | ✅ Yes | Backend only, not sent out |
| **PHI Sanitizer** | ✅ Yes | Extracts & tokenizes |
| **Conversation Engine** | ❌ No | Works with node IDs only |
| **GPT** | ❌ No | Receives sanitized text only |
| **ElevenLabs** | ❌ No | Receives validated PHI-free text |

---

## File Responsibilities

```
app/
├── main.py                    🚪 Entry point - Twilio webhooks
│   • /voice/incoming         → Start call, create session
│   • /voice/next             → Process speech, drive conversation
│   • /audio/{file}           → Serve TTS audio
│
├── models.py                  💾 Data layer - PHI storage
│   • CallSession             → Stores ALL PHI (backend only)
│   • SESSION_STORE           → In-memory dict (→ Redis)
│
├── phi_sanitizer.py           🛡️ CRITICAL - PHI protection
│   • extract_and_sanitize_phi() → Detect & tokenize PHI
│   • is_phi_free()           → Validate no PHI leaks
│   • create_phi_free_summary() → Safe context for GPT
│
├── conversation_engine.py     🧠 Business logic
│   • ConversationEngine      → Load Bland JSON
│   • get_node()              → Current state
│   • find_next_node()        → Transition logic
│
├── gpt_client.py              🤖 AI intent & reply
│   • analyze_user_intent_and_reply()
│   • ENFORCES: No PHI in, no PHI out
│   • Fallback logic if GPT down
│
├── tts_client.py              🔊 Voice synthesis
│   • generate_tts_audio()    → Call ElevenLabs
│   • ENFORCES: Validates PHI-free text
│   • Falls back to Twilio <Say>
│
├── twilio_utils.py            📞 TwiML helpers
│   • generate_twiml_gather() → Create response XML
│   • generate_twiml_transfer() → Pharmacist handoff
│
└── config.py                  ⚙️ Environment config
    • Settings                → API keys, URLs

pharmacy_bland_flow.json       📊 Conversation graph
    • Nodes                   → States (greeting, confirm, collect)
    • Edges                   → Transitions (yes/no/transfer)
    • Prompts                 → What to say/ask
```

---

## Security Boundaries

```
┌─────────────────────────────────────────────────────┐
│  TRUSTED ZONE (Can Handle PHI)                      │
│                                                     │
│  ┌──────────┐         ┌──────────┐                │
│  │  Twilio  │────────▶│ Backend  │                │
│  │  (BAA)   │         │ (FastAPI)│                │
│  └──────────┘         └─────┬────┘                │
│                             │                       │
│                       CallSession                   │
│                       (PHI Store)                   │
└──────────────────────────────┼──────────────────────┘
                               │
                               │ PHI Sanitizer
                               │ (Removes PHI)
                               ▼
┌─────────────────────────────────────────────────────┐
│  EXTERNAL ZONE (NO PHI ALLOWED)                     │
│                                                     │
│  ┌───────────┐         ┌──────────────┐           │
│  │    GPT    │         │  ElevenLabs  │           │
│  │ (No BAA)  │         │   (No BAA)   │           │
│  └───────────┘         └──────────────┘           │
│                                                     │
│  • Only sanitized text                             │
│  • Tokens instead of real data                     │
│  • Validation checks before sending                │
└─────────────────────────────────────────────────────┘
```

---

## Deployment Architecture (Production)

```
                    ┌─────────────┐
                    │   Route 53  │ (DNS)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  CloudFront │ (CDN for audio)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │     ALB     │ (Load Balancer)
                    └──────┬──────┘
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
    ┌────▼─────┐                      ┌─────▼────┐
    │   ECS    │                      │   ECS    │
    │ (FastAPI)│                      │ (FastAPI)│
    └────┬─────┘                      └─────┬────┘
         │                                   │
         └─────────────────┬─────────────────┘
                           │
                    ┌──────▼──────┐
                    │    Redis    │ (Sessions - PHI)
                    │  (Encrypted)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │     RDS     │ (Call logs - PHI)
                    │  (Encrypted)│
                    └─────────────┘

External Services (HTTPS only):
  • Twilio (webhooks)
  • OpenAI (API calls)
  • ElevenLabs (API calls)
```

---

## Key Security Measures

✅ **Implemented:**
- PHI sanitization before external API calls
- Validation checks (is_phi_free)
- Clear separation of trusted/untrusted zones
- Comprehensive logging (PHI on backend only)

⚠️ **TODO for Production:**
- HTTPS everywhere (TLS 1.3+)
- Twilio signature validation
- Redis with encryption at rest
- Database column-level encryption
- VPC with private subnets
- WAF rules
- Regular security audits
- Penetration testing
- HIPAA compliance certification

---

**This architecture ensures PHI never leaves the trusted zone!**
