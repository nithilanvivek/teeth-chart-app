import SwiftUI

@main
struct TeethChartAppApp: App {
    var body: some Scene {
        WindowGroup {
            ChartWebView()
                .background(Color(red: 0.055, green: 0.075, blue: 0.10))
                .ignoresSafeArea()
        }
    }
}
