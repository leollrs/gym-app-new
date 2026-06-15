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

    private var timeString: String {
        let m = max(countdown, 0) / 60
        let s = max(countdown, 0) % 60
        return String(format: "%d:%02d", m, s)
    }

    var body: some View {
        VStack(spacing: 8) {
            WatchStatusBar(title: session.tr("REST", "DESCANSO"), color: DS.amber)

            // Circular countdown with amber ring, bold tabular MM:SS
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.15), lineWidth: 8)
                    .frame(width: 130, height: 130)

                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(DS.amber, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .frame(width: 130, height: 130)
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? .none : .linear(duration: 1), value: countdown)

                VStack(spacing: 2) {
                    Text(timeString)
                        .font(.system(size: 34, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(countdown <= 5 ? DS.amber : .white)
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        .accessibilityAddTraits(.updatesFrequently)
                        .accessibilityLabel("\(countdown) seconds remaining")
                    Text(session.tr("REST TIMER", "DESCANSO"))
                        .font(.system(size: 9, weight: .heavy, design: .rounded))
                        .kerning(0.6)
                        .foregroundColor(DS.amber)
                }
            }

            // Next set hint
            if session.totalSets > 0 && session.setNumber > 0 {
                Text("\(session.tr("Next", "Sigue")) · \(session.tr("Set", "Serie")) \(min(session.setNumber + 1, session.totalSets)) \(session.tr("of", "de")) \(session.totalSets) · \(Int(session.suggestedWeight)) lbs")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(DS.textSub)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.horizontal, 8)
            }

            // Controls: +30s (muted pill) · Skip (teal primary)
            HStack(spacing: 6) {
                Button {
                    countdown += 30
                    totalDuration = max(totalDuration, countdown)
                    // If the timer already expired it was invalidated — restart
                    // it so the added time actually counts down instead of
                    // sitting frozen at 0:30.
                    hasNotified = false
                    startLocalCountdown()
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Text("+30s")
                        .font(.system(.caption, design: .rounded).weight(.heavy))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(DS.surface1)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)

                Button {
                    timer?.invalidate()
                    session.skipRest()
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    Text(session.tr("Skip", "Saltar"))
                        .font(.system(.caption, design: .rounded).weight(.heavy))
                        .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(DS.brandAccent)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Skip rest timer")
            }
            .padding(.horizontal, 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
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
