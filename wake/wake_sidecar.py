"""Owns the mic. Emits JSON lines: level / score / wake / ready / error."""
import argparse, json, queue, time
import numpy as np

def emit(**k): print(json.dumps(k), flush=True)

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--threshold", type=float, default=0.5)
ap.add_argument("--cooldown", type=float, default=2.0)
a = ap.parse_args()

try:
    import sounddevice as sd
    from openwakeword.model import Model
    model = Model(wakeword_models=[a.model], inference_framework="onnx")
except Exception as e:
    emit(type="error", msg=f"Wake model failed to load: {e}"); raise SystemExit(1)

q = queue.Queue()
def cb(indata, frames, t, status): q.put(indata[:, 0].copy())

CHUNK = 1280  # 80 ms @ 16 kHz, what openWakeWord expects
try:
    with sd.InputStream(samplerate=16000, channels=1, dtype="int16", blocksize=CHUNK, callback=cb):
        emit(type="ready")
        level, last = 0.0, 0.0
        while True:
            frame = q.get()
            rms = float(np.sqrt(np.mean((frame.astype(np.float32) / 32768.0) ** 2)))
            level = level * 0.7 + min(1.0, rms * 12.0) * 0.3
            emit(type="level", v=round(level, 3))
            score = max(model.predict(frame).values(), default=0.0)
            emit(type="score", v=round(float(score), 3))
            if score >= a.threshold and time.time() - last > a.cooldown:
                last = time.time(); model.reset()
                emit(type="wake", score=round(float(score), 3))
except Exception as e:
    emit(type="error", msg=f"Mic/stream error: {e}"); raise SystemExit(1)
