# HIPAA-Compliant Pharmacy Voice Bot

A FastAPI-based voice calling system for pharmacy prescription confirmations, built with strict HIPAA compliance in mind.

## 🔒 HIPAA Compliance Architecture

This system is designed to keep Protected Health Information (PHI) **strictly on the backend**, never exposing it to third-party AI services.

### What is PHI?
- Patient names
- Addresses  
- Phone numbers
- Email addresses
- Dates of birth
- Medication names
- Insurance information
- Any other personally identifiable health information

### How We Maintain HIPAA Compliance

#### ✅ PHI is ALLOWED in:
- **Twilio** - Covered by Business Associate Agreement (BAA)
- **Our backend** - This FastAPI application and its database

#### ❌ PHI is NEVER sent to:
- **OpenAI GPT** - Used for conversation logic only, receives sanitized transcripts
- **ElevenLabs** - Used for text-to-speech only, receives PHI-free text

### The PHI Sanitization Pipeline

```
1. User speaks → Twilio transcribes (PHI may be present)
2. Our backend receives transcript
3. PHI Sanitizer extracts and stores PHI locally:
   - Detects: phone numbers, emails, addresses, dates, etc.
   - Stores: Raw PHI in CallSession object (backend only)
   - Replaces: PHI with tokens like [PHONE_NUMBER_PROVIDED]
4. Only sanitized transcript sent to GPT
5. GPT returns intent and PHI-free reply
6. PHI-free reply sent to ElevenLabs for TTS
7. Twilio plays audio to user
```

## 🏗️ Architecture

```
┌─────────┐     ┌──────────────┐     ┌─────────┐
│ Twilio  │────▶│   Backend    │────▶│   GPT   │
│  (BAA)  │     │  (FastAPI)   │     │ (no PHI)│
└─────────┘     │              │     └─────────┘
                │  - Sessions  │
                │  - PHI Store │     ┌──────────────┐
                │  - Sanitizer │────▶│ ElevenLabs   │
                │  - Conv Flow │     │   (no PHI)   │
                └──────────────┘     └──────────────┘
```

## 📁 Project Structure

```
.
├── app/
│   ├── main.py              # FastAPI app, Twilio webhooks
│   ├── models.py            # CallSession data model
│   ├── conversation_engine.py  # Bland flow JSON interpreter
│   ├── phi_sanitizer.py     # PHI detection and tokenization
│   ├── gpt_client.py        # OpenAI wrapper (PHI-free only)
│   ├── tts_client.py        # ElevenLabs wrapper (PHI-free only)
│   ├── twilio_utils.py      # TwiML generation helpers
│   └── config.py            # Environment configuration
├── pharmacy_bland_flow.json # Conversation flow definition
├── requirements.txt         # Python dependencies
└── README.md               # This file
```

## 🚀 Setup

### Prerequisites
- Python 3.9+
- Twilio account with phone number
- OpenAI API key
- ElevenLabs API key (optional, falls back to Twilio `<Say>`)
- ngrok or similar for local testing

### Installation

1. **Clone and navigate to project:**
   ```bash
   cd "/Users/matthewmakh/PycharmProjects/Pharmacy_Bot/pythonProject1/HIPPA Flow"
   ```

2. **Create virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables:**
   Create a `.env` file:
   ```env
   # Required
   OPENAI_API_KEY=sk-your-openai-key
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your-twilio-auth-token
   
   # Optional but recommended
   ELEVENLABS_API_KEY=your-elevenlabs-key
   ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
   
   # For call transfers
   TWILIO_PHARMACIST_NUMBER=+1234567890
   
   # When using ngrok locally
   BASE_URL=https://your-ngrok-url.ngrok.io
   ```

5. **Run the application:**
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

6. **Expose locally with ngrok:**
   ```bash
   ngrok http 8000
   ```

7. **Configure Twilio webhook:**
   - Go to your Twilio phone number settings
   - Set "A CALL COMES IN" webhook to: `https://your-ngrok-url.ngrok.io/voice/incoming`
   - Set method to `HTTP POST`

## 🧪 Testing

