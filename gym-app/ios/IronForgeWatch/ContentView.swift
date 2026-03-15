import SwiftUI

struct ContentView: View {
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        TabView {
            if session.isWorkoutActive {
                WorkoutView()
            }
            StatsView()
            CheckInView()
            HeartRateView()
        }
        .tabViewStyle(.verticalPage)
        .onAppear {
            session.requestStats()
        }
    }
}
