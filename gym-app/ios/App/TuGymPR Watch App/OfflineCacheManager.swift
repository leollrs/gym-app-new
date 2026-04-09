import Foundation

// MARK: - Cached Routine Model

struct WatchRoutine: Codable {
    let id: String
    let name: String
    let exerciseCount: Int
    let lastUsed: String?
    let isProgram: Bool?
}

// MARK: - Offline Cache Manager

class OfflineCacheManager {
    static let shared = OfflineCacheManager()

    private let defaults: UserDefaults

    private enum Keys {
        static let routines = "cached_routines"
        static let qrPayload = "cached_qr_payload"
        static let userName = "cached_user_name"
        static let streak = "cached_streak"
        static let lastWorkoutDate = "cached_last_workout_date"
        static let lastWorkoutRoutine = "cached_last_workout_routine"
    }

    private init() {
        defaults = UserDefaults(suiteName: "group.com.tugympr.app") ?? .standard
    }

    // MARK: - Routines

    func saveRoutines(_ routines: [WatchRoutine]) {
        guard let data = try? JSONEncoder().encode(routines) else { return }
        defaults.set(data, forKey: Keys.routines)
    }

    func loadRoutines() -> [WatchRoutine] {
        guard let data = defaults.data(forKey: Keys.routines),
              let routines = try? JSONDecoder().decode([WatchRoutine].self, from: data) else {
            return []
        }
        return routines
    }

    // MARK: - User Context

    func saveUserContext(qr: String, name: String, streak: Int) {
        defaults.set(qr, forKey: Keys.qrPayload)
        defaults.set(name, forKey: Keys.userName)
        defaults.set(streak, forKey: Keys.streak)
    }

    func loadUserContext() -> (qr: String, name: String, streak: Int) {
        let qr = defaults.string(forKey: Keys.qrPayload) ?? ""
        let name = defaults.string(forKey: Keys.userName) ?? ""
        let streak = defaults.integer(forKey: Keys.streak)
        return (qr, name, streak)
    }

    // MARK: - Last Workout

    func saveLastWorkout(date: Date, routineName: String) {
        defaults.set(date, forKey: Keys.lastWorkoutDate)
        defaults.set(routineName, forKey: Keys.lastWorkoutRoutine)
    }

    func loadLastWorkout() -> (date: Date?, routineName: String?) {
        let date = defaults.object(forKey: Keys.lastWorkoutDate) as? Date
        let name = defaults.string(forKey: Keys.lastWorkoutRoutine)
        return (date, name)
    }

    // MARK: - Pending Actions Queue

    struct PendingAction: Codable, Identifiable {
        let id: UUID
        let action: String
        let payload: [String: String]
        let timestamp: Date

        init(action: String, payload: [String: String] = [:]) {
            self.id = UUID()
            self.action = action
            self.payload = payload
            self.timestamp = Date()
        }
    }

    private let pendingActionsKey = "pending_actions_queue"

    func queueAction(_ action: PendingAction) {
        var actions = loadPendingActions()
        actions.append(action)
        if let data = try? JSONEncoder().encode(actions) {
            defaults.set(data, forKey: pendingActionsKey)
        }
    }

    func loadPendingActions() -> [PendingAction] {
        guard let data = defaults.data(forKey: pendingActionsKey),
              let actions = try? JSONDecoder().decode([PendingAction].self, from: data) else {
            return []
        }
        return actions
    }

    func clearPendingActions() {
        defaults.removeObject(forKey: pendingActionsKey)
    }

    func removePendingAction(_ id: UUID) {
        var actions = loadPendingActions()
        actions.removeAll { $0.id == id }
        if let data = try? JSONEncoder().encode(actions) {
            defaults.set(data, forKey: pendingActionsKey)
        }
    }

    // MARK: - Local Workout State

    private let localSetsKey = "local_workout_sets"
    private let localWorkoutActiveKey = "local_workout_active"
    private let localWorkoutRoutineKey = "local_workout_routine_id"
    private let localWorkoutStartKey = "local_workout_start"

    struct LocalSet: Codable {
        let exerciseIndex: Int
        let setIndex: Int
        let weight: Double
        let reps: Int
        let timestamp: Date
    }

    func saveLocalSet(_ set: LocalSet) {
        var sets = loadLocalSets()
        sets.append(set)
        if let data = try? JSONEncoder().encode(sets) {
            defaults.set(data, forKey: localSetsKey)
        }
    }

    func loadLocalSets() -> [LocalSet] {
        guard let data = defaults.data(forKey: localSetsKey),
              let sets = try? JSONDecoder().decode([LocalSet].self, from: data) else {
            return []
        }
        return sets
    }

    func clearLocalSets() {
        defaults.removeObject(forKey: localSetsKey)
    }

    func saveLocalWorkoutState(routineId: String, startTime: Date) {
        defaults.set(true, forKey: localWorkoutActiveKey)
        defaults.set(routineId, forKey: localWorkoutRoutineKey)
        defaults.set(startTime, forKey: localWorkoutStartKey)
    }

    func clearLocalWorkoutState() {
        defaults.set(false, forKey: localWorkoutActiveKey)
        defaults.removeObject(forKey: localWorkoutRoutineKey)
        defaults.removeObject(forKey: localWorkoutStartKey)
        clearLocalSets()
    }

    func isLocalWorkoutActive() -> Bool {
        return defaults.bool(forKey: localWorkoutActiveKey)
    }

    // MARK: - Clear All

    func clearAll() {
        let allKeys = [
            Keys.routines,
            Keys.qrPayload,
            Keys.userName,
            Keys.streak,
            Keys.lastWorkoutDate,
            Keys.lastWorkoutRoutine
        ]
        for key in allKeys {
            defaults.removeObject(forKey: key)
        }
        clearPendingActions()
        clearLocalWorkoutState()
    }
}
