import Foundation
import CoreMotion
import Combine

enum ExerciseCategory: String, CaseIterable {
    case push       // bench press, OHP, pushups
    case pull       // rows, pulldowns
    case squat      // squats, leg press
    case hinge      // deadlift, RDL
    case isolation  // curls, extensions, lateral raises
    case unknown    // fallback: use acceleration magnitude

    /// Which axis of wrist acceleration best captures the rep motion
    enum Axis { case x, y, z, magnitude }

    var primaryAxis: Axis {
        switch self {
        case .push:      return .z
        case .pull:      return .z
        case .squat:     return .y
        case .hinge:     return .y
        case .isolation: return .x
        case .unknown:   return .magnitude
        }
    }

    /// Minimum acceleration delta (g) to register as a rep peak
    var peakThreshold: Double {
        switch self {
        case .push:      return 0.35
        case .pull:      return 0.35
        case .squat:     return 0.40
        case .hinge:     return 0.45
        case .isolation: return 0.25
        case .unknown:   return 0.35
        }
    }

    /// Minimum seconds between reps to prevent double-counting
    var minimumRepDuration: TimeInterval {
        switch self {
        case .push:      return 1.2
        case .pull:      return 1.0
        case .squat:     return 1.5
        case .hinge:     return 1.8
        case .isolation: return 0.8
        case .unknown:   return 1.2
        }
    }

    /// Low-pass filter smoothing factor (lower = smoother, more lag)
    var filterAlpha: Double {
        switch self {
        case .push:      return 0.15
        case .pull:      return 0.15
        case .squat:     return 0.12
        case .hinge:     return 0.10
        case .isolation: return 0.20
        case .unknown:   return 0.15
        }
    }

    static func from(_ string: String) -> ExerciseCategory {
        ExerciseCategory(rawValue: string.lowercased()) ?? .unknown
    }
}

class RepCountingManager: ObservableObject {
    @Published var repCount: Int = 0
    @Published var isTracking: Bool = false

    private let motionManager = CMMotionManager()
    private var category: ExerciseCategory = .unknown

    // Signal processing state
    private var filteredValue: Double = 0
    private var previousFiltered: Double = 0
    private var isRising: Bool = false
    private var lastRepTime: Date = .distantPast
    private var baselineValue: Double = 0
    private var calibrationSamples: [Double] = []
    private let calibrationCount = 25 // ~0.5s at 50Hz

    func startCounting(for categoryName: String) {
        guard motionManager.isDeviceMotionAvailable else { return }
        category = ExerciseCategory.from(categoryName)
        resetCount()
        isTracking = true
        filteredValue = 0
        previousFiltered = 0
        isRising = false
        calibrationSamples = []

        motionManager.deviceMotionUpdateInterval = 1.0 / 50.0 // 50Hz
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let motion else { return }
            self.processMotion(motion)
        }
    }

    func stopCounting() {
        motionManager.stopDeviceMotionUpdates()
        isTracking = false
    }

    func resetCount() {
        repCount = 0
        lastRepTime = .distantPast
        calibrationSamples = []
    }

    private func processMotion(_ motion: CMDeviceMotion) {
        let accel = motion.userAcceleration
        let raw: Double

        switch category.primaryAxis {
        case .x:         raw = accel.x
        case .y:         raw = accel.y
        case .z:         raw = accel.z
        case .magnitude: raw = sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z)
        }

        // Calibration phase: establish baseline
        if calibrationSamples.count < calibrationCount {
            calibrationSamples.append(raw)
            if calibrationSamples.count == calibrationCount {
                baselineValue = calibrationSamples.reduce(0, +) / Double(calibrationCount)
                filteredValue = baselineValue
                previousFiltered = baselineValue
            }
            return
        }

        let centered = raw - baselineValue

        // Exponential low-pass filter
        let alpha = category.filterAlpha
        filteredValue = alpha * centered + (1 - alpha) * previousFiltered

        // Peak detection state machine
        let threshold = category.peakThreshold
        let now = Date()

        if filteredValue > threshold && !isRising {
            // Crossed above threshold — start of potential rep
            isRising = true
        } else if filteredValue < threshold * 0.3 && isRising {
            // Crossed back below (with hysteresis) — rep completed
            isRising = false
            let elapsed = now.timeIntervalSince(lastRepTime)
            if elapsed >= category.minimumRepDuration {
                lastRepTime = now
                DispatchQueue.main.async {
                    self.repCount += 1
                }
            }
        }

        previousFiltered = filteredValue
    }
}
