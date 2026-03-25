import Foundation
import WatchConnectivity
import Combine
import WidgetKit

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

    // MARK: - QR & User context
    @Published var qrPayload: String = ""
    @Published var userName: String = ""
    @Published var currentStreak: Int = 0
    @Published var lastWorkoutDate: String = ""
    @Published var weeklyWorkoutCount: Int = 0

    // MARK: - PR celebration
    @Published var prJustHit: Bool = false
    @Published var prExerciseName: String = ""

    // MARK: - RPE
    @Published var pendingRPE: Bool = false

    // MARK: - Overload & PR per set
    @Published var overloadSuggestion: String = ""
    @Published var currentSetIsPR: Bool = false
    @Published var restRemainingSeconds: Int = 0

    // MARK: - Friends
    @Published var activeFriends: [[String: Any]] = []

    // MARK: - Connection
    @Published var isReachable = false

    // MARK: - Shared UserDefaults for complications
    private let sharedDefaults = UserDefaults(suiteName: "group.com.tugympr.app")

    private override init() {
        super.init()
        // Load cached data on startup
        let cached = OfflineCacheManager.shared.loadUserContext()
        qrPayload = cached.qr
        userName = cached.name
        currentStreak = cached.streak

        let cachedRoutines = OfflineCacheManager.shared.loadRoutines()
        if !cachedRoutines.isEmpty {
            availableRoutines = cachedRoutines.map { r in
                ["id": r.id, "name": r.name, "exerciseCount": r.exerciseCount, "lastUsed": r.lastUsed ?? "", "isProgram": r.isProgram ?? false] as [String: Any]
            }
        }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - Send messages to iPhone

    func startWorkout(routineId: String) {
        // Immediately show workout UI on Watch — don't wait for phone
        let routine = availableRoutines.first { ($0["id"] as? String) == routineId }
        let routineName = routine?["name"] as? String ?? "Workout"
        let cleanName = routineName.hasPrefix("Auto: ") ? String(routineName.dropFirst(6)) : routineName

        isWorkoutActive = true
        workoutJustEnded = false
        exerciseName = cleanName
        setNumber = 1
        totalSets = (routine?["exerciseCount"] as? Int ?? 1) * 3 // estimate
        suggestedWeight = 0
        suggestedReps = 0
        elapsedSeconds = 0

        // Tell phone to start the workout
        let msg: [String: Any] = ["action": "start_workout", "routineId": routineId]
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(msg, replyHandler: nil, errorHandler: { _ in
                WCSession.default.transferUserInfo(msg)
            })
        } else {
            WCSession.default.transferUserInfo(msg)
        }
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

    func saveAndEndWorkout() {
        let msg: [String: Any] = ["action": "save_and_end"]
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(msg, replyHandler: nil, errorHandler: nil)
        }
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

    func submitRPE(value: Int) {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "submit_rpe", "rpe": value], replyHandler: nil)
        pendingRPE = false
    }

    func checkIn() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "check_in"], replyHandler: nil)
    }

    func openQROnPhone() {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": "open_qr"], replyHandler: nil)
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
            // Auto-request routines when phone becomes reachable
            if session.isReachable {
                self.requestRoutines()
            }
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

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        DispatchQueue.main.async {
            self.handleMessage(userInfo)
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
            overloadSuggestion = ctx["overloadSuggestion"] as? String ?? ""
            currentSetIsPR = ctx["currentSetIsPR"] as? Bool ?? false
            restRemainingSeconds = ctx["restRemainingSeconds"] as? Int ?? 0

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
                let watchRoutines = routines.map { r in
                    WatchRoutine(
                        id: r["id"] as? String ?? "",
                        name: r["name"] as? String ?? "",
                        exerciseCount: r["exerciseCount"] as? Int ?? 0,
                        lastUsed: r["lastUsed"] as? String,
                        isProgram: r["isProgram"] as? Bool
                    )
                }
                OfflineCacheManager.shared.saveRoutines(watchRoutines)
            }

        case "user_context":
            qrPayload = ctx["qrPayload"] as? String ?? ""
            userName = ctx["userName"] as? String ?? ""
            currentStreak = ctx["currentStreak"] as? Int ?? 0
            lastWorkoutDate = ctx["lastWorkoutDate"] as? String ?? ""
            weeklyWorkoutCount = ctx["weeklyWorkoutCount"] as? Int ?? 0
            OfflineCacheManager.shared.saveUserContext(qr: qrPayload, name: userName, streak: currentStreak)
            syncComplicationData(
                streak: currentStreak,
                lastWorkoutName: ctx["lastWorkoutName"] as? String,
                lastWorkoutDate: lastWorkoutDate,
                weeklyCount: weeklyWorkoutCount
            )

        case "pr_hit":
            prJustHit = true
            prExerciseName = ctx["exerciseName"] as? String ?? ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                self.prJustHit = false
            }

        case "request_rpe":
            pendingRPE = true

        case "friends_active":
            if let friends = ctx["friends"] as? [[String: Any]] {
                activeFriends = friends
            }

        default:
            break
        }
    }

    // MARK: - Complication Data Sync

    private func syncComplicationData(streak: Int, lastWorkoutName: String?, lastWorkoutDate: String, weeklyCount: Int) {
        sharedDefaults?.set(streak, forKey: "streak")
        if let name = lastWorkoutName {
            sharedDefaults?.set(name, forKey: "lastWorkoutName")
        }
        sharedDefaults?.set(lastWorkoutDate, forKey: "lastWorkoutDate")
        sharedDefaults?.set(weeklyCount, forKey: "weeklyWorkoutCount")
        sharedDefaults?.synchronize()

        WidgetCenter.shared.reloadAllTimelines()
    }
}
