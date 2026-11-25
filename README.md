# Mirro

Mirro is a lightweight, native macOS menu bar app for publishing a horizontally mirrored MacBook camera feed to a virtual camera named **Mirro**. It is intended for use with Google Meet, Zoom, and Microsoft Teams. Mirro changes the pixels in the outgoing frames. Meeting apps may apply their own mirroring to the local preview.

Mirro uses Swift, SwiftUI, and Apple frameworks on macOS 12.3 and later. It has no third-party runtime dependencies. The source is available under the [MIT license](LICENSE).

## Status / Not verified

Mirro was written on Linux. Nothing has been compiled, run, camera-tested, or tested in Google Meet, Zoom, or Microsoft Teams. Linux validation covered YAML, property lists, and the repository layout. The GitHub Actions job is configured to run the package tests and make an unsigned compile-check build on macOS. That build cannot validate extension signing, activation, or video delivery.

The System Extension capability requires signing with an Apple Developer Program team that supports it. Free Personal Teams are reported not to support this capability. Install and run Mirro from `/Applications`. Approve the camera extension when macOS prompts you in **System Settings > Privacy & Security**. macOS 12 uses **System Preferences > Security & Privacy**. [Apple’s guide to creating a Core Media I/O camera extension](https://developer.apple.com/documentation/coremediaio/creating-a-camera-extension-with-core-media-i-o).

## Build on macOS

1. Install Xcode with a macOS SDK and install XcodeGen, for example with `brew install xcodegen`.
2. Replace the empty `DEVELOPMENT_TEAM` and the three `com.example.Mirro*` bundle ID placeholders in [project.yml](project.yml). The XcodeGen camera target key and the host’s embed dependency follow the extension bundle ID through a YAML alias.
3. In your developer account, configure the App Group for the host and camera extension identifiers. The spec uses `$(TeamIdentifierPrefix)$(MIRRO_APP_BUNDLE_ID)` as the macOS group and prefixes the extension’s Mach service name with that group. If you change the group, keep both targets and the service name aligned.
4. Generate the project and run the package tests.

   ```sh
   xcodegen generate
   swift test
   ```

5. Open `Mirro.xcodeproj`, select the **Mirro** scheme, and build with signing enabled. Copy the signed `Mirro.app` into `/Applications` before opening it.

For an unsigned build using the placeholders, generate the project and run the same compile check used by CI.

```sh
xcodegen generate
xcodebuild -project Mirro.xcodeproj -scheme Mirro -configuration Debug \
  -destination 'generic/platform=macOS' -derivedDataPath DerivedData \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

## Intended use

1. Open Mirro from `/Applications` and click the video icon in the menu bar.
2. Select the built-in camera or another available camera source. **Mirror horizontally** is enabled by default.
3. Click **Start virtual camera**, grant camera access, and approve the extension when prompted.
4. Select **Mirro** in your meeting app’s camera chooser. Check the outgoing orientation with a second device or participant using an asymmetric object, such as a card with text.
5. Click **Stop virtual camera** to release the physical camera. The virtual device stays registered and stops receiving frames. **Launch at login** opens Mirro in the Stopped state.

## Architecture

- **Host app.** An AppKit status item opens a SwiftUI popover. The host requests camera access and activates the bundled system extension using `OSSystemExtensionRequest`. It uses `SMAppService.mainApp` for launch at login on macOS 13 and later and an embedded ServiceManagement login helper on macOS 12.
- **Capture and processing.** An `AVCaptureSession` and `AVCaptureVideoDataOutput` deliver BGRA frames on a serial queue. Mirro requests 720p and locks capture to 30 FPS when the negotiated device format supports it. A host-clock timing gate caps faster inputs at 30 FPS. Core Image renders into a small, bounded pool of IOSurface-backed 1280 × 720 buffers, center-cropping and optionally reflecting the image in one pass. Under load Mirro drops frames instead of accumulating latency.
- **Frame transport.** The device publishes two `CMIOExtensionStream`s. The host opens the sink through the CoreMediaIO C API and enqueues timed sample buffers in its bounded `CMSimpleQueue`. The extension consumes and acknowledges those samples, then forwards them through its source stream to camera clients with the original host-clock timestamps. There is no application-level serialization or second render. The relay drains the sink while capture is active, including when no meeting app is reading.
- **Project layout.** The host, camera extension, and login helper are hardened XcodeGen targets. The camera extension is embedded under `Contents/Library/SystemExtensions` and the login helper under `Contents/Library/LoginItems`. The host and extension share an App Group for the extension’s Mach service. Frame transport uses the sink stream. The dependency-free `MirrorCore` Swift package contains settings, format identifiers, frame timing, and pixel processing tests.

## First macOS checks

The following code paths have `VERIFY-ON-MAC` comments and need SDK or runtime verification.

| Code | Check |
| --- | --- |
| [CameraSink.swift](App/CameraSink.swift) and [CameraProvider.swift](CameraExtension/CameraProvider.swift) | Confirm device UUID visibility in CoreMediaIO and AVFoundation, output-scope sink discovery, queue creation, and the fixed-format and queue-size properties. |
| [CameraSink.swift](App/CameraSink.swift) and [FrameRelay.swift](CameraExtension/FrameRelay.swift) | Confirm queue ownership on consume and stop, sample acknowledgement, and callback timing through stop, restart, and client disconnect. |
| [CapturePipeline.swift](App/CapturePipeline.swift) and [MirroController.swift](App/MirroController.swift) | Confirm physical-camera discovery and filtering, negotiated frame rate and orientation, and switching and unplugging sources. |
| [LoginPreference.swift](App/LoginPreference.swift) | Verify registration, launch, and removal with the embedded helper on macOS 12, and exercise the modern login toggle as well. |

Also verify XcodeGen’s two embed phases, signed entitlements and Mach service expansion, approval and activation from `/Applications`, and outgoing pixels in a meeting.
