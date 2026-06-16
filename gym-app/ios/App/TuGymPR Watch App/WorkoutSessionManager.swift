import Foundation
import HealthKit
import CoreLocation
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

class WorkoutSessionManager: NSObject, ObservableObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate, CLLocationManagerDelegate {
    @Published var currentHeartRate: Double = 0
    @Published var averageHeartRate: Double = 0
    @Published var heartRateZone: HeartRateZone = .warmup
    @Published var isSessionActive: Bool = false

    // Cardio-only live stats (LiveCardioWatchView reads these)
    @Published var caloriesBurned: Int = 0
    @Published var distanceMeters: Double = 0
    /// Whether the current cardio session is GPS-enabled (outdoor activity).
    /// LiveCardioWatchView shows the distance tile only when this is true.
    @Published var gpsEnabled: Bool = false

    /// Captured GPS fixes for the current cardio session. Drives the live
    /// route map on LiveCardioWatchView and is shipped to the iPhone on End
    /// (as `[{lat,lng,t}]`) so the saved `cardio_sessions` row has a route the
    /// app can draw — matching a phone-tracked run.
    @Published var routeLocations: [CLLocation] = []

    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var heartRateSamples: [Double] = []
    private var hrQuery: HKAnchoredObjectQuery?

    // GPS — used for outdoor cardio (run/walk/bike/hike). HealthKit's
    // HKLiveWorkoutBuilder only ingests distance from CoreLocation when
    // we're actively updating location, so we drive the location manager
    // ourselves alongside the workout.
    private let locationManager = CLLocationManager()
    private var routeBuilder: HKWorkoutRouteBuilder?

    func requestAuthorization() {
        let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let calType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
        let distType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!
        let workoutType = HKObjectType.workoutType()
        healthStore.requestAuthorization(
            toShare: [workoutType],
            read: [hrType, calType, distType]
        ) { _, _ in }
    }

    /// Map our cardio_type slug to HKWorkoutActivityType. Anything we don't
    /// have a dedicated type for falls through to `.other` so HealthKit
    /// still records the workout.
    private static func hkActivity(for slug: String) -> HKWorkoutActivityType {
        switch slug {
        case "running":       return .running
        case "walking":       return .walking
        case "cycling":       return .cycling
        case "rowing":        return .rowing
        case "elliptical":    return .elliptical
        case "stair_climber": return .stairClimbing
        case "hiking":        return .hiking
        case "hiit":          return .highIntensityIntervalTraining
        case "swimming":      return .swimming
        case "yoga":          return .yoga
        case "pilates":       return .pilates
        case "boxing":        return .boxing
        case "dance":         return .cardioDance
        case "skiing":        return .downhillSkiing
        default:              return .other
        }
    }

