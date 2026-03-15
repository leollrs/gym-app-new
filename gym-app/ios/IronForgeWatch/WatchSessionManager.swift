import Foundation
import WatchConnectivity
import Combine

class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    // Workout state
    @Published var isWorkoutActive = false
    @Published var exerciseName = ""
    @Published var setNumber = 0
    @Published var totalSets = 0
    @Published var suggestedWeight: Double = 0
    @Published var suggestedReps = 0
    @Published var restSeconds = 0
    @Published var isResting = false
    @Published var elapsedSeconds = 0

    // Workout ended
    @Published var workoutJustEnded = false
    @Published var endedDuration = 0
    @Published var endedVolume: Double = 0
    @Published var endedPRs = 0

    // Today stats
    @Published var steps = 0
    @Published var streak = 0
    @Published var checkedIn = false
    @Published var totalVolume: Double = 0
    @Published var workoutsThisWeek = 0

    // Connection
    @Published var isReachable = false

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - Send messages to iPhone

    func completeSet() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "complete_set"], replyHandler: nil)
    }

    func requestCheckIn() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "check_in"], replyHandler: nil)
    }

    func requestStats() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "request_stats"], replyHandler: nil)
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

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.handleContext(applicationContext)
        }
    }

    private func handleContext(_ ctx: [String: Any]) {
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

        case "workout_ended":
            isWorkoutActive = false
            workoutJustEnded = true
            endedDuration = ctx["duration"] as? Int ?? 0
            endedVolume = ctx["totalVolume"] as? Double ?? 0
            endedPRs = ctx["prsHit"] as? Int ?? 0

        case "today_stats":
            steps = ctx["steps"] as? Int ?? 0
            streak = ctx["streak"] as? Int ?? 0
            checkedIn = ctx["checkedIn"] as? Bool ?? false
            totalVolume = ctx["totalVolume"] as? Double ?? 0
            workoutsThisWeek = ctx["workoutsThisWeek"] as? Int ?? 0

        default:
            break
        }
    }
}
