# HIPAA Pharmacy Bot - Quick Reference

## 🚀 Quick Start Commands

```bash
# Setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your API keys

# Run locally
uvicorn app.main:app --reload --port 8000

# Or use the convenience script
./start.sh

# Test setup
python test_setup.py

# Expose with ngrok
ngrok http 8000
```

## 📞 Twilio Configuration

1. Get your ngrok URL: `https://abc123.ngrok.io`
2. Update `.env`: `BASE_URL=https://abc123.ngrok.io`
3. In Twilio Console → Phone Numbers → Your Number:
   - Voice & Fax → A CALL COMES IN
   - Webhook: `https://abc123.ngrok.io/voice/incoming`
   - HTTP POST

## 🔐 HIPAA Rules Summary

### ✅ PHI Can Go To:
- **Twilio** (covered by BAA)
- **Your Backend** (this app + database)

### ❌ PHI Never Goes To:
- **OpenAI GPT** (only sanitized text)
- **ElevenLabs** (only PHI-free TTS)

### 🛡️ How It Works:
```
User Speech → Twilio → Backend
                         ↓
                    [PHI Sanitizer]
                         ↓
                    Store PHI locally
                         ↓
                    Replace with tokens
                         ↓
                    GPT (sanitized only) → Intent
                         ↓
                    Generate PHI-free reply
                         ↓
                    ElevenLabs (PHI-free) → Audio
                         ↓
                    Twilio → User
```

## 📊 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/voice/incoming` | POST | Initial call webhook |
| `/voice/next` | POST | Speech processing loop |
| `/audio/{filename}` | GET | Serve TTS audio files |

## 🔍 Debugging

### Check logs:
```bash
# Server logs show:
# - Raw transcripts (PHI) - backend only
# - Sanitized transcripts
# - Detected intents
# - Node transitions
```

### Common issues:

**"Session not found"**
- Sessions are in-memory, lost on restart
- Use Redis in production

**"No audio playing"**
- Check BASE_URL matches ngrok URL
- Verify audio files in /tmp/pharmacy_bot_audio
- Check ElevenLabs API key

**"GPT not detecting intent"**
- Review sanitized transcript in logs
- Check OpenAI API key
- Verify PHI was properly sanitized

## 📁 Key Files

| File | Purpose |
|------|---------|
| `app/main.py` | FastAPI app & webhooks |
| `app/models.py` | CallSession (stores PHI) |
| `app/phi_sanitizer.py` | **CRITICAL** - PHI detection |
| `app/gpt_client.py` | OpenAI wrapper (enforces no PHI) |
| `app/tts_client.py` | ElevenLabs wrapper (enforces no PHI) |
| `app/conversation_engine.py` | Bland flow interpreter |
| `pharmacy_bland_flow.json` | Conversation graph |

## 🎯 Testing Locally

```bash
# Terminal 1: Start server
./start.sh

# Terminal 2: Start ngrok
ngrok http 8000

# Terminal 3: Test health
curl http://localhost:8000/

# Then call your Twilio number from a phone
```

## 🔧 Environment Variables

Required:
- `OPENAI_API_KEY` - GPT API key
- `TWILIO_ACCOUNT_SID` - Twilio account
- `TWILIO_AUTH_TOKEN` - Twilio auth

Optional:
- `ELEVENLABS_API_KEY` - TTS (falls back to Twilio <Say>)
- `TWILIO_PHARMACIST_NUMBER` - Transfer target
- `BASE_URL` - Public URL for Twilio callbacks

## 📝 Conversation Flow Nodes

1. **start** → Greeting
2. **confirm_identity** → Ask for name
3. **confirm_address** → Verify address
4. **collect_medications** → Other meds check
5. **collect_contact** → Phone/email
6. **collect_insurance** → Insurance upload
7. **confirm_preferences** → SMS consent
8. **transfer_to_pharmacist** → Human handoff
9. **end_call** → Goodbye

## 🚨 Production Checklist

- [ ] Replace in-memory sessions with Redis/DB
- [ ] Enable HTTPS everywhere
- [ ] Add Twilio signature validation
- [ ] Implement audit logging
- [ ] Set up monitoring (Sentry, DataDog)
- [ ] Configure data retention policies
- [ ] Sign BAAs with Twilio
- [ ] Security audit
- [ ] HIPAA compliance review
- [ ] Encrypt PHI at rest

## 📞 Support

Questions? Check:
1. Inline code comments
2. `README.md`
3. `test_setup.py` output
4. Server logs
