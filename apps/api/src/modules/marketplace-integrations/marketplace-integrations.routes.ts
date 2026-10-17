import { Router, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
  type AuthenticatedRequest
} from "../../middlewares/auth";
import {
  buyerCandidateListSchema,
  buyerDecisionSchema,
  createConnectionSchema,
  listConnectionsSchema,
  syncConnectionSchema,
  syncHistorySchema
} from "./marketplace-integrations.schemas";
import * as service from "./marketplace-integrations.service";

export const marketplaceIntegrationsRouter = Router();
marketplaceIntegrationsRouter.use(requireAuth);

const wrap =
  (
    handler: (
      request: AuthenticatedRequest,
      response: Response
    ) => Promise<void>
  ) =>
  async (
    request: AuthenticatedRequest,
    response: Response,
    next: (error?: unknown) => void
  ) => {
    try {
      await handler(request, response);
    } catch (error) {
      next(error);
    }
  };

const identity = (request: AuthenticatedRequest) => {
  if (!request.identity) throw new Error("authenticated identity unavailable");
  return request.identity;
};

const idempotencyKey = (request: AuthenticatedRequest) =>
  z.string().min(8).max(200).parse(request.headers["idempotency-key"]);

marketplaceIntegrationsRouter.get(
  "/buyer-candidates",
  requirePermission("BUYER_INGESTION_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(await service.listBuyerCandidates(
      identity(request), buyerCandidateListSchema.parse(request.query)
    ));
  })
);

marketplaceIntegrationsRouter.get(
  "/buyer-candidates/:candidateId",
  requirePermission("BUYER_INGESTION_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(await service.buyerCandidateDetail(
      identity(request), z.string().cuid().parse(request.params.candidateId)
    ));
  })
);

marketplaceIntegrationsRouter.get(
  "/buyer-candidates/:candidateId/evidence/:evidenceId",
  requirePermission("BUYER_INGESTION_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(await service.buyerCandidateEvidenceDetail(
      identity(request),
      z.string().cuid().parse(request.params.candidateId),
      z.string().cuid().parse(request.params.evidenceId)
    ));
  })
);

marketplaceIntegrationsRouter.get(
  "/buyer-candidates/:candidateId/conflicts",
  requirePermission("BUYER_INGESTION_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(await service.buyerCandidateConflicts(
      identity(request),
      z.string().cuid().parse(request.params.candidateId),
      syncHistorySchema.parse(request.query)
    ));
  })
);

marketplaceIntegrationsRouter.post(
  "/buyer-candidates/:candidateId/decision",
  requirePermission("BUYER_INGESTION_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(await service.decideBuyerCandidate(
      identity(request),
      z.string().cuid().parse(request.params.candidateId),
      buyerDecisionSchema.parse(request.body),
      idempotencyKey(request)
    ));
  })
);

marketplaceIntegrationsRouter.post(
  "/connections",
  requirePermission("INTEGRACAO_MARKETPLACE_GERENCIAR"),
  wrap(async (request, response) => {
    response
      .status(201)
      .json(
        await service.createConnection(
          identity(request),
          createConnectionSchema.parse(request.body),
          idempotencyKey(request)
        )
      );
  })
);

marketplaceIntegrationsRouter.get(
  "/connections",
  requirePermission("INTEGRACAO_MARKETPLACE_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(
      await service.listConnections(
        identity(request),
        listConnectionsSchema.parse(request.query)
      )
    );
  })
);

marketplaceIntegrationsRouter.get(
  "/connections/:connectionId",
  requirePermission("INTEGRACAO_MARKETPLACE_VISUALIZAR"),
  wrap(async (request, response) => {
    response.json(
      await service.connectionDetail(
        identity(request),
        z.string().cuid().parse(request.params.connectionId)
      )
    );
  })
);

marketplaceIntegrationsRouter.get(
  "/connections/:connectionId/sync-runs",
  requirePermission("INTEGRACAO_MARKETPLACE_HISTORICO_VISUALIZAR"),
  wrap(async (request, response) => {
    const query = syncHistorySchema.parse(request.query);
    response.json(
      await service.syncHistory(
        identity(request),
        z.string().cuid().parse(request.params.connectionId),
        query.page,
        query.limit
      )
    );
  })
);

marketplaceIntegrationsRouter.post(
  "/connections/:connectionId/sync-runs",
  requirePermission("INTEGRACAO_MARKETPLACE_SINCRONIZAR"),
  wrap(async (request, response) => {
    response
      .status(202)
      .json(
        await service.syncConnection(
          identity(request),
          z.string().cuid().parse(request.params.connectionId),
          syncConnectionSchema.parse(request.body),
          idempotencyKey(request)
        )
      );
  })
);

marketplaceIntegrationsRouter.post(
  "/sync-runs/:executionId/reprocess",
  requirePermission("INTEGRACAO_MARKETPLACE_REPROCESSAR"),
  wrap(async (request, response) => {
    response
      .status(202)
      .json(
        await service.reprocessExecution(
          identity(request),
          z.string().cuid().parse(request.params.executionId),
          idempotencyKey(request)
        )
      );
  })
);
