import SwiftUI
import WatchKit

struct RestTimerView: View {
    @EnvironmentObject var session: WatchSessionManager
    @State private var countdown: Int = 0
    @State private var timer: Timer?
    @State private var hasNotified: Bool = false

    var body: some View {
        VStack(spacing: 12) {
            if session.isResting {
                Text("REST")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundColor(DS.gold)
                    .tracking(2)

                // Circular countdown
                ZStack {
                    Circle()
                        .stroke(DS.cardBg, lineWidth: 8)
                        .frame(width: 100, height: 100)

                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(DS.gold, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 100, height: 100)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 1), value: countdown)

                    Text("\(countdown)")
                        .font(.system(size: 42, weight: .black, design: .rounded))
                        .foregroundColor(countdown <= 5 ? DS.gold : .white)
                        .monospacedDigit()
                }

                // Skip button
                Button(action: {
                    timer?.invalidate()
                    session.skipRest()
                    WKInterfaceDevice.current().play(.click)
                }) {
                    Text("Skip")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(DS.gold)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 8)
                        .background(DS.gold.opacity(0.15))
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
            } else {
                // Not resting — show next set info
                Image(systemName: "clock.fill")
                    .font(.system(size: 28))
                    .foregroundColor(Color(white: 0.25))

                Text("Rest timer will appear\nafter completing a set")
                    .font(.system(size: 12))
                    .foregroundColor(Color(white: 0.35))
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 8)
        .background(DS.darkBg)
        .onAppear { startTimer() }
        .onDisappear { timer?.invalidate() }
        .onChange(of: session.isResting) { resting in
            if resting {
                startTimer()
            } else {
                timer?.invalidate()
            }
        }
    }

    private var progress: Double {
        guard session.restSeconds > 0 else { return 0 }
        return Double(countdown) / Double(session.restSeconds)
    }

    private func startTimer() {
        guard session.isResting else { return }
        countdown = session.restSeconds
        hasNotified = false
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            if countdown > 0 {
                countdown -= 1
                // Tick haptic at 3, 2, 1
                if countdown <= 3 && countdown > 0 {
                    WKInterfaceDevice.current().play(.click)
                }
            } else if !hasNotified {
                hasNotified = true
                // Strong haptic when rest is over
                WKInterfaceDevice.current().play(.notification)
                timer?.invalidate()
            }
        }
    }
}
