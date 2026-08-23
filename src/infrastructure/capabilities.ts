import {
  ADAPTER_CAPABILITY_SETS,
  STAGING_ADAPTER_CAPABILITIES,
  type StagingAdapterCapability,
  type StagingAdapterType,
} from "./model.js";

export type CapabilityDecision =
  | { readonly compatible: true; readonly capabilities: readonly StagingAdapterCapability[]; readonly code: "CAPABILITIES_SATISFIED"; readonly authoritativeDelivery: false }
  | { readonly compatible: false; readonly capabilities: readonly StagingAdapterCapability[]; readonly code: "CAPABILITY_UNKNOWN" | "CAPABILITY_UNSUPPORTED"; readonly missing: string; readonly authoritativeDelivery: false };

export function negotiateCapabilities(
  adapterType: StagingAdapterType,
  required: readonly string[],
): CapabilityDecision {
  const supported = ADAPTER_CAPABILITY_SETS[adapterType];
  for (const capability of required) {
    if (!(STAGING_ADAPTER_CAPABILITIES as readonly string[]).includes(capability)) {
      return { compatible: false, capabilities: supported, code: "CAPABILITY_UNKNOWN", missing: capability, authoritativeDelivery: false };
    }
    if (!supported.includes(capability as StagingAdapterCapability)) {
      return { compatible: false, capabilities: supported, code: "CAPABILITY_UNSUPPORTED", missing: capability, authoritativeDelivery: false };
    }
  }
  return { compatible: true, capabilities: supported, code: "CAPABILITIES_SATISFIED", authoritativeDelivery: false };
}
