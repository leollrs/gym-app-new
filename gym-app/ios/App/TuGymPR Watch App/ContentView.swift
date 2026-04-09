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
                }
                .animation(reduceMotion ? .none : .easeInOut(duration: 0.3), value: session.isResting)
                .onAppear {
                    workoutSession.startSession()
                }
            } else {
                NavigationStack {
                    TabView {
                        QRCheckInView()
                        StartWorkoutPage()
                        FriendsActiveView()
                    }
                    .tabViewStyle(.verticalPage)
                }
            }
        }
        .environmentObject(session)
    }
}
