import SwiftUI

struct CheckInView: View {
    @EnvironmentObject var session: WatchSessionManager
    @State private var tapped = false

    private let gold = Color(red: 212/255, green: 175/255, blue: 55/255)
    private let darkBg = Color(red: 5/255, green: 7/255, blue: 11/255)

    var body: some View {
        VStack(spacing: 16) {
            if session.checkedIn || tapped {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44, weight: .regular, design: .default))
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .foregroundColor(.green)
                    .accessibilityLabel("Checked in successfully")

                Text("Checked In!")
                    .font(.headline)
                    .foregroundColor(.white)

                Text("You're at the gym")
                    .font(.caption)
                    .foregroundColor(.gray)
            } else {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 44, weight: .regular, design: .default))
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .foregroundColor(gold)
                    .accessibilityLabel("Gym location")

                Text("Check In")
                    .font(.headline)
                    .foregroundColor(.white)

                Button(action: {
                    session.requestCheckIn()
                    withAnimation { tapped = true }
                    // Reset after 3s in case phone doesn't confirm
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                        if !session.checkedIn { tapped = false }
                    }
                }) {
                    Text("Tap to Check In")
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(gold)
                        .cornerRadius(10)
                }
                .disabled(!session.isReachable)
                .opacity(session.isReachable ? 1 : 0.4)

                if !session.isReachable {
                    Text("iPhone not reachable")
                        .font(.caption2)
                        .foregroundColor(.red)
                }
            }
        }
        .padding(.horizontal, 8)
        .background(darkBg)
    }
}
