import SwiftUI
import WatchKit

struct QuickStartView: View {
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if session.availableRoutines.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "dumbbell.fill")
                            .font(.title3)
                            .foregroundColor(Color(white: 0.25))
                            .padding(.top, 16)
                            .accessibilityLabel("Quick start workout")

                        Text("No Routines")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(Color(white: 0.4))

                        Text("Open TuGymPR on your\niPhone to sync routines")
                            .font(.caption2)
                            .foregroundColor(Color(white: 0.3))
                            .multilineTextAlignment(.center)

                        Button {
                            session.requestRoutines()
                            WKInterfaceDevice.current().play(.click)
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .font(.caption2)
                                    .accessibilityLabel("Sync")
                                Text("Sync")
                                    .font(.caption.weight(.semibold))
                            }
                            .foregroundColor(DS.gold)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(DS.gold.opacity(0.15))
                            .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 4)
                    }
                    .padding(.top, 8)
                } else {
                    Text("ALL ROUTINES")
                        .font(.caption2)
                        .fontWeight(.heavy)
                        .foregroundColor(DS.mutedText)
                        .tracking(1.5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                        .accessibilityAddTraits(.isHeader)

                    ForEach(Array(session.availableRoutines.enumerated()), id: \.offset) { _, routine in
                        Button {
                            let id = routine["id"] as? String ?? ""
                            session.startWorkout(routineId: id)
                            WKInterfaceDevice.current().play(.click)
                        } label: {
                            let isProgram = (routine["isProgram"] as? Bool) == true
                            VStack(alignment: .leading, spacing: 4) {
                                Text(cleanName(routine["name"] as? String ?? "Workout"))
                                    .font(.subheadline.weight(.bold))
                                    .foregroundColor(.white)
                                    .lineLimit(1)

                                HStack(spacing: 8) {
                                    Label("\(routine["exerciseCount"] as? Int ?? 0)", systemImage: "figure.strengthtraining.traditional")
                                        .font(.caption2.weight(.medium))
                                        .foregroundColor(DS.mutedText)

                                    if isProgram {
                                        Text("PROGRAM")
                                            .font(.caption2.weight(.heavy))
                                            .foregroundColor(DS.gold)
                                            .tracking(0.5)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(DS.cardBg)
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 8)
        }
        .background(DS.darkBg)
        .navigationTitle("Routines")
        .onAppear {
            if session.isReachable {
                session.requestRoutines()
            }
        }
    }

    private func cleanName(_ name: String) -> String {
        name.hasPrefix("Auto: ") ? String(name.dropFirst(6)) : name
    }
}
