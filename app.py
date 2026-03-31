import os
import uuid
import asyncio
import base64
import edge_tts
from flask import Flask, request, jsonify, send_file, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

# --- CORS: allow any origin so external scripts can call the API ---
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

# Temp directory for generated audio
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_audio")
os.makedirs(TEMP_DIR, exist_ok=True)

# Curated voice list — high-quality neural voices
VOICES = [
    {"id": "en-US-AriaNeural", "name": "Aria", "gender": "Female", "tag": "Professional & Versatile"},
    {"id": "en-US-JennyNeural", "name": "Jenny", "gender": "Female", "tag": "Warm & Friendly"},
    {"id": "en-US-GuyNeural", "name": "Guy", "gender": "Male", "tag": "Casual & Friendly"},
    {"id": "en-GB-RyanNeural", "name": "Ryan", "gender": "Male", "tag": "Confident & Warm"},
]


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
#  REST API  — designed for both UI and external automation
# ============================================================

@app.route("/api/voices", methods=["GET"])
def get_voices():
    """Return the list of available voices.

    Example (curl):
        curl http://localhost:5000/api/voices

    Example (Python):
        import requests
        voices = requests.get("http://localhost:5000/api/voices").json()
    """
    return jsonify({"voices": VOICES})


@app.route("/api/synthesize", methods=["POST", "OPTIONS"])
def synthesize():
    """Generate speech audio from text.

    Accepts JSON body:
        text   (str)  — The text to speak (max 5000 chars)
        voice  (str)  — Voice ID, e.g. "en-US-AriaNeural"
        rate   (str)  — Speed, e.g. "+0%", "+50%", "-30%"
        pitch  (str)  — Pitch, e.g. "+0Hz", "+10Hz", "-20Hz"
        volume (str)  — Volume, e.g. "+0%", "-25%"
        output (str)  — "file" (default) returns raw audio,
                        "base64" returns JSON with base64-encoded audio,
                        "save" saves to disk and returns the path.
        save_path (str) — Used with output="save". Full path where
                          the audio file should be written.

    Returns:
        output="file"   → raw MP3 binary (Content-Type: audio/mpeg)
        output="base64" → {"audio_base64": "...", "format": "mp3",
                           "size_bytes": 12345}
        output="save"   → {"saved_to": "/path/to/file.mp3",
                           "size_bytes": 12345}

    Example (curl — download file):
        curl -X POST http://localhost:5000/api/synthesize \
             -H "Content-Type: application/json" \
             -d '{"text":"Hello world","voice":"en-US-AriaNeural"}' \
             --output speech.mp3

    Example (Python — get base64):
        import requests, base64
        r = requests.post("http://localhost:5000/api/synthesize", json={
            "text": "Hello from automation!",
            "voice": "en-US-AriaNeural",
            "output": "base64"
        })
        audio_bytes = base64.b64decode(r.json()["audio_base64"])
        with open("output.mp3", "wb") as f:
            f.write(audio_bytes)

    Example (Python — save directly to disk):
        import requests
        r = requests.post("http://localhost:5000/api/synthesize", json={
            "text": "Save this narration",
            "voice": "en-US-GuyNeural",
            "rate": "+10%",
            "output": "save",
            "save_path": "C:/my_project/audio/narration_01.mp3"
        })
        print(r.json())  # {"saved_to": "...", "size_bytes": ...}
    """
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json()

    text = data.get("text", "").strip()
    voice = data.get("voice", "en-US-AriaNeural")
    rate = data.get("rate", "+0%")
    pitch = data.get("pitch", "+0Hz")
    volume = data.get("volume", "+0%")
    output_mode = data.get("output", "file")   # file | base64 | save
    save_path = data.get("save_path", "")

    if not text:
        return jsonify({"error": "Text is required"}), 400

    if len(text) > 5000:
        return jsonify({"error": "Text must be 5000 characters or less"}), 400

    # Validate voice
    valid_ids = [v["id"] for v in VOICES]
    if voice not in valid_ids:
        return jsonify({"error": f"Invalid voice. Choose from: {valid_ids}"}), 400

    # Generate unique temp filename
    file_id = str(uuid.uuid4())
    filename = f"{file_id}.mp3"
    filepath = os.path.join(TEMP_DIR, filename)

    try:
        # Run async edge-tts synthesis
        asyncio.run(_synthesize(text, voice, rate, pitch, volume, filepath))

        if not os.path.exists(filepath):
            return jsonify({"error": "Audio generation failed"}), 500

        file_size = os.path.getsize(filepath)

        # --- Output mode: base64 (for automation / embedding) ---
        if output_mode == "base64":
            with open(filepath, "rb") as f:
                audio_b64 = base64.b64encode(f.read()).decode("utf-8")
            os.remove(filepath)
            return jsonify({
                "audio_base64": audio_b64,
                "format": "mp3",
                "size_bytes": file_size,
            })

        # --- Output mode: save to custom path ---
        if output_mode == "save":
            if not save_path:
                return jsonify({"error": "'save_path' is required when output='save'"}), 400
            # Ensure directory exists
            os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
            import shutil
            shutil.move(filepath, save_path)
            return jsonify({
                "saved_to": os.path.abspath(save_path),
                "size_bytes": file_size,
            })

        # --- Output mode: file (default — raw audio response) ---
        response = send_file(
            filepath,
            mimetype="audio/mpeg",
            as_attachment=False,
            download_name=f"voicegen_{file_id[:8]}.mp3",
        )

        @response.call_on_close
        def cleanup():
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception:
                pass

        return response

    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({"error": f"Synthesis failed: {str(e)}"}), 500


