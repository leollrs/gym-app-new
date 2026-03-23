import SwiftUI
import WatchKit

struct WorkoutSummaryView: View {
    @EnvironmentObject var session: WatchSessionManager
    @ObservedObject var workoutSession: WorkoutSessionManager

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Trophy icon
                Image(systemName: session.endedPRs > 0 ? "trophy.fill" : "checkmark.seal.fill")
                    .font(.system(size: 36))
                    .foregroundColor(DS.gold)
                    .padding(.top, 4)

                Text("Workout Complete!")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.white)

                // Stats grid
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    StatCard(
                        icon: "clock.fill",
                        value: DS.formatTime(session.endedDuration),
                        label: "Duration",
                        color: .blue
                    )

                    StatCard(
                        icon: "scalemass.fill",
                        value: DS.formatVolume(session.endedVolume),
                        label: "Volume",
                        color: .green
                    )

                    StatCard(
                        icon: "checkmark.circle.fill",
                        value: "\(session.endedSetsCompleted)",
                        label: "Sets",
                        color: DS.gold
                    )

                    if session.endedPRs > 0 {
                        StatCard(
                            icon: "trophy.fill",
                            value: "\(session.endedPRs)",
                            label: "PRs",
                            color: DS.gold
                        )
                    } else {
                        StatCard(
                            icon: "heart.fill",
                            value: workoutSession.averageHeartRate > 0 ? "\(Int(workoutSession.averageHeartRate))" : "--",
                            label: "Avg BPM",
                            color: .red
                        )
                    }
                }

                // Done button
                GoldButton("Done", icon: "hand.thumbsup.fill") {
                    session.dismissSummary()
                    WKInterfaceDevice.current().play(.success)
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 4)
        }
        .background(DS.darkBg)
        .onAppear {
            WKInterfaceDevice.current().play(.success)
        }
    }
}
