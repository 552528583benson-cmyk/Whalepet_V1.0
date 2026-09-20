# GitHub implementation references

Publication note: this lightweight repository does not include the private development workspace's `references/` snapshots or historical asset-processing tools mentioned below. The current release bundles only the original WhalePet runtime artwork. Reference notices are retained for provenance.

WhalePet remains a standalone Electron desktop application. No referenced plugin is installed into the user's DeepSeek Harness profile, and no third-party character artwork was copied into the active design asset set.

The following MIT-licensed repositories were reviewed on 2026-08-21:

- `cakeni/harness-pet` at `29bb8f0fbba5514b83300a103e2a1088a02b433a`
  - Reference: deterministic state precedence, completion as a timed transient, settings/position persistence, cleanup discipline.
- `nzl153/pet-whale` at `4f9a7fc4f44d33968c8fc15e2df9ee88e4cf5552`
  - Reference: 2500ms working-state stickiness so short tool gaps do not flash back to idle; click/drag separation.
- `Sutera-Diffusus/dsh-whale-musume` at `032ff113d75116d573a555bc32eca52f788dbdc9`
  - Reference: motion-hidden pose replacement (compress, swap at peak motion, spring back), drag-direction tilt, stale-transition recovery principles.
- `Er1c0v0/dsh-whale-pet` at `2e10c80abecfb66e599dac82609295659c3657de`
  - Earlier reference: local-only state mapping, reduced-motion behavior, immutable input verification and edge-connected background removal.

Adaptations in this project are intentionally small and rewritten for the standalone Electron architecture. Repository snapshots are stored under `references/` for audit. MIT notices are recorded in `LICENSES/GITHUB-REFERENCES-MIT.txt`.

Offline asset preparation also uses `opencv-python-headless` 4.13.0.92 from PyPI. OpenCV is Apache-2.0 licensed and the Python packaging project is MIT licensed. It is used only by `work/interpolate_transition_frames.py`; WhalePet has no OpenCV runtime dependency or network requirement.

## v0.10.3 motion research

- VPet (`LorisYounger/VPet`) was reviewed as a mature open-source desktop-pet reference. Its architecture separates graph playback (`PNGAnimation`, `Picture`) from display/state logic and explicitly supports alternative Live2D/Spine renderers. No VPet artwork or code was copied.
- Live2D Cubism's official motion documentation was reviewed for time-based motion management, per-motion fade behavior, stable end poses, and loop interpolation.
- Toon Boom's official pose-to-pose material was reviewed for key poses, breakdowns, in-betweens, spatial spacing and preserving character volume.
- MDN's `requestAnimationFrame` documentation was used for display-synchronised, timestamp-based playback instead of unsynchronised short timers.

## v0.11 anatomy-safe runtime decision

The v0.10.3 research remains useful, but a local frame-detail audit showed that whole-character interpolation was the wrong representation for this artwork: accessories changed shape inside the drawings themselves. Version 0.11 therefore follows the project's already-successful drag model—few intact bitmaps, one visible layer, and continuous compositor motion. No third-party code or artwork was copied for this change, and the desktop runtime has no network or paid dependency.
