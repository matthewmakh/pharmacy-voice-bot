"""
Twilio Utilities

Helper functions for generating TwiML responses and working with Twilio webhooks.
"""
from typing import Optional


def generate_twiml_gather(
    message: str,
    action_url: str,
    audio_url: Optional[str] = None,
    use_say_fallback: bool = True
) -> str:
    """
    Generate TwiML that plays a message and gathers speech input.
    
    Args:
        message: Text message (used for <Say> fallback)
        action_url: URL Twilio should POST to with speech results
        audio_url: Optional URL to MP3 audio file from ElevenLabs
        use_say_fallback: Whether to use <Say> if no audio_url
    
    Returns:
        TwiML XML string
    """
    twiml_parts = ['<?xml version="1.0" encoding="UTF-8"?>']
    twiml_parts.append('<Response>')
    
    # Start Gather
    twiml_parts.append(
        f'<Gather input="speech" '
        f'action="{action_url}" '
        f'method="POST" '
        f'speechTimeout="auto" '
        f'language="en-US">'
    )
    
    # Play audio or use Say
    if audio_url:
        twiml_parts.append(f'<Play>{audio_url}</Play>')
    elif use_say_fallback:
        # Escape message for XML
        safe_message = message.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        twiml_parts.append(f'<Say>{safe_message}</Say>')
    
    twiml_parts.append('</Gather>')
    
    # Fallback if no input received
    twiml_parts.append('<Say>I didn\'t receive any input. Goodbye.</Say>')
    twiml_parts.append('<Hangup/>')
    
    twiml_parts.append('</Response>')
    
    return '\n'.join(twiml_parts)


def generate_twiml_say(message: str) -> str:
    """
    Generate simple TwiML with just a Say element.
    
    Args:
        message: Text to speak
    
    Returns:
        TwiML XML string
    """
    safe_message = message.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>{safe_message}</Say>
</Response>"""


def generate_twiml_transfer(phone_number: str, message: str = "Transferring you now.") -> str:
    """
    Generate TwiML to transfer call to a phone number.
    
    Args:
        phone_number: Phone number to transfer to (E.164 format)
        message: Optional message before transfer
    
    Returns:
        TwiML XML string
    """
    safe_message = message.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>{safe_message}</Say>
    <Dial>{phone_number}</Dial>
</Response>"""


def generate_twiml_hangup(message: str = "Thank you for calling. Goodbye!") -> str:
    """
    Generate TwiML to say goodbye and hang up.
    
    Args:
        message: Farewell message
    
    Returns:
        TwiML XML string
    """
    safe_message = message.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>{safe_message}</Say>
    <Hangup/>
</Response>"""


def generate_twiml_play(audio_url: str, next_action_url: Optional[str] = None) -> str:
    """
    Generate TwiML to play audio and optionally continue to next action.
    
    Args:
        audio_url: URL to audio file
        next_action_url: Optional URL to redirect to after playback
    
    Returns:
        TwiML XML string
    """
    twiml_parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>']
    twiml_parts.append(f'<Play>{audio_url}</Play>')
    
    if next_action_url:
        twiml_parts.append(f'<Redirect method="POST">{next_action_url}</Redirect>')
    else:
        twiml_parts.append('<Hangup/>')
    
    twiml_parts.append('</Response>')
    
    return '\n'.join(twiml_parts)
