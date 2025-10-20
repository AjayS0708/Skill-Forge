from flask import Flask, render_template, request, jsonify
import os
import requests
from typing import Tuple, Dict, Any, List
import time
import re

app = Flask(__name__, static_folder='../static', static_url_path='/static')

# Gemini API key (prefer environment variable if set)

API_KEY = os.getenv("GEMINI_API_KEY", " Your Api key") #place ur api key here

API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyDtF_0jzNoKPGtS-QGpE8zDfKvI5o2dcAk")


@app.route('/')
def home():
    return render_template('index.html')

@app.route('/generate', methods=['POST'])
def generate():
    topic = request.json.get('topic', '').strip()
    if not topic:
        return jsonify({'error': 'Topic required'}), 400

    # Safety filter: block inappropriate topics (sexual/explicit content, etc.)
    blocked_patterns = re.compile(r"\b(sex|sexual|porn|pornography|erotic|fetish|nsfw|adult\s*content|xxx|nude|explicit)\b", re.IGNORECASE)
    if blocked_patterns.search(topic):
        return jsonify({
            'error': 'Topic not allowed',
            'details': 'This topic is restricted. Please enter an educational/professional topic.'
        }), 400

    # Allowlist: accept only clearly educational/professional domains
    allowed_patterns = re.compile(
        r"\b(software|programming|coding|computer\s*science|python|java|c\+\+|react|angular|vue|web\s*development|"
        r"data\s*(science|analytics|engineering)|machine\s*learning|artificial\s*intelligence|ai|deep\s*learning|"
        r"cloud|aws|azure|gcp|devops|kubernetes|docker|cyber\s*security|networking|database|sql|nosql|postgres|mysql|"
        r"math|calculus|algebra|statistics|probability|physics|chemistry|biology|economics|finance|accounting|"
        r"marketing|operations|supply\s*chain|design|ux|ui|product\s*management|project\s*management|"
        r"entrepreneurship|business|hr|law|medicine|nursing|pharmacy|mechanical|electrical|civil|electronics|"
        r"robotics|embedded|blockchain|android|ios|flutter|kotlin|swift|django|flask|node|express|typescript|"
        r"go|rust|r\s*language|tableau|power\s*bi|excel|pandas|numpy|matplotlib|sql\s*server|oracle)\b",
        re.IGNORECASE,
    )
    if not allowed_patterns.search(topic):
        return jsonify({
            'error': 'Topic not allowed',
            'details': 'Please enter an educational or professional topic (e.g., Data Science, Python, AWS, Accounting, Calculus, UX Design).'
        }), 400

    prompt = f"""
    You are a senior mentor. Create a strictly actionable learning plan for: "{topic}".

    Output must be concise Markdown focused ONLY on:
     1) Tech stack to learn with official docs links.
         - For each technology listed, include exactly TWO short lines describing it: a one-line summary (what it is / why it's useful) and a one-line practical tip (how to start / common use). Keep each descriptive line <= 14 words.
         - Provide an official docs link on the same bullet line as the tech name. Example format:
            - React — [Official Docs](https://reactjs.org)
              - Summary: A component-based UI library for building interactive web apps.
              - Tip: Start with function components and hooks; build a small CRUD app.
    2) 3–5 concrete project ideas with brief requirements and acceptance criteria.
    3) Curated learning resources:
       - 3–5 high-quality courses (platform + link + who it's for)
       - 5–8 YouTube channels or playlists (link + what to watch first)
    4) A weekly plan table (8–12 weeks) with columns: Week | Focus | Key Tasks | Est. Hours | Output.

    Rules:
    - Use bullet points only; avoid long paragraphs.
    - Every resource bullet must contain a direct link.
    - Prefer official docs and well-known platforms (Coursera, edX, Udemy, freeCodeCamp, Google Cloud Skills Boost, AWS Skill Builder, Microsoft Learn).
    - No fluff, no motivational text, no repeated summaries.
    - Target 700–1200 words.
    - Use plain text links like: [Title](https://example.com)
    """

    # Build request payload
    def build_payload(max_tokens: int, with_plain_text: bool = True) -> Dict[str, Any]:
        cfg: Dict[str, Any] = {
            "maxOutputTokens": max_tokens,
            "temperature": 0.7,
            "topP": 0.95,
            "topK": 40,
        }
        if with_plain_text:
            cfg["responseMimeType"] = "text/plain"
        return {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": cfg,
        }

    # base payload: much larger cap for richer content, no forced MIME type
    payload = build_payload(8192, with_plain_text=False)

    def call_gemini(url: str, use_header_key: bool) -> Tuple[int, Dict[str, Any], str]:
        headers = {"Content-Type": "application/json"}
        params = None
        if use_header_key:
            headers["x-goog-api-key"] = API_KEY
        else:
            params = {"key": API_KEY}
        # simple retry loop for transient timeouts
        last_exc = None
        for attempt in range(3):
            try:
                resp = requests.post(url, headers=headers, params=params, json=payload, timeout=60)
                try:
                    data_json = resp.json()
                except Exception:
                    data_json = {"raw": resp.text}
                return resp.status_code, data_json, url
            except requests.exceptions.Timeout as e:
                last_exc = e
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                else:
                    return 504, {"error": "Gateway timeout while calling model", "exception": str(e)}, url

    try:
        # Helper: recursively collect any text fields from response
        def extract_texts(node: Any, out: List[str]) -> None:
            if node is None:
                return
            if isinstance(node, dict):
                # common key
                if isinstance(node.get("text"), str):
                    out.append(node["text"])
                # some variants embed text under "content" or nested parts
                for key, value in node.items():
                    extract_texts(value, out)
            elif isinstance(node, list):
                for item in node:
                    extract_texts(item, out)

        # Ordered list of endpoints to try (prefer larger-capacity models first)
        attempts: List[Tuple[str, bool]] = [
            ("https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent", False),
            ("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", True),
            ("https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent", False),
            ("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", True),
            ("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-8b:generateContent", True),
        ]

        last_status, last_data, last_url = 0, {}, ""
        for url, use_header in attempts:
            status, data, used_url = call_gemini(url, use_header)
            if status == 200:
                # success path
                prompt_feedback = data.get("promptFeedback") or {}
                if prompt_feedback.get("blockReason"):
                    return jsonify({
                        'error': 'Request was blocked by safety filters.',
                        'details': prompt_feedback,
                        'url': used_url,
                    }), 400

                candidates = data.get("candidates") or []
                if not candidates:
                    return jsonify({'error': 'No candidates returned from model.', 'url': used_url}), 502

                texts: List[str] = []
                # Collect text from all candidates/parts
                for cand in candidates:
                    extract_texts(cand.get("content"), texts)
                if not texts:
                    # If no text but we have candidates and maybe hit MAX_TOKENS, retry once with higher output limit
                    try_again = False
                    for cand in candidates:
                        if cand.get("finishReason") == "MAX_TOKENS":
                            try_again = True
                            break
                    if try_again:
                        # Rebuild payload with larger limit
                        large_payload = build_payload(12000, with_plain_text=False)
                        original_payload = payload
                        payload = large_payload
                        status2, data2, used_url2 = call_gemini(used_url, use_header)
                        payload = original_payload
                        if status2 == 200:
                            texts2: List[str] = []
                            for cand2 in (data2.get("candidates") or []):
                                extract_texts(cand2.get("content"), texts2)
                            if texts2:
                                text2 = "\n".join(t.strip() for t in texts2 if isinstance(t, str) and t.strip())
                                return jsonify({'roadmap': text2, 'url': used_url2})
                    # Include small slice of raw to inspect shape
                    preview = str(candidates[:1])[:1200]
                    return jsonify({'error': 'Model returned no text.', 'url': used_url, 'content_preview': preview}), 502

                text = "\n".join(t.strip() for t in texts if isinstance(t, str) and t.strip())
                return jsonify({'roadmap': text, 'url': used_url})

            # remember last error and continue trying others
            last_status, last_data, last_url = status, data, used_url

        # All attempts failed; try listing models to help debug
        models_v1 = {}
        models_v1beta = {}
        try:
            r1 = requests.get(
                "https://generativelanguage.googleapis.com/v1/models",
                params={"key": API_KEY},
                timeout=40,
            )
            models_v1 = r1.json()
        except Exception:
            models_v1 = {"error": "Failed to fetch v1 models"}
        try:
            r2 = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                headers={"x-goog-api-key": API_KEY},
                timeout=40,
            )
            models_v1beta = r2.json()
        except Exception:
            models_v1beta = {"error": "Failed to fetch v1beta models"}

        return jsonify({
            'error': f"Upstream error {last_status}",
            'details': last_data,
            'url': last_url,
            'models_v1': models_v1,
            'models_v1beta': models_v1beta,
        }), 502

        # Check for prompt feedback blocks
        prompt_feedback = data.get("promptFeedback") or {}
        if prompt_feedback.get("blockReason"):
            return jsonify({
                'error': 'Request was blocked by safety filters.',
                'details': prompt_feedback
            }), 400

        candidates = data.get("candidates") or []
        if not candidates:
            return jsonify({'error': 'No candidates returned from model.'}), 502

        content = candidates[0].get("content") or {}
        parts = content.get("parts") or []
        if not parts or not parts[0].get("text"):
            return jsonify({'error': 'Model returned no text.'}), 502

        text = parts[0]["text"]
        return jsonify({'roadmap': text})
    except Exception as e:
        return jsonify({'error': f"Server error: {str(e)}"}), 500


