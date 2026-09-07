import base64
import json
import os
import tempfile
import traceback
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import google.generativeai as genai
from google.api_core.exceptions import DeadlineExceeded
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.twiml.voice_response import VoiceResponse


load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_API_KEY = os.getenv("TWILIO_API_KEY")
TWILIO_API_SECRET = os.getenv("TWILIO_API_SECRET")
TWILIO_TWIML_APP_SID = os.getenv("TWILIO_TWIML_APP_SID")

if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
    genai.configure(api_key=GEMINI_API_KEY)

SYSTEM_INSTRUCTION = """You are a trauma-informed text analysis assistant helping a victim support helpline assess psychological distress in messages from complainants, some of whom may have experienced caste-based violence, threats, or abuse. Analyze the following message (which may be in English, Tamil, or mixed Tamil-English) and respond ONLY with a JSON object, no other text, no markdown formatting, with these exact fields:

- sentiment_score (float 0-1, 0=very negative, 1=very positive)
- fear_score (float 0-1)
- distress_score (float 0-1)
- suicidal_ideation_flag (boolean)
- isolation_flag (boolean)
- key_phrases (array of strings, short phrases from the text that indicate distress)
- reasoning (one sentence explaining the assessment)"""


class AnalyzeTextRequest(BaseModel):
    text: str
    language: str


app = FastAPI(title="Hackathon Backend")
voice_cases = []

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://localhost(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def classify_text(text: str, language: str):
    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        raise RuntimeError("Gemini API key is not configured.")

    model = genai.GenerativeModel(model_name=GEMINI_MODEL)
    prompt = (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"Language: {language}\nMessage:\n{text}"
    )

    for attempt in range(2):
        try:
            # The installed legacy SDK rejects request_options in its proto request.
            result = model.generate_content(prompt)
            break
        except DeadlineExceeded:
            if attempt == 1:
                raise

    response_text = result.text.strip()
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[-1]
        if response_text.endswith("```"):
            response_text = response_text[:-3].rstrip()

    analysis = json.loads(response_text)
    if not isinstance(analysis, dict):
        raise ValueError("Response must be a JSON object")

    required_fields = {
        "sentiment_score",
        "fear_score",
        "distress_score",
        "suicidal_ideation_flag",
        "isolation_flag",
        "key_phrases",
        "reasoning",
    }
    if not required_fields.issubset(analysis):
        missing = sorted(required_fields - analysis.keys())
        raise ValueError(f"Missing fields: {', '.join(missing)}")

    sentiment_score = float(analysis["sentiment_score"])
    fear_score = float(analysis["fear_score"])
    distress_score = float(analysis["distress_score"])
    if not all(0 <= score <= 1 for score in (sentiment_score, fear_score, distress_score)):
        raise ValueError("Score fields must be between 0 and 1")
    if not isinstance(analysis["suicidal_ideation_flag"], bool):
        raise ValueError("suicidal_ideation_flag must be a boolean")
    if not isinstance(analysis["isolation_flag"], bool):
        raise ValueError("isolation_flag must be a boolean")

    svi_score = (
        fear_score * 0.3
        + distress_score * 0.4
        + (1 - sentiment_score) * 0.3
    ) * 100
    if analysis["suicidal_ideation_flag"]:
        svi_score = min(100, svi_score + 20)
    svi_score = round(svi_score, 2)

    if svi_score < 30:
        risk_category = "Low"
        recommended_action = "Log and monitor"
    elif svi_score <= 60:
        risk_category = "Moderate"
        recommended_action = "Schedule counselling follow-up"
    elif svi_score <= 85:
        risk_category = "High"
        recommended_action = "Priority counselling + legal aid referral"
    else:
        risk_category = "Critical"
        recommended_action = "Immediate escalation: counsellor + police intervention"

    return {
        "svi_score": svi_score,
        "risk_category": risk_category,
        "flags": [
            flag
            for flag in ("suicidal_ideation_flag", "isolation_flag")
            if analysis[flag]
        ],
        "recommended_action": recommended_action,
        "reasoning": analysis["reasoning"],
    }


def twiml_response(response: VoiceResponse):
    return Response(content=str(response), media_type="application/xml")


def require_twilio_config():
    required = {
        "TWILIO_ACCOUNT_SID": TWILIO_ACCOUNT_SID,
        "TWILIO_API_KEY": TWILIO_API_KEY,
        "TWILIO_API_SECRET": TWILIO_API_SECRET,
        "TWILIO_TWIML_APP_SID": TWILIO_TWIML_APP_SID,
    }
    missing = [name for name, value in required.items() if not value or value.startswith("your_")]
    if missing:
        raise HTTPException(status_code=500, detail=f"Missing Twilio configuration: {', '.join(missing)}")


def transcribe_recording(audio_bytes: bytes):
    audio_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as audio_file:
            audio_file.write(audio_bytes)
            audio_path = audio_file.name

        uploaded_file = genai.upload_file(path=audio_path, mime_type="audio/wav")
        model = genai.GenerativeModel(model_name=GEMINI_MODEL)
        result = model.generate_content([
            "Transcribe this audio recording exactly. Return only the spoken words, without commentary.",
            uploaded_file,
        ])
        return result.text.strip()
    finally:
        if audio_path and os.path.exists(audio_path):
            os.unlink(audio_path)


def download_recording(recording_url: str):
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        raise RuntimeError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required to download recordings.")

    request = urllib.request.Request(f"{recording_url}.wav")
    credentials = f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode()
    request.add_header("Authorization", f"Basic {base64.b64encode(credentials).decode()}")
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze-text")
def analyze_text(payload: AnalyzeTextRequest):
    try:
        return classify_text(payload.text, payload.language)
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Gemini analysis failed: {exc}") from exc


@app.get("/voice-token")
@app.post("/voice-token")
def voice_token():
    require_twilio_config()
    token = AccessToken(
        TWILIO_ACCOUNT_SID,
        TWILIO_API_KEY,
        TWILIO_API_SECRET,
        identity="browser-demo",
    )
    token.add_grant(VoiceGrant(
        outgoing_application_sid=TWILIO_TWIML_APP_SID,
        incoming_allow=True,
    ))
    return {"token": token.to_jwt().decode("utf-8"), "identity": "browser-demo"}


@app.post("/voice")
def voice():
    response = VoiceResponse()
    response.say("Welcome to the support text analyzer demo. Please speak after the beep.")
    response.record(
        max_length=60,
        action="/voice/recording",
        play_beep=True,
        method="POST",
    )
    return twiml_response(response)


@app.post("/voice/recording")
async def voice_recording(request: Request):
    try:
        form_data = urllib.parse.parse_qs((await request.body()).decode("utf-8"))
        recording_url = form_data.get("RecordingUrl", [None])[0]
        if not recording_url:
            raise ValueError("Twilio did not provide a RecordingUrl")

        transcript = transcribe_recording(download_recording(recording_url))
        analysis = classify_text(transcript, "en")
        voice_cases.append({
            "id": f"voice-{len(voice_cases) + 1}",
            "text": transcript,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "Voice Call",
            **analysis,
        })

        response = VoiceResponse()
        response.say("Thank you. Your message has been recorded for review.")
        return twiml_response(response)
    except Exception as exc:
        traceback.print_exc()
        response = VoiceResponse()
        response.say("We could not process the recording. Please try again later.")
        return twiml_response(response)


@app.get("/voice-cases")
def get_voice_cases():
    return voice_cases
