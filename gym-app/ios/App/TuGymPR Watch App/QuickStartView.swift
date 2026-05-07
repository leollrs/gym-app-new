import SwiftUI
import WatchKit

struct QuickStartView: View {
    @EnvironmentObject var session: WatchSessionManager

    // ── Warm-up prompt ─────────────────────────────────────────────
    // Tapping a routine fires a confirmation dialog before starting,
    // so the user can opt in / out of the phone's warm-up gate.
    @State private var pendingRoutineId: String? = nil
    @State private var showWarmUpPrompt: Bool = false

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                WatchStatusBar(title: session.tr("ROUTINES", "RUTINAS"))

                if session.availableRoutines.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "dumbbell.fill")
                            .font(.title3)
                            .foregroundColor(DS.textFaint)
                            .padding(.top, 16)
                            .accessibilityLabel(session.tr("Quick start workout", "Inicio rápido"))

                        Text(session.tr("No Routines", "Sin rutinas"))
                            .font(.system(.subheadline, design: .rounded).weight(.bold))
                            .foregroundColor(DS.textSub)

                        Text(session.tr("Open TuGymPR on your\niPhone to sync routines",
                                       "Abre TuGymPR en tu\niPhone para sincronizar"))
                            .font(.system(.caption2, design: .rounded))
                            .foregroundColor(DS.textFaint)
                            .multilineTextAlignment(.center)

                        Button {
                            session.requestRoutines()
                            WKInterfaceDevice.current().play(.click)
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .font(.caption2)
                                Text(session.tr("Sync", "Sincronizar"))
                                    .font(.system(.caption, design: .rounded).weight(.heavy))
                            }
                            .foregroundColor(Color(red: 0, green: 0.08, blue: 0.07))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(DS.brandAccent)
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 4)
                    }
                    .padding(.top, 8)
                } else {
                    ForEach(Array(session.availableRoutines.enumerated()), id: \.offset) { _, routine in
                        Button {
                            let id = routine["id"] as? String ?? ""
                            pendingRoutineId = id
                            showWarmUpPrompt = true
                            WKInterfaceDevice.current().play(.click)
                        } label: {
                            let isProgram = (routine["isProgram"] as? Bool) == true
                            HStack(spacing: 10) {
                                Image(systemName: isProgram ? "figure.strengthtraining.traditional" : "list.bullet.rectangle")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundColor(DS.brandAccent)
                                    .frame(width: 20)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(cleanName(routine["name"] as? String ?? session.tr("Workout", "Entrenamiento")))
                                        .font(.system(.caption, design: .rounded).weight(.heavy))
                                        .foregroundColor(.white)
                                        .lineLimit(1)
                                    HStack(spacing: 6) {
                                        Text("\(routine["exerciseCount"] as? Int ?? 0) \(session.tr("ex", "ej"))")
                                            .font(.system(size: 9, weight: .semibold, design: .rounded))
                                            .foregroundColor(DS.textSub)
                                        if isProgram {
                                            Text(session.tr("PROGRAM", "PROGRAMA"))
                                                .font(.system(size: 8, weight: .heavy, design: .rounded))
                                                .kerning(0.4)
                                                .foregroundColor(DS.brandAccent)
                                        }
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(DS.surface1)
                            .cornerRadius(14)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(Color.black)
        .navigationTitle(session.tr("Routines", "Rutinas"))
        .onAppear {
            if session.isReachable {
                session.requestRoutines()
            }
        }
        .confirmationDialog(
            session.tr("Start with a warm-up?", "¿Empezar con calentamiento?"),
            isPresented: $showWarmUpPrompt,
            titleVisibility: .visible
        ) {
            Button(session.tr("With warm-up", "Con calentamiento")) {
                if let id = pendingRoutineId {
                    session.startWorkout(routineId: id, skipWarmUp: false)
                }
                pendingRoutineId = nil
            }
            Button(session.tr("Skip warm-up", "Sin calentamiento")) {
                if let id = pendingRoutineId {
                    session.startWorkout(routineId: id, skipWarmUp: true)
                }
                pendingRoutineId = nil
            }
            Button(session.tr("Cancel", "Cancelar"), role: .cancel) {
                pendingRoutineId = nil
            }
        }
    }

    private func cleanName(_ name: String) -> String {
        name.hasPrefix("Auto: ") ? String(name.dropFirst(6)) : name
    }
}
