"""
Conversation Engine

Loads and interprets the Bland AI flow JSON to drive the conversation.
This module treats the JSON as a state machine graph:
- Nodes represent conversation states
- Edges represent transitions based on user intent
- Prompts guide what the assistant should say/ask

The engine maintains conversation state and determines:
1. What node we're in
2. What to say next (based on node prompt and context)
3. Which edge to follow (based on user response/intent)
"""
import json
from typing import Dict, Any, Optional, List, Tuple
from pathlib import Path


class ConversationEngine:
    """
    Manages conversation flow based on Bland AI JSON structure.
    
    This engine:
    - Loads the flow definition from JSON
    - Tracks current node/state
    - Determines transitions based on user intent
    - Provides PHI-free prompts for the assistant
    """
    
    def __init__(self, flow_file_path: str):
        """
        Initialize the conversation engine.
        
        Args:
            flow_file_path: Path to pharmacy_bland_flow.json
        """
        self.flow_file_path = flow_file_path
        self.flow_data = self._load_flow()
        self.global_config = {}
        self.nodes = self._parse_nodes()
        self.edges = self._parse_edges()
        self.start_node = self._find_start_node()
    
    def _load_flow(self) -> Dict[str, Any]:
        """Load the Bland flow JSON file."""
        flow_path = Path(self.flow_file_path)
        if not flow_path.exists():
            # Return a minimal default flow if file doesn't exist
            return self._create_default_flow()
        
        with open(flow_path, 'r') as f:
            return json.load(f)
    
    def _create_default_flow(self) -> Dict[str, Any]:
        """
        Create a default flow structure if no JSON file exists.
        This represents a basic pharmacy call flow.
        """
        return {
            "nodes": [
                {
                    "id": "start",
                    "name": "Greeting",
                    "type": "message",
                    "prompt": "Hello! This is an automated call from the pharmacy regarding your prescription. May I confirm I'm speaking with the right person?",
                    "data": {
                        "collect": "identity_confirmation"
                    }
                },
                {
                    "id": "confirm_identity",
                    "name": "Identity Confirmation",
                    "type": "input",
                    "prompt": "To confirm your identity, can you please state your full name?",
                    "data": {
                        "extract": ["name"],
                        "validation": "identity"
                    }
                },
                {
                    "id": "confirm_address",
                    "name": "Address Confirmation",
                    "type": "input",
                    "prompt": "Thank you. Can you please confirm your delivery address?",
                    "data": {
                        "extract": ["address"],
                        "collect": "address"
                    }
                },
                {
                    "id": "collect_medications",
                    "name": "Other Medications",
                    "type": "input",
                    "prompt": "Are you currently taking any other medications or supplements that we should know about?",
                    "data": {
                        "extract": ["medications"],
                        "collect": "medications"
                    }
                },
                {
                    "id": "collect_contact",
                    "name": "Contact Information",
                    "type": "input",
                    "prompt": "What's the best phone number and email to reach you?",
                    "data": {
                        "extract": ["phone", "email"],
                        "collect": "contact_info"
                    }
                },
                {
                    "id": "collect_insurance",
                    "name": "Insurance Information",
                    "type": "input",
                    "prompt": "We can send you a secure link to upload your insurance card. Would you prefer to receive that link via text or email?",
                    "data": {
                        "extract": ["insurance_preference"],
                        "collect": "insurance"
                    }
                },
                {
                    "id": "transfer_to_pharmacist",
                    "name": "Transfer Request",
                    "type": "transfer",
                    "prompt": "I'll connect you with a pharmacist right away. Please hold.",
                    "data": {
                        "action": "transfer"
                    }
                },
                {
                    "id": "end_call",
                    "name": "Call Completion",
                    "type": "end",
                    "prompt": "Thank you for your time. Your prescription will be processed and delivered soon. Have a great day!",
                    "data": {
                        "action": "hangup"
                    }
                }
            ],
            "edges": [
                {
                    "from": "start",
                    "to": "confirm_identity",
                    "condition": "user_responded",
                    "priority": 1
                },
                {
                    "from": "confirm_identity",
                    "to": "confirm_address",
                    "condition": "identity_confirmed",
                    "priority": 1
                },
                {
                    "from": "confirm_identity",
                    "to": "end_call",
                    "condition": "wrong_person",
                    "priority": 2
                },
                {
                    "from": "confirm_address",
                    "to": "collect_medications",
                    "condition": "address_confirmed",
                    "priority": 1
                },
                {
                    "from": "collect_medications",
                    "to": "collect_contact",
                    "condition": "info_provided",
                    "priority": 1
                },
                {
                    "from": "collect_contact",
                    "to": "collect_insurance",
                    "condition": "contact_provided",
                    "priority": 1
                },
                {
                    "from": "collect_insurance",
                    "to": "end_call",
                    "condition": "completed",
                    "priority": 1
                },
                {
                    "from": "*",
                    "to": "transfer_to_pharmacist",
                    "condition": "user_requests_pharmacist",
                    "priority": 10
                }
            ]
        }
    
    def _parse_nodes(self) -> Dict[str, Dict[str, Any]]:
        """Parse nodes from flow data into a lookup dict."""
        nodes = {}
        for node in self.flow_data.get("nodes", []):
            # Handle both old and new JSON formats
            node_id = node.get("id")
            if node_id:
                nodes[node_id] = node
            # Check for global config
            if "globalConfig" in node:
                self.global_config = node["globalConfig"]
        return nodes
    
    def _parse_edges(self) -> List[Dict[str, Any]]:
        """Parse edges from flow data."""
        edges = self.flow_data.get("edges", [])
        # Normalize edges to use consistent 'from' and 'to' keys
        normalized = []
        for edge in edges:
            # Extract label from data object if present
            edge_data = edge.get("data", {})
            label = edge.get("label", edge_data.get("label", ""))
            
            # Try to infer condition from label
            condition = edge.get("condition", "")
            priority = edge.get("priority", 5)
            
            if not condition and label:
                # Convert label to a condition key
                label_lower = label.lower()
                if "wrong person" in label_lower:
                    condition = "wrong_person"
                    priority = 1  # Higher priority for specific conditions
                elif "no idea" in label_lower or "wrong number" in label_lower:
                    condition = "wrong_number"
                    priority = 1
                elif "hang up" in label_lower:
                    condition = "always"
                    priority = 10  # Lower priority for always
                elif "user responded" in label_lower or "user wants" in label_lower:
                    condition = "always"
                    priority = 10
                elif "confirmed" in label_lower or "identity" in label_lower:
                    condition = "confirmed"
                    priority = 1
                elif "taking" in label_lower and "medication" in label_lower:
                    condition = "taking_medications"
                    priority = 1
                elif "no" in label_lower and "medication" in label_lower:
                    condition = "no_medications"
                    priority = 1
                elif "has" in label_lower and "card" in label_lower:
                    condition = "has_card"
                    priority = 1
                elif "no" in label_lower and "card" in label_lower:
                    condition = "no_card"
                    priority = 1
                elif "agrees" in label_lower or "user agrees" in label_lower:
                    condition = "interested"
                    priority = 1
                elif "denies" in label_lower or "user denies" in label_lower or "declined" in label_lower:
                    condition = "not_interested"
                    priority = 1
                elif "text" in label_lower:
                    condition = "text"
                    priority = 1
                elif "email" in label_lower:
                    condition = "email"
                    priority = 1
                elif "can help" in label_lower:
                    condition = "can_help"
                    priority = 1
                else:
                    condition = "always"
                    priority = 10
            
            if not condition:
                condition = "always"
                priority = 10
            
            normalized_edge = {
                "from": edge.get("source", edge.get("from")),
                "to": edge.get("target", edge.get("to")),
                "condition": condition,
                "label": label,
                "priority": priority
            }
            normalized.append(normalized_edge)
        return normalized
    
    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        """Get a node by ID."""
        return self.nodes.get(node_id)
    
    def _find_start_node(self) -> str:
        """Find the starting node (marked with isStart=true or id='1')."""
        for node_id, node in self.nodes.items():
            data = node.get("data", {})
            if data.get("isStart"):
                return node_id
            if node_id == "1":
                return node_id
        # Fallback to first node
        return list(self.nodes.keys())[0] if self.nodes else "start"
    
    def get_global_prompt(self) -> str:
        """Get the global system prompt."""
        return self.global_config.get("globalPrompt", "")
    
    def get_node_prompt(self, node_id: str) -> str:
        """Get the prompt/message for a given node."""
        node = self.get_node(node_id)
        if not node:
            return "I'm here to help you with your prescription. How can I assist?"
        
        data = node.get("data", {})
        # Try 'prompt' first, then 'text'
        prompt = data.get("prompt", data.get("text", node.get("prompt", "")))
        return prompt
    
    def get_node_context_hint(self, node_id: str) -> str:
        """
        Get context hint for PHI sanitizer based on node type.
        
        Returns a hint like "collecting_medications" or "collecting_address"
        to help the sanitizer know what kind of PHI to expect.
        """
        node = self.get_node(node_id)
        if not node:
            return ""
        
        data = node.get("data", {})
        collect_type = data.get("collect", "")
        
        if collect_type == "medications":
            return "collecting_medications"
        elif collect_type == "insurance":
            return "collecting_insurance"
        elif collect_type == "address":
            return "collecting_address"
        elif collect_type == "contact_info":
            return "collecting_contact"
        
        return ""
    
    def find_next_node(
        self,
        current_node_id: str,
        user_intent: str,
        session_flags: Dict[str, bool]
    ) -> Tuple[str, str]:
        """
        Determine the next node based on current node and user intent.
        
        Args:
            current_node_id: Current conversation node
            user_intent: Detected intent from user response
            session_flags: Dict of boolean flags (identity_confirmed, etc)
        
        Returns:
            Tuple of (next_node_id, transition_reason)
        """
        # Check for universal transitions (like transfer request)
        for edge in self.edges:
            if edge["from"] == "*" and self._matches_condition(edge["condition"], user_intent, session_flags):
                return edge["to"], edge["condition"]
        
        # Find edges from current node, sorted by priority
        candidate_edges = [
            e for e in self.edges 
            if e["from"] == current_node_id
        ]
        candidate_edges.sort(key=lambda e: e.get("priority", 999))
        
        # Return first matching edge
        for edge in candidate_edges:
            if self._matches_condition(edge["condition"], user_intent, session_flags):
                return edge["to"], edge["condition"]
        
        # Default: stay on current node
        return current_node_id, "no_transition"
    
    def _matches_condition(
        self,
        condition: str,
        user_intent: str,
        session_flags: Dict[str, bool]
    ) -> bool:
        """
        Check if an edge condition is satisfied.
        
        Args:
            condition: Edge condition string
            user_intent: User's detected intent
            session_flags: Session state flags
        
        Returns:
            True if condition is met
        """
        # Always transitions (default path)
        if condition == "always":
            return True
        
        # Direct intent match
        if condition == user_intent:
            return True
        
        # Check session flags
        if condition in session_flags and session_flags[condition]:
            return True
        
        # Fuzzy matching for common patterns
        intent_lower = user_intent.lower()
        condition_lower = condition.lower()
        
        # Transfer/pharmacist requests
        if "transfer" in condition_lower or "pharmacist" in condition_lower:
            if any(word in intent_lower for word in ["transfer", "pharmacist", "human", "agent", "person"]):
                return True
        
        # Confirmations
        if any(word in condition_lower for word in ["confirm", "yes", "agreed", "correct"]):
            if any(word in intent_lower for word in ["yes", "confirm", "correct", "agreed", "right", "yep", "yeah", "sure"]):
                return True
        
        # Denials
        if any(word in condition_lower for word in ["deny", "no", "wrong", "declined"]):
            if any(word in intent_lower for word in ["no", "incorrect", "wrong", "denied", "nope", "not_interested"]):
                return True
        
        # Wrong person handling
        if "wrong" in condition_lower and "person" in condition_lower:
            if "wrong_person" in intent_lower or "not_available" in intent_lower:
                return True
        
        # Can help (person willing to assist)
        if "can_help" in condition_lower or "willing" in condition_lower:
            if "can_help" in intent_lower or "willing" in intent_lower:
                return True
        
        # Medication-related
        if "taking" in condition_lower and "medication" in condition_lower:
            if "taking_medications" in intent_lower or ("yes" in intent_lower and "medication" in condition_lower):
                return True
        
        if "no" in condition_lower and "medication" in condition_lower:
            if "no_medications" in intent_lower or ("no" in intent_lower and "medication" in condition_lower):
                return True
        
        # Insurance card availability
        if "has_card" in condition_lower or "have" in condition_lower:
            if "has_card" in intent_lower or ("yes" in intent_lower and "card" in condition_lower):
                return True
        
        if "no_card" in condition_lower or ("no" in condition_lower and "card" in condition_lower):
            if "no_card" in intent_lower or ("no" in intent_lower and "card" in condition_lower):
                return True
        
        # Interest/agreement
        if "interested" in condition_lower and "not" not in condition_lower:
            if "interested" in intent_lower or "agreed" in intent_lower:
                return True
        
        if "not_interested" in condition_lower or "declined" in condition_lower:
            if "not_interested" in intent_lower or "declined" in intent_lower:
                return True
        
        # Preference detection (text vs email)
        if "text" in condition_lower:
            if "text" in intent_lower or "sms" in intent_lower:
                return True
        
        if "email" in condition_lower:
            if "email" in intent_lower:
                return True
        
        return False
    
    def get_assistant_reply_template(
        self,
        node_id: str,
        user_intent: str,
        phi_collected: Dict[str, bool]
    ) -> str:
        """
        Generate a PHI-free assistant reply template.
        
        Args:
            node_id: Current node
            user_intent: User's detected intent
            phi_collected: Dict indicating which PHI fields have been collected
        
        Returns:
            A PHI-free string the assistant should say
        """
        node = self.get_node(node_id)
        if not node:
            return "I understand. Let me help you with that."
        
        prompt = node.get("prompt", "")
        
        # Add acknowledgment based on intent
        if "provided" in user_intent or "collected" in user_intent:
            acknowledgments = [
                "Thank you for providing that information.",
                "Got it, I've recorded that.",
                "Perfect, thank you."
            ]
            import random
            ack = random.choice(acknowledgments)
            return f"{ack} {prompt}"
        
        return prompt


def load_conversation_engine(flow_path: str = "pharmacy_bland_flow.json") -> ConversationEngine:
    """
    Factory function to load the conversation engine.
    
    Args:
        flow_path: Path to the Bland flow JSON file
    
    Returns:
        Initialized ConversationEngine instance
    """
    return ConversationEngine(flow_path)
