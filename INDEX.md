# 📋 HIPAA Pharmacy Voice Bot - Documentation Index

Welcome! This document helps you navigate all the project documentation.

---

## 🚀 Getting Started (Start Here!)

### 1. **[GETTING_STARTED.md](GETTING_STARTED.md)** ⭐ **START HERE**
   - Complete step-by-step setup checklist
   - Installation instructions
   - API key configuration
   - Testing procedures
   - Troubleshooting guide
   - **Use this for your first setup!**

### 2. **[QUICKSTART.md](QUICKSTART.md)** 
   - Quick reference for common commands
   - Cheat sheet format
   - API endpoint list
   - Debugging tips
   - **Use this after initial setup**

---

## 📖 Understanding the System

### 3. **[README.md](README.md)**
   - Complete project documentation
   - HIPAA compliance explanation
   - Architecture overview
   - Setup instructions (detailed)
   - Production recommendations
   - **Comprehensive reference**

### 4. **[ARCHITECTURE.md](ARCHITECTURE.md)**
   - System architecture diagrams
   - Data flow visualization
   - Security boundaries
   - Component responsibilities
   - Deployment architecture
   - **For understanding design**

### 5. **[PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)**
   - Complete implementation overview
   - Feature checklist
   - Code statistics
   - Production enhancement TODOs
   - Key design decisions
   - **For project overview**

---

## 🔧 Configuration & Scripts

### 6. **[.env.example](.env.example)**
   - Environment variable template
   - Required API keys
   - Configuration options
   - **Copy to .env and edit**

### 7. **[start.sh](start.sh)**
   - Convenience startup script
   - Automatic setup steps
   - **Run this to start server**

### 8. **[test_setup.py](test_setup.py)**
   - Validation test script
   - PHI sanitization tests
   - Configuration checks
   - **Run to verify setup**

---

## 💻 Source Code

### Core Application (`app/` directory)

#### Entry Point
- **[app/main.py](app/main.py)** - FastAPI application, Twilio webhooks
  - `/voice/incoming` - Initial call webhook
  - `/voice/next` - Speech processing loop
  - Orchestrates all components

#### Data Layer
- **[app/models.py](app/models.py)** - CallSession data model, PHI storage
  - `CallSession` - Stores all call state and PHI
  - `SESSION_STORE` - In-memory storage (→ Redis in prod)

#### HIPAA Compliance (CRITICAL)
- **[app/phi_sanitizer.py](app/phi_sanitizer.py)** - PHI detection and sanitization
  - `extract_and_sanitize_phi()` - Detects and tokenizes PHI
  - `is_phi_free()` - Validates no PHI in text
  - **Most critical file for compliance!**

#### Business Logic
- **[app/conversation_engine.py](app/conversation_engine.py)** - Bland flow interpreter
  - `ConversationEngine` - Loads and traverses flow graph
  - `find_next_node()` - Determines conversation transitions
  - Reads from `pharmacy_bland_flow.json`

#### External Services
- **[app/gpt_client.py](app/gpt_client.py)** - OpenAI GPT wrapper
  - `analyze_user_intent_and_reply()` - Intent detection
  - **Enforces: No PHI to GPT**
  
- **[app/tts_client.py](app/tts_client.py)** - ElevenLabs TTS wrapper
  - `generate_tts_audio()` - Text-to-speech
  - **Enforces: No PHI to ElevenLabs**

- **[app/twilio_utils.py](app/twilio_utils.py)** - TwiML generation helpers
  - `generate_twiml_gather()` - Creates voice prompts
  - `generate_twiml_transfer()` - Pharmacist handoff

#### Configuration
- **[app/config.py](app/config.py)** - Environment settings
  - Loads API keys from environment
  - Configuration constants

---

## 📊 Data & Configuration

### 9. **[pharmacy_bland_flow.json](pharmacy_bland_flow.json)**
   - Conversation flow definition
   - Nodes (states) and edges (transitions)
   - Prompts and collection rules
   - **Edit this to change conversation logic**

### 10. **[requirements.txt](requirements.txt)**
   - Python dependencies
   - Pinned versions
   - **pip install -r requirements.txt**

---

## 📝 How to Use This Documentation

### If you're... 

**🆕 Brand new to the project:**
1. Read [GETTING_STARTED.md](GETTING_STARTED.md) first
2. Follow the checklist step-by-step
3. Run the test call
4. Then read [ARCHITECTURE.md](ARCHITECTURE.md) to understand how it works

**🔧 Setting up for development:**
1. [GETTING_STARTED.md](GETTING_STARTED.md) for setup
2. [README.md](README.md) for detailed reference
3. [ARCHITECTURE.md](ARCHITECTURE.md) for system design
4. Read code comments in `app/` files

**🚀 Preparing for production:**
1. [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) - Production checklist
2. [ARCHITECTURE.md](ARCHITECTURE.md) - Deployment architecture
3. [README.md](README.md) - Security considerations section
4. Review TODOs in source code files

**🐛 Debugging an issue:**
1. [QUICKSTART.md](QUICKSTART.md) - Debugging section
2. [GETTING_STARTED.md](GETTING_STARTED.md) - Troubleshooting section
3. Check server logs
4. Run `python test_setup.py`

