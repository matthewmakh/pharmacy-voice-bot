"""
Twilio SMS Client

Sends SMS messages via Twilio API for document collection.
"""
from twilio.rest import Client
from app.config import settings
import logging

logger = logging.getLogger(__name__)


def send_insurance_card_link(to_phone_number: str) -> bool:
    """
    Send an SMS with a link to upload insurance card.
    
    Args:
        to_phone_number: Phone number to send to (E.164 format)
    
    Returns:
        True if sent successfully, False otherwise
    """
    try:
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        
        # You can customize this link to point to your actual upload form
        upload_link = settings.INSURANCE_UPLOAD_LINK or "https://forms.gle/your-insurance-upload-form"
        
        message_body = (
            "Hi from A.V. Chemist Pharmacy! "
            "Please use this secure link to upload a photo of the front and back of your insurance card: "
            f"{upload_link}\n\n"
            "This helps us process your medications faster. Thank you!"
        )
        
        message = client.messages.create(
            body=message_body,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=to_phone_number
        )
        
        logger.info(f"📱 SMS sent successfully! SID: {message.sid}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to send SMS: {e}")
        return False


def send_document_link(to_phone_number: str, document_type: str = "insurance card") -> bool:
    """
    Send a generic document upload link via SMS.
    
    Args:
        to_phone_number: Phone number to send to (E.164 format)
        document_type: Type of document to request
    
    Returns:
        True if sent successfully, False otherwise
    """
    try:
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        
        upload_link = settings.DOCUMENT_UPLOAD_LINK or "https://forms.gle/your-upload-form"
        
        message_body = (
            f"Hi from A.V. Chemist Pharmacy! "
            f"Please use this secure link to upload your {document_type}: "
            f"{upload_link}\n\n"
            "Thank you!"
        )
        
        message = client.messages.create(
            body=message_body,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=to_phone_number
        )
        
        logger.info(f"📱 SMS sent successfully! SID: {message.sid} to {to_phone_number}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to send SMS: {e}")
        return False
