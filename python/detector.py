"""
detector.py — NeuroFlow Py-Feat Detector Wrapper
Tracks AU04 (Brow Furrow) and AU45 (Blink Rate) to compute
a Cognitive Load Score from webcam or video file.
"""

import threading
import time
import random

# Attempt to import Py-Feat; fall back to simulation if unavailable
try:
    from feat import Detector as FeatDetector
    import cv2
    FEAT_AVAILABLE = True
except ImportError:
    FEAT_AVAILABLE = False
    print("[NeuroFlow] ⚠  Py-Feat or OpenCV not installed. Running in SIMULATION mode.")


# ─── Cognitive Load Score formula ───────────────────────────
# CLS = (AU04 × 0.7) + (AU45_normalised × 0.3)
# AU45 blink rate: normal ~15-20/min. High stress ≈ low blink rate.
# Normalised: clamp(blink_rate / 30, 0, 1)  [30/min = max normal = 1.0]
AU04_WEIGHT  = 0.7
AU45_WEIGHT  = 0.3
AU45_MAX_BPM = 30.0   # blinks per minute at which AU45 score = 1.0


def compute_cls(au04: float, au45_raw: float) -> float:
    """Compute Cognitive Load Score from raw AU values (0–1 each)."""
    au45_norm = min(au45_raw / AU45_MAX_BPM, 1.0) if au45_raw > 0 else au45_raw
    return round(au04 * AU04_WEIGHT + au45_norm * AU45_WEIGHT, 4)


# ─── Simulation ──────────────────────────────────────────────
_sim_t = 0.0

def _simulate_frame() -> dict:
    global _sim_t
    _sim_t += 0.1
    au04 = max(0, min(1, 0.25 + 0.35 * abs(pow((_sim_t % 6.28) / 3.14 - 1, 3)) + random.uniform(-0.04, 0.04)))
    au45 = max(0, min(1, 0.3 + 0.2 * (1 - au04) + random.uniform(-0.03, 0.03)))
    cls  = compute_cls(au04, au45)
    return {
        "au04": round(au04, 4),
        "au45": round(au45, 4),
        "cognitive_load_score": cls,
        "mode": "simulation",
    }


# ─── Live Webcam Loop ─────────────────────────────────────────
class LiveDetector:
    """
    Runs Py-Feat in a background thread, continuously reading
    from the webcam. Exposes `get_latest()` for the Flask endpoint.
    """

    def __init__(self):
        self._lock   = threading.Lock()
        self._latest = {"au04": 0.0, "au45": 0.0, "cognitive_load_score": 0.0, "mode": "idle"}
        self._running = False

        if FEAT_AVAILABLE:
            self.detector = FeatDetector(
                face_model="retinaface",
                landmark_model="mobilefacenet",
                au_model="xgb",
                emotion_model="resmasknet",
            )
            print("[NeuroFlow] ✅ Py-Feat Detector initialized (real mode)")
        else:
            self.detector = None

    def start(self):
        if self._running:
            return
        self._running = True
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()
        print("[NeuroFlow] 🎥 Live detector loop started")

    def _loop(self):
        if not FEAT_AVAILABLE:
            # Simulation loop
            while self._running:
                data = _simulate_frame()
                with self._lock:
                    self._latest = data
                time.sleep(0.5)
            return

        # Real Py-Feat loop
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("[NeuroFlow] ⚠  No webcam found — falling back to simulation")
            while self._running:
                data = _simulate_frame()
                with self._lock:
                    self._latest = data
                time.sleep(0.5)
            return

        frame_count  = 0
        blink_frames = 0   # frames where AU45 > 0.5 (blink event proxy)
        start_time   = time.time()

        while self._running:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue

            frame_count += 1
            elapsed = time.time() - start_time

            # Run Py-Feat every ~500ms (every ~15 frames at 30fps)
            if frame_count % 15 == 0:
                try:
                    result = self.detector.detect_image(frame)
                    aus    = result.aus.iloc[0].to_dict() if not result.aus.empty else {}

                    au04 = float(aus.get("AU04", 0.0))
                    au45_raw = float(aus.get("AU45", 0.0))

                    if au45_raw > 0.5:
                        blink_frames += 1
                    blink_rate_bpm = (blink_frames / max(elapsed, 1)) * 60

                    cls = compute_cls(au04, blink_rate_bpm)
                    data = {
                        "au04": round(au04, 4),
                        "au45": round(blink_rate_bpm / AU45_MAX_BPM, 4),
                        "au45_raw_bpm": round(blink_rate_bpm, 2),
                        "cognitive_load_score": cls,
                        "mode": "live",
                    }
                except Exception as e:
                    print(f"[NeuroFlow] Py-Feat frame error: {e}")
                    data = _simulate_frame()

                with self._lock:
                    self._latest = data

            time.sleep(0.033)   # ~30fps cap

        cap.release()

    def get_latest(self) -> dict:
        with self._lock:
            return dict(self._latest)

    def analyze_video(self, video_path: str) -> dict:
        """Analyze a video file and return full AU timeline."""
        if not FEAT_AVAILABLE:
            return {"error": "Py-Feat not installed. Install with: pip install feat"}
        try:
            result = self.detector.detect_video(video_path, skip_frames=5)
            aus = result.aus.copy()
            aus["cognitive_load_score"] = (
                aus.get("AU04", 0) * AU04_WEIGHT +
                aus.get("AU45", 0) * AU45_WEIGHT
            )
            return {
                "frames": len(aus),
                "au04_mean":  round(float(aus["AU04"].mean()), 4) if "AU04" in aus.columns else None,
                "au45_mean":  round(float(aus["AU45"].mean()), 4) if "AU45" in aus.columns else None,
                "cls_mean":   round(float(aus["cognitive_load_score"].mean()), 4),
                "cls_max":    round(float(aus["cognitive_load_score"].max()), 4),
                "timeline":   aus[["AU04","AU45","cognitive_load_score"]].round(4).to_dict(orient="records"),
            }
        except Exception as e:
            return {"error": str(e)}


# Singleton
_detector_instance: LiveDetector | None = None

def get_detector() -> LiveDetector:
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = LiveDetector()
    return _detector_instance
