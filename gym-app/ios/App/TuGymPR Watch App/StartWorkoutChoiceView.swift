import SwiftUI
import WatchKit

struct StartWorkoutPage: View {
    @EnvironmentObject var session: WatchSessionManager

    /// Today's workout — the routine the phone says is scheduled for today
    private var todayRoutine: [String: Any]? {
        session.availableRoutines.first { ($0["isTodayWorkout"] as? Bool) == true }
    }

    /// Any program routine as fallback
    private var anyProgramRoutine: [String: Any]? {
        session.availableRoutines.first { ($0["isProgram"] as? Bool) == true }
    }

    var body: some View {
        VStack(spacing: 12) {
            Text("WORKOUT")
                .font(.system(size: 10, weight: .heavy))
                .foregroundColor(DS.mutedText)
                .tracking(1.5)

            // Start today's workout
            if let routine = todayRoutine ?? anyProgramRoutine {
                Button {
                    let id = routine["id"] as? String ?? ""
                    session.startWorkout(routineId: id)
                    WKInterfaceDevice.current().play(.click)
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "flame.fill")
                            .font(.system(size: 24))
                            .foregroundColor(DS.gold)

                        Text("Start Workout")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(.white)

                        Text(cleanName(routine["name"] as? String ?? ""))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(DS.mutedText)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(DS.gold.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(DS.gold.opacity(0.3), lineWidth: 1)
                    )
                    .cornerRadius(14)
                }
                .buttonStyle(.plain)
            }

            // Browse routines
            NavigationLink(destination: QuickStartView()) {
                HStack(spacing: 8) {
                    Image(systemName: "list.bullet")
                        .font(.system(size: 14))
                        .foregroundColor(.white)

                    Text("Browse Routines")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(DS.mutedText)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(DS.cardBg)
                .cornerRadius(12)
            }
            .buttonStyle(.plain)

            if todayRoutine == nil && anyProgramRoutine == nil && session.availableRoutines.isEmpty {
                Text("Open TuGymPR on your\niPhone to sync routines")
                    .font(.system(size: 10))
                    .foregroundColor(Color(white: 0.3))
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            } else if todayRoutine == nil && anyProgramRoutine == nil {
                Text("No active program")
                    .font(.system(size: 10))
                    .foregroundColor(Color(white: 0.3))
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity)
        .background(DS.darkBg)
    }

    private func cleanName(_ name: String) -> String {
        name.hasPrefix("Auto: ") ? String(name.dropFirst(6)) : name
    }
}