    /// Start a watch-only cardio session. Differs from `startSession()` in
    /// that it picks the right HKWorkoutActivityType and turns on calorie +
    /// distance collection so LiveCardioWatchView can render those rings.
    func startCardioSession(activityType slug: String) {
        guard !isSessionActive else { return }
        requestAuthorization()

        let config = HKWorkoutConfiguration()
        config.activityType = WorkoutSessionManager.hkActivity(for: slug)
        let isOutdoor = (slug == "running" || slug == "walking" ||
                          slug == "cycling" || slug == "hiking")
        // Outdoor for run/walk/bike/hike; indoor for the rest. Outdoor is
        // what unlocks distance via watch GPS, indoor keeps the session
        // HR-only. We also drive CoreLocation ourselves for outdoor so
        // distance + route are recorded reliably.
        config.locationType = isOutdoor ? .outdoor : .indoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            session.delegate = self
            builder.delegate = self
            self.workoutSession = session
            self.builder = builder

            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { _, _ in }

            isSessionActive = true
            heartRateSamples = []
            caloriesBurned = 0
            distanceMeters = 0
            routeLocations = []
            gpsEnabled = isOutdoor

            // For outdoor cardio, kick off CoreLocation. HealthKit's data
            // source listens for CL fixes from the workout's data source,
            // but only if we're actively updating — so we own the manager
            // here and pipe fixes into a HKWorkoutRouteBuilder for the
            // saved route map.
            if isOutdoor {
                routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)
                locationManager.delegate = self
                locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
                locationManager.distanceFilter = 5
                locationManager.activityType = (slug == "cycling") ? .fitness : .fitness
                locationManager.allowsBackgroundLocationUpdates = false
                let status = locationManager.authorizationStatus
                if status == .notDetermined {
                    locationManager.requestWhenInUseAuthorization()
                }
                locationManager.startUpdatingLocation()
            }
        } catch {
            print("Failed to start cardio session: \(error)")
        }
    }

    /// Serialize the captured fixes into the `[{lat,lng,t}]` shape the iPhone
    /// stores in `cardio_sessions.route` (identical to gpsTracker.js), so the
    /// app's route map renders a watch-tracked run the same as a phone one.
    private func routePayload() -> [[String: Any]] {
        routeLocations.map { loc in
            [
                "lat": loc.coordinate.latitude,
                "lng": loc.coordinate.longitude,
                "t": Int(loc.timestamp.timeIntervalSince1970 * 1000),
            ]
        }
    }

    /// End a watch-only cardio session and return the summary numbers + route.
    /// Caller is expected to forward the summary to the iPhone via
    /// WatchSessionManager.shared.saveWatchCardio(...).
    func stopCardioSession() -> (durationSeconds: Int, avgHR: Int, calories: Int, distanceKm: Double?, route: [[String: Any]]) {
        let start = builder?.startDate ?? Date()
        let duration = max(0, Int(Date().timeIntervalSince(start)))
        let avg = Int(averageHeartRate)
        let cal = caloriesBurned
        let dist: Double? = distanceMeters > 0 ? distanceMeters / 1000.0 : nil
        let route = routePayload()
        // Stop CL updates first so no late fixes write into a finalized route.
        if gpsEnabled {
            locationManager.stopUpdatingLocation()
            // Finalize the route. We don't strictly need to attach it to a
            // workout object since we're about to send the summary up to
            // the phone, but finishRoute clears HK's internal buffers.
            routeBuilder?.finishRoute(with: HKWorkout(activityType: .other, start: start, end: Date()), metadata: nil) { _, _ in }
            routeBuilder = nil
        }
        workoutSession?.end()
        builder?.endCollection(withEnd: Date()) { [weak self] _, _ in
            self?.builder?.finishWorkout { _, _ in }
        }
        isSessionActive = false
        gpsEnabled = false
        return (duration, avg, cal, dist, route)
    }

    // MARK: - CLLocationManagerDelegate
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Filter out junk fixes (poor accuracy / negative speed) and feed
        // the rest into the route builder + into our running distance tally.
        let good = locations.filter { $0.horizontalAccuracy > 0 && $0.horizontalAccuracy <= 50 }
        guard !good.isEmpty else { return }
        routeBuilder?.insertRouteData(good) { _, _ in }
        // Compute distance ourselves so the UI updates immediately — we
        // don't have to wait for HKLiveWorkoutBuilder to ingest the
        // distanceWalkingRunning samples (which can lag a few seconds).
        if let last = good.last {
            DispatchQueue.main.async {
                if let prev = self._lastFix {
                    let delta = last.distance(from: prev)
                    if delta < 100 { self.distanceMeters += delta } // reject teleports
                }
                self._lastFix = last
                // Append to the live route so the wrist map draws the path as
                // it's run (and so we can ship the full route to the iPhone).
                self.routeLocations.append(contentsOf: good)
            }
        }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Non-fatal — workout still records HR + calories; distance just stays at 0.
        print("CLLocationManager error: \(error.localizedDescription)")
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // If the user grants access mid-session, kick the updates loop.
        if manager.authorizationStatus == .authorizedWhenInUse ||
           manager.authorizationStatus == .authorizedAlways {
            if isSessionActive && gpsEnabled { manager.startUpdatingLocation() }
        }
    }
    private var _lastFix: CLLocation? {
        get { _lastFixStorage }
        set { _lastFixStorage = newValue }
    }
    private var _lastFixStorage: CLLocation?

    // MARK: - HKWorkoutSessionDelegate (no-op stubs — required to set delegate)
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}
    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {}

    // MARK: - HKLiveWorkoutBuilderDelegate
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let builder = self.builder else { return }
        for type in collectedTypes {
            guard let qt = type as? HKQuantityType,
                  let stats = builder.statistics(for: qt) else { continue }

            if qt == HKQuantityType.quantityType(forIdentifier: .heartRate) {
                if let q = stats.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute())) {
                    DispatchQueue.main.async {
                        self.currentHeartRate = q
                        self.heartRateZone = HeartRateZone.from(bpm: q)
                        self.heartRateSamples.append(q)
                        self.averageHeartRate = self.heartRateSamples.reduce(0, +) / Double(self.heartRateSamples.count)
                    }
                }
            } else if qt == HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
                if let q = stats.sumQuantity()?.doubleValue(for: .kilocalorie()) {
                    DispatchQueue.main.async { self.caloriesBurned = Int(q) }
                }
            } else if qt == HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) ||
                      qt == HKQuantityType.quantityType(forIdentifier: .distanceCycling) {
                if let q = stats.sumQuantity()?.doubleValue(for: .meter()) {
                    DispatchQueue.main.async { self.distanceMeters = q }
                }
            }
        }
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
