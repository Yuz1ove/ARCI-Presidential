import type { z } from "zod";
import type {
  acknowledgeOperatorReviewCommandSchema,
  controlPlaneQuerySchema,
  missionReadModelSchema,
  operatorCommandSchema,
  operatorReviewSchema,
  proposeMissionCommandSchema,
  publicHistoryRecordSchema,
  requestMissionUpdateCommandSchema,
  runtimeHistoryAppendInputSchema,
  runtimeHistoryRecordSchema,
  runtimeReadModelSchema,
} from "./schemas.js";

export type OperatorCommand = z.infer<typeof operatorCommandSchema>;
export type ProposeMissionCommand = z.infer<typeof proposeMissionCommandSchema>;
export type RequestMissionUpdateCommand = z.infer<typeof requestMissionUpdateCommandSchema>;
export type AcknowledgeOperatorReviewCommand = z.infer<typeof acknowledgeOperatorReviewCommandSchema>;
export type ControlPlaneQuery = z.infer<typeof controlPlaneQuerySchema>;
export type RuntimeHistoryRecord = z.infer<typeof runtimeHistoryRecordSchema>;
export type RuntimeHistoryAppendInput = z.infer<typeof runtimeHistoryAppendInputSchema>;
export type MissionReadModel = z.infer<typeof missionReadModelSchema>;
export type RuntimeReadModel = z.infer<typeof runtimeReadModelSchema>;
export type OperatorReview = z.infer<typeof operatorReviewSchema>;
export type PublicHistoryRecord = z.infer<typeof publicHistoryRecordSchema>;

export type CommandOutcome = MissionReadModel | OperatorReview;
