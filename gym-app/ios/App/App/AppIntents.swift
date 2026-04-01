import AppIntents
import UIKit

// ────────────────────────────────────────────────────────────────────────────
// TuGymPR — Siri Shortcuts (App Intents)
//
// These intents let users trigger common actions via Siri voice commands.
// Each intent opens the app to a specific deep-link URL that the web layer
// handles via the Capacitor `appUrlOpen` listener (or direct path matching).
//
// NOTE: The Watch app has its own intent definitions in TuGymPRIntents.swift
// (different target), so the struct names here are intentionally prefixed
// with "Phone" to avoid collisions if both targets ever share a module.
//
// ── Xcode project configuration required ──
// 1. Add this file to the "App" target in Xcode (Build Phases → Compile Sources).
// 2. In the App target → Signing & Capabilities, add "App Intents" if not present.
// 3. No NSUserActivityTypes plist entries are needed — the AppIntents framework
//    and AppShortcutsProvider handle discovery automatically on iOS 16+.
// ────────────────────────────────────────────────────────────────────────────

// MARK: - Helper

@available(iOS 16.0, *)
private func openDeepLink(_ path: String) {
    DispatchQueue.main.async {
        guard let url = URL(string: "tugympr://\(path)") else { return }
        UIApplication.shared.open(url)
    }
}

// MARK: - Start Workout

@available(iOS 16.0, *)
struct PhoneStartWorkoutIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Workout"
    static var description = IntentDescription("Start your scheduled workout in TuGymPR")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        openDeepLink("siri/start-workout")
        return .result()
    }
}

// MARK: - Check In at Gym

@available(iOS 16.0, *)
struct PhoneCheckInIntent: AppIntent {
    static var title: LocalizedStringResource = "Check In at Gym"
    static var description = IntentDescription("Check in at your gym with TuGymPR")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        openDeepLink("siri/check-in")
        return .result()
    }
}

// MARK: - Show Gym Card

@available(iOS 16.0, *)
struct PhoneShowGymCardIntent: AppIntent {
    static var title: LocalizedStringResource = "Show Gym Card"
    static var description = IntentDescription("Show your gym membership card")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        openDeepLink("siri/gym-card")
        return .result()
    }
}

// MARK: - Check Streak

@available(iOS 16.0, *)
struct PhoneCheckStreakIntent: AppIntent {
    static var title: LocalizedStringResource = "Check My Streak"
    static var description = IntentDescription("Check your workout streak in TuGymPR")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        openDeepLink("siri/streak")
        return .result()
    }
}

// MARK: - Log Nutrition

@available(iOS 16.0, *)
struct PhoneLogNutritionIntent: AppIntent {
    static var title: LocalizedStringResource = "Log Food"
    static var description = IntentDescription("Log food in TuGymPR")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        openDeepLink("siri/log-food")
        return .result()
    }
}

// MARK: - Shortcuts Provider

@available(iOS 16.0, *)
struct TuGymPRPhoneShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PhoneStartWorkoutIntent(),
            phrases: [
                "Start my workout in \(.applicationName)",
                "Begin workout in \(.applicationName)",
                "Let's train in \(.applicationName)"
            ],
            shortTitle: "Start Workout",
            systemImageName: "figure.strengthtraining.traditional"
        )
        AppShortcut(
            intent: PhoneCheckInIntent(),
            phrases: [
                "Check in at the gym with \(.applicationName)",
                "Gym check in with \(.applicationName)"
            ],
            shortTitle: "Check In",
            systemImageName: "qrcode"
        )
        AppShortcut(
            intent: PhoneShowGymCardIntent(),
            phrases: [
                "Show my gym card in \(.applicationName)",
                "Show my membership in \(.applicationName)"
            ],
            shortTitle: "Gym Card",
            systemImageName: "creditcard"
        )
        AppShortcut(
            intent: PhoneCheckStreakIntent(),
            phrases: [
                "What's my streak in \(.applicationName)",
                "Check my workout streak in \(.applicationName)"
            ],
            shortTitle: "Check Streak",
            systemImageName: "flame"
        )
        AppShortcut(
            intent: PhoneLogNutritionIntent(),
            phrases: [
                "Log food in \(.applicationName)",
                "Track my meal in \(.applicationName)"
            ],
            shortTitle: "Log Food",
            systemImageName: "fork.knife"
        )
    }
}
