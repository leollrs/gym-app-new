import SwiftUI
import WatchKit

struct RestTimerView: View {
    @EnvironmentObject var session: WatchSessionManager
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var countdown: Int = 0
    @State private var totalDuration: Int = 0
    @State private var timer: Timer?
    @State private var hasNotified: Bool = false
    @State private var initializedFromPhone: Bool = false

    var body: some View {
        VStack(spacing: 12) {
            Text("REST")
                .font(.caption)
                .fontWeight(.heavy)
                .foregroundColor(DS.gold)
                .tracking(2)
                .accessibilityAddTraits(.isHeader)

            // Circular countdown
            ZStack {
                Circle()
                    .stroke(DS.cardBg, lineWidth: 8)
                    .frame(width: 110, height: 110)

                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(DS.gold, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .frame(width: 110, height: 110)
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? .none : .linear(duration: 1), value: countdown)

                VStack(spacing: 2) {
                    Text("\(countdown)")
                        .font(.system(size: 48, weight: .black, design: .rounded))
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        .foregroundColor(countdown <= 5 ? DS.gold : .white)
                        .monospacedDigit()
                        .accessibilityAddTraits(.updatesFrequently)
                        .accessibilityLabel("\(countdown) seconds remaining")
                    Text("sec")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(DS.mutedText)
                }
            }

            // Skip button
            Button(action: {
                timer?.invalidate()
                session.skipRest()
                WKInterfaceDevice.current().play(.click)
            }) {
                Text("Skip")
                    .font(.subheadline.weight(.bold))
                    .foregroundColor(DS.gold)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 10)
                    .background(DS.gold.opacity(0.15))
                    .cornerRadius(10)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Skip rest timer")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.darkBg)
        .onAppear {
            // Initialize from phone's remaining time
            totalDuration = session.restSeconds > 0 ? session.restSeconds : 90
            if session.restRemainingSeconds > 0 {
                countdown = session.restRemainingSeconds
            } else {
                countdown = totalDuration
            }
            initializedFromPhone = true
            hasNotified = false
            startLocalCountdown()
        }
        .onDisappear {
            timer?.invalidate()
        }
        .onChange(of: session.restRemainingSeconds) { newValue in
            // Phone sent an update — sync our countdown
            if newValue > 0 && abs(countdown - newValue) > 2 {
                countdown = newValue
            }
            // Phone says 0 remaining — rest ended
            if newValue == 0 && initializedFromPhone && countdown <= 0 && !hasNotified {
                hasNotified = true
                WKInterfaceDevice.current().play(.notification)
                timer?.invalidate()
            }
        }
        .onChange(of: session.isResting) { resting in
            if !resting {
                timer?.invalidate()
            }
        }
    }

    private var progress: Double {
        guard totalDuration > 0 else { return 0 }
        return max(0, Double(countdown) / Double(totalDuration))
    }

    private func startLocalCountdown() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            if countdown > 0 {
                countdown -= 1
                // Haptic ticks at 3, 2, 1
                if countdown <= 3 && countdown > 0 {
                    WKInterfaceDevice.current().play(.click)
                }
            } else if !hasNotified {
                hasNotified = true
                WKInterfaceDevice.current().play(.notification)
                timer?.invalidate()
            }
        }
    }
}
