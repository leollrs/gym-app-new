import SwiftUI

struct FriendsActiveView: View {
    @EnvironmentObject var session: WatchSessionManager

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // Header
                Text("FRIENDS")
                    .font(.caption2)
                    .fontWeight(.heavy)
                    .foregroundColor(DS.mutedText)
                    .tracking(1.5)
                    .padding(.top, 4)
                    .accessibilityAddTraits(.isHeader)

                if session.activeFriends.isEmpty {
                    // Empty state
                    VStack(spacing: 8) {
                        Image(systemName: "person.2.fill")
                            .font(.title3)
                            .foregroundColor(Color(white: 0.25))
                            .padding(.top, 16)

                        Text("No friends active")
                            .font(.body)
                            .fontWeight(.semibold)
                            .foregroundColor(Color(white: 0.4))

                        Text("Your gym friends' activity\nwill show up here")
                            .font(.caption)
                            .foregroundColor(Color(white: 0.3))
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 8)
                } else {
                    ForEach(Array(session.activeFriends.enumerated()), id: \.offset) { _, friend in
                        FriendRow(friend: friend)
                    }
                }
            }
            .padding(.horizontal, 8)
        }
        .background(DS.darkBg)
    }
}

struct FriendRow: View {
    let friend: [String: Any]

    private var name: String { friend["name"] as? String ?? "Friend" }
    private var status: String { friend["status"] as? String ?? "" }
    private var isActive: Bool { (friend["isActive"] as? Bool) == true }

    var body: some View {
        HStack(spacing: 10) {
            // Avatar circle with initial
            ZStack {
                Circle()
                    .fill(isActive ? DS.gold.opacity(0.2) : DS.cardBg)
                    .frame(width: 32, height: 32)
                Text(String(name.prefix(1)).uppercased())
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(isActive ? DS.gold : DS.mutedText)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    if isActive {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 5, height: 5)
                            .accessibilityLabel("Currently working out")
                        Text("Working out")
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(.green)
                    } else {
                        Text(status)
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(DS.mutedText)
                    }
                }
            }

            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(DS.cardBg)
        .cornerRadius(10)
    }
}