**🏥 Verifying HIPAA compliance:**
1. [README.md](README.md) - "HIPAA Compliance Architecture" section
2. [ARCHITECTURE.md](ARCHITECTURE.md) - Security boundaries diagrams
3. [app/phi_sanitizer.py](app/phi_sanitizer.py) - Implementation
4. [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) - PHI protection table

**📱 Understanding the conversation flow:**
1. [pharmacy_bland_flow.json](pharmacy_bland_flow.json) - Flow definition
2. [app/conversation_engine.py](app/conversation_engine.py) - Implementation
3. [ARCHITECTURE.md](ARCHITECTURE.md) - Data flow section

---

## 📂 File Tree

```
HIPPA Flow/
│
├── 📄 Documentation (READ FIRST)
│   ├── GETTING_STARTED.md    ⭐ Start here!
│   ├── QUICKSTART.md         Quick reference
│   ├── README.md             Main documentation
│   ├── ARCHITECTURE.md       System design
│   ├── PROJECT_SUMMARY.md    Overview
│   └── INDEX.md              This file
│
├── 🐍 Source Code
│   └── app/
│       ├── main.py           FastAPI application
│       ├── models.py         Data models (PHI storage)
│       ├── phi_sanitizer.py  HIPAA compliance ⚠️
│       ├── conversation_engine.py  Flow logic
│       ├── gpt_client.py     OpenAI wrapper
│       ├── tts_client.py     ElevenLabs wrapper
│       ├── twilio_utils.py   TwiML helpers
│       ├── config.py         Configuration
│       └── __init__.py       Package init
│
├── 📊 Configuration
│   ├── pharmacy_bland_flow.json  Conversation graph
│   ├── requirements.txt      Dependencies
│   ├── .env.example          Environment template
│   └── .gitignore            Git ignore rules
│
└── 🔧 Scripts
    ├── start.sh              Quick start script
    └── test_setup.py         Setup validation
```

---

## 📊 Code Statistics

- **Total Lines:** ~3,000
- **Python Code:** ~1,500 lines
- **Documentation:** ~1,400 lines
- **Configuration:** ~100 lines

### Breakdown:
- `app/main.py`: 305 lines (FastAPI app)
- `app/conversation_engine.py`: 364 lines (Flow logic)
- `app/phi_sanitizer.py`: 206 lines (HIPAA critical)
- `app/gpt_client.py`: 188 lines (AI integration)
- `app/tts_client.py`: 145 lines (Voice synthesis)
- `app/twilio_utils.py`: 136 lines (TwiML)
- `app/models.py`: 97 lines (Data models)
- Documentation: 5 MD files

---

## 🔑 Key Concepts

### HIPAA Compliance
- **PHI** = Protected Health Information
- **BAA** = Business Associate Agreement
- **Twilio has BAA** → can handle PHI ✅
- **GPT/ElevenLabs NO BAA** → must NOT see PHI ❌

### PHI Sanitization Flow
```
User Speech → Twilio → Backend
              ↓
        [Detect PHI]
              ↓
        Store locally
              ↓
        Replace with tokens
              ↓
        Send to GPT (sanitized)
```

### Conversation Engine
- Loads `pharmacy_bland_flow.json`
- Treats it as state machine graph
- Nodes = conversation states
- Edges = transitions based on intent

---

## 🎯 Quick Links by Task

| Task | Primary Doc | Supporting Docs |
|------|-------------|-----------------|
| First-time setup | [GETTING_STARTED.md](GETTING_STARTED.md) | [README.md](README.md) |
| Quick command reference | [QUICKSTART.md](QUICKSTART.md) | - |
| Understand architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | [README.md](README.md) |
| Modify conversation | [pharmacy_bland_flow.json](pharmacy_bland_flow.json) | [conversation_engine.py](app/conversation_engine.py) |
| HIPAA compliance | [README.md](README.md) | [phi_sanitizer.py](app/phi_sanitizer.py) |
| Production deployment | [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Troubleshooting | [QUICKSTART.md](QUICKSTART.md) | [GETTING_STARTED.md](GETTING_STARTED.md) |

---

## 💡 Tips

1. **Always start with [GETTING_STARTED.md](GETTING_STARTED.md)** - It has the complete checklist
2. **Keep [QUICKSTART.md](QUICKSTART.md) handy** - Quick reference for common tasks
3. **Read code comments** - Every file has extensive inline documentation
4. **Check logs** - Server logs show PHI sanitization in action
5. **Test early, test often** - Use `python test_setup.py` to validate

---

## 🆘 Getting Help

1. **Check documentation** (you're in the right place!)
2. **Read error messages** in server logs
3. **Run validation tests:** `python test_setup.py`
4. **Review code comments** in `app/` files
5. **Check troubleshooting sections** in GETTING_STARTED.md and QUICKSTART.md

---

## 📜 Document Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| GETTING_STARTED.md | ✅ Complete | 2025-11-22 |
| QUICKSTART.md | ✅ Complete | 2025-11-22 |
| README.md | ✅ Complete | 2025-11-22 |
| ARCHITECTURE.md | ✅ Complete | 2025-11-22 |
| PROJECT_SUMMARY.md | ✅ Complete | 2025-11-22 |
| Source Code | ✅ Complete | 2025-11-22 |

---

**Ready to get started? Go to [GETTING_STARTED.md](GETTING_STARTED.md)! 🚀**