@app.route('/models', methods=['GET'])
def list_models():
    """Return available models for this API key from v1 and v1beta."""
    try:
        models_v1 = {}
        models_v1beta = {}
        try:
            r1 = requests.get(
                "https://generativelanguage.googleapis.com/v1/models",
                params={"key": API_KEY},
                timeout=20,
            )
            models_v1 = r1.json()
        except Exception as e:
            models_v1 = {"error": f"Failed to fetch v1 models: {str(e)}"}
        try:
            r2 = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                headers={"x-goog-api-key": API_KEY},
                timeout=20,
            )
            models_v1beta = r2.json()
        except Exception as e:
            models_v1beta = {"error": f"Failed to fetch v1beta models: {str(e)}"}

        return jsonify({
            'models_v1': models_v1,
            'models_v1beta': models_v1beta,
        })
    except Exception as e:
        return jsonify({'error': f"Server error: {str(e)}"}), 500



@app.route('/api/salary', methods=['GET', 'POST'])
def api_salary():
    """Mock salary API for quick frontend prototyping.

    Query params / JSON body:
      - tech (required)
      - location (optional, default 'India')
      - exp / experience (optional, default 'mid')

    Returns a mocked JSON structure suitable for the frontend charts.
    """
    try:
        if request.method == 'POST' and request.is_json:
            payload = request.json
            tech = (payload.get('tech') or '').strip()
            location = payload.get('location', 'India')
            exp = payload.get('experience') or payload.get('exp') or 'mid'
        else:
            tech = (request.args.get('tech') or '').strip()
            location = request.args.get('location', 'India')
            exp = request.args.get('exp') or request.args.get('experience') or 'mid'

        if not tech:
            return jsonify({'error': 'Missing required parameter: tech'}), 400

        # Simple deterministic hash to generate stable mock numbers per tech
        h = sum(ord(c) for c in tech) % 100000
        # base median between ~800k to ~3.2M INR depending on tech string
        base_median = 800000 + (h * 24)

        # Adjust by experience level to make entry/mid/senior differ
        exp_norm = (exp or 'mid').lower()
        exp_map = {
            'entry': 0.65,
            'junior': 0.75,
            'mid': 1.0,
            'senior': 1.45,
            'lead': 1.8
        }
        multiplier = exp_map.get(exp_norm, 1.0)
        median = int(base_median * multiplier)
        p25 = int(median * 0.75)
        p75 = int(median * 1.35)
        mn = int(median * 0.45)
        mx = int(median * 3.1)

        # Trend: years 2021..2025 with modest growth
        trend = []
        base = median - 120000
        for year in range(2021, 2026):
            # small yearly incremental increase
            offset = (year - 2021) * (h % 30000) // 4
            trend.append({'year': year, 'median': int(base + offset)})

        # mock city breakdown for major metros in India
        cities = ['Bengaluru', 'Mumbai', 'NCR', 'Hyderabad', 'Pune']
        city_breakdown = []
        for i, city in enumerate(cities):
            factor = 1.0 + (i * 0.08)  # Bengaluru often higher
            city_breakdown.append({
                'city': city,
                'median': int(median * factor),
                'sample_size': 80 - i * 8
            })

        response = {
            'tech': tech,
            'location': location,
            'experience': exp,
            'currency': 'INR',
            'median': median,
            'p25': p25,
            'p75': p75,
            'min': mn,
            'max': mx,
            'sample_size': 500 + (h % 800),
            'sources': {'mock': 1},
            'trend': trend,
            'demand_index': 50 + (h % 50),
            'city_breakdown': city_breakdown,
            'last_updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        }
        return jsonify(response)
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True)
