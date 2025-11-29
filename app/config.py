"""
Configuration settings for the HIPAA-compliant pharmacy voice bot.
Reads API keys and settings from environment variables.
"""
import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Load .env file
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class Settings:
    """Application settings loaded from environment variables."""
    
    # Third-party API keys - REQUIRED
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    
    # Runtime configuration (Railway sets PORT automatically)
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    # Audio storage directory (must be accessible for serving via FastAPI)
    AUDIO_DIR: str = os.getenv("AUDIO_DIR", "/tmp/pharmacy_bot_audio")
    
    # Twilio phone number for transferring to live pharmacist
    TWILIO_PHARMACIST_NUMBER: Optional[str] = os.getenv("TWILIO_PHARMACIST_NUMBER")
    
    # Twilio phone number for sending SMS (usually same as the one receiving calls)
    TWILIO_PHONE_NUMBER: str = os.getenv("TWILIO_PHONE_NUMBER", "")
    
    # Document upload links
    INSURANCE_UPLOAD_LINK: Optional[str] = os.getenv("INSURANCE_UPLOAD_LINK", "https://forms.gle/insurance-upload")
    DOCUMENT_UPLOAD_LINK: Optional[str] = os.getenv("DOCUMENT_UPLOAD_LINK", "https://forms.gle/document-upload")
    
    # OpenAI model configuration
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4")
    
    # ElevenLabs voice ID (optional - will use default if not set)
    ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    
    # Base URL for serving audio files (must be publicly accessible for Twilio)
    # In production, this should be your domain; locally use ngrok URL
    BASE_URL: str = os.getenv("BASE_URL", "http://localhost:8000")


settings = Settings()
