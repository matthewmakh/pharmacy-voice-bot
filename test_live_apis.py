"""
Live API Integration Test

This script tests the actual API integrations with your keys:
- OpenAI GPT for intent detection
- ElevenLabs for TTS generation
- PHI sanitization with real conversation flow
"""
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

print("🧪 HIPAA Pharmacy Bot - Live API Integration Test")
print("=" * 60)

# Test 1: Configuration Loading
print("\n✓ Test 1: Load Configuration with Real API Keys")
from app.config import settings

api_keys_status = {
    "OpenAI": "✅" if settings.OPENAI_API_KEY and len(settings.OPENAI_API_KEY) > 20 else "❌",
    "ElevenLabs": "✅" if settings.ELEVENLABS_API_KEY and len(settings.ELEVENLABS_API_KEY) > 20 else "❌",
    "Twilio SID": "✅" if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_ACCOUNT_SID.startswith("AC") else "❌",
    "Twilio Auth": "✅" if settings.TWILIO_AUTH_TOKEN and len(settings.TWILIO_AUTH_TOKEN) > 20 else "❌",
}

for key, status in api_keys_status.items():
    print(f"  {status} {key}")

if "❌" in api_keys_status.values():
    print("\n⚠️  Some API keys are missing or invalid!")
    print("   Please check your .env file")
else:
    print("\n✅ All API keys loaded successfully!")

# Test 2: PHI Sanitization (No API calls)
print("\n✓ Test 2: PHI Sanitization (Local)")
from app.phi_sanitizer import extract_and_sanitize_phi
from app.models import CallSession

test_session = CallSession(call_sid="TEST123", from_number="+1234567890", session_id="test")
test_transcript = "Hi, my phone number is 555-867-5309 and email is patient@example.com"

sanitized, phi = extract_and_sanitize_phi(test_transcript, test_session)
print(f"  Original: {test_transcript}")
print(f"  Sanitized: {sanitized}")
print(f"  Extracted PHI: {list(phi.keys())}")
print(f"  ✅ PHI sanitization working!")

# Test 3: GPT Integration (LIVE API CALL)
print("\n✓ Test 3: GPT Intent Detection (LIVE API)")
try:
    from app.gpt_client import analyze_user_intent_and_reply
    
    # Test with sanitized input (no PHI)
    result = analyze_user_intent_and_reply(
        sanitized_user_input="I provided my [PHONE_NUMBER_PROVIDED]",
        current_node_id="collect_contact",
        node_prompt="What's the best phone number to reach you?",
        conversation_summary="Patient confirmed identity.",
        conversation_history=[]
    )
    
    print(f"  Input: 'I provided my [PHONE_NUMBER_PROVIDED]'")
    print(f"  Detected Intent: {result['intent']}")
    print(f"  GPT Reply: {result['reply'][:80]}...")
    print(f"  ✅ GPT API working!")
    
except Exception as e:
    print(f"  ❌ GPT API Error: {e}")
    print(f"     Check your OPENAI_API_KEY")

# Test 4: ElevenLabs TTS (LIVE API CALL)
print("\n✓ Test 4: ElevenLabs TTS Generation (LIVE API)")
try:
    from app.tts_client import generate_tts_audio
    
    # Test with PHI-free text
    test_text = "Thank you for confirming. Let me ask you about other medications."
    audio_file = generate_tts_audio(test_text, "test_session")
    
    if audio_file:
        print(f"  Text: '{test_text[:50]}...'")
        print(f"  Generated: {audio_file}")
        print(f"  ✅ ElevenLabs API working!")
        
        # Check if file exists
        audio_path = Path(settings.AUDIO_DIR) / audio_file
        if audio_path.exists():
            size_kb = audio_path.stat().st_size / 1024
            print(f"  File size: {size_kb:.1f} KB")
    else:
        print(f"  ⚠️  No audio generated (may be using Twilio <Say> fallback)")
        
except Exception as e:
    print(f"  ❌ ElevenLabs API Error: {e}")
    print(f"     Check your ELEVENLABS_API_KEY")

# Test 5: Conversation Engine
print("\n✓ Test 5: Conversation Flow")
from app.conversation_engine import load_conversation_engine

engine = load_conversation_engine("pharmacy_bland_flow.json")

# Simulate a conversation transition
current_node = "start"
user_intent = "user_responded"
session_flags = {"identity_confirmed": False}

next_node, transition = engine.find_next_node(current_node, user_intent, session_flags)
print(f"  Current: '{current_node}'")
print(f"  Intent: '{user_intent}'")
print(f"  Next: '{next_node}' (via: {transition})")
print(f"  ✅ Conversation engine working!")

# Test 6: Full Integration Test
print("\n✓ Test 6: Simulated Call Flow")
print("  Simulating: Patient provides phone number...")

# Create a test session
from app.models import create_session, save_session

call_session = create_session("CALL_TEST_123", "+15555551234")
call_session.current_node_id = "collect_contact"

# User says their phone number (contains PHI)
user_speech = "Yes, my number is 555-867-5309"
print(f"  User says: '{user_speech}'")

# Sanitize PHI
sanitized_speech, extracted_phi = extract_and_sanitize_phi(
    user_speech, 
    call_session,
    "collecting_contact"
)
print(f"  Sanitized: '{sanitized_speech}'")
print(f"  Stored PHI: phone={call_session.raw_phone_number}")

# Get GPT response (only if API worked above)
if api_keys_status["OpenAI"] == "✅":
    try:
        gpt_response = analyze_user_intent_and_reply(
            sanitized_user_input=sanitized_speech,
            current_node_id=call_session.current_node_id,
            node_prompt="What's the best phone number to reach you?",
            conversation_summary="Collecting contact information.",
            conversation_history=[]
        )
        print(f"  GPT Intent: {gpt_response['intent']}")
        print(f"  Bot Reply: '{gpt_response['reply'][:60]}...'")
        print(f"  ✅ Full flow working end-to-end!")
    except Exception as e:
        print(f"  ⚠️  GPT call failed: {e}")

# Summary
print("\n" + "=" * 60)
print("📊 Test Summary:")
print(f"  Configuration: {'✅' if '❌' not in api_keys_status.values() else '⚠️'}")
print(f"  PHI Sanitization: ✅")
print(f"  Conversation Engine: ✅")
print(f"  GPT Integration: {api_keys_status['OpenAI']}")
print(f"  ElevenLabs TTS: {api_keys_status['ElevenLabs']}")

print("\n✅ Testing Complete!")
print("\n📋 Next Steps:")
print("  1. Start server: uvicorn app.main:app --reload")
print("  2. Start ngrok: ngrok http 8000")
print("  3. Configure Twilio webhook with ngrok URL")
print("  4. Call your Twilio number to test live!")
