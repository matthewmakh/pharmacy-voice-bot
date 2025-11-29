# Testing Checklist

## Local Testing (Before Deployment)

### ✅ Test 1: Health Check
```bash
curl http://localhost:8000/
# Expected: {"status":"healthy","service":"HIPAA Pharmacy Voice Bot","version":"1.0.0"}
```

### ✅ Test 2: Conversation Flow Loaded
```bash
cd "/Users/matthewmakh/PycharmProjects/Pharmacy_Bot/pythonProject1/HIPPA Flow"
python -c "from app.conversation_engine import load_conversation_engine; engine = load_conversation_engine('pharmacy_bland_flow.json'); print(f'✅ Loaded {len(engine.nodes)} nodes and {len(engine.edges)} edges')"
```

### ✅ Test 3: API Keys Valid
```bash
python test_live_apis.py
# Should show all ✅ green checks
```

### ✅ Test 4: Live Call Test (with ngrok)
1. Start server: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
2. Start ngrok: `ngrok http 8000`
3. Update Twilio webhook to ngrok URL
4. Call your Twilio number
5. Check logs show:
   - 📍 Current Node
   - 👤 User Said
   - 🔒 Sanitized
   - 🎯 Intent detected
   - 🤖 Assistant reply
   - ➡️ Transitions

### ✅ Test 5: SMS Sending
When user agrees to provide insurance, check logs for:
```
💳 User agreed to provide insurance, sending SMS to +1XXX...
📱 SMS sent successfully! SID: SM...
✅ Insurance SMS sent successfully
```

## Railway Deployment Testing

### ✅ Test 1: Deployment Success
- Railway dashboard shows "Success" status
- View logs show "Application startup complete"

### ✅ Test 2: Health Check (Railway)
```bash
curl https://your-app.railway.app/
# Expected: {"status":"healthy"...}
```

### ✅ Test 3: Update Twilio
1. Go to Twilio Console → Phone Numbers
2. Update webhook to: `https://your-app.railway.app/voice/incoming`
3. Save

### ✅ Test 4: Production Call Test
Call your Twilio number and verify:
- [ ] Bot answers with greeting
- [ ] Conversation flows naturally
- [ ] PHI is sanitized (check Railway logs)
- [ ] Bot moves through nodes correctly
- [ ] SMS is sent when user agrees
- [ ] Audio plays clearly
- [ ] Call ends properly

### ✅ Test 5: Monitor Logs
In Railway dashboard:
- Click "View Logs"
- Watch for errors
- Verify PHI sanitization working
- Check transitions are correct

## Test Conversation Script

Call the number and follow this script:

**Bot**: "Hi, can I please speak with [patient_name]?"
**You**: "Yes, speaking" ✅ Should go to identity confirmation

**Bot**: "Thank you. My name is Sandra..."
**You**: "Sure, I have a moment" ✅ Should ask for address

**Bot**: "Would you mind confirming your current address?"
**You**: "123 Main Street, New York, 10001" ✅ Should sanitize address, ask about medications

**Bot**: "Are you taking any other medications?"
**You**: "No" ✅ Should ask about insurance card

**Bot**: "Do you have your primary insurance card handy?"
**You**: "Yes" ✅ Should offer to send link

**Bot**: "Would you be interested in sharing your insurance information?"
**You**: "Yes" ✅ **SHOULD SEND SMS IMMEDIATELY** 📱

**Bot**: "Perfect! I just sent you a text message..."
**You**: Check your phone for SMS ✅

**Bot**: Should continue to wrap up and end call

## Success Criteria

✅ All local tests pass
✅ Railway deployment successful
✅ Health endpoint responding
✅ Test call completes full flow
✅ PHI never sent to GPT/ElevenLabs (verify in logs)
✅ SMS sent successfully when user agrees
✅ Audio quality is good
✅ No errors in Railway logs

## Common Issues

### SMS Not Sending
- Check TWILIO_PHONE_NUMBER is set correctly in Railway
- Verify Twilio account has SMS capability
- Check Railway logs for error message

### Audio Not Playing
- Verify BASE_URL is set to Railway URL (not localhost)
- Check audio files are being generated (logs show "Generated TTS audio")
- Railway filesystem is ephemeral - files work but don't persist

### 502 Bad Gateway
- Check Railway logs for startup errors
- Verify all required env vars are set
- Ensure PORT is using $PORT (not hardcoded)

### Bot Gets Stuck in Loop
- Check conversation flow in pharmacy_bland_flow.json
- Verify edge conditions are triggering correctly
- Review GPT intent detection in logs

## Next Steps After Testing

1. **Set up monitoring** - Railway provides basic metrics
2. **Configure alerts** - Get notified of errors
3. **Review costs** - Monitor OpenAI, ElevenLabs, Twilio usage
4. **Update upload links** - Replace placeholder form URLs
5. **Security audit** - Review PHI handling
6. **Load testing** - Test with multiple simultaneous calls
7. **Backup plan** - Set up pharmacist transfer for issues
