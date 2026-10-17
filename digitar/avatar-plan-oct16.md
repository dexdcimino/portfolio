# Digitar Avatar — build plan (started Oct 16, 2026)

Dex's call: Digitar data stays in the portfolio repo (dexcimino/portfolio, `digitar/` folder) — no separate repo. The avatar is Digitar Phase 3, now active as a planned build. Deep tool research: `digitar-avatar-research-oct16.md` (research lane, Oct 16).

## What it is
A live 3D avatar of Dex that overlays onto streams (OBS) and performs as him:
- **Mode A — camera ON:** webcam face/head tracking drives the model (head pose, expressions, mouth from his speech).
- **Mode B — camera OFF:** the avatar still talks & gestures on its own — audio (mic or TTS) drives lip sync; gestures + expressions run procedurally from an emotion system.
- **Expressions:** an emotion class system (neutral / happy / angry / sad / squint-thinking / surprised…) expressed through eyes, brows & mouth, following the conversation procedurally; when the Digitar brain speaks, its text carries emotion tags the state machine follows.

## Stack verdict (Bash)
- **Unity + C#** — Dex's instinct is right. The whole toolchain lives there: uLipSync (audio→viseme), UniVRM, MediaPipe face tracking, Spout→OBS. Unreal is overkill for a stylized overlay; Godot lacks the plugin ecosystem.
- **Model:** authored by Dex (Maya/ZBrush/Substance). VRM is the standard portable container; FBX + blendshapes into Unity also works. Needed shape set: ~15 visemes + a lean expression set (lids, brows, eye-wide, emotion combos). ARKit-52 is the gold standard but heavy; a lean custom set is the v1 target.
- **Mouth:** ONE driver for both modes — uLipSync analyzes audio in real time (mic in Mode A, TTS/audio in Mode B) and outputs visemes. Dex's sprite-plane mouth idea uses the identical signal chain (it's how 2D VTubers work) — viable fast fallback; blendshape visemes are the v1 aim since he's sculpting anyway.
- **Tracking (Mode A):** MediaPipe Face Landmarker in Unity → head pose + face blendshapes from a plain webcam; OneEuro smoothing against jitter; blink + gaze from the same landmarks.
- **Autonomous layer (Mode B):** emotion state machine (blendshape preset blends + transitions), procedural idle sway, gesture clips triggered by speech-energy peaks, blink timer. Eyes are driven by lid/brow shapes + pupil look-at, never by scaling the eyeball.
- **Stream output:** Unity transparent render → Spout2 into OBS as an overlay. Audio→mouth latency target ~50–80 ms (feels live).

## Phases
- **P0 — Talking head from audio only:** model + viseme set + uLipSync + OBS overlay. Proves everything; serves both modes from day one.
- **P1 — Webcam tracking:** MediaPipe head pose + expressions (Mode A complete).
- **P2 — Emotion system + gestures:** state machine, expression classes, procedural gesture layer (Mode B complete).
- **P3 — Digitar brain hookup:** TTS persona + emotion tags from conversation; the avatar performs as digital Dex unattended.

## Dex supplies
The model, the viseme sculpt set, a handful of expression shapes. Everything else is code & plugins.

## Open items
- Repo layout for the Unity project (research lane proposes; likely its own project folder next to `digitar/` in the portfolio repo, with build artifacts gitignored).
- Model style: Proto Isles-style stick figure (Dex's Oct 15 seed idea) vs a fuller character — his call when he models.

## Research verdicts (Oct 16, deep lane — full report: digitar-avatar-research-oct16.md)
- Unity + C# confirmed. Model = VRM 1.0 with ARKit-52-NAMED blendshapes as the interchange contract (every driver — MediaPipe, iPhone, Audio2Face — speaks ARKit names). Two layers: tracking writes ARKit channels; the emotion engine writes VRM presets; layers add per frame.
- Lip sync: uLipSync (free, mic + TTS). NVIDIA Audio2Face-3D = Phase-4 upgrade (full face + emotion from voice).
- Tracking: MediaPipe Face Landmarker via a Python sidecar → UDP/VMC → Unity; OneEuro filtering mandatory. iPhone/iFacialMocap is an upgrade path only (Dex is on Pixel — webcam is primary).
- OBS: KlakSpout/Spout2, true alpha.
- Sprite-plane mouth: SKIP (research verdict) — 5 vowel blendshapes are an afternoon of sculpting for Dex and sprites dead-end in 3D.
- Phase 0 shortcut: Warudo (free) hosts a sample VRM immediately — webcam tracking, mic lip sync, idle animations, expression presets, C# plugin SDK. Custom Unity app replaces the host phase by phase; the model is never re-authored.
- Layout: archive text stays in portfolio digitar/ (add digitar/avatar/ for specs/logs); the Unity project lives OUTSIDE the portfolio repo (~/workspace/digitar-avatar/) — build artifacts would bloat it. Dex's data stays in the Dex repo; only the app binary project sits apart.

## Lighting direction (Dex, Oct 16, 2026)
The avatar scene matches the GAME's lighting, not a generic studio setup.
Dex is building a scene/environment as a lighting study of WorldHop's
environment + ambience + general lighting. Unity scene should recreate
that environment lighting (ambient/IBL feel, key light color/intensity,
rim) so the character reads exactly as he does in-game. 3-point setup is
only a supplement if the game match needs help.

## Operator-only options UI (Dex, Oct 16, 2026)
The avatar app needs a private control UI for Dex only — never visible in
the stream/OBS output. Stream output stays a clean avatar render (Spout
from the render camera); controls live in the operator window/panel.

Tabs/sections:
- **Gear:** switch cosmetic pieces live — eyes, mouth parts, head/hair
  pieces, accessories, material colors.
- **Lighting:** simple preset switching for comparison:
  1. **Game Match** — recreate WorldHop environment/ambience/general
     lighting as closely as possible.
  2. **Basic Studio** — clean 3-point studio setup (key/fill/rim).
  3. **Hybrid** — game ambience as the base + studio key/rim boost for
     stream readability.
  Keep options SIMPLE: preset buttons first; a few sliders only if needed
  (intensity / warmth / rim strength).
- **Face/Test (implied by workflow):** trigger mouths/eyes/emotions by
  hand for testing the swap rig.

Dex wants to compare Bash's Unity lighting takes: game-match vs basic
studio vs hybrid, side by side, before locking the look.

## Future idea (Dex, Oct 16, 2026 — vague, parked, NOT committed)
Live lighting sync with the game: if it's night in-game, the stream
character is lit dark too. Mechanism when/if built: the game (or a small
companion feed) publishes its lighting state — time of day, ambient/sky
color, fog color, sun intensity — and the avatar scene applies the same
values to its own lights. Sibling of the shared character-config idea
(colors + piece IDs); lighting state would ride the same channel.
The options UI is designed to keep growing sections over time.

## How UI vs stream output works (explained to Dex, Oct 16, 2026)
One Unity app, two outputs. (1) Stream render: a dedicated camera renders
ONLY the 3D scene -> Spout -> OBS. The UI is never in that camera's view.
(2) Operator display: Dex's monitor shows the scene PLUS the control panel
layer on top. Controls change the scene; the stream sees the result,
never the controls themselves.
