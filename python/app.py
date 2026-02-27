"""
app.py — NeuroFlow Flask Server
Exposes:
  GET  /live     → latest AU scores from webcam (or simulation)
  POST /analyze  → analyze a video file path, return full AU timeline
  GET  /health   → server health check
"""

from flask import Flask, jsonify, request
from flask_cors import CORS

from detector import get_detector

app = Flask(__name__)
CORS(app)   # allow browser to poll from any origin

# ──────────────────────────────────────────────────────
# Start the background webcam loop immediately
# ──────────────────────────────────────────────────────
detector = get_detector()
detector.start()


# ──────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """Quick health check — confirms server is alive."""
    return jsonify({"status": "ok", "service": "NeuroFlow Py-Feat Server"})


@app.route("/live", methods=["GET"])
def live():
    """
    Returns the latest AU scores from the webcam loop.
    Response shape:
    {
        "au04": 0.4217,          # Brow Furrow (0–1)
        "au45": 0.2891,          # Blink Rate normalised (0–1)
        "au45_raw_bpm": 8.67,    # raw blinks/min (real mode only)
        "cognitive_load_score": 0.382,
        "mode": "live" | "simulation"
    }
    """
    data = detector.get_latest()
    return jsonify(data)


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Analyze a local video file with Py-Feat.
    Request body (JSON): { "video_path": "C:/path/to/video.mp4" }
    Response: { frames, au04_mean, au45_mean, cls_mean, cls_max, timeline: [...] }
    """
    body = request.get_json(silent=True) or {}
    video_path = body.get("video_path", "")

    if not video_path:
        return jsonify({"error": "video_path is required"}), 400

    result = detector.analyze_video(video_path)
    return jsonify(result)


# ──────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print()
    print("╔══════════════════════════════════════════════╗")
    print("║  ⚡ NeuroFlow Py-Feat Server                 ║")
    print("║  http://localhost:5000                       ║")
    print("║  GET  /live     — real-time AU scores        ║")
    print("║  POST /analyze  — video file analysis        ║")
    print("║  GET  /health   — server status              ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    app.run(host="0.0.0.0", port=5000, debug=False)
