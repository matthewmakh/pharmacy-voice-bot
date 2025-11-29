#!/bin/bash

# Quick start script for HIPAA Pharmacy Voice Bot
# This script helps you set up and run the application locally

echo "🏥 HIPAA Pharmacy Voice Bot - Quick Start"
echo "=========================================="
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "📥 Installing dependencies..."
pip install -r requirements.txt

# Check for .env file
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found!"
    echo "📝 Creating .env from example..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your API keys:"
    echo "   - OPENAI_API_KEY"
    echo "   - ELEVENLABS_API_KEY"
    echo "   - TWILIO_ACCOUNT_SID"
    echo "   - TWILIO_AUTH_TOKEN"
    echo ""
    echo "Press Enter when ready to continue..."
    read
fi

# Create audio directory
echo "📁 Creating audio directory..."
mkdir -p /tmp/pharmacy_bot_audio

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 Starting server..."
echo ""
echo "📱 To test with Twilio:"
echo "   1. In another terminal, run: ngrok http 8000"
echo "   2. Copy the ngrok HTTPS URL"
echo "   3. Update BASE_URL in .env with the ngrok URL"
echo "   4. Configure Twilio webhook to: https://your-ngrok-url.ngrok.io/voice/incoming"
echo ""
echo "Starting uvicorn..."
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
