import SwiftUI

enum DS {
    static let darkBg = Color(red: 5/255, green: 7/255, blue: 11/255)
    static let cardBg = Color(red: 15/255, green: 23/255, blue: 42/255)
    static let gold = Color(red: 212/255, green: 175/255, blue: 55/255)
    static let mutedText = Color(white: 0.6)

    static func formatTime(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }

    static func formatVolume(_ v: Double) -> String {
        if v >= 1000 { return String(format: "%.0fk", v / 1000) }
        return String(format: "%.0f", v)
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
                        .font(.system(size: 14))
                }
                Text(title)
                    .font(.system(size: 15, weight: .bold))
            }
            .foregroundColor(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(DS.gold)
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
                .font(.system(size: 14))
                .foregroundColor(color)
            Text(value)
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(DS.cardBg)
        .cornerRadius(10)
    }
}
