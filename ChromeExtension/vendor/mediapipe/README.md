# MediaPipe runtime and model

- `vision_bundle.mjs`, `vision_wasm_internal.js` and the binary in `vision_wasm_internal.wasm.gz` come from [@mediapipe/tasks-vision 0.10.32](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.32). Mirro uses the SIMD WebAssembly build.
- `hand_landmarker.task.gz` contains [Google's Hand Landmarker model, float16 version 1](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task). [Model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker).

Both binaries are stored as gzip without modifying their contents. To regenerate them, run `gzip -9 -n -c FILE > FILE.gz` on each original; keep only the compressed binaries here. Chrome decompresses them locally when Finger snap starts.

The runtime and model are distributed under [Apache License 2.0](LICENSE).
