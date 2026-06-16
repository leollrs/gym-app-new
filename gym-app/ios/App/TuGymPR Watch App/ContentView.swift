import SwiftUI

struct ContentView: View {
    @EnvironmentObject var session: WatchSessionManager
    @StateObject private var workoutSession = WorkoutSessionManager()
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    var body: some View {
        Group {
            if session.workoutJustEnded {
                WorkoutSummaryView(workoutSession: workoutSession)
                    .onAppear {
                        workoutSession.stopSession()
                    }
            } else if session.isWorkoutActive {
                ZStack {
                    TabView {
                        ActiveWorkoutView()
                        HeartRateZoneView(workoutSession: workoutSession)
                    }
                    .tabViewStyle(.verticalPage)

                    if session.isResting {
                        RestTimerView()
                            .transition(.opacity)
                            .zIndex(10)
                    }

                    // Post-set RPE prompt. The phone fires `request_rpe`
                    // (WatchSessionManager sets pendingRPE); show the picker
                    // and forward the choice back via submitRPE (which also
                    // clears pendingRPE). Outranks the rest overlay.
                    if session.pendingRPE {
                        RPEInputView(
                            onSelect: { session.submitRPE(value: $0) },
                            onSkip: { session.pendingRPE = false }
                        )
                        .transition(.opacity)
                        .zIndex(20)
                    }
                }
                .animation(reduceMotion ? .none : .easeInOut(duration: 0.3), value: session.isResting)
                .onAppear {
                    workoutSession.startSession()
                }
            } else if let cardio = session.activeCardio {
                // Live cardio is hoisted to the root so it survives leaving and
                // re-entering the app (the HKWorkoutSession keeps the watch app
                // alive in the background). End / Done clears session.activeCardio.
                LiveCardioWatchView(activity: cardio)
            } else {
                NavigationStack {
                    TabView {
                        StartWorkoutPage()
                        DailySummaryView()
                        NutritionView()
                        FriendsActiveView()
                    }
                    .tabViewStyle(.verticalPage)
                }
            }
        }
        .environmentObject(session)
    }
}
