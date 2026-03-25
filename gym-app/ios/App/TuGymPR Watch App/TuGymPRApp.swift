import SwiftUI
import WatchConnectivity

@main
struct TuGymPRWatchApp: App {
    @StateObject private var connector = WatchSessionManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connector)
        }
    }
}
