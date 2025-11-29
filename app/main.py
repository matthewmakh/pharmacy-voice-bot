"""
Main FastAPI Application

HIPAA-Compliant Pharmacy Voice Bot

This application orchestrates:
1. Twilio voice webhooks (telephony)
2. Conversation engine (Bland JSON flow logic)
3. PHI sanitization (keeping sensitive data backend-only)
4. GPT for intent detection and responses (PHI-free)
5. ElevenLabs for TTS (PHI-free)

Architecture:
- Twilio → /voice/incoming → creates session → plays greeting → gathers speech
- Twilio → /voice/next → processes speech → sanitizes PHI → calls GPT → generates TTS → continues conversation
"""
from fastapi import FastAPI, Form, Request
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import logging

from app.config import settings
from app.models import get_session, create_session, save_session
from app.conversation_engine import load_conversation_engine
from app.phi_sanitizer import extract_and_sanitize_phi, create_phi_free_summary
from app.gpt_client import analyze_user_intent_and_reply
from app.tts_client import generate_tts_audio, get_audio_url
from app.sms_client import send_insurance_card_link, send_document_link
from app.twilio_utils import (
    generate_twiml_gather,
    generate_twiml_hangup,
    generate_twiml_transfer
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="HIPAA Pharmacy Voice Bot")

# Load conversation engine
conversation_engine = load_conversation_engine("pharmacy_bland_flow.json")

# Create audio directory
Path(settings.AUDIO_DIR).mkdir(parents=True, exist_ok=True)

# Mount audio directory for serving generated TTS files
app.mount("/audio", StaticFiles(directory=settings.AUDIO_DIR), name="audio")


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "HIPAA Pharmacy Voice Bot",
        "version": "1.0.0"
    }


@app.post("/voice/incoming")
async def voice_incoming(
    CallSid: str = Form(...),
    From: str = Form(...),
    To: str = Form(...)
):
    """
    Twilio webhook for incoming calls.
    
    This is called when a call first connects.
    Creates a new session and starts the conversation.
    
    HIPAA Note:
    - From number is PHI (caller's phone)
    - We store it in backend session only
    - Never send to GPT or ElevenLabs
    """
    logger.info(f"Incoming call: CallSid={CallSid}, From={From}")
    
    # Create new session
    session = create_session(call_sid=CallSid, from_number=From)
    
    # Get initial greeting from conversation engine (use start node)
    start_node_id = conversation_engine.start_node
    session.current_node_id = start_node_id
    greeting_prompt = conversation_engine.get_node_prompt(start_node_id)
    
    # Generate TTS for greeting (if configured)
    audio_filename = None
    try:
        audio_filename = generate_tts_audio(greeting_prompt, session.session_id)
    except Exception as e:
        logger.error(f"TTS generation failed: {e}")
    
    # Build audio URL if we have one
    audio_url = get_audio_url(audio_filename) if audio_filename else None
    
    # Generate TwiML response
    action_url = f"{settings.BASE_URL}/voice/next"
    twiml = generate_twiml_gather(
        message=greeting_prompt,
        action_url=action_url,
        audio_url=audio_url
    )
    
    # Add to sanitized history
    session.add_sanitized_exchange(greeting_prompt, "[WAITING_FOR_RESPONSE]")
    save_session(session)
    
    return Response(content=twiml, media_type="application/xml")


