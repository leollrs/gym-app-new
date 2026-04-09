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
            lastWorkoutName: "Push Day",
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

    // MARK: - Circular: Streak count with fire icon

    private var circularView: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 1) {
                Image(systemName: "flame.fill")
                    .font(.caption.weight(.bold))
                    .foregroundColor(complicationGold)
                Text("\(entry.streak)")
                    .font(.system(.body, design: .rounded).weight(.black))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
        }
    }

    // MARK: - Rectangular: App name + streak + last workout date

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "flame.fill")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(complicationGold)
                Text("TuGymPR")
                    .font(.caption.weight(.heavy))
                    .foregroundColor(complicationGold)
            }

            HStack(spacing: 4) {
                Text("\(entry.streak) day streak")
                    .font(.system(.caption, design: .rounded).weight(.bold))
                Spacer()
                Text("\(entry.weeklyCount)/wk")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.secondary)
            }

            HStack(spacing: 4) {
                Text(entry.lastWorkoutName)
                    .font(.caption2.weight(.medium))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Text("·")
                    .foregroundColor(.secondary)
                Text(formatRelativeDate(entry.lastWorkoutDate))
                    .font(.caption2.weight(.medium))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
    }

    // MARK: - Inline: Emoji + streak + workout name

    private var inlineView: some View {
        Text("🔥 \(entry.streak) streak • \(entry.lastWorkoutName)")
            .font(.caption.weight(.semibold))
            .lineLimit(1)
    }

    // MARK: - Corner: Streak number with gauge

    private var cornerView: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 1) {
                Image(systemName: "flame.fill")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(complicationGold)
                Text("\(entry.streak)")
                    .font(.system(.headline, design: .rounded).weight(.black))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
        }
        .widgetLabel {
            Gauge(value: Double(min(entry.weeklyCount, 7)), in: 0...7) {
                Text("Wk")
            } currentValueLabel: {
                Text("\(entry.weeklyCount)")
            }
            .tint(complicationGold)
        }
    }

    // MARK: - Helpers

    private var complicationGold: Color {
        Color(red: 212/255, green: 175/255, blue: 55/255)
    }

    private func formatRelativeDate(_ dateString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateString) else { return dateString }

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
        lastWorkoutName: "Push Day",
        lastWorkoutDate: "2026-03-23",
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
