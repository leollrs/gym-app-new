import SwiftUI
import WatchKit
import WatchConnectivity

struct QRCheckInView: View {
    @EnvironmentObject var session: WatchSessionManager
    @State private var feedbackText: String = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("GYM CHECK-IN")
                .font(.caption2.weight(.heavy))
                .foregroundColor(DS.mutedText)
                .tracking(1.5)

            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 48, weight: .regular, design: .default))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .foregroundColor(DS.gold)
                .accessibilityLabel("QR check-in code")

            GoldButton("Open QR on iPhone", icon: "iphone") {
                session.openQROnPhone()
                if WCSession.default.isReachable {
                    WKInterfaceDevice.current().play(.success)
                    feedbackText = "Check your iPhone"
                } else {
                    WKInterfaceDevice.current().play(.click)
                    feedbackText = "Will sync when iPhone connects"
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                    feedbackText = ""
                }
            }

            GoldButton("Quick Check-In", icon: "checkmark.seal.fill") {
                session.checkIn()
                if WCSession.default.isReachable {
                    WKInterfaceDevice.current().play(.success)
                    feedbackText = "Checked in!"
                } else {
                    WKInterfaceDevice.current().play(.click)
                    feedbackText = "Check-in will sync when iPhone connects"
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                    feedbackText = ""
                }
            }

            if !feedbackText.isEmpty {
                Text(feedbackText)
                    .font(.caption2.weight(.medium))
                    .foregroundColor(feedbackText.contains("sync") ? .orange.opacity(0.8) : DS.mutedText)
            }
        }
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity)
        .background(DS.darkBg)
    }
}
