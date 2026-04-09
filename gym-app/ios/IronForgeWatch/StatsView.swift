import SwiftUI

struct StatsView: View {
    @EnvironmentObject var session: WatchSessionManager

    private let gold = Color(red: 212/255, green: 175/255, blue: 55/255)
    private let darkBg = Color(red: 5/255, green: 7/255, blue: 11/255)
    private let cardBg = Color(red: 15/255, green: 23/255, blue: 42/255)

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("TODAY")
                    .font(.caption2.weight(.heavy))
                    .foregroundColor(.gray)
                    .tracking(2)

                // Streak
                HStack(spacing: 6) {
                    Image(systemName: "flame.fill")
                        .foregroundColor(gold)
                        .font(.subheadline)
                        .accessibilityLabel("Streak")
                    Text("\(session.streak) day streak")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.white)
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 14)
                .background(gold.opacity(0.12))
                .cornerRadius(20)

                // Stats grid
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    StatCard(icon: "figure.walk", value: "\(session.steps)", label: "Steps", color: gold)
                    StatCard(icon: "dumbbell.fill", value: "\(session.workoutsThisWeek)", label: "Workouts", color: .green)
                    StatCard(icon: "scalemass.fill", value: formatVolume(session.totalVolume), label: "Volume", color: .blue)
                    StatCard(icon: "checkmark.circle.fill",
                             value: session.checkedIn ? "Yes" : "No",
                             label: "Checked In",
                             color: session.checkedIn ? .green : .red)
                }
            }
            .padding(.horizontal, 4)
        }
        .background(darkBg)
    }

    private func formatVolume(_ v: Double) -> String {
        if v >= 1000 {
            return String(format: "%.0fk", v / 1000)
        }
        return String(format: "%.0f", v)
    }
}

struct StatCard: View {
    let icon: String
    let value: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundColor(color)
            Text(value)
                .font(.system(.body, design: .rounded).weight(.black))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color(red: 15/255, green: 23/255, blue: 42/255))
        .cornerRadius(10)
        .accessibilityElement(children: .combine)
    }
}
