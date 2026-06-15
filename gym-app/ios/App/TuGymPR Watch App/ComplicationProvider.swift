// NOTE: Add a Widget Extension target in Xcode and include this file in that target.
// The widget extension target should have "group.com.tugympr.app" added to its App Groups capability.

import WidgetKit
import SwiftUI

// MARK: - Timeline Entry

struct ComplicationEntry: TimelineEntry {
    let date: Date
    let streak: Int
    let lastWorkoutName: String
    let lastWorkoutDate: String
    let weeklyCount: Int
}

// MARK: - Timeline Provider

struct TuGymPRTimelineProvider: TimelineProvider {
    private let suiteName = "group.com.tugympr.app"

    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(
            date: Date(),
            streak: 12,
            lastWorkoutName: "Lower Power",
            lastWorkoutDate: "Today",
            weeklyCount: 4
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
        let entry = readEntry()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
        let entry = readEntry()
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        let timeline = Timeline(entries: [entry], policy: .after(nextRefresh))
        completion(timeline)
    }

    private func readEntry() -> ComplicationEntry {
        let defaults = UserDefaults(suiteName: suiteName)
        let streak = defaults?.integer(forKey: "streak") ?? 0
        let lastWorkoutName = defaults?.string(forKey: "lastWorkoutName") ?? "No workout"
        let lastWorkoutDate = defaults?.string(forKey: "lastWorkoutDate") ?? "--"
        let weeklyCount = defaults?.integer(forKey: "weeklyWorkoutCount") ?? 0

        return ComplicationEntry(
            date: Date(),
            streak: streak,
            lastWorkoutName: lastWorkoutName,
            lastWorkoutDate: lastWorkoutDate,
            weeklyCount: weeklyCount
        )
    }
}

// MARK: - Complication Views
//
// New visual language (per "Apple Watch · 7 faces" reference):
//   - Flame / streak numbers use brand orange #FF5A2E
//   - Secondary metrics use teal #2EC4C4 (brand accent from shared defaults)
//   - SF Rounded heavy numerals, tabular alignment
//   - Compact hierarchy: big number · small uppercase label

struct TuGymPRComplicationEntryView: View {
    @Environment(\.widgetFamily) var widgetFamily
    var entry: ComplicationEntry

    var body: some View {
        switch widgetFamily {
        case .accessoryCircular:
            circularView
        case .accessoryRectangular:
            rectangularView
        case .accessoryInline:
            inlineView
        case .accessoryCorner:
            cornerView
        default:
            circularView
        }
    }

    // MARK: - Circular — orange flame above streak count

    private var circularView: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 11, weight: .black))
                    .foregroundColor(streakOrange)
                Text("\(entry.streak)")
                    .font(.system(.title3, design: .rounded).weight(.black))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .monospacedDigit()
            }
        }
        .widgetAccentable()
    }

    // MARK: - Rectangular — streak headline + weekly count + last workout

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            // Brand row
            HStack(spacing: 3) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 10, weight: .black))
                    .foregroundColor(streakOrange)
                Text("TUGYMPR")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .kerning(0.6)
                    .foregroundColor(streakOrange)
                Spacer(minLength: 0)
                Text("\(entry.weeklyCount)/wk")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(.secondary)
                    .monospacedDigit()
            }

            // Big streak number + "DAY STREAK" label
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(entry.streak)")
                    .font(.system(.title2, design: .rounded).weight(.black))
                    .monospacedDigit()
                Text(entry.streak == 1 ? "DAY STREAK" : "DAY STREAK")
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .kerning(0.5)
                    .foregroundColor(.secondary)
            }

            // Last workout sub line
            HStack(spacing: 3) {
                Text(entry.lastWorkoutName)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Text("·")
                    .foregroundColor(.secondary)
                Text(formatRelativeDate(entry.lastWorkoutDate))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .widgetAccentable()
    }

    // MARK: - Inline — compact single line w/ flame

    private var inlineView: some View {
        Text("🔥 \(entry.streak) day · \(entry.lastWorkoutName)")
            .font(.system(.caption, design: .rounded).weight(.semibold))
            .lineLimit(1)
    }

    // MARK: - Corner — streak number anchored in corner + weekly gauge

    private var cornerView: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 10, weight: .black))
                    .foregroundColor(streakOrange)
                Text("\(entry.streak)")
                    .font(.system(.headline, design: .rounded).weight(.black))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .monospacedDigit()
            }
        }
        .widgetAccentable()
        .widgetLabel {
            Gauge(value: Double(min(entry.weeklyCount, 7)), in: 0...7) {
                Text("Wk")
            } currentValueLabel: {
                Text("\(entry.weeklyCount)/7")
                    .monospacedDigit()
            }
            .tint(accentTeal)
        }
    }

    // MARK: - Helpers

    private var streakOrange: Color {
        Color(red: 255/255, green: 90/255, blue: 46/255)
    }

    private var accentTeal: Color {
        // Prefer gym branding color from shared app group if available
        if let defaults = UserDefaults(suiteName: "group.com.tugympr.app"),
           let hex = (defaults.string(forKey: "gymAccentHex")
                      ?? defaults.string(forKey: "accentColorHex")),
           let c = Color(hex: hex) {
            return c
        }
        return Color(red: 46/255, green: 196/255, blue: 196/255)
    }

    private func formatRelativeDate(_ dateString: String) -> String {
        // The iPhone may send a plain "yyyy-MM-dd" OR a full ISO8601 timestamp
        // (completed_at). Accept either, falling back to the date prefix, so we
        // never render a raw timestamp on the complication.
        let parsed: Date?
        if let iso = ISO8601DateFormatter().date(from: dateString) {
            parsed = iso
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            parsed = formatter.date(from: String(dateString.prefix(10)))
        }
        guard let date = parsed else { return "" }

        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let startOfDate = calendar.startOfDay(for: date)

        let components = calendar.dateComponents([.day], from: startOfDate, to: startOfToday)
        guard let days = components.day else { return dateString }

        switch days {
        case 0: return "Today"
        case 1: return "Yesterday"
        case 2...6: return "\(days)d ago"
        default: return dateString
        }
    }
}

// MARK: - Widget Definition

struct TuGymPRComplication: Widget {
    let kind: String = "TuGymPRComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TuGymPRTimelineProvider()) { entry in
            TuGymPRComplicationEntryView(entry: entry)
        }
        .configurationDisplayName("TuGymPR")
        .description("Track your workout streak and recent activity.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
            .accessoryCorner
        ])
    }
}

// MARK: - Previews

#if DEBUG
struct TuGymPRComplication_Previews: PreviewProvider {
    static var sampleEntry = ComplicationEntry(
        date: Date(),
        streak: 12,
        lastWorkoutName: "Lower Power",
        lastWorkoutDate: "2026-04-22",
        weeklyCount: 4
    )

    static var previews: some View {
        Group {
            TuGymPRComplicationEntryView(entry: sampleEntry)
                .previewContext(WidgetPreviewContext(family: .accessoryCircular))
                .previewDisplayName("Circular")

            TuGymPRComplicationEntryView(entry: sampleEntry)
                .previewContext(WidgetPreviewContext(family: .accessoryRectangular))
                .previewDisplayName("Rectangular")

            TuGymPRComplicationEntryView(entry: sampleEntry)
                .previewContext(WidgetPreviewContext(family: .accessoryInline))
                .previewDisplayName("Inline")

            TuGymPRComplicationEntryView(entry: sampleEntry)
                .previewContext(WidgetPreviewContext(family: .accessoryCorner))
                .previewDisplayName("Corner")
        }
    }
}
#endif
