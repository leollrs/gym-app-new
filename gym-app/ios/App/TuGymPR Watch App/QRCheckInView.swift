import SwiftUI
import WatchKit

struct QRCheckInView: View {
    @EnvironmentObject var session: WatchSessionManager
    @State private var feedbackText: String = ""
    @State private var qrImage: UIImage? = nil
    @State private var lastLoadedPayload: String = ""

    private var payload: String {
        if !session.qrPayload.isEmpty { return session.qrPayload }
        let defaults = UserDefaults(suiteName: "group.com.tugympr.app")
        return defaults?.string(forKey: "qrPayload") ?? ""
    }

    private var gymName: String {
        let defaults = UserDefaults(suiteName: "group.com.tugympr.app")
        return defaults?.string(forKey: "gymName") ?? session.tr("Check-In", "Registro")
    }

    var body: some View {
        VStack(spacing: 6) {
            WatchStatusBar(title: session.tr("CHECK-IN", "REGISTRO"))

            Text(gymName)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(DS.textSub)
                .lineLimit(1)

            Text(session.tr("Scan at front desk", "Escanea en recepción"))
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundColor(.white)

            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.white)

                if let img = qrImage {
                    Image(uiImage: img)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 108, height: 108)
                } else if !payload.isEmpty {
                    // Payload exists but PNG not yet delivered from iPhone.
                    VStack(spacing: 4) {
                        Image(systemName: "qrcode")
                            .font(.system(size: 44, weight: .regular))
                            .foregroundColor(.black)
                        Text(session.tr("Syncing…", "Sincronizando…"))
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .foregroundColor(.black.opacity(0.55))
                    }
                } else {
                    Image(systemName: "qrcode")
                        .font(.system(size: 56, weight: .regular))
                        .foregroundColor(.black)
                }
            }
            .frame(width: 120, height: 120)
            .accessibilityLabel("QR check-in code")

            if payload.isEmpty && !feedbackText.isEmpty {
                Text(feedbackText)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(feedbackText.contains("sync") ? DS.streakOrange : DS.textSub)
            } else if qrImage == nil && !payload.isEmpty {
                Button {
                    // Force the phone to resend the PNG
                    session.requestQRRefresh()
                    WKInterfaceDevice.current().play(.click)
                    feedbackText = session.tr("Requesting…", "Solicitando…")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { feedbackText = "" }
                } label: {
                    Text(session.tr("Retry sync", "Reintentar"))
                        .font(.system(.caption2, design: .rounded).weight(.heavy))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(DS.surface1)
                        .cornerRadius(10)
                }
                .buttonStyle(.plain)
            } else if payload.isEmpty {
                Button {
                    session.openQROnPhone()
                    if session.isReachable {
                        WKInterfaceDevice.current().play(.success)
                        feedbackText = session.tr("Check your iPhone", "Revisa tu iPhone")
                    } else {
                        WKInterfaceDevice.current().play(.click)
                        feedbackText = session.tr("Will sync when connected", "Sincronizará al conectarse")
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { feedbackText = "" }
                } label: {
                    Text(session.tr("Show on iPhone", "Mostrar en iPhone"))
                        .font(.system(.caption, design: .rounded).weight(.heavy))
                        .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(DS.brandAccent)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .onAppear { loadQRImage() }
        .onChange(of: session.qrPayload) { _, _ in loadQRImage() }
        .onChange(of: session.qrImageVersion) { _, _ in loadQRImage() }
    }

    private func loadQRImage() {
        let currentPayload = payload
        DispatchQueue.global(qos: .userInitiated).async {
            if let img = loadSharedQRPng(expectedPayload: currentPayload) {
                DispatchQueue.main.async {
                    qrImage = img
                    lastLoadedPayload = currentPayload
                }
            } else {
                DispatchQueue.main.async {
                    qrImage = nil
                    lastLoadedPayload = ""
                }
            }
        }
    }

    /// Load the iPhone-rendered QR PNG from the shared app group container.
    /// iPhone writes `qr.png` next to a sidecar `qr.payload` file; we verify the
    /// payload matches so we never show a stale QR for a different user.
    private func loadSharedQRPng(expectedPayload: String) -> UIImage? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.tugympr.app"
        ) else { return nil }
        let pngURL = container.appendingPathComponent("qr.png")
        let payloadURL = container.appendingPathComponent("qr.payload")
        if let stored = try? String(contentsOf: payloadURL, encoding: .utf8),
           !expectedPayload.isEmpty,
           stored.trimmingCharacters(in: .whitespacesAndNewlines) != expectedPayload {
            return nil // mismatch — don't show stale QR
        }
        guard let data = try? Data(contentsOf: pngURL) else { return nil }
        return UIImage(data: data)
    }
}
