"""
GPT Client Wrapper

This module provides a HIPAA-compliant wrapper around OpenAI's GPT API.

CRITICAL RULES:
1. NEVER send PHI to GPT
2. Only send sanitized transcripts (with tokens like [PHONE_NUMBER_PROVIDED])
3. Only send PHI-free conversation context
4. GPT's output must also be PHI-free (we enforce this by instruction)

GPT's role:
- Analyze sanitized user input
- Determine user intent (yes/no/provided info/wants transfer/etc)
- Generate appropriate PHI-free assistant responses
"""
from typing import Dict, Any, List, Optional
from openai import OpenAI
from app.config import settings
from app.phi_sanitizer import is_phi_free


# Configure OpenAI client
client = OpenAI(api_key=settings.OPENAI_API_KEY)


def analyze_user_intent_and_reply(
    sanitized_user_input: str,
    current_node_id: str,
    node_prompt: str,
    conversation_summary: str,
    conversation_history: List[Dict[str, str]],
    global_system_prompt: str = ""
) -> Dict[str, str]:
    """
    Use GPT to analyze user intent and generate assistant reply.
    
    Args:
        sanitized_user_input: User transcript with PHI replaced by tokens
        current_node_id: Current conversation node
        node_prompt: The prompt/question associated with current node
        conversation_summary: PHI-free summary of what's been collected
        conversation_history: List of sanitized conversation exchanges
        global_system_prompt: Global prompt from flow configuration
    
    Returns:
        Dict with:
        - "intent": detected user intent (e.g., "confirmed", "denied", "provided_info")
        - "reply": PHI-free assistant response
    
    HIPAA Compliance:
    - All inputs must be PHI-free (checked by is_phi_free)
    - GPT is instructed to never generate PHI
    - Output is validated before returning
    """
    
    # Safety check: ensure no PHI in inputs
    if not is_phi_free(sanitized_user_input):
        raise ValueError("ERROR: PHI detected in input to GPT! This is a HIPAA violation.")
    
    if not is_phi_free(conversation_summary):
        raise ValueError("ERROR: PHI detected in conversation summary! This is a HIPAA violation.")
    
    # Build the system prompt - use global prompt if available
    if global_system_prompt:
        base_instructions = global_system_prompt
    else:
        base_instructions = """You are a warm, friendly, and professional voice assistant. 
Your job is to help callers with clear and conversational responses during a phone call.

You call pharmacy customers to confirm their delivery. This can include things like their address, medications, delivery time, etc.

Don't speak too slowly.

This is a phone call, do not use exclamation marks.

You respond naturally — not too formal, not too casual. Your tone is confident, calm, and empathetic."""
    
    system_prompt = base_instructions + """

CRITICAL HIPAA RULES:
- You will NEVER see or generate real PHI (names, addresses, phone numbers, emails, medications, insurance info)
- User input has been sanitized - PHI is replaced with tokens like [PHONE_NUMBER_PROVIDED] or [ADDRESS_PROVIDED]
- You must NEVER generate actual PHI in your responses
- Use generic acknowledgments like "Thank you, I've recorded that" instead of repeating back PHI

Your tasks:
1. Analyze the user's response and determine their intent
2. Generate an appropriate, helpful assistant reply that moves the conversation forward
3. Keep replies natural, brief, and professional

Common intents:
- "confirmed" / "yes" / "agreed" - user confirmed something
- "denied" / "no" / "disagreed" - user denied or said no
- "provided_info" - user provided requested information
- "wants_transfer" - user wants to speak with a human/pharmacist
- "unclear" - user response was ambiguous
- "off_topic" - user said something unrelated
- "wrong_person" - wrong person answered or not available
- "can_help" - person who answered can help even if not the target person
- "taking_medications" - user mentioned taking other medications
- "no_medications" - user is not taking other medications
- "has_card" - user has insurance card available
- "no_card" - user doesn't have insurance card
- "interested" - user is interested in the offer
- "not_interested" - user declined the offer

Output format:
Return a JSON object with:
{"intent": "detected_intent_here", "reply": "your PHI-free response here"}
"""
    
    # Build conversation context
    context_messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history (last 4 exchanges max)
    recent_history = conversation_history[-8:] if len(conversation_history) > 8 else conversation_history
    context_messages.extend(recent_history)
    
    # Add current context
    context_messages.append({
        "role": "system",
        "content": f"""Current situation:
- Node: {current_node_id}
- Node type/purpose: {node_prompt[:200]}...
- What we've collected so far: {conversation_summary}
- User just said (sanitized): {sanitized_user_input}

IMPORTANT: The node prompt describes what you should ask or say. Follow it closely. If it's asking a yes/no question, keep your response focused on that question. Don't jump ahead or ask for details before getting the yes/no answer.

Please analyze the user's intent and provide your response."""
    })
    
    try:
        # Call GPT
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=context_messages,
            temperature=0.7,
            max_tokens=200
        )
        
        result_text = response.choices[0].message.content
        
        # Parse JSON response
        import json
        result = json.loads(result_text)
        
        intent = result.get("intent", "unclear")
        reply = result.get("reply", "I understand. Let me help you with that.")
        
        # Validate reply is PHI-free
        if not is_phi_free(reply):
            # If GPT accidentally generated PHI, use a safe fallback
            reply = "Thank you for that information. Let me continue."
        
        return {
            "intent": intent,
            "reply": reply
        }
    
    except Exception as e:
        # Fallback if GPT fails
        print(f"WARNING: GPT call failed: {e}")
        return _fallback_intent_and_reply(sanitized_user_input, node_prompt)


def _fallback_intent_and_reply(
    sanitized_input: str,
    node_prompt: str
) -> Dict[str, str]:
    """
    Deterministic fallback when GPT is unavailable.
    Uses simple keyword matching.
    """
    input_lower = sanitized_input.lower()
    
    # Detect transfer requests
    if any(word in input_lower for word in ["pharmacist", "human", "person", "transfer", "speak to", "talk to"]):
        return {
            "intent": "wants_transfer",
            "reply": "I'll connect you with a pharmacist right away. Please hold."
        }
    
    # Detect confirmations
    if any(word in input_lower for word in ["yes", "yeah", "correct", "right", "confirm", "yep", "sure"]):
        return {
            "intent": "confirmed",
            "reply": f"Great, thank you. {node_prompt}"
        }
    
    # Detect denials
    if any(word in input_lower for word in ["no", "nope", "wrong", "incorrect", "not right"]):
        return {
            "intent": "denied",
            "reply": "I understand. Let me clarify that for you."
        }
    
    # Detect info provided
    if any(token in sanitized_input for token in ["[", "PROVIDED]", "DESCRIBED]"]):
        return {
            "intent": "provided_info",
            "reply": f"Thank you for providing that information. {node_prompt}"
        }
    
    # Default
    return {
        "intent": "unclear",
        "reply": "I'm sorry, I didn't quite catch that. Could you please repeat?"
    }
