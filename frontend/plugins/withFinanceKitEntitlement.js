const { withEntitlementsPlist, withInfoPlist } = require('@expo/config-plugins')

/**
 * Corrects the FinanceKit entitlement that expo-finance-kit's own plugin writes.
 *
 * `node_modules/expo-finance-kit/plugin/build/withEntitlements.js` sets
 * `com.apple.developer.financekit` to the boolean `true`. Apple's entitlement is an array of
 * strings — Xcode's own capability template (Templates/Project Templates/iOS/Application
 * Extension/Background Delivery Extension.xctemplate) is:
 *
 *   <key>com.apple.developer.financekit</key>
 *   <array><string>financial-data</string></array>
 *
 * A boolean grants nothing. This plugin must be listed BEFORE expo-finance-kit in app.json:
 * withEntitlementsPlist composes mods so the LAST-registered runs FIRST, which means the
 * earliest-listed plugin gets the final write. Verified by introspection, not assumed — listing it
 * after upstream leaves the boolean in place.
 *
 * Delete this plugin if the upstream package ever fixes it; the invariant worth keeping is that
 * `npx expo prebuild` produces an array here, which is easy to check:
 *   plutil -p ios/ToFi/ToFi.entitlements | grep -A2 financekit
 */
module.exports = function withFinanceKitEntitlement(config) {
  const withCorrectEntitlement = withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.financekit'] = ['financial-data']
    return config
  })

  // Upstream's withInfoPlist pushes a 'com.expo.financekit.sync' BGTaskScheduler identifier
  // unconditionally — even with enableBackgroundDelivery false, which is how we run it. We never
  // register that task (patches/expo-finance-kit+0.2.23.patch removes upstream's late register
  // call, which crashed at launch once this identifier was gone), and declaring background processing the app does not perform is the kind
  // of thing App Review asks about. Dropped here; NSFinancialDataUsageDescription is kept.
  return withInfoPlist(withCorrectEntitlement, (config) => {
    const identifiers = config.modResults.BGTaskSchedulerPermittedIdentifiers
    if (Array.isArray(identifiers)) {
      const kept = identifiers.filter((id) => id !== 'com.expo.financekit.sync')
      if (kept.length > 0) {
        config.modResults.BGTaskSchedulerPermittedIdentifiers = kept
      } else {
        delete config.modResults.BGTaskSchedulerPermittedIdentifiers
      }
    }
    return config
  })
}
