import Foundation
import ActivityKit

struct WorkoutActivityAttributes: ActivityAttributes {
    let routineName: String
    // Static attributes are immutable per ActivityKit — totalSets lives in ContentState
    // so it can reflect mid-session removals/skips. `initialTotalSets` is kept here
    // only as a fallback for legacy widget code paths.
    let initialTotalSets: Int
    let startedAt: Date

    struct ContentState: Codable, Hashable {
        var elapsedSeconds: Int
        var completedSets: Int
        var totalSets: Int
        var currentExerciseName: String
        var isResting: Bool
        var restEndDate: Date?
        var isRestFinished: Bool
        var isPaused: Bool
        // Cardio mode (when totalSets == 0): optional distance in km shown on the
        // Live Activity / Dynamic Island. nil for workout mode.
        var distanceKm: Double?
    }
}
