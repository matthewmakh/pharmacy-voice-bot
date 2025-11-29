# 🚀 Getting Started Checklist

Use this checklist to get your HIPAA Pharmacy Voice Bot up and running.

## ✅ Pre-Flight Checklist

### 1. System Requirements
- [ ] Python 3.9 or higher installed
- [ ] Terminal/command line access
- [ ] Text editor (VS Code, vim, etc.)
- [ ] Internet connection

### 2. API Accounts & Keys
- [ ] **OpenAI Account** 
  - Sign up at https://platform.openai.com/
  - Generate API key
  - Add payment method (GPT-4 access)
  
- [ ] **Twilio Account**
  - Sign up at https://www.twilio.com/
  - Purchase a phone number with Voice capability
  - Get Account SID and Auth Token from console
  
- [ ] **ElevenLabs Account** (Optional but recommended)
  - Sign up at https://elevenlabs.io/
  - Generate API key
  - Note: Will fall back to Twilio `<Say>` if not provided

### 3. Local Tools
- [ ] **ngrok** (for local testing)
  - Download from https://ngrok.com/
  - Sign up for free account
  - Install and authenticate

---

## 📦 Installation Steps

### Step 1: Navigate to Project
```bash
cd "/Users/matthewmakh/PycharmProjects/Pharmacy_Bot/pythonProject1/HIPPA Flow"
```
- [ ] Confirmed in correct directory

### Step 2: Create Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```
- [ ] Virtual environment created
- [ ] Virtual environment activated (prompt shows `(venv)`)

### Step 3: Install Dependencies
```bash
pip install -r requirements.txt
```
- [ ] All packages installed without errors
- [ ] Verify with: `pip list`

### Step 4: Configure Environment
```bash
cp .env.example .env
nano .env  # Or use your preferred editor
```

Edit `.env` and add your API keys:
```env
OPENAI_API_KEY=sk-proj-your-actual-key-here
ELEVENLABS_API_KEY=your-elevenlabs-key-here
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-twilio-auth-token-here
TWILIO_PHARMACIST_NUMBER=+1234567890
```

- [ ] All API keys added to `.env`
- [ ] File saved

### Step 5: Test Setup
```bash
python test_setup.py
```
- [ ] All tests pass (green checkmarks)
- [ ] No critical errors shown

---

## 🏃 Running the Application

### Step 6: Start the Server
```bash
# Option A: Use convenience script
./start.sh

# Option B: Run manually
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
- [ ] Server starts without errors
- [ ] See: "Application startup complete"
- [ ] Access http://localhost:8000 in browser
- [ ] Health check returns: `{"status": "healthy"}`

### Step 7: Expose with ngrok
**Open a NEW terminal window/tab**, keep server running in first terminal.

```bash
ngrok http 8000
```

- [ ] ngrok starts successfully
- [ ] Note the HTTPS URL (e.g., `https://abc123.ngrok.io`)
- [ ] Copy this URL

### Step 8: Update BASE_URL
In your `.env` file, update:
```env
BASE_URL=https://your-ngrok-url.ngrok.io
```

- [ ] BASE_URL updated in `.env`
- [ ] Restart server (Ctrl+C, then `./start.sh` again)

---

## 📞 Twilio Configuration

### Step 9: Configure Twilio Webhook
1. Go to https://console.twilio.com/
2. Navigate to: Phone Numbers → Manage → Active numbers
3. Click on your phone number
4. Scroll to "Voice & Fax" section
5. Under "A CALL COMES IN":
   - Select "Webhook"
   - Enter: `https://your-ngrok-url.ngrok.io/voice/incoming`
   - Select "HTTP POST"
6. Click "Save"

- [ ] Webhook URL configured
- [ ] Set to HTTP POST
- [ ] Configuration saved

---

## 🧪 Testing

### Step 10: Test the System

**Terminal Check:**
```bash
# Check server logs in terminal 1
# You should see: "Application startup complete"
```
- [ ] Server running without errors

**Health Check:**
```bash
curl http://localhost:8000/
```
Expected response:
```json
{"status":"healthy","service":"HIPAA Pharmacy Voice Bot","version":"1.0.0"}
```
- [ ] Health check passes

