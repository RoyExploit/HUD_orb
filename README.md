# Particle Orb HUD

Desktop version of `particle_orb.py`: transparent, frameless, always-on-top, draggable orb.
Idle = small & dim · you speak / wake word / assistant speaks = it **pops** to full size.
Same colors as your original (`STATE_COLORS`): teal → blue (listening) → magenta/orange (speaking).

## Run
    npm install
    npm start          # dev
    npm run dist       # Windows installer (NSIS) -> dist/

First launch: the HUD checks for `openwakeword`, `onnxruntime`, `sounddevice`, `numpy`
(skips anything already installed, installs only what's missing, downloads openWakeWord's
feature models once), then asks for your **.onnx file** and **call name** in the hover panel.
Watch the purple score bar while you say the phrase — it flashes “TRIGGERED” when it fires.

## Hover panel
Hover (or click) the orb: wake settings, server links (▶ launch, checkbox = open at startup,
“Launch all”), start-with-computer toggle, Quit. Drag the orb to move it; position is saved.

## Drive it from your assistant
    from orb_client import set_state, feed_amplitude
    set_state("speaking"); feed_amplitude(0.6)   # repeatedly while TTS plays
    set_state("idle")
Wake word → auto “listening” for 8s (`wakeHoldSec` in config.json).
