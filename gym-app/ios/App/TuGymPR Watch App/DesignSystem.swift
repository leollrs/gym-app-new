import SwiftUI

enum DS {
    static let darkBg = Color(red: 5/255, green: 7/255, blue: 11/255)
    static let cardBg = Color(red: 15/255, green: 23/255, blue: 42/255)
    static let gold = Color(red: 212/255, green: 175/255, blue: 55/255)
    static let mutedText = Color(white: 0.6)
    static let successGreen = Color(red: 16/255, green: 185/255, blue: 129/255)
    static let dangerRed = Color(red: 239/255, green: 68/255, blue: 68/255)
    static let warningOrange = Color(red: 249/255, green: 115/255, blue: 22/255)

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
                    .font(.headline)
            }
            .foregroundColor(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(DS.gold)
            .cornerRadius(12)
        }
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
                    .font(.headline)
            }
            .foregroundColor(DS.gold)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(DS.cardBg)
            .cornerRadius(12)
        }
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
                .font(.headline)
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(label)
                .font(.caption2)
                .foregroundColor(.gray)
                .textCase(.uppercase)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(DS.cardBg)
        .cornerRadius(10)
        .accessibilityElement(children: .combine)
    }
}
