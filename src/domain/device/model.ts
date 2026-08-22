import { z } from "zod";
import { channelMediumSchema } from "../environment/model.js";
import { domainIdSchema } from "../ids.js";

export const deviceStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    deviceId: domainIdSchema,
    batteryPercent: z.number().finite().min(0).max(100),
    location: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict()
      .optional(),
    availableInterfaces: z.array(channelMediumSchema).min(1),
    estimatedRuntimeMinutes: z.number().int().nonnegative().optional(),
  })
  .strict();

export type DeviceState = z.infer<typeof deviceStateSchema>;
