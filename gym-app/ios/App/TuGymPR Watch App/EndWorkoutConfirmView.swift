import SwiftUI
import WatchKit

struct EndWorkoutConfirmView: View {
    @EnvironmentObject var session: WatchSessionManager
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
                .accessibilityLabel(session.tr("Workout complete", "Entrenamiento completo"))

            Text(session.tr("End Workout?", "¿Terminar entrenamiento?"))
                .font(.headline)
                .foregroundColor(.white)

            // Quick stats
            HStack(spacing: 16) {
                VStack(spacing: 2) {
                    Text(DS.formatTime(elapsedTime))
                        .font(.system(.subheadline, design: .rounded).weight(.black))
                        .foregroundColor(.white)
                    Text(session.tr("TIME", "TIEMPO"))
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(DS.mutedText)
                        .tracking(0.5)
                }
                VStack(spacing: 2) {
                    Text("\(completedSets)")
                        .font(.system(.subheadline, design: .rounded).weight(.black))
                        .foregroundColor(.white)
                    Text(session.tr("SETS", "SERIES"))
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(DS.mutedText)
                        .tracking(0.5)
                }
            }
            .padding(.vertical, 4)

            // Save & End
            GoldButton(session.tr("Save & End", "Guardar y terminar"), icon: "checkmark.circle.fill") {
                onSaveAndEnd()
            }
            .accessibilityHint(session.tr("Saves workout and returns to home", "Guarda el entrenamiento y vuelve al inicio"))

            // Keep Going
            Button {
                onKeepGoing()
            } label: {
                Text(session.tr("Keep Going", "Seguir"))
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
