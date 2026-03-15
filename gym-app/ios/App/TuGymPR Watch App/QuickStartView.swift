import SwiftUI

struct QuickStartView: View {
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Header
                Text("IRONFORGE")
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundColor(DS.gold)
                    .tracking(3)
                    .padding(.top, 4)

                // Connection indicator
                HStack(spacing: 4) {
                    Circle()
                        .fill(session.isReachable ? Color.green : Color.red)
                        .frame(width: 6, height: 6)
                    Text(session.isReachable ? "Connected" : "No iPhone")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(DS.mutedText)
                }

                if session.availableRoutines.isEmpty {
                    // Empty state
                    VStack(spacing: 8) {
                        Image(systemName: "dumbbell.fill")
                            .font(.system(size: 28))
                            .foregroundColor(Color(white: 0.25))
                            .padding(.top, 16)

                        Text("No Routines")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Color(white: 0.4))

                        Text("Open IronForge on your\niPhone to sync routines")
                            .font(.system(size: 11))
                            .foregroundColor(Color(white: 0.3))
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 8)
                } else {
                    // Routine list
                    Text("START WORKOUT")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundColor(DS.mutedText)
                        .tracking(1.5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)

                    ForEach(Array(session.availableRoutines.enumerated()), id: \.offset) { _, routine in
                        RoutineRow(routine: routine) {
                            let id = routine["id"] as? String ?? ""
                            session.startWorkout(routineId: id)
                            WKInterfaceDevice.current().play(.click)
                        }
                    }
                }
            }
            .padding(.horizontal, 8)
        }
        .background(DS.darkBg)
        .onAppear {
            session.requestRoutines()
        }
    }
}

struct RoutineRow: View {
    let routine: [String: Any]
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 4) {
                Text(routine["name"] as? String ?? "Workout")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Label("\(routine["exerciseCount"] as? Int ?? 0)", systemImage: "figure.strengthtraining.traditional")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(DS.mutedText)

                    if let lastUsed = routine["lastUsed"] as? String, !lastUsed.isEmpty {
                        Text(lastUsed)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(Color(white: 0.35))
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
