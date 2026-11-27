# GrapheneOS Browser (Vanadium) Privacy Overview

The default browser on GrapheneOS is **Vanadium**, which offers strong baseline privacy by stripping out Google tracking while prioritizing top-tier security hardening. However, it lacks built-in ad blocking and advanced anti-fingerprinting tools found in browsers like Brave or Tor.

## What Vanadium Does Well

* **Zero telemetry:** Vanadium is built from Chromium with Google services, crash reporting, and telemetry completely removed.
* **Leak protection:** It disables peer-to-peer WebRTC by default (forcing proxied connections) and blocks websites from accessing local network interfaces, preventing sites from exposing your real IP address.
* **Private default search:** It uses DuckDuckGo as the default search engine instead of Google.
* **Industry-leading security:** Because security is essential to privacy, Vanadium uses strict sandboxing, memory protections, and rapid Chromium security patches to stop malicious websites from compromising your device.

## Privacy Limitations & Trade-offs

* **No built-in ad or tracker blocking:** Vanadium does not include an integrated ad blocker or support browser extensions. To block ads and third-party trackers, you need to pair it with network-level filtering like NextDNS, RethinkDNS, or a VPN with DNS blocking.
* **Basic anti-fingerprinting:** Unlike Tor Browser or Brave, Vanadium does not aggressively randomize or spoof your browser fingerprint, as doing so can weaken Chromium's security boundaries.
* **Safe Browsing trade-offs:** Enabling the optional "Standard" or "Enhanced" Safe Browsing features can send URLs and page data to Google for analysis.

## Bottom Line

Vanadium is ideal for **everyday browsing** when paired with a private DNS service. If you need **aggressive ad blocking** out of the box, consider installing Brave—though third-party browsers slightly increase your device's attack surface. For **maximum anonymity**, use the Tor Browser.

## References

* Reddit r/GrapheneOS discussion on Vanadium privacy: https://www.reddit.com/r/GrapheneOS/comments/1q1ezh1/is_vanadium_basically_the_most_private_browser_on/
* GrapheneOS forum discussion on webapps privacy & security: https://discuss.grapheneos.org/d/29604-how-privatesecure-are-webapps