@app.route("/api/batch", methods=["POST", "OPTIONS"])
def batch_synthesize():
    """Generate multiple audio files in one request (for automation).

    Accepts JSON body:
        items (list) — Each item has: text, voice, rate, pitch, volume, save_path

    Returns JSON with results for each item.

    Example (Python):
        import requests
        r = requests.post("http://localhost:5000/api/batch", json={
            "items": [
                {"text": "First sentence.", "voice": "en-US-AriaNeural",
                 "save_path": "C:/audio/part1.mp3"},
                {"text": "Second sentence.", "voice": "en-US-GuyNeural",
                 "save_path": "C:/audio/part2.mp3"},
            ]
        })
        print(r.json())
    """
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json()
    items = data.get("items", [])

    if not items:
        return jsonify({"error": "No items provided"}), 400

    if len(items) > 50:
        return jsonify({"error": "Maximum 50 items per batch"}), 400

    valid_ids = [v["id"] for v in VOICES]
    results = []

    for i, item in enumerate(items):
        text = item.get("text", "").strip()
        voice = item.get("voice", "en-US-AriaNeural")
        rate = item.get("rate", "+0%")
        pitch = item.get("pitch", "+0Hz")
        volume = item.get("volume", "+0%")
        save_path = item.get("save_path", "")

        if not text:
            results.append({"index": i, "success": False, "error": "Empty text"})
            continue
        if voice not in valid_ids:
            results.append({"index": i, "success": False, "error": f"Invalid voice: {voice}"})
            continue

        file_id = str(uuid.uuid4())
        filepath = os.path.join(TEMP_DIR, f"{file_id}.mp3")

        try:
            asyncio.run(_synthesize(text, voice, rate, pitch, volume, filepath))
            file_size = os.path.getsize(filepath)

            if save_path:
                os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
                import shutil
                shutil.move(filepath, save_path)
                results.append({
                    "index": i,
                    "success": True,
                    "saved_to": os.path.abspath(save_path),
                    "size_bytes": file_size,
                })
            else:
                # Return as base64 if no save_path
                with open(filepath, "rb") as f:
                    audio_b64 = base64.b64encode(f.read()).decode("utf-8")
                os.remove(filepath)
                results.append({
                    "index": i,
                    "success": True,
                    "audio_base64": audio_b64,
                    "size_bytes": file_size,
                })
        except Exception as e:
            if os.path.exists(filepath):
                os.remove(filepath)
            results.append({"index": i, "success": False, "error": str(e)})

    return jsonify({"results": results, "total": len(items)})


async def _synthesize(text, voice, rate, pitch, volume, filepath):
    """Run edge-tts synthesis asynchronously."""
    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
    )
    await communicate.save(filepath)


if __name__ == "__main__":
    print("\n  Twelve Labs — Text to Speech Server")
    print("  " + "=" * 46)
    print("  UI:    http://localhost:5000")
    print("  API:   http://localhost:5000/api/voices")
    print("  API:   http://localhost:5000/api/synthesize")
    print("  API:   http://localhost:5000/api/batch")
    print("  " + "=" * 46 + "\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