**Phone Test:**
1. Call your Twilio phone number from your mobile phone
2. Listen for the greeting
3. Respond to the prompts
4. Watch server logs for:
   - Raw transcripts
   - Sanitized transcripts (with tokens like [PHONE_NUMBER_PROVIDED])
   - Detected intents
   - Node transitions

- [ ] Call connects successfully
- [ ] Greeting plays
- [ ] Bot responds to your speech
- [ ] Conversation flows naturally
- [ ] Can request pharmacist transfer (if configured)
- [ ] Call ends gracefully

---

## 🐛 Troubleshooting

### Issue: "Import could not be resolved"
**Solution:** Activate virtual environment and reinstall
```bash
source venv/bin/activate
pip install -r requirements.txt
```

### Issue: "Session not found"
**Solution:** Sessions are in-memory. If server restarts, sessions are lost. This is expected in development.

### Issue: "No audio playing"
**Checklist:**
- [ ] BASE_URL in `.env` matches ngrok URL exactly
- [ ] Audio directory exists: `/tmp/pharmacy_bot_audio`
- [ ] ElevenLabs API key is valid
- [ ] Check server logs for TTS generation errors

### Issue: "Call doesn't connect"
**Checklist:**
- [ ] Twilio webhook URL is correct
- [ ] ngrok is still running (doesn't expire)
- [ ] Server is running and accessible
- [ ] Webhook is set to HTTP POST

### Issue: "GPT errors"
**Checklist:**
- [ ] OpenAI API key is valid
- [ ] Account has GPT-4 access
- [ ] Check server logs for specific error
- [ ] System will fall back to deterministic logic

---

## 📊 Verify HIPAA Compliance

### Step 11: Check PHI Sanitization

Make a test call and say something like:
- "My phone number is 555-123-4567"
- "Email me at test@example.com"

In server logs, verify you see:
```
Raw transcript (PHI): My phone number is 555-123-4567
Sanitized transcript: My phone number is [PHONE_NUMBER_PROVIDED]
```

- [ ] PHI detected and replaced with tokens
- [ ] Raw PHI appears in backend logs only
- [ ] Sanitized version sent to GPT (check logs)
- [ ] No actual PHI in GPT requests

---

## ✅ Success Criteria

You're ready to develop when:
- [x] Server runs without errors
- [x] Health check returns successful response
- [x] Phone call connects to Twilio number
- [x] Bot greeting plays
- [x] Bot responds to your speech
- [x] PHI sanitization working (check logs)
- [x] Conversation flows through multiple nodes
- [x] Can end call gracefully

---

## 📚 Next Steps

### For Development:
- [ ] Review `ARCHITECTURE.md` to understand system design
- [ ] Read inline code comments in `app/` files
- [ ] Modify `pharmacy_bland_flow.json` to customize conversation
- [ ] Test different scenarios (transfer, wrong person, etc.)

### For Production:
- [ ] Review `PROJECT_SUMMARY.md` production checklist
- [ ] Replace in-memory sessions with Redis
- [ ] Deploy to cloud (AWS, GCP, Azure)
- [ ] Enable HTTPS with proper certificates
- [ ] Add Twilio signature validation
- [ ] Set up monitoring and logging
- [ ] Conduct security audit
- [ ] Sign BAAs with all vendors

---

## 🆘 Need Help?

1. **Check the logs** - Most issues are visible in server output
2. **Run test_setup.py** - Validates configuration
3. **Review documentation:**
   - `README.md` - Full documentation
   - `QUICKSTART.md` - Quick reference
   - `ARCHITECTURE.md` - System design
   - `PROJECT_SUMMARY.md` - Complete overview
4. **Check code comments** - Every file has detailed explanations

---

## 🎉 You're Ready!

Once all checkboxes above are complete, you have a working HIPAA-compliant pharmacy voice bot!

**Remember:**
- This is a development setup
- PHI is protected but in-memory only
- For production, follow the Production Checklist in PROJECT_SUMMARY.md
- Always verify PHI sanitization is working before handling real patient data

**Happy building! 🏥🤖**
