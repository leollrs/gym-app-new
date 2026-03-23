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
                    .font(.system(size: 44))
                    .foregroundColor(.green)

                Text("Checked In!")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)

                Text("You're at the gym")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            } else {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 44))
                    .foregroundColor(gold)

                Text("Check In")
                    .font(.system(size: 16, weight: .bold))
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
                        .font(.system(size: 14, weight: .bold))
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
                        .font(.system(size: 10))
                        .foregroundColor(.red)
                }
            }
        }
        .padding(.horizontal, 8)
        .background(darkBg)
    }
}
