#!/bin/bash
# Quick deployment script for Railway

echo "🚀 Pharmacy Voice Bot - Railway Deployment"
echo "=========================================="
echo ""

# Check if git is initialized
if [ ! -d .git ]; then
    echo "📦 Initializing git repository..."
    git init
    git add .
    git commit -m "Initial commit - HIPAA Pharmacy Voice Bot"
else
    echo "✅ Git repository already initialized"
fi

echo ""
echo "Next steps:"
echo ""
echo "1. Create a GitHub repository at: https://github.com/new"
echo "   Name it: pharmacy-voice-bot"
echo ""
echo "2. Push your code:"
echo "   git remote add origin https://github.com/YOUR_USERNAME/pharmacy-voice-bot.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "3. Deploy on Railway:"
echo "   • Go to https://railway.app"
echo "   • Click 'New Project' → 'Deploy from GitHub repo'"
echo "   • Select 'pharmacy-voice-bot'"
echo "   • Railway will auto-deploy!"
echo ""
echo "4. Configure environment variables in Railway dashboard"
echo "   See DEPLOYMENT.md for full list"
echo ""
echo "5. Update Twilio webhook to your Railway URL:"
echo "   https://your-app.railway.app/voice/incoming"
echo ""
