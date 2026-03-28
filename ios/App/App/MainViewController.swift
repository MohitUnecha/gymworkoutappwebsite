import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginType(NativeHealthSyncPlugin.self)
        super.capacitorDidLoad()
    }
}
