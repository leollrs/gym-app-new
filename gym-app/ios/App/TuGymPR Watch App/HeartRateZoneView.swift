import SwiftUI

struct HeartRateZoneView: View {
    @ObservedObject var workoutSession: WorkoutSessionManager
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    private let zones: [(HeartRateZone, ClosedRange<Double>)] = [
        (.warmup,  0...99),
        (.fatBurn, 100...129),
        (.cardio,  130...159),
        (.peak,    160...220),
    ]

    var body: some View {
        VStack(spacing: 10) {
            // Heart icon with pulse
            Image(systemName: "heart.fill")
                .font(.title3)
                .foregroundColor(workoutSession.heartRateZone.color)
                .symbolEffect(.pulse, isActive: workoutSession.isSessionActive)
                .accessibilityLabel("Heart rate")

            // BPM display
            if workoutSession.currentHeartRate > 0 {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(Int(workoutSession.currentHeartRate))")
                        .font(.system(size: 38, weight: .black, design: .rounded))
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        .foregroundColor(.white)
                    Text("BPM")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.gray)
                }
            } else {
                Text("--")
                    .font(.system(size: 38, weight: .black, design: .rounded))
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .foregroundColor(Color(white: 0.3))
            }

            // Zone badge
            Text(workoutSession.heartRateZone.rawValue)
                .font(.caption2.weight(.heavy))
                .foregroundColor(.white)
                .tracking(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(workoutSession.heartRateZone.color.opacity(0.8))
                .cornerRadius(12)

            // Zone bar
            HStack(spacing: 2) {
                ForEach(zones, id: \.0) { zone, _ in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(zone.color.opacity(zone == workoutSession.heartRateZone ? 1.0 : 0.2))
                        .frame(height: zone == workoutSession.heartRateZone ? 10 : 6)
                        .animation(reduceMotion ? .none : .easeInOut(duration: 0.3), value: workoutSession.heartRateZone)
                }
            }
            .padding(.horizontal, 4)
            .accessibilityHidden(true)

            // Avg HR
            if workoutSession.averageHeartRate > 0 {
                Text("Avg \(Int(workoutSession.averageHeartRate)) BPM")
                    .font(.caption2.weight(.medium))
                    .foregroundColor(DS.mutedText)
            }
        }
        .padding(.horizontal, 8)
        .background(DS.darkBg)
    }
}

extension HeartRateZone: Equatable, Hashable {}
