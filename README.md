# NeuroFlow

NeuroFlow is an intelligent, real-time web UI adapter designed to detect cognitive load and sensory overload, particularly assisting neurodivergent individuals such as those with ADHD or Autism. 

## Overview
NeuroFlow uses a dual-threat technology approach:
1. **MediaPipe (The Live Companion)**: A Chrome extension running directly in the browser that detects immediate attention drops or eye strain using Face Landmarker Blendshapes.
2. **Py-Feat (The Scientific Auditor)**: A Python server (using Streamlit) utilized during the testing phase to track Action Unit (AU) data, specifically AU04 (Brow Furrow) and AU45 (Blink Rate), to generate a precise Cognitive Load Score.

## Features
- **NeuroShield Mode**: Strips distractions, converts to greyscale on high load, and enlarges fonts for sensory relief.
- **DevCompass Mode**: Developer-focused mode featuring Pomodoro timers, break alerts, and session tracking.
- **ZenFlow Mode**: Promotes mental health alongside breathing exercises, calming page tints, and stress logging.
- **FocusLens Mode**: Assists students by blurring distractions, pausing videos during inattention, and performing fatigue checks.

## Setup Instructions

### Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked" and select the `extension` folder found in this repository.
4. Pin the extension to your toolbar and allow camera permissions for real-time tracking when prompted.

### Streamlit Backend
1. Navigate to the `web` directory in your terminal.
2. Install the necessary Python requirements.
```bash
pip install -r requirements.txt
```
3. Run the application.
```bash
streamlit run app.py
```

## Technical Stack
- Vanilla HTML, CSS, and JavaScript for the extension UI and UX.
- Chrome Extension Manifest V3 for optimal security and performance.
- MediaPipe Tasks Vision (WASM) for completely localized, in-browser machine learning inference.
- Chart.js for live data visualization within the extension side panel and options page.
- Python, Streamlit, and Py-Feat for the advanced scientific testing backend.
