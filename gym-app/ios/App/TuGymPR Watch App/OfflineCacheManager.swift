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
    }
}
