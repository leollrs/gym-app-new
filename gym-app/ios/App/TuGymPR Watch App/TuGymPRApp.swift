import SwiftUI
import WatchConnectivity

@main
struct IronForgeWatchApp: App {
    @StateObject private var connector = WatchSessionManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connector)
        }
    }
}
