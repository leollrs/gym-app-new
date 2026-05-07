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
    /// Increments every time a new QR PNG is written to the shared container,
    /// so SwiftUI views observing it will re-load the image from disk.
    @Published var qrImageVersion: Int = 0

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

    // MARK: - Localization
    /// User's app language pushed by the iPhone via the `user_context`
    /// message. Drives `tr(en:es:)` so the Watch UI matches the iPhone
    /// language without bundling a full Localizable.strings setup.
    @Published var currentLanguage: String = "en"

    /// Pick between an English and a Spanish string based on the current
    /// language. Callers should prefer this over hardcoded literals.
    func tr(_ en: String, _ es: String) -> String {
        currentLanguage == "es" ? es : en
    }

    // MARK: - Exercise library (synced from iPhone)
    /// `[{"id": "...", "name": "...", "category": "..."}]` — used by the
    /// Free Lift picker so the user can mark which exercise they're doing
    /// straight from the wrist.
    @Published var availableExercises: [[String: Any]] = []

    /// Multi-exercise free-lift session, owned by the watch. Each entry
    /// is `{ "id": String, "name": String, "sets": [[String: Any]] }`,
    /// where each set is `{ "weight": Double, "reps": Int,
    /// "set_number": Int, "skipped": Bool? }`.
    ///
    /// We hold the full list (not just the current exercise) so the
    /// "+ Exercise" tile genuinely APPENDS during a session — like the
    /// iPhone's empty workout — instead of ending the current entry and
    /// restarting. On Save & End the entire list ships to the iPhone in
    /// one `watch_workout_complete` payload.
    @Published var freeLiftEntries: [[String: Any]] = []
    /// Index into freeLiftEntries for the entry the user is currently
    /// logging sets for. Defaults to the last appended entry (so adding
    /// a new exercise switches to it).
    @Published var currentFreeLiftIdx: Int = 0
    /// Wall-clock start of the current free-lift session — used to compute
    /// duration in the End payload.
    private var freeLiftStartedAt: Date? = nil

    /// True iff a free-lift session is currently in flight. Views read
    /// this instead of the deprecated `freeLiftExercise != nil` check.
    var isFreeLiftActive: Bool { !freeLiftEntries.isEmpty }

    /// Convenience — the entry the user is currently logging into. nil
    /// when there's no active free-lift session.
    var freeLiftExercise: [String: Any]? {
        guard !freeLiftEntries.isEmpty,
              currentFreeLiftIdx >= 0,
              currentFreeLiftIdx < freeLiftEntries.count else { return nil }
        return freeLiftEntries[currentFreeLiftIdx]
    }

    /// Mutable helper for set arrays inside the published list.
    private func currentFreeLiftSets() -> [[String: Any]] {
        guard let entry = freeLiftExercise,
              let sets = entry["sets"] as? [[String: Any]] else { return [] }
        return sets
    }
    private func setCurrentFreeLiftSets(_ sets: [[String: Any]]) {
        guard !freeLiftEntries.isEmpty,
              currentFreeLiftIdx < freeLiftEntries.count else { return }
        var entries = freeLiftEntries
        entries[currentFreeLiftIdx]["sets"] = sets
        freeLiftEntries = entries
    }

    // MARK: - Nutrition (today's macro totals + targets)
    @Published var nutritionCaloriesEaten: Int = 0
    @Published var nutritionCaloriesGoal: Int = 2000
    @Published var nutritionProteinEaten: Int = 0
    @Published var nutritionProteinGoal: Int = 150
    @Published var nutritionCarbsEaten: Int = 0
    @Published var nutritionCarbsGoal: Int = 250
    @Published var nutritionFatEaten: Int = 0
    @Published var nutritionFatGoal: Int = 70

    // MARK: - On-watch cardio session
    /// Activity-type slug ('running' / 'walking' / 'cycling' / 'rowing' /
    /// 'hiking' / 'elliptical' / 'other'). Watch-only state — we send the
    /// summary to the iPhone on End so it lands in cardio_sessions like
    /// any phone-tracked run.
    @Published var watchCardioType: String = ""

    // MARK: - Shared UserDefaults for complications
    private let sharedDefaults = UserDefaults(suiteName: "group.com.tugympr.app")

    private override init() {
        super.init()
        // Load cached data on startup — wrapped in safety to prevent init crash
        loadCachedState()
        // Activate WCSession off the main thread to avoid UI blocking / freeze
        activateSessionAsync()
    }

    private func loadCachedState() {
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
        // Restore pending action count for UI badges
        pendingActionCount = OfflineCacheManager.shared.loadPendingActions().count
    }

    private func activateSessionAsync() {
        // Delegate must be assigned on any thread BEFORE activate, but do not
        // block the main thread — WCSession.activate can take time on first launch.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, WCSession.isSupported() else { return }
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - Offline action tracking
    @Published var pendingActionCount: Int = 0

    // MARK: - Send messages to iPhone

    /// Start a routine workout on the watch. `skipWarmUp` defaults to true
    /// to preserve the previous behaviour for callers that haven't been
    /// updated, but the new flow asks the user with a confirmation dialog
    /// (see StartWorkoutChoiceView) and forwards their choice here.
    func startWorkout(routineId: String, skipWarmUp: Bool = true) {
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

        // Persist local workout state for standalone operation
        OfflineCacheManager.shared.saveLocalWorkoutState(routineId: routineId, startTime: Date())

        // Tell phone to start the workout. The phone respects skipWarmUp
        // and, if false, shows its warm-up gate before the first exercise.
        let msg: [String: Any] = [
            "action": "start_workout",
            "routineId": routineId,
            "skipWarmUp": skipWarmUp,
        ]
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(msg, replyHandler: nil, errorHandler: { _ in
                WCSession.default.transferUserInfo(msg)
            })
        } else {
            WCSession.default.transferUserInfo(msg)
        }
    }

    // MARK: - In-workout set / exercise actions
    //
    // These mirror the iPhone's set buttons. For routine workouts the
    // action is forwarded to the phone (which owns the loggedSets[]
    // state). For free-lift sessions we apply the change locally first
    // so the watch UI updates immediately.

    /// "+ Set" — open one more empty set slot for the current exercise.
    /// In free-lift this just advances `setNumber` to the next slot so the
    /// eyebrow visibly grows ("SET 1" → "SET 2") even before the user
    /// fills in weight/reps. Routine workouts forward to the phone.
    func addSetTap() {
        if isFreeLiftActive {
            DispatchQueue.main.async {
                let nextSlot = self.currentFreeLiftSets().count + 1
                // Bump display by one — the slot is implicit; if the user
                // taps DONE SET it'll write into this position.
                self.setNumber = max(self.setNumber, 0) + 1
                _ = nextSlot
            }
            return
        }
        sendOrQueue(["action": "add_set"])
        DispatchQueue.main.async {
            self.totalSets = max(1, self.totalSets + 1)
        }
    }

    /// "− Set" — undo. Free-lift removes the most recent logged set so
    /// the user can correct a mistake (display rolls back). Routine
    /// workouts forward to the phone, which strips the last unfilled slot.
    func removeSetTap() {
        if isFreeLiftActive {
            var sets = currentFreeLiftSets()
            // Roll back the displayed set if we just bumped via +Set
            // without logging anything.
            let nextSlot = sets.count + 1
            if setNumber > nextSlot {
                DispatchQueue.main.async {
                    self.setNumber = max(1, self.setNumber - 1)
                }
                return
            }
            // Otherwise, drop the most recently logged set.
            guard !sets.isEmpty else { return }
            sets.removeLast()
            DispatchQueue.main.async {
                self.setCurrentFreeLiftSets(sets)
                self.setNumber = max(1, sets.count + 1)
            }
            return
        }
        sendOrQueue(["action": "remove_set"])
        DispatchQueue.main.async {
            self.totalSets = max(1, self.totalSets - 1)
        }
    }

    /// "Skip" — mark the current set as skipped + advance to the next.
    /// In free-lift we record a skipped marker locally so it's reflected
    /// in the End payload too (the phone tags those sets as skipped).
    func skipSetTap() {
        if isFreeLiftActive {
            var sets = currentFreeLiftSets()
            sets.append([
                "weight": 0,
                "reps":   0,
                "set_number": sets.count + 1,
                "skipped": true,
            ])
            DispatchQueue.main.async {
                self.setCurrentFreeLiftSets(sets)
                self.setNumber = sets.count + 1
            }
            return
        }
        sendOrQueue(["action": "skip_set"])
    }

    /// "+ Exercise" — for free-lift this APPENDS a new exercise to the
    /// session and switches the active view to it (so the user can log
    /// sets for it immediately). For routine workouts, the action is
    /// forwarded to the phone, which appends + auto-advances to it.
    func addExerciseTap(exercise: [String: Any]) {
        let exId = (exercise["id"] as? String) ?? ""
        let exName = (exercise["name"] as? String) ?? "Exercise"
        if isFreeLiftActive {
            DispatchQueue.main.async {
                let entry: [String: Any] = [
                    "id":   exId,
                    "name": exName,
                    "sets": [] as [[String: Any]],
                ]
                self.freeLiftEntries.append(entry)
                self.currentFreeLiftIdx = self.freeLiftEntries.count - 1
                self.exerciseName = exName
                self.setNumber = 1
                self.totalSets = 0
            }
            return
        }
        sendOrQueue([
            "action":       "add_exercise",
            "exerciseId":   exId,
            "exerciseName": exName,
        ])
        DispatchQueue.main.async {
            // Update the wrist UI immediately so it doesn't lag the phone.
            self.exerciseName = exName
            self.setNumber = 1
        }
    }

    // MARK: - Quick-start free-form modes

    /// Tap "Cardio · free" on the Start screen. Tells the phone to open
    /// the LiveCardio screen so the user can pick their cardio type and
    /// start GPS tracking. The Watch heart-rate workout session can be
    /// started independently from the cardio tab.
    func startCardioFree() {
        let msg: [String: Any] = ["action": "start_cardio_free"]
        sendOrQueue(msg)
    }

    /// Free lift entry once the user has picked an exercise from the watch
    /// library. We seed the live workout state with the exercise name so
    /// the existing ActiveWorkoutView can drive set logging on the wrist.
    /// The phone is told via `start_free_lift` (so it can mirror the live
    /// session if foregrounded) but we don't depend on it: every set is
    /// also captured into `freeLiftSets` here, and the full session ships
    /// to the phone as a single payload on Save & End.
    func startFreeLift(exercise: [String: Any]) {
        let name = (exercise["name"] as? String) ?? self.tr("Free lift", "Levantamiento libre")
        let exerciseId = (exercise["id"] as? String) ?? ""
        let now = Date()
        DispatchQueue.main.async {
            // Seed the multi-exercise list with the picked exercise. Any
            // subsequent "+ Exercise" tap will append, not replace.
            self.freeLiftEntries = [[
                "id":   exerciseId,
                "name": name,
                "sets": [] as [[String: Any]],
            ]]
            self.currentFreeLiftIdx = 0
            self.freeLiftStartedAt = now
            self.isWorkoutActive = true
            self.workoutJustEnded = false
            self.exerciseName = name
            self.setNumber = 1
            // Free lift has no fixed set count — leave totalSets at 0 and
            // let ActiveWorkoutView render "SET X" without "/ Y".
            self.totalSets = 0
            self.suggestedWeight = 0
            self.suggestedReps = 8
            self.elapsedSeconds = 0
        }
        OfflineCacheManager.shared.saveLocalWorkoutState(routineId: "empty", startTime: now)
        let msg: [String: Any] = [
            "action": "start_free_lift",
            "exerciseId": exerciseId,
            "exerciseName": name,
        ]
        sendOrQueue(msg)
    }

    /// "Log food" tile on the Watch nutrition tab. The actual food picker
    /// lives on the iPhone (camera scan, barcode, search), so we just
    /// foreground the iPhone with a deeplink to /nutrition.
    func openNutritionOnPhone() {
        let msg: [String: Any] = ["action": "open_nutrition"]
        sendOrQueue(msg)
    }

    /// Send a watch-tracked cardio session to the phone for DB logging
    /// once the user taps End on LiveCardioWatchView. The phone treats
    /// `watch_cardio_session` as a fully-formed cardio_sessions row.
    func saveWatchCardio(
        activityType: String,
        durationSeconds: Int,
        averageHeartRate: Int,
        caloriesBurned: Int,
        distanceKm: Double?
    ) {
        var msg: [String: Any] = [
            "action": "watch_cardio_session",
            "cardio_type": activityType,
            "duration_seconds": durationSeconds,
            "avg_heart_rate": averageHeartRate,
            "calories_burned": caloriesBurned,
            "source": "watch",
        ]
        if let km = distanceKm { msg["distance_km"] = km }
        sendOrQueue(msg)
    }

    func completeSet(actualReps: Int, actualWeight: Double) {
        // Always save locally first so data is never lost
        OfflineCacheManager.shared.saveLocalSet(OfflineCacheManager.LocalSet(
            exerciseIndex: 0,
            setIndex: setNumber,
            weight: actualWeight,
            reps: actualReps,
            timestamp: Date()
        ))

        // ── Free-lift: append set to the *current* exercise entry. The
        // entire session ships to the phone in one `watch_workout_complete`
        // payload on Save & End — no per-set WCSession traffic needed.
        if isFreeLiftActive {
            var sets = currentFreeLiftSets()
            sets.append([
                "weight":     actualWeight,
                "reps":       actualReps,
                "set_number": sets.count + 1,
            ])
            DispatchQueue.main.async {
                self.setCurrentFreeLiftSets(sets)
                self.setNumber = sets.count + 1
            }
            return
        }

        // ── Routine workout: phone owns the data — send the set up live.
        let msg: [String: Any] = [
            "action": "complete_set",
            "actualReps": actualReps,
            "actualWeight": actualWeight
        ]
        sendOrQueue(msg)
    }

    func skipRest() {
        let msg: [String: Any] = ["action": "skip_rest"]
        sendOrQueue(msg)
        DispatchQueue.main.async {
            self.isResting = false
        }
    }

    func endWorkout() {
        let msg: [String: Any] = ["action": "end_workout"]
        sendOrQueue(msg)
    }

    func saveAndEndWorkout() {
        // Free-lift: ship the entire multi-exercise session in one shot so
        // the iPhone can save it via complete_workout regardless of
        // whether the phone was mounted in ActiveSession during the
        // workout. Routine workouts continue to use the existing
        // save_and_end → handleFinish path.
        if isFreeLiftActive {
            let durationSec = max(1, Int(Date().timeIntervalSince(freeLiftStartedAt ?? Date())))
            let isoFormatter = ISO8601DateFormatter()
            // Drop entries with zero sets so we don't pollute the iPhone's
            // workout log with empty exercises (user picked but never
            // logged anything).
            let entriesWithSets = freeLiftEntries.filter { entry in
                let sets = (entry["sets"] as? [[String: Any]]) ?? []
                return !sets.isEmpty
            }
            // Even an empty session signals "I'm done" so we always send.
            let payload: [String: Any] = [
                "action":           "watch_workout_complete",
                "exercises":        entriesWithSets,
                "duration_seconds": durationSec,
                "started_at":       isoFormatter.string(from: freeLiftStartedAt ?? Date()),
                "completed_at":     isoFormatter.string(from: Date()),
            ]
            sendOrQueue(payload)
        } else {
            // Routine: phone has the in-memory log; signal save & end.
            sendOrQueue(["action": "save_and_end"])
        }

        // Update local state immediately regardless of phone connectivity
        DispatchQueue.main.async {
            self.isWorkoutActive = false
            self.workoutJustEnded = true
            self.freeLiftEntries = []
            self.currentFreeLiftIdx = 0
            self.freeLiftStartedAt = nil
            OfflineCacheManager.shared.clearLocalWorkoutState()
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
        let msg: [String: Any] = ["action": "submit_rpe", "rpe": value]
        sendOrQueue(msg)
        pendingRPE = false
    }

    func checkIn() {
        let msg: [String: Any] = ["action": "check_in"]
        sendOrQueue(msg)
    }

    func openQROnPhone() {
        let msg: [String: Any] = ["action": "open_qr"]
        sendOrQueue(msg)
    }

    /// Ask the iPhone to re-send the QR PNG (shared app group write).
    func requestQRRefresh() {
        let msg: [String: Any] = ["action": "request_qr_png"]
        sendOrQueue(msg)
    }

    // MARK: - Offline Send/Queue Helpers

    private func sendOrQueue(_ msg: [String: Any]) {
        // Always go through transferUserInfo when not reachable — it's queued
        // by the system and delivered when the phone is available again.
        if WCSession.default.activationState == .activated, WCSession.default.isReachable {
            WCSession.default.sendMessage(msg, replyHandler: nil) { [weak self] _ in
                // Send failed despite being reachable — queue via transferUserInfo
                // for guaranteed delivery, AND persist to our local queue as backup.
                WCSession.default.transferUserInfo(msg)
                self?.queueMessage(msg)
            }
        } else {
            // Not reachable — use the system's guaranteed queued delivery
            if WCSession.default.activationState == .activated {
                WCSession.default.transferUserInfo(msg)
            }
            queueMessage(msg)
        }
    }

    private func queueMessage(_ msg: [String: Any]) {
        var payload: [String: String] = [:]
        for (key, value) in msg where key != "action" {
            payload[key] = "\(value)"
        }
        let action = OfflineCacheManager.PendingAction(
            action: msg["action"] as? String ?? "",
            payload: payload
        )
        OfflineCacheManager.shared.queueAction(action)
        DispatchQueue.main.async {
            self.pendingActionCount = OfflineCacheManager.shared.loadPendingActions().count
        }
    }

    private func flushPendingActions() {
        let actions = OfflineCacheManager.shared.loadPendingActions()
        guard !actions.isEmpty else { return }

        for action in actions {
            var msg: [String: Any] = ["action": action.action]
            for (key, value) in action.payload {
                // Convert numeric strings back to their original types
                if let intVal = Int(value) {
                    msg[key] = intVal
                } else if let doubleVal = Double(value) {
                    msg[key] = doubleVal
                } else {
                    msg[key] = value
                }
            }
            WCSession.default.sendMessage(msg, replyHandler: nil) { _ in
                // If direct send still fails, use guaranteed delivery
                WCSession.default.transferUserInfo(msg)
            }
            OfflineCacheManager.shared.removePendingAction(action.id)
        }

        DispatchQueue.main.async {
            self.pendingActionCount = 0
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
            if session.isReachable {
                self.requestRoutines()
                self.flushPendingActions()
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
            // Language ('en' / 'es') drives `tr(en:es:)` across the watch UI.
            // Anything other than 'es' is treated as English.
            if let lang = ctx["language"] as? String, !lang.isEmpty {
                currentLanguage = lang.hasPrefix("es") ? "es" : "en"
            }
            OfflineCacheManager.shared.saveUserContext(qr: qrPayload, name: userName, streak: currentStreak)
            // Also write to shared defaults so QRCheckInView sees it offline
            sharedDefaults?.set(qrPayload, forKey: "qrPayload")
            if let gym = ctx["gymName"] as? String { sharedDefaults?.set(gym, forKey: "gymName") }
            if let accent = ctx["gymAccentHex"] as? String { sharedDefaults?.set(accent, forKey: "gymAccentHex") }
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

        case "exercises_sync":
            // Slim {id, name, category} list pushed from the iPhone so
            // Free Lift can offer a picker without round-tripping per tap.
            if let list = ctx["exercises"] as? [[String: Any]] {
                availableExercises = list
            }

        case "nutrition_summary":
            // Today's macro totals + targets — drives the rings on the
            // Watch's Nutrition tab. Goals are sticky (set in onboarding /
            // calculator) so the iPhone always pushes them alongside the
            // eaten values.
            if let v = ctx["caloriesEaten"] as? Int { nutritionCaloriesEaten = v }
            if let v = ctx["caloriesGoal"]  as? Int, v > 0 { nutritionCaloriesGoal  = v }
            if let v = ctx["proteinEaten"]  as? Int { nutritionProteinEaten  = v }
            if let v = ctx["proteinGoal"]   as? Int, v > 0 { nutritionProteinGoal   = v }
            if let v = ctx["carbsEaten"]    as? Int { nutritionCarbsEaten    = v }
            if let v = ctx["carbsGoal"]     as? Int, v > 0 { nutritionCarbsGoal     = v }
            if let v = ctx["fatEaten"]      as? Int { nutritionFatEaten      = v }
            if let v = ctx["fatGoal"]       as? Int, v > 0 { nutritionFatGoal       = v }

        case "daily_summary":
            // Apple-style activity rings + points/streak tiles powering
            // DailySummaryView. The view reads these straight off
            // group.com.tugympr.app, so we just persist whatever the iPhone
            // has computed.
            if let move = ctx["moveCalories"] as? Int { sharedDefaults?.set(move, forKey: "moveCalories") }
            if let mg = ctx["moveGoal"] as? Int { sharedDefaults?.set(mg, forKey: "moveGoal") }
            if let mp = ctx["moveProgress"] as? Double { sharedDefaults?.set(mp, forKey: "moveProgress") }
            if let ex = ctx["exerciseMinutes"] as? Int { sharedDefaults?.set(ex, forKey: "exerciseMinutes") }
            if let eg = ctx["exerciseGoal"] as? Int { sharedDefaults?.set(eg, forKey: "exerciseGoal") }
            if let ep = ctx["exerciseProgress"] as? Double { sharedDefaults?.set(ep, forKey: "exerciseProgress") }
            if let st = ctx["standHours"] as? Int { sharedDefaults?.set(st, forKey: "standHours") }
            if let sg = ctx["standGoal"] as? Int { sharedDefaults?.set(sg, forKey: "standGoal") }
            if let sp = ctx["standProgress"] as? Double { sharedDefaults?.set(sp, forKey: "standProgress") }
            if let pt = ctx["pointsToday"] as? Int { sharedDefaults?.set(pt, forKey: "pointsToday") }
            if let pTotal = ctx["pointsTotal"] as? Int { sharedDefaults?.set(pTotal, forKey: "pointsTotal") }
            sharedDefaults?.synchronize()
            // Bumping a published flag would force DailySummaryView to
            // refresh, but it already polls UserDefaults via @State accessors
            // each time the tab becomes visible, so a pure write is enough.
            WidgetCenter.shared.reloadAllTimelines()

        case "qr_png":
            // iPhone sent the pre-rendered QR as base64. Write to shared container
            // so QRCheckInView can load it via UIImage.
            if let base64 = ctx["pngBase64"] as? String,
               let data = Data(base64Encoded: base64) {
                let payloadString = ctx["payload"] as? String ?? qrPayload
                DispatchQueue.global(qos: .utility).async {
                    if let container = FileManager.default.containerURL(
                        forSecurityApplicationGroupIdentifier: "group.com.tugympr.app"
                    ) {
                        let pngURL = container.appendingPathComponent("qr.png")
                        let payloadURL = container.appendingPathComponent("qr.payload")
                        try? data.write(to: pngURL, options: .atomic)
                        try? payloadString.write(to: payloadURL, atomically: true, encoding: .utf8)
                    }
                    DispatchQueue.main.async {
                        self.qrImageVersion &+= 1
                    }
                }
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
