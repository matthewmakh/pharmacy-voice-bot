# Railway Deployment Guide

## Quick Deploy to Railway

### Step 1: Prepare Your Repository

1. Initialize git if not already done:
```bash
cd "/Users/matthewmakh/PycharmProjects/Pharmacy_Bot/pythonProject1/HIPPA Flow"
git init
git add .
git commit -m "Initial commit - HIPAA Pharmacy Voice Bot"
```

2. Create a GitHub repository and push:
```bash
# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/pharmacy-voice-bot.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your `pharmacy-voice-bot` repository
4. Railway will auto-detect Python and deploy

### Step 3: Configure Environment Variables

In Railway dashboard, go to your project → Variables, and add:

**Required:**
```
OPENAI_API_KEY=your-openai-key-here
ELEVENLABS_API_KEY=your-elevenlabs-key-here
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
```

**Auto-set by Railway:**
```
PORT=8000
HOST=0.0.0.0
```

**Set after deployment:**
```
BASE_URL=https://your-app.railway.app
```

**Optional:**
```
TWILIO_PHARMACIST_NUMBER=+17248173271
INSURANCE_UPLOAD_LINK=https://forms.gle/your-insurance-form
DOCUMENT_UPLOAD_LINK=https://forms.gle/your-document-form
OPENAI_MODEL=gpt-4
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
AUDIO_DIR=/tmp/pharmacy_bot_audio
```

### Step 4: Get Your Railway URL

1. After deployment, Railway will give you a URL like: `https://pharmacy-voice-bot-production.up.railway.app`
2. Copy this URL
3. Go back to Variables and update `BASE_URL` to your Railway URL

### Step 5: Configure Twilio Webhooks

1. Go to [Twilio Console](https://console.twilio.com)
2. Navigate to Phone Numbers → Active Numbers
3. Click your number: `+1 (724) 817-3271`
4. Under "Voice Configuration":
   - **A CALL COMES IN**: Webhook
   - **URL**: `https://your-app.railway.app/voice/incoming`
   - **HTTP**: POST
5. Save

### Step 6: Test!

Call your Twilio number: `+1 (724) 817-3271`

## Monitoring

### View Logs
```bash
# In Railway dashboard, click "View Logs"
# Or use Railway CLI:
railway logs
```

### Health Check
```bash
curl https://your-app.railway.app/
# Should return: {"status":"healthy","service":"HIPAA Pharmacy Voice Bot","version":"1.0.0"}
```

## Troubleshooting

### 502 Bad Gateway
- Check logs for startup errors
- Verify all environment variables are set
- Ensure PORT is not hardcoded (use $PORT)

### Twilio Can't Reach Webhook
- Verify BASE_URL is set to your Railway URL
- Check health endpoint works
- Ensure Railway app is running (not sleeping)

### Audio Files Not Playing
- Railway provides ephemeral filesystem - audio files work but are temporary
- For production, consider using S3 or similar for audio storage

### App Sleeping/Cold Starts
- Railway free tier may sleep after inactivity
- Upgrade to Hobby plan ($5/month) for always-on service

## Cost Estimates

**Railway:**
- Hobby Plan: $5/month (recommended for production)
- Includes: 500 hours, 8GB RAM, always-on

**APIs:**
- OpenAI: ~$0.03 per conversation (GPT-4)
- ElevenLabs: ~$0.10-0.30 per minute of audio
- Twilio: ~$0.0085 per minute + $1/month per number

**Example:**
- 100 calls/month @ 3 min each = ~$20-30 total

## Production Checklist

- [ ] Environment variables set in Railway
- [ ] BASE_URL updated to Railway URL
- [ ] Twilio webhooks configured
- [ ] Test call successful
- [ ] Insurance upload form link configured
- [ ] Pharmacist transfer number set
- [ ] Monitoring/alerting set up
- [ ] Review logs for any errors
- [ ] Test PHI sanitization working
- [ ] Verify SMS sending works
