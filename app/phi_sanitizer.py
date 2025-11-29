"""
PHI Sanitization Module

This module is CRITICAL for HIPAA compliance.
It detects and replaces PHI in user transcripts before sending to external AI services.

Pattern:
1. User speaks → Twilio transcribes → we receive transcript (may contain PHI)
2. We detect and extract PHI using regex/heuristics
3. We store raw PHI in CallSession (backend only)
4. We replace PHI with tokens like [PHONE_NUMBER_PROVIDED]
5. Only sanitized text goes to GPT
"""
import re
from typing import Tuple, Dict, Any
from app.models import CallSession


# Regex patterns for common PHI
PHONE_PATTERN = re.compile(
    r'\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'
)

EMAIL_PATTERN = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
)

# Simple address pattern (street numbers + common street types)
ADDRESS_PATTERN = re.compile(
    r'\b\d+\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Circle|Cir)\b',
    re.IGNORECASE
)

# ZIP code pattern
ZIP_PATTERN = re.compile(r'\b\d{5}(?:-\d{4})?\b')

# Date patterns (MM/DD/YYYY, MM-DD-YYYY, etc)
DATE_PATTERN = re.compile(
    r'\b(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b'
)

# Insurance member ID patterns (alphanumeric sequences)
INSURANCE_ID_PATTERN = re.compile(
    r'\b(?:member|policy|id)?\s*(?:number)?\s*[A-Z0-9]{6,20}\b',
    re.IGNORECASE
)


def extract_and_sanitize_phi(
    transcript: str,
    session: CallSession,
    context_hint: str = ""
) -> Tuple[str, Dict[str, Any]]:
    """
    Extract PHI from transcript and return sanitized version.
    
    Args:
        transcript: Raw user speech transcript (may contain PHI)
        session: Current call session (to store extracted PHI)
        context_hint: Hint about what we're expecting (e.g., "collecting_address")
    
    Returns:
        Tuple of (sanitized_transcript, extracted_phi_dict)
    
    HIPAA Note:
    - This function processes PHI but keeps it in the backend
    - Extracted PHI is stored in session object (in-memory or database)
    - Sanitized output contains tokens instead of actual PHI
    - The sanitized output is safe to send to GPT/external AI
    """
    sanitized = transcript
    extracted_phi = {}
    
    # Extract phone numbers
    phone_matches = PHONE_PATTERN.findall(transcript)
    if phone_matches:
        extracted_phi["phone_numbers"] = phone_matches
        # Store in session if not already set
        if not session.raw_phone_number and phone_matches:
            session.raw_phone_number = phone_matches[0]
        # Replace in transcript
        for phone in phone_matches:
            sanitized = sanitized.replace(phone, "[PHONE_NUMBER_PROVIDED]")
    
    # Extract emails
    email_matches = EMAIL_PATTERN.findall(transcript)
    if email_matches:
        extracted_phi["emails"] = email_matches
        if not session.raw_email and email_matches:
            session.raw_email = email_matches[0]
        for email in email_matches:
            sanitized = sanitized.replace(email, "[EMAIL_PROVIDED]")
    
    # Extract addresses
    address_matches = ADDRESS_PATTERN.findall(transcript)
    if address_matches:
        extracted_phi["addresses"] = address_matches
        if not session.raw_address and address_matches:
            session.raw_address = address_matches[0]
        for addr in address_matches:
            sanitized = sanitized.replace(addr, "[ADDRESS_PROVIDED]")
    
    # Extract ZIP codes
    zip_matches = ZIP_PATTERN.findall(transcript)
    if zip_matches:
        extracted_phi["zip_codes"] = zip_matches
        for zip_code in zip_matches:
            sanitized = sanitized.replace(zip_code, "[ZIP_CODE_PROVIDED]")
    
    # Extract dates (could be DOB or other sensitive dates)
    date_matches = DATE_PATTERN.findall(transcript)
    if date_matches:
        extracted_phi["dates"] = date_matches
        for date in date_matches:
            sanitized = sanitized.replace(date, "[DATE_PROVIDED]")
    
    # Context-specific extraction
    if context_hint == "collecting_medications":
        # User is describing medications - treat entire response as PHI
        # Store raw text but sanitize for GPT
        if transcript.strip():
            session.raw_medications = transcript
            extracted_phi["medications_described"] = True
            sanitized = "[MEDICATIONS_DESCRIBED]"
    
    elif context_hint == "collecting_insurance":
        # Look for insurance IDs
        insurance_matches = INSURANCE_ID_PATTERN.findall(transcript)
        if insurance_matches:
            extracted_phi["insurance_ids"] = insurance_matches
            session.raw_insurance_info = transcript
            for ins_id in insurance_matches:
                sanitized = sanitized.replace(ins_id, "[INSURANCE_INFO_PROVIDED]")
        # Even if no pattern match, if context is insurance, be conservative
        if len(transcript.split()) > 3 and not extracted_phi:
            session.raw_insurance_info = transcript
            extracted_phi["insurance_info_described"] = True
            sanitized = "[INSURANCE_INFO_PROVIDED]"
    
    # TODO: Future improvements:
    # - Use a local NER model (e.g., spaCy with medical entities) to detect drug names
    # - Implement phonetic matching for common medication names
    # - Add ML-based PII detection as a secondary layer
    # - Integrate with a medical vocabulary (RxNorm) for medication detection
    
    return sanitized, extracted_phi


def is_phi_free(text: str) -> bool:
    """
    Quick check if text appears to be free of obvious PHI.
    Used as a safety check before sending to external AI.
    
    Returns False if potential PHI is detected.
    """
    # Check for patterns
    if PHONE_PATTERN.search(text):
        return False
    if EMAIL_PATTERN.search(text):
        return False
    if ADDRESS_PATTERN.search(text):
        return False
    if DATE_PATTERN.search(text):
        return False
    
    # Check for numeric sequences that might be IDs
    if re.search(r'\b\d{6,}\b', text):
        return False
    
    return True


def create_phi_free_summary(session: CallSession) -> str:
    """
    Create a PHI-free summary of the call session for GPT context.
    
    Returns:
        A string describing the call state without revealing PHI
    """
    summary_parts = []
    
    if session.identity_confirmed:
        summary_parts.append("Patient identity has been confirmed.")
    
    if session.raw_address:
        summary_parts.append("Address has been collected.")
    
    if session.raw_phone_number:
        summary_parts.append("Phone number has been collected.")
    
    if session.raw_email:
        summary_parts.append("Email address has been collected.")
    
    if session.raw_medications:
        summary_parts.append("Medication information has been collected.")
    
    if session.raw_insurance_info:
        summary_parts.append("Insurance information has been collected.")
    
    if session.wants_pharmacist_transfer:
        summary_parts.append("Patient has requested to speak with a pharmacist.")
    
    if not summary_parts:
        return "Call just started, no information collected yet."
    
    return " ".join(summary_parts)