### Test the health endpoint:
```bash
curl http://localhost:8000/
```

### Test with Twilio:
Call your Twilio phone number and follow the bot's prompts.

### Check logs:
The application logs will show:
- Raw transcripts (PHI-bearing) - backend only
- Sanitized transcripts (tokens)
- Detected intents
- Node transitions

## 🔐 Security Considerations

### Current Implementation (Development)
- ✅ PHI sanitization before sending to external APIs
- ✅ In-memory session storage
- ✅ Validation checks on GPT input/output
- ⚠️ HTTP endpoints (use ngrok for testing)

### Production Recommendations

1. **HTTPS Everywhere**
   - Use proper SSL/TLS certificates
   - Never expose HTTP endpoints

2. **Persistent Storage**
   ```python
   # Replace in-memory SESSION_STORE with:
   # - Redis with encryption at rest
   # - PostgreSQL with encrypted columns
   # - AWS RDS with encryption enabled
   ```

3. **Authentication**
   - Add Twilio request validation
   - Verify webhook signatures
   - IP allowlisting

4. **Audit Logging**
   - Log all PHI access
   - Implement audit trails
   - Set up monitoring/alerts

5. **BAA Coverage**
   - Ensure Twilio BAA is signed
   - Verify your hosting provider offers HIPAA-compliant infrastructure
   - Document all PHI flows

6. **Access Controls**
   - Implement role-based access
   - Encrypt PHI at rest and in transit
   - Regular security audits

7. **Data Retention**
   - Define PHI retention policies
   - Implement automatic purging
   - Comply with HIPAA minimum necessary standard

## 🔄 Conversation Flow

The bot follows the conversation graph defined in `pharmacy_bland_flow.json`:

1. **Greeting** - Initial welcome
2. **Identity Confirmation** - Verify caller
3. **Address Confirmation** - Verify delivery address
4. **Medications Check** - Ask about other medications
5. **Contact Collection** - Get phone/email
6. **Insurance Info** - Offer secure upload link
7. **Preferences** - SMS notifications consent
8. **Wrap-up** - Thank and hang up

At any point, user can request transfer to pharmacist.

## 📝 Where to Plug In Production Services

### Database (models.py)
Replace `SESSION_STORE` dict with Redis:
```python
import redis
r = redis.Redis(host='localhost', port=6379, db=0)
# Store: r.set(f"session:{call_sid}", json.dumps(session))
# Retrieve: r.get(f"session:{call_sid}")
```

### Cloud Storage (tts_client.py)
Replace local file storage with S3:
```python
import boto3
s3 = boto3.client('s3')
# Upload: s3.put_object(Bucket='my-audio-bucket', Key=filename, Body=audio)
# URL: s3.generate_presigned_url('get_object', Params={'Bucket': '...', 'Key': filename})
```

### Monitoring
Add application performance monitoring (APM):
```python
# DataDog, New Relic, or Sentry
import sentry_sdk
sentry_sdk.init(dsn="your-sentry-dsn")
```

## 🐛 Troubleshooting

### "Import openai could not be resolved"
Make sure you're in the virtual environment and dependencies are installed:
```bash
source venv/bin/activate
pip install -r requirements.txt
```

### "Session not found"
Session storage is in-memory and resets on server restart. In production, use Redis or database.

### TTS audio not playing
- Verify `BASE_URL` in `.env` points to your public ngrok URL
- Check audio files are being created in `/tmp/pharmacy_bot_audio`
- Verify ElevenLabs API key is valid

### GPT not detecting intent correctly
- Check `app/gpt_client.py` system prompt
- Verify OpenAI API key is valid
- Review logs for sanitized transcripts sent to GPT

## 📚 Additional Resources

- [Twilio Voice Webhooks](https://www.twilio.com/docs/voice/twiml)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [ElevenLabs API Documentation](https://elevenlabs.io/docs)
- [HIPAA Compliance Guide](https://www.hhs.gov/hipaa/for-professionals/index.html)

## 📄 License

This is a reference implementation. Consult with legal and compliance teams before using in production with real PHI.

## 👥 Support

For questions or issues, please refer to the inline code comments or reach out to the development team.
