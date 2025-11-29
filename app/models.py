"""
Data models for the pharmacy voice bot.
Contains CallSession and related data structures.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime


@dataclass
class CallSession:
    """
    Represents a single call session with a patient.
    
    HIPAA Compliance Note:
    - This object DOES contain PHI (raw_* fields)
    - It is stored only in backend memory/database
    - PHI fields are NEVER sent to GPT or ElevenLabs
    - Only sanitized/tokenized versions are sent to external AI services
    """
    
    # Twilio identifiers
    call_sid: str
    from_number: str  # Caller's phone (PHI)
    
    # Internal tracking
    session_id: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    
    # Conversation state
    current_node_id: str = "start"
    previous_node_id: Optional[str] = None
    
    # PHI data collected during the call (stored locally, never sent to AI)
    patient_id: Optional[str] = None  # Our internal ID (not PHI if properly anonymized)
    raw_address: Optional[str] = None
    raw_phone_number: Optional[str] = None
    raw_email: Optional[str] = None
    raw_medications: Optional[str] = None
    raw_insurance_info: Optional[str] = None
    
    # Non-PHI flags and metadata
    identity_confirmed: bool = False
    address_confirmed: bool = False
    wants_pharmacist_transfer: bool = False
    consent_given: bool = False
    
    # Conversation history (sanitized - PHI removed/tokenized)
    # Format: [{"role": "assistant", "content": "..."}, {"role": "user", "content": "[sanitized]"}]
    sanitized_history: List[Dict[str, str]] = field(default_factory=list)
    
    # Raw transcripts (PHI-bearing) - kept for backend logging/audit only
    raw_transcripts: List[Dict[str, str]] = field(default_factory=list)
    
    def add_raw_transcript(self, speaker: str, text: str) -> None:
        """Add a raw transcript entry (may contain PHI)."""
        self.raw_transcripts.append({
            "timestamp": datetime.utcnow().isoformat(),
            "speaker": speaker,
            "text": text
        })
    
    def add_sanitized_exchange(self, assistant_msg: str, user_msg: str) -> None:
        """Add sanitized conversation exchange to history."""
        self.sanitized_history.append({"role": "assistant", "content": assistant_msg})
        self.sanitized_history.append({"role": "user", "content": user_msg})


# In-memory session store
# TODO: Replace with Redis or database for production
# Example Redis replacement:
#   - Use redis-py with JSON serialization
#   - Store sessions with TTL (e.g., 1 hour)
#   - Key format: f"call_session:{call_sid}"
SESSION_STORE: Dict[str, CallSession] = {}


def get_session(call_sid: str) -> Optional[CallSession]:
    """Retrieve a call session by Twilio CallSid."""
    return SESSION_STORE.get(call_sid)


def save_session(session: CallSession) -> None:
    """Save or update a call session."""
    SESSION_STORE[session.call_sid] = session


def create_session(call_sid: str, from_number: str) -> CallSession:
    """Create a new call session."""
    import uuid
    session = CallSession(
        call_sid=call_sid,
        from_number=from_number,
        session_id=str(uuid.uuid4())
    )
    save_session(session)
    return session
