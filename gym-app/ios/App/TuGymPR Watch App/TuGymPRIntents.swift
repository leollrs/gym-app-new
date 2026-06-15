import AppIntents
import Foundation
import WatchConnectivity

// MARK: - Start Workout Intent

struct StartWorkoutIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Workout"
    static var description: IntentDescription = "Start a workout routine in TuGymPR."
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // WatchSessionManager mutates @Published state in startWorkout, so do
        // the read + start on the main actor. Prefer today's scheduled
        // workout over an arbitrary first routine.
        let started: String? = await MainActor.run {
            let manager = WatchSessionManager.shared
            let routines = manager.availableRoutines
            let pick = routines.first { ($0["isTodayWorkout"] as? Bool) == true } ?? routines.first
            guard let routine = pick, let routineId = routine["id"] as? String else { return nil }
            manager.startWorkout(routineId: routineId)
            return routine["name"] as? String ?? "your workout"
        }

        if let name = started {
            return .result(dialog: "Starting \(name). Let's go!")
        } else {
            return .result(dialog: "No routines available. Open TuGymPR on your iPhone to sync your routines.")
        }
    }
}

// MARK: - Check Streak Intent

struct CheckStreakIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Streak"
    static var description: IntentDescription = "Check your current workout streak in TuGymPR."

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let defaults = UserDefaults(suiteName: "group.com.tugympr.app")
        let streak = defaults?.integer(forKey: "streak") ?? 0
        let weeklyCount = defaults?.integer(forKey: "weeklyWorkoutCount") ?? 0

        if streak == 0 {
            return .result(dialog: "You don't have an active streak yet. Hit the gym to get started!")
        } else {
            return .result(dialog: "You have a \(streak) day streak! You've worked out \(weeklyCount) times this week.")
        }
    }
}

// MARK: - Quick Check-In Intent

struct QuickCheckInIntent: AppIntent {
    static var title: LocalizedStringResource = "Gym Check-In"
    static var description: IntentDescription = "Check in at the gym with TuGymPR."

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard WCSession.default.isReachable else {
            return .result(dialog: "Can't reach your iPhone right now. Make sure it's nearby and try again.")
        }

        WCSession.default.sendMessage(
            ["action": "check_in", "source": "siri"],
            replyHandler: nil,
            errorHandler: nil
        )

        return .result(dialog: "Checked in! Keep up the streak!")
    }
}

// MARK: - App Shortcuts Provider

struct TuGymPRShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartWorkoutIntent(),
            phrases: [
                "Start my workout in \(.applicationName)",
                "Start a workout in \(.applicationName)",
                "Begin workout in \(.applicationName)"
            ],
            shortTitle: "Start Workout",
            systemImageName: "figure.strengthtraining.traditional"
        )

        AppShortcut(
            intent: CheckStreakIntent(),
            phrases: [
                "What's my streak in \(.applicationName)",
                "Check my streak in \(.applicationName)",
                "How's my streak in \(.applicationName)"
            ],
            shortTitle: "Check Streak",
            systemImageName: "flame.fill"
        )

        AppShortcut(
            intent: QuickCheckInIntent(),
            phrases: [
                "Check in at the gym with \(.applicationName)",
                "Gym check-in with \(.applicationName)",
                "Check in with \(.applicationName)"
            ],
            shortTitle: "Gym Check-In",
            systemImageName: "checkmark.circle.fill"
        )
    }
}
