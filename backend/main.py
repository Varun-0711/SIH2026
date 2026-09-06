import json
import os
import traceback

import google.generativeai as genai
from google.api_core.exceptions import DeadlineExceeded
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
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

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://localhost(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze-text")
def analyze_text(payload: AnalyzeTextRequest):
    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="Gemini API key is not configured. Add GEMINI_API_KEY to backend/.env.",
        )

    try:
        model = genai.GenerativeModel(model_name=GEMINI_MODEL)
        prompt = (
            f"{SYSTEM_INSTRUCTION}\n\n"
            f"Language: {payload.language}\nMessage:\n{payload.text}"
        )
        for attempt in range(2):
            try:
                result = model.generate_content(
                    prompt,
                    request_options={"timeout": 30},
                )
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
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Gemini analysis failed: {exc}",
        ) from exc

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

    flags = [
        flag
        for flag in ("suicidal_ideation_flag", "isolation_flag")
        if analysis[flag]
    ]

    return {
        "svi_score": svi_score,
        "risk_category": risk_category,
        "flags": flags,
        "recommended_action": recommended_action,
        "reasoning": analysis["reasoning"],
    }
