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
                .font(.system(size: 28))
                .foregroundColor(DS.gold)

            Text("End Workout?")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.white)

            // Quick stats
            HStack(spacing: 16) {
                VStack(spacing: 2) {
                    Text(DS.formatTime(elapsedTime))
                        .font(.system(size: 15, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    Text("TIME")
                        .font(.system(size: 8, weight: .heavy))
                        .foregroundColor(DS.mutedText)
                        .tracking(0.5)
                }
                VStack(spacing: 2) {
                    Text("\(completedSets)")
                        .font(.system(size: 15, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    Text("SETS")
                        .font(.system(size: 8, weight: .heavy))
                        .foregroundColor(DS.mutedText)
                        .tracking(0.5)
                }
            }
            .padding(.vertical, 4)

            // Save & End
            GoldButton("Save & End", icon: "checkmark.circle.fill") {
                onSaveAndEnd()
            }

            // Keep Going
            Button {
                onKeepGoing()
            } label: {
                Text("Keep Going")
                    .font(.system(size: 14, weight: .semibold))
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
