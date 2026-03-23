import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(WalletPassPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Disable rubber-band overscroll bounce on the WebView
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.alwaysBounceHorizontal = false
    }
}
