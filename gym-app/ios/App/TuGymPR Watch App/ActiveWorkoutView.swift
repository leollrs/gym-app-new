import SwiftUI
import WatchKit

struct ActiveWorkoutView: View {
    @EnvironmentObject var session: WatchSessionManager
    @ObservedObject var repCounter: RepCountingManager

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // Exercise name
                Text(session.exerciseName)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                // Set counter
                Text("Set \(session.setNumber) of \(session.totalSets)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.gray)

                // Suggested weight & reps
                VStack(spacing: 2) {
                    Text("\(Int(session.suggestedWeight)) lbs")
                        .font(.system(size: 24, weight: .black, design: .rounded))
                        .foregroundColor(.white)

                    Text("× \(session.suggestedReps) reps")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.gray)
                }

                // Live rep counter
                ZStack {
                    Circle()
                        .stroke(DS.cardBg, lineWidth: 6)
                        .frame(width: 64, height: 64)

                    Circle()
                        .trim(from: 0, to: repProgress)
                        .stroke(DS.gold, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .frame(width: 64, height: 64)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.3), value: repCounter.repCount)

                    VStack(spacing: 0) {
                        Text("\(repCounter.repCount)")
                            .font(.system(size: 24, weight: .black, design: .rounded))
                            .foregroundColor(DS.gold)
                        Text("reps")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(DS.mutedText)
                    }
                }
                .padding(.vertical, 4)

                // Done button
                GoldButton("Done", icon: "checkmark.circle.fill") {
                    session.completeSet(
                        actualReps: repCounter.repCount > 0 ? repCounter.repCount : session.suggestedReps,
                        actualWeight: session.suggestedWeight
                    )
                    WKInterfaceDevice.current().play(.success)
                    repCounter.resetCount()
                }

                // Elapsed time
                Text(DS.formatTime(session.elapsedSeconds))
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(Color(white: 0.35))
            }
            .padding(.horizontal, 8)
        }
        .background(DS.darkBg)
        .onChange(of: session.exerciseName) { _ in
            // New exercise — restart rep counting with correct category
            repCounter.stopCounting()
            repCounter.startCounting(for: session.exerciseCategory)
        }
        .onChange(of: session.setNumber) { _ in
            // New set — reset rep count
            repCounter.resetCount()
        }
    }

    private var repProgress: Double {
        guard session.suggestedReps > 0 else { return 0 }
        return min(Double(repCounter.repCount) / Double(session.suggestedReps), 1.0)
    }
}
