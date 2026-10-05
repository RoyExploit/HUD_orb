"""Check wake-word packages; only install what is missing. Prints progress lines."""
import importlib.util as u, os, subprocess, sys

PKGS = {"openwakeword": "openwakeword", "onnxruntime": "onnxruntime",
        "sounddevice": "sounddevice", "numpy": "numpy"}

missing = [pip for mod, pip in PKGS.items() if u.find_spec(mod) is None]
if missing:
    print(f"Installing: {', '.join(missing)}", flush=True)
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", *missing])
    if r.returncode:
        sys.exit(1)
else:
    print("Wake-word packages already installed.", flush=True)

# openWakeWord also needs its shared feature models (melspectrogram + embedding).
import openwakeword
mdir = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models")
if not (os.path.exists(os.path.join(mdir, "melspectrogram.onnx"))
        and os.path.exists(os.path.join(mdir, "embedding_model.onnx"))):
    print("Downloading openWakeWord feature models…", flush=True)
    import openwakeword.utils as ou
    ou.download_models()
print("Wake-word packages ready.", flush=True)
