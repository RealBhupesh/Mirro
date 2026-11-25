# MediaPipe runtime and model

- `vision_bundle.mjs`, `vision_wasm_internal.js` and `vision_wasm_internal.wasm` come from [@mediapipe/tasks-vision 0.10.32](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.32). Mirro uses the SIMD WebAssembly build.
- `hand_landmarker.task` is [Google's Hand Landmarker model, float16 version 1](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task). [Model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker).

The runtime and model are distributed under [Apache License 2.0](LICENSE).
