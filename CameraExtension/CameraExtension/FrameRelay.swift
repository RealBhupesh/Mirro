import CoreMedia
import CoreMediaIO
import Foundation
import MirrorCore

final class FrameRelay {
    // A single queue owns stream lifetimes and completion state. Framework entry
    // points call in from the provider queue. Sink completions return asynchronously.
    private let queue = DispatchQueue(label: "Mirro.camera-relay", qos: .userInitiated)
    private let clock = CMClockGetHostTimeClock()
    private weak var source: CMIOExtensionStream?
    private weak var sink: CMIOExtensionStream?
    private var sourceCount = 0
    private var producer: CMIOExtensionClient?
    private var timer: DispatchSourceTimer?
    private var generation: UInt64 = 0
    private var pending = false

    func bind(source: CMIOExtensionStream, sink: CMIOExtensionStream) {
        queue.sync {
            self.source = source
            self.sink = sink
        }
    }

    func reserveSink(for client: CMIOExtensionClient) -> Bool {
        queue.sync {
            if let producer = producer { return producer === client }
            producer = client
            return true
        }
    }

    func disconnect(_ client: CMIOExtensionClient) {
        queue.sync {
            if producer === client { clearSink() }
        }
    }

    func startSource() {
        queue.sync { sourceCount += 1 }
    }

    func stopSource() {
        queue.sync { sourceCount = max(0, sourceCount - 1) }
    }

    func startSink() throws {
        try queue.sync {
            guard producer != nil, sink != nil else { throw StreamError.missingProducer }
            guard timer == nil else { return }
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now(),
                           repeating: .nanoseconds(1_000_000_000 / Int(CameraFormat.framesPerSecond)),
                           leeway: .milliseconds(2))
            timer.setEventHandler { [weak self] in self?.consume() }
            self.timer = timer
            timer.resume()
        }
    }

    func stopSink() {
        queue.sync { clearSink() }
    }

    private func clearSink() {
        generation &+= 1
        timer?.cancel()
        timer = nil
        pending = false
        producer = nil
    }

    private func consume() {
        guard timer != nil, !pending, let producer = producer, let sink = sink else { return }
        pending = true
        let requestGeneration = generation
        // VERIFY-ON-MAC: check the consume/acknowledgement contract and callback timing on hardware.
        sink.consumeSampleBuffer(from: producer) { [weak self] sample, sequence, flags, hasMore, error in
            guard let self = self else { return }
            self.queue.async {
                guard self.generation == requestGeneration else { return }
                self.pending = false
                guard error == nil else { return }
                if let sample = sample {
                    self.relay(sample, sequence: sequence, flags: flags)
                }
                if hasMore { self.consume() }
            }
        }
    }

    private func relay(_ sample: CMSampleBuffer, sequence: UInt64, flags: CMIOExtensionStream.DiscontinuityFlags) {
        if sourceCount > 0, let timestamp = CameraFormat.hostNanoseconds(
            for: CMSampleBufferGetPresentationTimeStamp(sample)
        ) {
            source?.send(sample, discontinuity: flags, hostTimeInNanoseconds: timestamp)
        }

        if let now = CameraFormat.hostNanoseconds(for: CMClockGetTime(clock)) {
            let scheduled = CMIOExtensionScheduledOutput(sequenceNumber: sequence, hostTimeInNanoseconds: now)
            sink?.notifyScheduledOutputChanged(scheduled)
        }
    }
}
