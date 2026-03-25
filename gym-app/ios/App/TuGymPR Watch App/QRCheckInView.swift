import SwiftUI
import WatchKit
import WatchConnectivity

struct QRCheckInView: View {
    @EnvironmentObject var session: WatchSessionManager
    @State private var feedbackText: String = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("GYM CHECK-IN")
                .font(.system(size: 10, weight: .heavy))
                .foregroundColor(DS.mutedText)
                .tracking(1.5)

            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 48))
                .foregroundColor(DS.gold)

            GoldButton("Open QR on iPhone", icon: "iphone") {
                if WCSession.default.isReachable {
                    session.openQROnPhone()
                    WKInterfaceDevice.current().play(.success)
                    feedbackText = "Check your iPhone"
                } else {
                    WKInterfaceDevice.current().play(.failure)
                    feedbackText = "iPhone not reachable"
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    feedbackText = ""
                }
            }

            if !feedbackText.isEmpty {
                Text(feedbackText)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(feedbackText.contains("not") ? .red.opacity(0.8) : DS.mutedText)
            }
        }
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity)
        .background(DS.darkBg)
    }
}
