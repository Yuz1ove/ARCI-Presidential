import { z } from "zod";
import { domainIdSchema } from "../ids.js";

export const domainEventTypeSchema = z.enum([
  "mission.requested",
  "mission.updated",
  "mission.delivered",
  "observation.received",
  "observation.normalized",
  "observation.ignored",
  "situation.changed",
  "route.degraded",
  "route.invalidated",
  "planning.started",
  "route.candidates_scored",
  "policy.approved",
  "policy.rejected",
  "route.updated",
  "execution.started",
  "execution.attempt_accepted",
  "execution.attempt_failed",
  "execution.attempt_timed_out",
  "execution.result_ignored",
  "verification.started",
  "verification.ack_received",
  "verification.ack_ignored",
  "verification.failed",
  "verification.indeterminate",
  "adaptation.started",
  "adaptation.decided",
  "runtime.state_updated",
  "runtime.completed",
  "runtime.failed",
]);
export type DomainEventType = z.infer<typeof domainEventTypeSchema>;

export const domainEventSchema = z
  .object({
    eventId: domainIdSchema,
    eventType: domainEventTypeSchema,
    schemaVersion: z.literal(1),
    timestamp: z.iso.datetime({ offset: true }),
    sequence: z.number().int().positive(),
    runId: domainIdSchema,
    missionId: domainIdSchema,
    correlationId: domainIdSchema,
    causationId: domainIdSchema.optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DomainEvent = z.infer<typeof domainEventSchema>;

export type EventInput = Omit<DomainEvent, "sequence">;

export class InMemoryEventStore {
  private readonly events: DomainEvent[] = [];

  public append(input: EventInput): DomainEvent {
    if (this.events.some((event) => event.eventId === input.eventId)) {
      throw new Error(`duplicate event ID: ${input.eventId}`);
    }
    const event = domainEventSchema.parse({ ...input, sequence: this.events.length + 1 });
    this.events.push(event);
    return event;
  }

  public all(): readonly DomainEvent[] {
    return [...this.events];
  }

  public byCorrelationId(correlationId: string): readonly DomainEvent[] {
    return this.events.filter((event) => event.correlationId === correlationId);
  }

  public byEventType(eventType: DomainEventType): readonly DomainEvent[] {
    return this.events.filter((event) => event.eventType === eventType);
  }
}
