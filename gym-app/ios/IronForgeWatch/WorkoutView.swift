import SwiftUI

struct WorkoutView: View {
    @EnvironmentObject var session: WatchSessionManager
    @State private var restCountdown = 0
    @State private var timer: Timer?

    private let gold = Color(red: 212/255, green: 175/255, blue: 55/255)
    private let darkBg = Color(red: 5/255, green: 7/255, blue: 11/255)

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Exercise name
                Text(session.exerciseName)
                    .font(.headline)
                    .foregroundColor(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                // Set counter
                Text("Set \(session.setNumber) of \(session.totalSets)")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.gray)

                if session.isResting {
                    // Rest timer
                    VStack(spacing: 6) {
                        Text("REST")
                            .font(.caption2.weight(.heavy))
                            .foregroundColor(gold)
                            .tracking(2)

                        Text("\(restCountdown)s")
                            .font(.system(size: 36, weight: .black, design: .rounded))
                            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                            .foregroundColor(gold)
                            .monospacedDigit()
                    }
                    .onAppear { startRestTimer() }
                    .onDisappear { timer?.invalidate() }
                } else {
                    // Suggestion
                    VStack(spacing: 4) {
                        Text("\(Int(session.suggestedWeight)) lbs")
                            .font(.system(.title3, design: .rounded).weight(.black))
                            .foregroundColor(.white)

                        Text("× \(session.suggestedReps) reps")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.gray)
                    }
                }

                // Complete set button
                Button(action: { session.completeSet() }) {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.subheadline)
                            .accessibilityLabel("Complete set")
                        Text("Done")
                            .font(.subheadline.weight(.bold))
                    }
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(gold)
                    .cornerRadius(12)
                }
                .disabled(session.isResting)
                .opacity(session.isResting ? 0.4 : 1)

                // Elapsed time
                Text(formatTime(session.elapsedSeconds))
                    .font(.system(.caption, design: .monospaced).weight(.medium))
                    .foregroundColor(Color(white: 0.45))
            }
            .padding(.horizontal, 8)
        }
        .background(darkBg)
    }

    private func startRestTimer() {
        restCountdown = session.restSeconds
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            if restCountdown > 0 {
                restCountdown -= 1
            } else {
                timer?.invalidate()
            }
        }
    }

    private func formatTime(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }
}
