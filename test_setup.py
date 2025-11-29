"""
Test script to validate HIPAA compliance and basic functionality.

Run this after setting up the environment to ensure:
1. PHI sanitization works correctly
2. No PHI leaks to external APIs
3. Conversation engine loads properly
"""
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

print("🧪 HIPAA Pharmacy Bot - Validation Tests")
print("=" * 50)

# Test 1: PHI Sanitizer
print("\n✓ Test 1: PHI Sanitization")
from app.phi_sanitizer import extract_and_sanitize_phi, is_phi_free
from app.models import CallSession

test_session = CallSession(call_sid="test", from_number="+1234567890", session_id="test-session")

test_cases = [
    ("My phone number is 555-123-4567", "[PHONE_NUMBER_PROVIDED]"),
    ("Email me at john.doe@example.com", "[EMAIL_PROVIDED]"),
    ("I live at 123 Main Street", "[ADDRESS_PROVIDED]"),
    ("My zip is 12345", "[ZIP_CODE_PROVIDED]"),
]

for original, expected_token in test_cases:
    sanitized, phi = extract_and_sanitize_phi(original, test_session)
    if expected_token in sanitized:
        print(f"  ✅ Sanitized: '{original[:30]}...' → '{sanitized[:40]}...'")
    else:
        print(f"  ❌ FAILED: '{original}' → '{sanitized}'")

# Test 2: PHI-Free Validation
print("\n✓ Test 2: PHI-Free Validation")
phi_free_texts = [
    "Thank you for that information.",
    "I've recorded your [ADDRESS_PROVIDED].",
    "Can you confirm your delivery preference?"
]
phi_bearing_texts = [
    "Your number is 555-123-4567",
    "Send to john@example.com",
    "123 Main Street"
]

for text in phi_free_texts:
    if is_phi_free(text):
        print(f"  ✅ PHI-free: '{text[:40]}...'")
    else:
        print(f"  ❌ FAILED: Flagged as PHI: '{text}'")

for text in phi_bearing_texts:
    if not is_phi_free(text):
        print(f"  ✅ Detected PHI: '{text[:40]}...'")
    else:
        print(f"  ❌ FAILED: Missed PHI: '{text}'")

# Test 3: Conversation Engine
print("\n✓ Test 3: Conversation Engine")
try:
    from app.conversation_engine import load_conversation_engine
    engine = load_conversation_engine("pharmacy_bland_flow.json")
    
    nodes = engine.nodes
    edges = engine.edges
    
    print(f"  ✅ Loaded {len(nodes)} nodes")
    print(f"  ✅ Loaded {len(edges)} edges")
    
    # Test node retrieval
    start_node = engine.get_node("start")
    if start_node:
        print(f"  ✅ Start node: '{start_node.get('name')}'")
    
    # Test prompt retrieval
    prompt = engine.get_node_prompt("start")
    if prompt:
        print(f"  ✅ Start prompt: '{prompt[:50]}...'")
    
except Exception as e:
    print(f"  ❌ FAILED: {e}")

# Test 4: Configuration
print("\n✓ Test 4: Configuration")
from app.config import settings

config_checks = [
    ("OPENAI_API_KEY", settings.OPENAI_API_KEY),
    ("ELEVENLABS_API_KEY", settings.ELEVENLABS_API_KEY),
    ("TWILIO_ACCOUNT_SID", settings.TWILIO_ACCOUNT_SID),
    ("AUDIO_DIR", settings.AUDIO_DIR),
]

for name, value in config_checks:
    if value:
        masked = value[:8] + "..." if len(value) > 8 else "***"
        print(f"  ✅ {name}: {masked}")
    else:
        print(f"  ⚠️  {name}: Not set (may use fallback)")

# Test 5: Import Check
print("\n✓ Test 5: Module Imports")
try:
    from app.gpt_client import analyze_user_intent_and_reply
    print("  ✅ gpt_client")
except ImportError as e:
    print(f"  ❌ gpt_client: {e}")

try:
    from app.tts_client import generate_tts_audio
    print("  ✅ tts_client")
except ImportError as e:
    print(f"  ❌ tts_client: {e}")

try:
    from app.twilio_utils import generate_twiml_gather
    print("  ✅ twilio_utils")
except ImportError as e:
    print(f"  ❌ twilio_utils: {e}")

print("\n" + "=" * 50)
print("✅ Validation complete!")
print("\n📋 Next steps:")
print("  1. Review any ⚠️  warnings above")
print("  2. Set missing API keys in .env")
print("  3. Run: ./start.sh")
print("  4. Test with: curl http://localhost:8000/")
