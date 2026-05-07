import SwiftUI
import Combine

enum DS {
    // MARK: - Legacy tokens (kept for compatibility with existing views)
    static let darkBg = Color.black
    static let cardBg = Color(white: 1.0, opacity: 0.10)
    static let mutedText = Color(white: 1.0, opacity: 0.55)
    static let successGreen = Color(red: 94/255, green: 170/255, blue: 94/255)
    static let dangerRed = Color(red: 255/255, green: 59/255, blue: 92/255)
    static let warningOrange = Color(red: 255/255, green: 90/255, blue: 46/255)

    // MARK: - New Watch design language ("Apple Watch · 7 faces" reference)
    // Primary teal accent (Start Workout / positive actions)
    static let accentTeal = Color(red: 46/255, green: 196/255, blue: 196/255)     // #2EC4C4
    static let accentTealDeep = Color(red: 31/255, green: 176/255, blue: 176/255) // #1FB0B0 (gradient end)
    static let accentTealSoft = Color(red: 46/255, green: 196/255, blue: 196/255).opacity(0.18)

    // Brand orange — streak / flame accents
    static let streakOrange = Color(red: 255/255, green: 90/255, blue: 46/255)    // #FF5A2E
    static let streakOrangeSoft = Color(red: 255/255, green: 90/255, blue: 46/255).opacity(0.18)
    static let streakOrangeGlow = Color(red: 255/255, green: 143/255, blue: 74/255) // #FF8F4A (text on dark)

    // Amber — rest timers / cardio zone
    static let amber = Color(red: 255/255, green: 194/255, blue: 74/255)           // #FFC24A

    // Zone colors
    static let zoneEasy = Color(red: 94/255, green: 170/255, blue: 94/255)         // #5EAA5E
    static let zoneFatBurn = Color(red: 46/255, green: 196/255, blue: 196/255)     // #2EC4C4
    static let zoneCardio = Color(red: 255/255, green: 194/255, blue: 74/255)      // #FFC24A
    static let zonePeak = Color(red: 255/255, green: 59/255, blue: 92/255)         // #FF3B5C

    // Ring colors (Move / Exercise / Stand)
    static let ringMove = Color(red: 255/255, green: 59/255, blue: 92/255)         // #FF3B5C
    static let ringExercise = Color(red: 167/255, green: 249/255, blue: 91/255)    // #A7F95B
    static let ringStand = Color(red: 1/255, green: 195/255, blue: 195/255)        // #01C3C3

    // Translucent surfaces on black
    static let surface1 = Color.white.opacity(0.10)
    static let surface2 = Color.white.opacity(0.12)
    static let textSub = Color.white.opacity(0.55)
    static let textFaint = Color.white.opacity(0.35)

    // Legacy gold alias — remapped so any straggler call sites still compile
    // and render in the new visual language (teal is the primary accent now).
    static var gold: Color { accentTeal }

    // MARK: - Branded accent from shared UserDefaults
    // The iOS app writes `accentColorHex` / `gymAccentHex` into the app group
    // `group.com.tugympr.app`. We prefer that at runtime, but fall back to the
    // watch-native teal if branding isn't available.
    static var brandAccent: Color {
        if let defaults = UserDefaults(suiteName: "group.com.tugympr.app"),
           let hex = (defaults.string(forKey: "gymAccentHex")
                      ?? defaults.string(forKey: "accentColorHex")),
           let color = Color(hex: hex) {
            return color
        }
        return accentTeal
    }

    // MARK: - Formatters
    static func formatTime(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }

    static func formatVolume(_ v: Double) -> String {
        if v >= 1000 { return String(format: "%.0fk", v / 1000) }
        return String(format: "%.0f", v)
    }

    static func formatRelativeDate(_ dateString: String) -> String {
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
        case 2...6: return "\(days) days ago"
        case 7: return "1 week ago"
        default:
            let weeks = days / 7
            if weeks <= 4 { return "\(weeks) weeks ago" }
            return dateString
        }
    }
}

// MARK: - Hex color init
extension Color {
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
        let r = Double((v >> 16) & 0xff) / 255.0
        let g = Double((v >> 8) & 0xff) / 255.0
        let b = Double(v & 0xff) / 255.0
        self = Color(red: r, green: g, blue: b)
    }
}

// MARK: - Shared status bar (brand title + time, per reference)
struct WatchStatusBar: View {
    let title: String
    var color: Color = DS.streakOrange

    var body: some View {
        HStack {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .kerning(0.4)
                .foregroundColor(color)
            Spacer()
            TimeView()
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundColor(.white)
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 2)
    }
}

// Lightweight live clock label for the status bar
private struct TimeView: View {
    @State private var now = Date()
    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    private let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "H:mm"
        return f
    }()
    var body: some View {
        Text(formatter.string(from: now))
            .onReceive(timer) { now = $0 }
    }
}

// MARK: - Buttons (new teal primary, pill variants)
struct GoldButton: View {
    let title: String
    let icon: String?
    let action: () -> Void

    init(_ title: String, icon: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon)
                        .font(.body)
                }
                Text(title)
                    .font(.system(.headline, design: .rounded).weight(.heavy))
            }
            .foregroundColor(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(DS.brandAccent)
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }
}

struct SecondaryButton: View {
    let title: String
    let icon: String?
    let action: () -> Void

    init(_ title: String, icon: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon)
                        .font(.body)
                }
                Text(title)
                    .font(.system(.headline, design: .rounded).weight(.bold))
            }
            .foregroundColor(DS.brandAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(DS.surface1)
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
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
                .font(.body)
                .foregroundColor(color)
            Text(value)
                .font(.system(.headline, design: .rounded).weight(.heavy))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(label)
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .kerning(0.5)
                .foregroundColor(DS.textSub)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(DS.surface1)
        .cornerRadius(10)
        .accessibilityElement(children: .combine)
    }
}
