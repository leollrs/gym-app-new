import SwiftUI

struct HeartRateZoneView: View {
    @ObservedObject var workoutSession: WorkoutSessionManager
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    private let zones: [(HeartRateZone, ClosedRange<Double>, Color, String)] = [
        (.warmup,  0...99,    DS.zoneEasy,     "EASY"),
        (.fatBurn, 100...129, DS.zoneFatBurn,  "FAT"),
        (.cardio,  130...159, DS.zoneCardio,   "CARDIO"),
        (.peak,    160...220, DS.zonePeak,     "PEAK"),
    ]

    private var currentZoneColor: Color {
        zones.first { $0.0 == workoutSession.heartRateZone }?.2 ?? DS.zoneCardio
    }

    /// Fully-localized zone eyebrow. The enum rawValue is English-only, so the
    /// old `rawValue + tr("ZONE","ZONA")` rendered "CARDIO ZONA" in Spanish.
    private func zoneLabel(_ zone: HeartRateZone) -> String {
        switch zone {
        case .warmup:  return session.tr("WARM UP ZONE", "ZONA CALENTAMIENTO")
        case .fatBurn: return session.tr("FAT BURN ZONE", "ZONA QUEMA GRASA")
        case .cardio:  return session.tr("CARDIO ZONE", "ZONA CARDIO")
        case .peak:    return session.tr("PEAK ZONE", "ZONA PICO")
        }
    }

    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        VStack(spacing: 8) {
            WatchStatusBar(title: session.tr("CARDIO", "CARDIO"), color: DS.amber)

            // BPM hero — heart glyph + big amber number + BPM label
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(currentZoneColor)
                    .symbolEffect(.pulse, isActive: workoutSession.isSessionActive)
                    .accessibilityLabel(session.tr("Heart rate", "Frecuencia cardíaca"))
                    .baselineOffset(-2)

                if workoutSession.currentHeartRate > 0 {
                    Text("\(Int(workoutSession.currentHeartRate))")
                        .font(.system(size: 42, weight: .heavy, design: .rounded))
                        .foregroundColor(currentZoneColor)
                        .monospacedDigit()
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                } else {
                    Text("--")
                        .font(.system(size: 42, weight: .heavy, design: .rounded))
                        .foregroundColor(DS.textFaint)
                        .monospacedDigit()
                }

                Text("BPM")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundColor(DS.textSub)
            }

            // Zone label eyebrow
            Text(zoneLabel(workoutSession.heartRateZone))
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .kerning(0.6)
                .foregroundColor(currentZoneColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            // 4-segment zone bar (matches reference HR face)
            HStack(spacing: 3) {
                ForEach(zones, id: \.0) { zone, _, color, _ in
                    let isActive = zone == workoutSession.heartRateZone
                    RoundedRectangle(cornerRadius: 4)
                        .fill(isActive ? color : Color.white.opacity(0.15))
                        .frame(height: 10)
                        .shadow(color: isActive ? color.opacity(0.6) : .clear,
                                radius: isActive ? 6 : 0)
                        .animation(reduceMotion ? .none : .easeInOut(duration: 0.3),
                                   value: workoutSession.heartRateZone)
                }
            }
            .padding(.horizontal, 12)
            .accessibilityHidden(true)

            // Bar labels
            HStack {
                ForEach(zones, id: \.0) { _, _, _, label in
                    Text(label)
                        .font(.system(size: 8, weight: .heavy, design: .rounded))
                        .kerning(0.3)
                        .foregroundColor(DS.textFaint)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 12)

            // Avg HR footer
            if workoutSession.averageHeartRate > 0 {
                Text("\(session.tr("AVG", "PROM")) \(Int(workoutSession.averageHeartRate)) BPM")
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .kerning(0.5)
                    .foregroundColor(DS.textSub)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }
}

extension HeartRateZone: Equatable, Hashable {}
