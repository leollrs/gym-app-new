import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(WalletPassPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.alwaysBounceHorizontal = false
    }

    // Free memory when iOS sends a memory warning (before camera could trigger OOM)
    override func didReceiveMemoryWarning() {
        super.didReceiveMemoryWarning()
        // Clear URL cache to reduce memory footprint
        URLCache.shared.removeAllCachedResponses()
    }
}