@app.post("/voice/next")
async def voice_next(
    CallSid: str = Form(...),
    SpeechResult: str = Form(None),
    Confidence: float = Form(None)
):
    """
    Twilio webhook for processing speech input.
    
    This is the main conversation loop:
    1. Receive user transcript from Twilio
    2. Sanitize PHI (extract and tokenize)
    3. Call GPT with sanitized input to get intent and reply
    4. Update conversation state
    5. Generate TTS for reply
    6. Return TwiML to continue conversation
    
    HIPAA Compliance:
    - SpeechResult may contain PHI
    - We sanitize before sending to GPT
    - Only PHI-free content goes to ElevenLabs
    """
    logger.info(f"Processing speech: CallSid={CallSid}")
    
    # Retrieve session
    session = get_session(CallSid)
    if not session:
        logger.error(f"Session not found for CallSid={CallSid}")
        return Response(
            content=generate_twiml_hangup("Sorry, I couldn't find your session. Please call back."),
            media_type="application/xml"
        )
    
    # Handle case where no speech was detected
    if not SpeechResult:
        logger.warning("No speech detected")
        twiml = generate_twiml_gather(
            message="I didn't hear anything. Could you please repeat that?",
            action_url=f"{settings.BASE_URL}/voice/next"
        )
        return Response(content=twiml, media_type="application/xml")
    
    # Log raw transcript (PHI-bearing) - backend only
    session.add_raw_transcript("user", SpeechResult)
    
    # CRITICAL: Sanitize PHI before sending to external AI
    context_hint = conversation_engine.get_node_context_hint(session.current_node_id)
    sanitized_transcript, extracted_phi = extract_and_sanitize_phi(
        SpeechResult,
        session,
        context_hint
    )
    
    # Get current node info for logging
    current_node = conversation_engine.get_node(session.current_node_id)
    current_node_name = current_node.get("data", {}).get("name", session.current_node_id) if current_node else session.current_node_id
    
    # Clear, formatted logging
    logger.info("=" * 80)
    logger.info(f"📍 CURRENT NODE: {current_node_name} (ID: {session.current_node_id})")
    logger.info(f"👤 USER SAID: \"{SpeechResult}\"")
    logger.info(f"🔒 SANITIZED: \"{sanitized_transcript}\"")
    if extracted_phi:
        logger.info(f"🚨 PHI EXTRACTED: {list(extracted_phi.keys())}")
    
    # Create PHI-free conversation summary
    phi_free_summary = create_phi_free_summary(session)
    
    # Get node prompt
    node_prompt = conversation_engine.get_node_prompt(session.current_node_id)
    
    # Call GPT to analyze intent and generate reply (PHI-free inputs only!)
    try:
        global_prompt = conversation_engine.get_global_prompt()
        
        gpt_result = analyze_user_intent_and_reply(
            sanitized_user_input=sanitized_transcript,
            current_node_id=session.current_node_id,
            node_prompt=node_prompt,
            conversation_summary=phi_free_summary,
            conversation_history=session.sanitized_history,
            global_system_prompt=global_prompt
        )
        
        user_intent = gpt_result["intent"]
        assistant_reply = gpt_result["reply"]
        
        logger.info(f"🎯 DETECTED INTENT: {user_intent}")
        logger.info(f"🤖 ASSISTANT REPLY: \"{assistant_reply}\"")
        
    except Exception as e:
        logger.error(f"❌ GPT analysis failed: {e}")
        assistant_reply = "I'm having trouble processing that. Let me transfer you to a pharmacist."
        user_intent = "wants_transfer"
    
    # Update session flags based on intent
    if user_intent in ["confirmed", "yes", "agreed"]:
        if "identity" in session.current_node_id.lower():
            session.identity_confirmed = True
        elif "address" in session.current_node_id.lower():
            session.address_confirmed = True
    
    if "transfer" in user_intent or "pharmacist" in user_intent:
        session.wants_pharmacist_transfer = True
    
    # Check if user agreed to provide insurance and send SMS immediately
    if user_intent == "interested":
        # Check if we're in the insurance question node
        if current_node_name and "insurance" in current_node_name.lower():
            # Send SMS with upload link
            logger.info(f"💳 User agreed to provide insurance, sending SMS to {session.raw_phone_number}")
            sms_sent = send_insurance_card_link(session.raw_phone_number)
            
            if sms_sent:
                # Update the assistant reply to confirm SMS was sent
                assistant_reply = "Perfect! I just sent you a text message with a secure link to upload your insurance card. You can do that whenever it's convenient for you."
                logger.info("✅ Insurance SMS sent successfully")
            else:
                assistant_reply = "Great! We'll send you a text message shortly with a link to upload your insurance card."
                logger.warning("⚠️  SMS send failed, but continuing conversation")
    
    # Add to sanitized history
    session.add_sanitized_exchange(assistant_reply, sanitized_transcript)
    
    # Determine next node
    session_flags = {
        "identity_confirmed": session.identity_confirmed,
        "address_confirmed": session.address_confirmed,
        "wants_transfer": session.wants_pharmacist_transfer,
        "user_requests_pharmacist": session.wants_pharmacist_transfer,
        "provided_info": "provided" in user_intent.lower(),
        "confirmed": user_intent in ["confirmed", "yes", "agreed"],
        "denied": user_intent in ["denied", "no", "disagreed"],
        "wrong_person": user_intent == "wrong_person",
        "can_help": user_intent == "can_help",
        "taking_medications": user_intent == "taking_medications",
        "no_medications": user_intent == "no_medications",
        "has_card": user_intent == "has_card",
        "no_card": user_intent == "no_card",
        "interested": user_intent == "interested",
        "not_interested": user_intent == "not_interested",
        "text": "text" in user_intent.lower() or "sms" in user_intent.lower(),
        "email": "email" in user_intent.lower(),
        "always": True
    }
    
    next_node_id, transition_reason = conversation_engine.find_next_node(
        session.current_node_id,
        user_intent,
        session_flags
    )
    
    next_node = conversation_engine.get_node(next_node_id)
    next_node_name = next_node.get("data", {}).get("name", next_node_id) if next_node else next_node_id
    
    logger.info(f"➡️  TRANSITION: {current_node_name} -> {next_node_name}")
    logger.info(f"   Condition: {transition_reason}")
    logger.info("=" * 80)
    
    session.previous_node_id = session.current_node_id
    session.current_node_id = next_node_id
    
    # Save updated session
    save_session(session)
    
    # Handle special nodes
    next_node = conversation_engine.get_node(next_node_id)
    
    # Transfer to pharmacist
    if next_node:
        node_type = next_node.get("type")
        node_data = next_node.get("data", {})
        
        # Check for Transfer Call type
        if node_type == "Transfer Call" or node_type == "transfer":
            transfer_number = node_data.get("transferNumber", settings.TWILIO_PHARMACIST_NUMBER)
            if transfer_number:
                twiml = generate_twiml_transfer(transfer_number, assistant_reply)
            else:
                twiml = generate_twiml_hangup(
                    "I'd like to transfer you, but no pharmacist number is configured. Please call back."
                )
            return Response(content=twiml, media_type="application/xml")
        
        # End call
        if node_type == "End Call" or node_type == "end":
            twiml = generate_twiml_hangup(assistant_reply)
            return Response(content=twiml, media_type="application/xml")
    
    # Continue conversation - generate TTS for assistant reply
    audio_filename = None
    try:
        audio_filename = generate_tts_audio(assistant_reply, session.session_id)
    except Exception as e:
        logger.error(f"❌ TTS generation failed: {e}")
    
    audio_url = get_audio_url(audio_filename) if audio_filename else None
    
    # Prepare message for Twilio
    # If we moved to a new node, add the new node's prompt
    # If we stayed on same node and GPT didn't follow the prompt well, use the node prompt
    if next_node_id != session.previous_node_id:
        next_prompt = conversation_engine.get_node_prompt(next_node_id)
        # Only append if the assistant reply doesn't already contain the question
        if len(next_prompt) > 50 and next_prompt[:50].lower() not in assistant_reply.lower():
            combined_message = f"{assistant_reply} {next_prompt}"
        else:
            combined_message = assistant_reply
    else:
        # Stayed on same node - might need to re-ask the question
        node_name = current_node_name.lower()
        if "question" in node_name or "ask" in node_name:
            # This is a question node - make sure we ask the question from the prompt
            question_prompt = conversation_engine.get_node_prompt(next_node_id)
            # Extract just the question part (after "Question:")
            if "Question:" in question_prompt:
                question_text = question_prompt.split("Question:")[1].split("\n\n")[0].strip()
                combined_message = f"{assistant_reply} {question_text}"
            else:
                combined_message = assistant_reply
        else:
            combined_message = assistant_reply
    
    # Generate TwiML to continue conversation
    action_url = f"{settings.BASE_URL}/voice/next"
    twiml = generate_twiml_gather(
        message=combined_message,
        action_url=action_url,
        audio_url=audio_url
    )
    
    return Response(content=twiml, media_type="application/xml")


@app.get("/audio/{filename}")
async def serve_audio(filename: str):
    """
    Serve generated TTS audio files.
    
    Note: FastAPI StaticFiles middleware is already mounted,
    but this explicit route provides better logging.
    """
    audio_path = Path(settings.AUDIO_DIR) / filename
    if audio_path.exists():
        return FileResponse(audio_path, media_type="audio/mpeg")
    else:
        return Response(content="Audio file not found", status_code=404)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True
    )
