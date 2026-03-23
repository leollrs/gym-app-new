import Foundation
import ActivityKit

struct WorkoutActivityAttributes: ActivityAttributes {
    let routineName: String
    let totalSets: Int
    let startedAt: Date

    struct ContentState: Codable, Hashable {
        var elapsedSeconds: Int
        var completedSets: Int
        var currentExerciseName: String
        var isResting: Bool
        var restEndDate: Date?
        var isRestFinished: Bool
    }
}
