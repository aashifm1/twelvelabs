import os
import uuid
import asyncio
import tempfile
import logging
import re

import edge_tts
from flask import Flask, request, jsonify, send_file, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")
log = logging.getLogger("twelvelabs")

# Only allow the app's own origin to call the API. The UI and API are
# served from the same origin, so no cross-origin access is required.
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://twelvelabs.onrender.com")


@app.after_request
def add_security_headers(response):
    origin = request.headers.get("Origin")
    if origin == ALLOWED_ORIGIN:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Audio is generated to the OS temp directory and deleted immediately
# after it has been streamed to the browser. Nothing is ever written to
# a user-supplied path and nothing is kept on disk after the request.
TEMP_DIR = tempfile.gettempdir()

MAX_TEXT_LENGTH = 5000

VOICES = [
    {"id": "en-US-AriaNeural", "name": "Aria", "gender": "Female", "tag": "Professional and versatile"},
    {"id": "en-US-JennyNeural", "name": "Jenny", "gender": "Female", "tag": "Warm and friendly"},
    {"id": "en-US-GuyNeural", "name": "Guy", "gender": "Male", "tag": "Casual and friendly"},
    {"id": "en-GB-RyanNeural", "name": "Ryan", "gender": "Male", "tag": "Confident and warm"},
]
VALID_VOICE_IDS = {v["id"] for v in VOICES}


# ============================================================
#  FRONTEND
# ============================================================

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/robots.txt")
def robots():
    return send_from_directory("static", "robots.txt", mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap():
    return send_from_directory("static", "sitemap.xml", mimetype="application/xml")


# ============================================================
#  API
# ============================================================

@app.route("/api/voices", methods=["GET"])
def get_voices():
    """Return the list of available voices."""
    return jsonify({"voices": VOICES})


def _is_safe_ssml_param(value):
    """Guard against SSML/prosody parameter injection: only a small,
    well-defined shape (sign, digits, unit) is ever passed to edge-tts."""
    return bool(re.fullmatch(r"[+-]\d{1,3}(%|Hz)", str(value)))


@app.route("/api/synthesize", methods=["POST", "OPTIONS"])
def synthesize():
    """Generate speech audio from text and stream it back to the browser.

    Accepts a JSON body:
        text   (str) - the text to speak (max 5000 characters)
        voice  (str) - a voice id from /api/voices
        rate   (str) - e.g. "+0%", "+50%", "-30%"
        pitch  (str) - e.g. "+0Hz", "+10Hz", "-20Hz"
        volume (str) - e.g. "+0%", "-25%"

    Always returns raw MP3 audio (Content-Type: audio/mpeg). The browser
    downloads it directly; the file is removed from the server as soon
    as the response has been sent, so nothing lingers on disk.
    """
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json(silent=True) or {}

    text = str(data.get("text", "")).strip()
    voice = data.get("voice", "en-US-AriaNeural")
    rate = data.get("rate", "+0%")
    pitch = data.get("pitch", "+0Hz")
    volume = data.get("volume", "+0%")

    if not text:
        return jsonify({"error": "Text is required"}), 400

    if len(text) > MAX_TEXT_LENGTH:
        return jsonify({"error": f"Text must be {MAX_TEXT_LENGTH} characters or less"}), 400

    if voice not in VALID_VOICE_IDS:
        return jsonify({"error": "Invalid voice selected"}), 400

    if not (_is_safe_ssml_param(rate) and _is_safe_ssml_param(pitch) and _is_safe_ssml_param(volume)):
        return jsonify({"error": "Invalid rate, pitch, or volume value"}), 400

    filename = f"{uuid.uuid4()}.mp3"
    filepath = os.path.join(TEMP_DIR, filename)

    try:
        asyncio.run(_synthesize(text, voice, rate, pitch, volume, filepath))

        if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
            return jsonify({"error": "Audio generation failed"}), 500

        response = send_file(
            filepath,
            mimetype="audio/mpeg",
            as_attachment=False,
            download_name="twelvelabs_audio.mp3",
        )

        @response.call_on_close
        def cleanup():
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except OSError:
                pass

        return response

    except Exception:
        log.exception("Speech synthesis failed")
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({"error": "Synthesis failed. Please try again."}), 500


async def _synthesize(text, voice, rate, pitch, volume, filepath):
    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
    )
    await communicate.save(filepath)


# ============================================================
#  ERROR HANDLERS
# ============================================================

@app.errorhandler(404)
def not_found(_error):
    return send_from_directory("static", "404.html"), 404


@app.errorhandler(500)
def server_error(_error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    debug_mode = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    port = int(os.environ.get("PORT", 5000))
    print("\n  Twelve Labs -- Text to Speech Server")
    print("  " + "=" * 46)
    print(f"  UI:  http://localhost:{port}")
    print(f"  API: http://localhost:{port}/api/voices")
    print(f"  API: http://localhost:{port}/api/synthesize")
    print("  " + "=" * 46 + "\n")
    app.run(debug=debug_mode, host="0.0.0.0", port=port)