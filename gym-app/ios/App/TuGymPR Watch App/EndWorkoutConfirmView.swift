import SwiftUI
import WatchKit

struct EndWorkoutConfirmView: View {
    let elapsedTime: Int
    let completedSets: Int
    let onSaveAndEnd: () -> Void
    let onKeepGoing: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            // Header
            Image(systemName: "flag.checkered")
                .font(.title3)
                .foregroundColor(DS.gold)
                .accessibilityLabel("Workout complete")

            Text("End Workout?")
                .font(.headline)
                .foregroundColor(.white)

            // Quick stats
            HStack(spacing: 16) {
                VStack(spacing: 2) {
                    Text(DS.formatTime(elapsedTime))
                        .font(.system(.subheadline, design: .rounded).weight(.black))
                        .foregroundColor(.white)
                    Text("TIME")
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(DS.mutedText)
                        .tracking(0.5)
                }
                VStack(spacing: 2) {
                    Text("\(completedSets)")
                        .font(.system(.subheadline, design: .rounded).weight(.black))
                        .foregroundColor(.white)
                    Text("SETS")
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(DS.mutedText)
                        .tracking(0.5)
                }
            }
            .padding(.vertical, 4)

            // Save & End
            GoldButton("Save & End", icon: "checkmark.circle.fill") {
                onSaveAndEnd()
            }
            .accessibilityHint("Saves workout and returns to home")

            // Keep Going
            Button {
                onKeepGoing()
            } label: {
                Text("Keep Going")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(DS.gold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(DS.gold.opacity(0.12))
                    .cornerRadius(10)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .frame(maxHeight: .infinity)
        .background(DS.darkBg)
    }
}
