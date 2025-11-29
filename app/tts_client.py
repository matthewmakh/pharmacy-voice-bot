"""
ElevenLabs TTS Client

Generates speech audio from text using ElevenLabs API.

HIPAA Compliance:
- This module MUST only receive PHI-free text
- Never send patient names, addresses, medications, etc to ElevenLabs
- All text is validated before sending
"""
import os
import requests
import hashlib
from pathlib import Path
from typing import Optional
from app.config import settings
from app.phi_sanitizer import is_phi_free


def generate_tts_audio(text: str, session_id: str) -> Optional[str]:
    """
    Generate TTS audio using ElevenLabs API.
    
    Args:
        text: PHI-free text to convert to speech
        session_id: Call session ID (for naming the audio file)
    
    Returns:
        Path to generated audio file (relative to audio directory)
        None if generation failed
    
    HIPAA Compliance:
    - Text MUST be PHI-free before calling this function
    - Function validates text doesn't contain obvious PHI
    - If PHI detected, raises an error instead of sending to ElevenLabs
    """
    
    # CRITICAL: Validate text is PHI-free
    if not is_phi_free(text):
        raise ValueError(
            "HIPAA VIOLATION PREVENTED: Text contains potential PHI and cannot be sent to ElevenLabs. "
            f"Text: {text[:100]}"
        )
    
    if not settings.ELEVENLABS_API_KEY:
        # Fallback to Twilio <Say> - return None to signal this
        print("WARNING: No ElevenLabs API key configured, will use Twilio <Say> instead")
        return None
    
    # Create audio directory if it doesn't exist
    audio_dir = Path(settings.AUDIO_DIR)
    audio_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate unique filename based on text hash
    text_hash = hashlib.md5(text.encode()).hexdigest()[:8]
    filename = f"{session_id}_{text_hash}.mp3"
    filepath = audio_dir / filename
    
    # Check if already generated (cache)
    if filepath.exists():
        return filename
    
    # ElevenLabs API endpoint
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{settings.ELEVENLABS_VOICE_ID}"
    
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": settings.ELEVENLABS_API_KEY
    }
    
    data = {
        "text": text,
        "model_id": "eleven_turbo_v2_5",  # Faster model
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }
    
    try:
        response = requests.post(url, json=data, headers=headers, timeout=10)
        
        if response.status_code == 200:
            # Save audio file
            with open(filepath, 'wb') as f:
                f.write(response.content)
            
            print(f"Generated TTS audio: {filename}")
            return filename
        else:
            print(f"ElevenLabs API error: {response.status_code} - {response.text}")
            return None
    
    except Exception as e:
        print(f"Error generating TTS: {e}")
        return None


def get_audio_url(filename: str) -> str:
    """
    Get the public URL for a generated audio file.
    
    Args:
        filename: Name of the audio file
    
    Returns:
        Full URL that Twilio can access to play the audio
    """
    return f"{settings.BASE_URL}/audio/{filename}"


def cleanup_old_audio(max_age_hours: int = 2):
    """
    Clean up old audio files to prevent disk fill-up.
    
    Args:
        max_age_hours: Delete files older than this many hours
    
    TODO: In production, consider:
    - Running this as a scheduled background task
    - Using cloud storage (S3) with automatic expiration
    - Implementing proper audio file lifecycle management
    """
    import time
    
    audio_dir = Path(settings.AUDIO_DIR)
    if not audio_dir.exists():
        return
    
    max_age_seconds = max_age_hours * 3600
    current_time = time.time()
    
    deleted_count = 0
    for audio_file in audio_dir.glob("*.mp3"):
        file_age = current_time - audio_file.stat().st_mtime
        if file_age > max_age_seconds:
            try:
                audio_file.unlink()
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting {audio_file}: {e}")
    
    if deleted_count > 0:
        print(f"Cleaned up {deleted_count} old audio files")
