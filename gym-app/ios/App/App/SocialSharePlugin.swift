import Foundation
import Capacitor
import UIKit
import MessageUI
import Photos

// Direct-share endpoints for the destinations Instagram Stories doesn't cover.
//
// Each method skips the generic iOS share sheet and lands the user one tap
// closer to the destination they actually picked:
//
//   shareToMessages     → MFMessageComposeViewController (in-app iMessage
//                         composer; image attached, body pre-filled).
//   shareToWhatsApp     → UIDocumentInteractionController with the
//                         `net.whatsapp.image` UTI (jumps into WhatsApp at
//                         the contact picker with the image attached).
//   shareToInstagramFeed → save image to Photos library + open
//                          `instagram://library?LocalIdentifier=<id>`
//                          (lands inside IG with our image preselected).
//
// IG Stories has its own plugin (InstagramSharePlugin) because the
// background/sticker pasteboard flow is very different.

@objc(SocialSharePlugin)
public class SocialSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SocialSharePlugin"
    public let jsName = "SocialShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareToMessages",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareToWhatsApp",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareToInstagramFeed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "canShareViaMessages",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isWhatsAppInstalled",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isInstagramInstalled", returnType: CAPPluginReturnPromise),
    ]

    // The plugin instance has to outlive the synchronous call so the
    // MFMessageComposeViewController + UIDocumentInteractionController
    // delegates keep their reference. Capacitor holds the instance for
    // the app lifetime, so storing the controller here works.
    private var docController: UIDocumentInteractionController?

    // ── Helpers ─────────────────────────────────────────────────────────────

    private func dataFromBase64(_ raw: String?) -> Data? {
        guard let raw = raw else { return nil }
        let stripped: String
        if let commaIdx = raw.firstIndex(of: ",") {
            stripped = String(raw[raw.index(after: commaIdx)...])
        } else {
            stripped = raw
        }
        return Data(base64Encoded: stripped, options: .ignoreUnknownCharacters)
    }

    private var rootViewController: UIViewController? {
        return UIApplication.shared
            .connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: { $0.isKeyWindow })?
            .rootViewController
    }

    // ── Capabilities ────────────────────────────────────────────────────────

    @objc func canShareViaMessages(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["installed": MFMessageComposeViewController.canSendText()])
        }
    }

    @objc func isWhatsAppInstalled(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let installed: Bool
            if let url = URL(string: "whatsapp://send") {
                installed = UIApplication.shared.canOpenURL(url)
            } else {
                installed = false
            }
            call.resolve(["installed": installed])
        }
    }

    @objc func isInstagramInstalled(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let installed: Bool
            if let url = URL(string: "instagram://") {
                installed = UIApplication.shared.canOpenURL(url)
            } else {
                installed = false
            }
            call.resolve(["installed": installed])
        }
    }

    // ── Messages: in-app iMessage composer ──────────────────────────────────

    private var messageDelegate: MessageComposerDelegate?

    @objc func shareToMessages(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let imageData = dataFromBase64(call.getString("image"))

        DispatchQueue.main.async {
            guard MFMessageComposeViewController.canSendText() else {
                call.reject("Messages cannot send on this device")
                return
            }
            let composer = MFMessageComposeViewController()
            composer.body = text
            if let imageData = imageData {
                composer.addAttachmentData(imageData, typeIdentifier: "public.png", filename: "tugympr.png")
            }
            // Strong reference to delegate to survive the modal lifecycle —
            // MFMessageComposeViewController only retains its delegate weakly.
            let delegate = MessageComposerDelegate { [weak self] in
                self?.messageDelegate = nil
            }
            self.messageDelegate = delegate
            composer.messageComposeDelegate = delegate

            guard let presenter = self.rootViewController else {
                call.reject("No root view controller to present from")
                return
            }
            // If we're already presenting (e.g. tour overlay, modal), present
            // from the top-most one rather than the root, otherwise iOS warns
            // and silently rejects the presentation.
            var top = presenter
            while let presented = top.presentedViewController { top = presented }
            top.present(composer, animated: true) {
                call.resolve()
            }
        }
    }

    // ── WhatsApp: image attachment via document interaction ────────────────

    @objc func shareToWhatsApp(_ call: CAPPluginCall) {
        guard let imageData = dataFromBase64(call.getString("image")) else {
            call.reject("Missing image")
            return
        }
        let text = call.getString("text") ?? ""

        DispatchQueue.main.async {
            // WhatsApp's published .wai + net.whatsapp.image UTI flow stopped
            // working reliably on recent iOS versions — UIDocumentInteractionController
            // either fails to present or shows an empty menu. The pattern
            // that actually lands the user inside WhatsApp every time is:
            //   1. Put the image bytes on UIPasteboard (WhatsApp's compose
            //      view long-press → paste accepts image pasteboard items).
            //   2. Open `whatsapp://send?text=<caption>` — WhatsApp launches
            //      at its contact picker; after the user picks a contact,
            //      they tap the attachment button → paste → the image is
            //      attached with our caption already in the text box.
            //
            // Two taps inside WhatsApp instead of one, but reliable across
            // iOS 14-26 and every published WhatsApp version. If the URL
            // scheme also fails (no WhatsApp installed), we still stage the
            // image in Documents and fall back to UIDocumentInteractionController
            // so the user lands on the iOS share sheet rather than nowhere.
            if let image = UIImage(data: imageData) {
                UIPasteboard.general.image = image
            }

            var schemeUrl: URL? = nil
            if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
                schemeUrl = URL(string: "whatsapp://send?text=\(encoded)")
            }
            if schemeUrl == nil { schemeUrl = URL(string: "whatsapp://send") }

            if let url = schemeUrl, UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url, options: [:]) { success in
                    if success {
                        call.resolve()
                    } else {
                        self.presentWhatsAppDocFallback(imageData: imageData, text: text, call: call)
                    }
                }
                return
            }

            self.presentWhatsAppDocFallback(imageData: imageData, text: text, call: call)
        }
    }

    // UIDocumentInteractionController fallback: stages the image as a
    // `.wai` file in Documents and presents the "Open in" menu. Only used
    // when the `whatsapp://` URL scheme fails (WhatsApp not installed,
    // canOpenURL false, etc).
    private func presentWhatsAppDocFallback(imageData: Data, text: String, call: CAPPluginCall) {
        let docsDir: URL
        do {
            docsDir = try FileManager.default.url(
                for: .documentDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true
            )
        } catch {
            call.reject("WhatsApp share failed: \(error.localizedDescription)")
            return
        }
        let fileUrl = docsDir.appendingPathComponent("tugympr-share.wai")
        do {
            if FileManager.default.fileExists(atPath: fileUrl.path) {
                try FileManager.default.removeItem(at: fileUrl)
            }
            try imageData.write(to: fileUrl, options: .atomic)
        } catch {
            call.reject("Failed to stage image: \(error.localizedDescription)")
            return
        }
        if !text.isEmpty { UIPasteboard.general.string = text }

        let controller = UIDocumentInteractionController(url: fileUrl)
        controller.uti = "net.whatsapp.image"
        controller.name = "TuGymPR"
        self.docController = controller

        guard let presenter = self.rootViewController else {
            call.reject("No root view controller to present from")
            return
        }
        var top = presenter
        while let presented = top.presentedViewController { top = presented }
        let view = top.view ?? UIView()
        let sourceRect = CGRect(
            x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1
        )
        let presented = controller.presentOpenInMenu(from: sourceRect, in: view, animated: true)
            || controller.presentOptionsMenu(from: sourceRect, in: view, animated: true)
        if presented {
            call.resolve(["fallback": true])
        } else {
            call.reject("WhatsApp share menu could not be presented")
        }
    }

    // ── Instagram Feed: save + deep link to library ─────────────────────────

    @objc func shareToInstagramFeed(_ call: CAPPluginCall) {
        guard let imageData = dataFromBase64(call.getString("image")) else {
            call.reject("Missing image")
            return
        }

        let openIG: (String?) -> Void = { localId in
            DispatchQueue.main.async {
                // Prefer the asset-targeted URL so IG opens its picker with our
                // image preselected. Fall back to the bare scheme if Photos
                // didn't return an id (e.g. permission denied — see below).
                let url: URL? = {
                    if let id = localId,
                       let u = URL(string: "instagram://library?LocalIdentifier=\(id)") {
                        return u
                    }
                    return URL(string: "instagram://app")
                }()
                guard let url = url, UIApplication.shared.canOpenURL(url) else {
                    call.reject("Instagram is not installed")
                    return
                }
                UIApplication.shared.open(url, options: [:]) { success in
                    if success {
                        call.resolve(["openedWithAsset": localId != nil])
                    } else {
                        call.reject("Failed to open Instagram")
                    }
                }
            }
        }

        // Save to Photos. Requires `NSPhotoLibraryAddUsageDescription` in
        // Info.plist (already present for progress-photo uploads). If the
        // user denies access we still fall through and open IG bare —
        // they can paste from clipboard or pick from another source.
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                openIG(nil)
                return
            }
            var placeholder: PHObjectPlaceholder?
            PHPhotoLibrary.shared().performChanges({
                let req = PHAssetCreationRequest.forAsset()
                req.addResource(with: .photo, data: imageData, options: nil)
                placeholder = req.placeholderForCreatedAsset
            }) { success, _ in
                openIG(success ? placeholder?.localIdentifier : nil)
            }
        }
    }
}

// MFMessageComposeViewControllerDelegate must be on an NSObject. Splitting
// out keeps SocialSharePlugin focused on JS bridge concerns.
private class MessageComposerDelegate: NSObject, MFMessageComposeViewControllerDelegate {
    let onDismiss: () -> Void
    init(onDismiss: @escaping () -> Void) {
        self.onDismiss = onDismiss
        super.init()
    }
    func messageComposeViewController(_ controller: MFMessageComposeViewController,
                                      didFinishWith result: MessageComposeResult) {
        controller.dismiss(animated: true) { [weak self] in
            self?.onDismiss()
        }
    }
}
