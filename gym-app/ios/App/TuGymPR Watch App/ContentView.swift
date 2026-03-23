import SwiftUI

struct ContentView: View {
    @EnvironmentObject var session: WatchSessionManager
    @StateObject private var workoutSession = WorkoutSessionManager()
    @StateObject private var repCounter = RepCountingManager()

    var body: some View {
        Group {
            if session.workoutJustEnded {
                WorkoutSummaryView(workoutSession: workoutSession)
                    .onAppear {
                        workoutSession.stopSession()
                        repCounter.stopCounting()
                    }
            } else if session.isWorkoutActive {
                TabView {
                    ActiveWorkoutView(repCounter: repCounter)
                    RestTimerView()
                    HeartRateZoneView(workoutSession: workoutSession)
                }
                .tabViewStyle(.verticalPage)
                .onAppear {
                    workoutSession.startSession()
                    repCounter.startCounting(for: session.exerciseCategory)
                }
            } else {
                QuickStartView()
            }
        }
        .environmentObject(session)
    }
}
