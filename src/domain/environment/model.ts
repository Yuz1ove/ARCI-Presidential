import { z } from "zod";

export const probabilitySchema = z.number().finite().min(0).max(1);
export const normalizedCostSchema = probabilitySchema;

export const channelMediumSchema = z.enum([
  "CELLULAR",
  "WIFI",
  "LORA",
  "SATELLITE",
]);
export type ChannelMedium = z.infer<typeof channelMediumSchema>;

const channelTelemetrySchema = z
  .object({
    medium: channelMediumSchema,
    available: z.boolean(),
    signalStrength: probabilitySchema,
    latencyMs: z.number().int().nonnegative(),
    packetLoss: probabilitySchema,
    bandwidthKbps: z.number().finite().positive(),
    energyCost: normalizedCostSchema,
    monetaryCost: normalizedCostSchema,
    reliability: probabilitySchema.optional(),
  })
  .strict()
  .superRefine((channel, context) => {
    const derived = deriveReliability(channel);
    if (channel.reliability !== undefined && Math.abs(channel.reliability - derived) > 0.000001) {
      context.addIssue({
        code: "custom",
        message: `reliability must equal derived value ${derived}`,
      });
    }
  });

export function deriveReliability(input: {
  available: boolean;
  packetLoss: number;
  signalStrength: number;
}): number {
  if (!input.available) return 0;
  return Number(((1 - input.packetLoss) * (0.5 + input.signalStrength * 0.5)).toFixed(6));
}

export const channelStateSchema = channelTelemetrySchema.transform((channel) => ({
  ...channel,
  reliability: deriveReliability(channel),
}));
export type ChannelState = z.infer<typeof channelStateSchema>;
export type ChannelTelemetry = z.input<typeof channelStateSchema>;

export const infrastructureStatusSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "COLLAPSED",
]);

export const environmentStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    timestamp: z.iso.datetime({ offset: true }),
    weatherRisk: probabilitySchema.optional(),
    regionalCongestion: probabilitySchema,
    channels: z.array(channelStateSchema).min(1).superRefine((channels, context) => {
      const seen = new Set<ChannelMedium>();
      for (const channel of channels) {
        if (seen.has(channel.medium)) {
          context.addIssue({
            code: "custom",
            message: `duplicate channel ${channel.medium}`,
          });
        }
        seen.add(channel.medium);
      }
    }),
    relayAvailability: probabilitySchema,
    infrastructureStatus: infrastructureStatusSchema,
  })
  .strict();

export type EnvironmentState = z.infer<typeof environmentStateSchema>;
export type EnvironmentStateInput = z.input<typeof environmentStateSchema>;

export function channelByMedium(
  environment: EnvironmentState,
  medium: ChannelMedium,
): ChannelState | undefined {
  return environment.channels.find((channel) => channel.medium === medium);
}
