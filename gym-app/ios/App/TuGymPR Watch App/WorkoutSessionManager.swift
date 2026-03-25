import Foundation
import HealthKit
import Combine
import WatchConnectivity

enum HeartRateZone: String {
    case warmup  = "WARM UP"
    case fatBurn = "FAT BURN"
    case cardio  = "CARDIO"
    case peak    = "PEAK"

    var color: SwiftUI.Color {
        switch self {
        case .warmup:  return .blue
        case .fatBurn: return .green
        case .cardio:  return .orange
        case .peak:    return .red
        }
    }

    var icon: String {
        switch self {
        case .warmup:  return "figure.walk"
        case .fatBurn: return "flame.fill"
        case .cardio:  return "bolt.heart.fill"
        case .peak:    return "exclamationmark.triangle.fill"
        }
    }

    /// Zone boundaries (simplified; ideally based on user max HR)
    static func from(bpm: Double) -> HeartRateZone {
        switch bpm {
        case ..<100:  return .warmup
        case ..<130:  return .fatBurn
        case ..<160:  return .cardio
        default:      return .peak
        }
    }
}

import SwiftUI

class WorkoutSessionManager: NSObject, ObservableObject {
    @Published var currentHeartRate: Double = 0
    @Published var averageHeartRate: Double = 0
    @Published var heartRateZone: HeartRateZone = .warmup
    @Published var isSessionActive: Bool = false

    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var heartRateSamples: [Double] = []
    private var hrQuery: HKAnchoredObjectQuery?

    func requestAuthorization() {
        let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let workoutType = HKObjectType.workoutType()
        healthStore.requestAuthorization(toShare: [workoutType], read: [hrType]) { _, _ in }
    }

    func startSession() {
        guard !isSessionActive else { return }
        requestAuthorization()

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)

            let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
            builder.dataSource?.enableCollection(for: hrType, predicate: nil)

            self.workoutSession = session
            self.builder = builder

            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { _, _ in }

            isSessionActive = true
            heartRateSamples = []

            // Observe HR updates
            let query = HKAnchoredObjectQuery(
                type: hrType,
                predicate: nil,
                anchor: nil,
                limit: HKObjectQueryNoLimit
            ) { _, _, _, _, _ in }

            query.updateHandler = { [weak self] _, samples, _, _, _ in
                guard let self,
                      let samples = samples as? [HKQuantitySample],
                      let latest = samples.last else { return }

                let bpm = latest.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                DispatchQueue.main.async {
                    self.currentHeartRate = bpm
                    self.heartRateZone = HeartRateZone.from(bpm: bpm)
                    self.heartRateSamples.append(bpm)
                    self.averageHeartRate = self.heartRateSamples.reduce(0, +) / Double(self.heartRateSamples.count)

                    // Send live HR to phone (every 5th sample to avoid flooding)
                    if self.heartRateSamples.count % 5 == 0, WCSession.default.isReachable {
                        WCSession.default.sendMessage([
                            "action": "heart_rate_update",
                            "bpm": Int(bpm),
                            "avgBPM": Int(self.averageHeartRate),
                            "zone": self.heartRateZone.rawValue,
                        ], replyHandler: nil, errorHandler: nil)
                    }
                }
            }

            self.hrQuery = query
            healthStore.execute(query)
        } catch {
            print("Failed to start workout session: \(error)")
        }
    }

    func stopSession() {
        if let query = hrQuery {
            healthStore.stop(query)
            hrQuery = nil
        }
        // Send HR summary to phone before ending
        sendHeartRateSummary()
        workoutSession?.end()
        builder?.endCollection(withEnd: Date()) { [weak self] _, _ in
            self?.builder?.finishWorkout { _, _ in }
        }
        isSessionActive = false
    }

    /// Send heart rate data to the iPhone for the session summary
    private func sendHeartRateSummary() {
        guard WCSession.default.isReachable else { return }
        let maxHR = heartRateSamples.max() ?? 0
        let minHR = heartRateSamples.filter { $0 > 0 }.min() ?? 0
        WCSession.default.sendMessage([
            "action": "heart_rate_summary",
            "averageBPM": Int(averageHeartRate),
            "maxBPM": Int(maxHR),
            "minBPM": Int(minHR),
            "samples": heartRateSamples.count,
        ], replyHandler: nil, errorHandler: nil)
    }
}
