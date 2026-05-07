import SwiftUI

struct FriendsActiveView: View {
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                WatchStatusBar(title: session.tr("ACTIVE NOW", "ACTIVOS AHORA"))

                if session.activeFriends.isEmpty {
                    // Empty state
                    VStack(spacing: 8) {
                        Image(systemName: "person.2.fill")
                            .font(.title3)
                            .foregroundColor(DS.textFaint)
                            .padding(.top, 16)
                            .accessibilityLabel(session.tr("Friends", "Amigos"))

                        Text(session.tr("No friends active", "Sin amigos activos"))
                            .font(.system(.body, design: .rounded).weight(.bold))
                            .foregroundColor(DS.textSub)

                        Text(session.tr("Your gym friends' activity\nwill show up here",
                                       "La actividad de tus amigos\naparecerá aquí"))
                            .font(.system(.caption, design: .rounded))
                            .foregroundColor(DS.textFaint)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 12)
                } else {
                    // Header sub-line
                    HStack {
                        Text("\(session.activeFriends.count) \(session.tr("friends lifting", "amigos entrenando"))")
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundColor(DS.textSub)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)

                    ForEach(Array(session.activeFriends.enumerated()), id: \.offset) { _, friend in
                        FriendRow(friend: friend)
                    }
                }
            }
            .padding(.bottom, 8)
        }
        .background(Color.black)
    }
}

struct FriendRow: View {
    let friend: [String: Any]

    private var name: String { friend["name"] as? String ?? "Friend" }
    private var status: String { friend["status"] as? String ?? "" }
    private var isActive: Bool { (friend["isActive"] as? Bool) == true }
    private var heartRate: Int { friend["heartRate"] as? Int ?? 0 }
    private var colorHex: String? { friend["color"] as? String }

    private var avatarColor: Color {
        if let hex = colorHex, let c = Color(hex: hex) { return c }
        return DS.streakOrange
    }

    var body: some View {
        HStack(spacing: 8) {
            // Avatar circle with initial + live dot
            ZStack(alignment: .bottomTrailing) {
                ZStack {
                    Circle()
                        .fill(avatarColor)
                        .frame(width: 28, height: 28)
                    Text(initials(from: name))
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                }
                if isActive {
                    Circle()
                        .fill(Color(red: 62/255, green: 220/255, blue: 110/255))
                        .frame(width: 9, height: 9)
                        .overlay(
                            Circle().stroke(Color.black, lineWidth: 1.5)
                        )
                }
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                    .lineLimit(1)

                if isActive {
                    Text(status.isEmpty ? "Working out" : status)
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundColor(DS.textSub)
                        .lineLimit(1)
                } else {
                    Text(status.isEmpty ? "Idle" : status)
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundColor(DS.textFaint)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if heartRate > 0 {
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(heartRate)")
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .foregroundColor(DS.amber)
                        .monospacedDigit()
                    Text("BPM")
                        .font(.system(size: 7, weight: .heavy, design: .rounded))
                        .foregroundColor(DS.textFaint)
                        .kerning(0.3)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(DS.surface1)
        .cornerRadius(14)
        .padding(.horizontal, 8)
    }

    private func initials(from name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap { $0.first }.map(String.init).joined().uppercased()
    }
}
