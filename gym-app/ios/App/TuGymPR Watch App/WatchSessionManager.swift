import Foundation
import WatchConnectivity
import Combine

class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    // MARK: - Workout state
    @Published var isWorkoutActive = false
    @Published var exerciseName = ""
    @Published var setNumber = 0
    @Published var totalSets = 0
    @Published var suggestedWeight: Double = 0
    @Published var suggestedReps = 0
    @Published var restSeconds = 0
    @Published var isResting = false
    @Published var elapsedSeconds = 0
    @Published var exerciseCategory = ""

    // MARK: - Workout ended
    @Published var workoutJustEnded = false
    @Published var endedDuration = 0
    @Published var endedVolume: Double = 0
    @Published var endedPRs = 0
    @Published var endedSetsCompleted = 0

    // MARK: - Routines for Quick Start
    @Published var availableRoutines: [[String: Any]] = []

    // MARK: - Connection
    @Published var isReachable = false

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - Send messages to iPhone

    func startWorkout(routineId: String) {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "start_workout", "routineId": routineId], replyHandler: nil)
    }

    func completeSet(actualReps: Int, actualWeight: Double) {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage([
            "action": "complete_set",
            "actualReps": actualReps,
            "actualWeight": actualWeight
        ], replyHandler: nil)
    }

    func skipRest() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "skip_rest"], replyHandler: nil)
        DispatchQueue.main.async {
            self.isResting = false
        }
    }

    func endWorkout() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "end_workout"], replyHandler: nil)
    }

    func requestRoutines() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "request_routines"], replyHandler: nil)
    }

    func dismissSummary() {
        DispatchQueue.main.async {
            self.workoutJustEnded = false
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async {
            self.handleMessage(message)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.handleMessage(applicationContext)
        }
    }

    private func handleMessage(_ ctx: [String: Any]) {
        guard let type = ctx["type"] as? String else { return }

        switch type {
        case "workout_active":
            isWorkoutActive = true
            workoutJustEnded = false
            exerciseName = ctx["exerciseName"] as? String ?? ""
            setNumber = ctx["setNumber"] as? Int ?? 0
            totalSets = ctx["totalSets"] as? Int ?? 0
            suggestedWeight = ctx["suggestedWeight"] as? Double ?? 0
            suggestedReps = ctx["suggestedReps"] as? Int ?? 0
            restSeconds = ctx["restSeconds"] as? Int ?? 0
            isResting = ctx["isResting"] as? Bool ?? false
            elapsedSeconds = ctx["elapsedSeconds"] as? Int ?? 0
            exerciseCategory = ctx["exerciseCategory"] as? String ?? "unknown"

        case "workout_ended":
            isWorkoutActive = false
            workoutJustEnded = true
            endedDuration = ctx["duration"] as? Int ?? 0
            endedVolume = ctx["totalVolume"] as? Double ?? 0
            endedPRs = ctx["prsHit"] as? Int ?? 0
            endedSetsCompleted = ctx["setsCompleted"] as? Int ?? 0

        case "routines_sync":
            if let routines = ctx["routines"] as? [[String: Any]] {
                availableRoutines = routines
            }

        default:
            break
        }
    }
}
