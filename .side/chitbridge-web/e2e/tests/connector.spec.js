// MODULE: Connector cockpit — the IoT/ERP DEVICE operations (add device, ping, ERP-test, delete). This is the deep level
// under a created IoT gateway / ERP system co-assist. NEEDS the entity to have the `connector` capability enabled AND a
// gateway/system created first (the wizard's iot/erp types are "explore-only" without the capability), so it's a setup-
// dependent skeleton until a connector-enabled test entity exists.
// LOCATORS: conn-topic · conn-device-id · conn-path · conn-device-name (add-device form) + by title: "Ping — mark live" /
//           "Test connection" (ping), "📄 Send a test document" (ERP-test), delete icon.
const { test, expect } = require('@playwright/test');

test.describe('Module · Connector cockpit (IoT / ERP)', () => {
  test.skip('[CONN-01] add a device, ping, ERP-test, delete (needs a connector-enabled entity + a gateway)', async ({ page }) => {
    // TODO(setup): use an entity with the `connector` capability; create an IoT gateway (or ERP system) via the co-assist
    //   wizard; open its cockpit (coassist-row → device cockpit).
    // ADD DEVICE:   conn-device-name.fill(...) → conn-topic/conn-path.fill(...) → the "Add" button → device appears.
    // PING (IoT):   getByTitle('Ping — mark live').click() → health goes live.
    // ERP-TEST:     getByText('Send a test document') → a receipt (hash + outcome) appears in the ledger.
    // DELETE:       getByTitle(/Delete this/).click() → connector removed.
  });
});
