"""Drop into your assistant. Drives the HUD orb over localhost."""
import json, urllib.request
def _post(path, body):
    try:
        urllib.request.urlopen(urllib.request.Request(
            f"http://127.0.0.1:17890{path}", json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=0.3)
    except Exception: pass
def set_state(state, hold=0): _post("/state", {"state": state, "hold": hold})   # idle | listening | speaking
def feed_amplitude(level):    _post("/amp", {"level": level})                    # 0..1 while TTS plays
