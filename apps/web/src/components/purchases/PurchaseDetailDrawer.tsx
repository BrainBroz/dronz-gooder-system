import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography
} from "@mui/material";
import { useUnifiedPurchaseDetail } from "../../hooks/useUnifiedPurchases";
import { PurchaseTimeline } from "./PurchaseTimeline";
import { BlockedReasonChip } from "./BlockedReasonChip";
import { ItemMappingDrawer } from "./ItemMappingDrawer";
import { ItemAssignmentDrawer } from "./ItemAssignmentDrawer";
import { MaterializationConfirmDialog } from "./MaterializationConfirmDialog";
import { ConflictResolutionDrawer } from "./ConflictResolutionDrawer";
import type { UnifiedPurchaseDetail } from "../../types/unified-purchases";

type DrawerState = {
  type: "none" | "mapping" | "assignment" | "materialize" | "conflict";
  itemId?: string;
  conflictId?: string;
  storeId?: string;
};

type MaterializationSummary = {
  storeId: string;
  storeName: string;
  itemCount: number;
  totalUnits: number;
};

function nextItemAction(item: { mapeamentos: unknown[]; atribuicoes: unknown[] }) {
  if (item.mapeamentos.length === 0) return "Mapear produto";
  if (item.atribuicoes.length === 0) return "Atribuir";
  return null;
}

/**
 * A materialização é por COMPRA + LOJA (não por item): o backend agrega todos
 * os itens elegíveis daquela loja em um único PedidoCompra por chamada.
 * Por isso a ação é sempre agregada por loja aqui — nunca apresentada como
 * operação de um item isolado.
 */
function materializationSummaries(detail: UnifiedPurchaseDetail): MaterializationSummary[] {
  const byStore = new Map<string, MaterializationSummary>();
  for (const item of detail.itens) {
    for (const assignment of item.atribuicoes) {
      const materialized = item.itensMaterializados.find(
        (m) => m.lojaId === assignment.lojaId
      );
      const pendingQty = assignment.quantidade - (materialized?.quantidade ?? 0);
      if (pendingQty <= 0) continue;
      const current = byStore.get(assignment.lojaId) ?? {
        storeId: assignment.lojaId,
        storeName: assignment.loja.nome,
        itemCount: 0,
        totalUnits: 0
      };
      current.itemCount += 1;
      current.totalUnits += pendingQty;
      byStore.set(assignment.lojaId, current);
    }
  }
  return Array.from(byStore.values());
}

export function PurchaseDetailDrawer({
  purchaseId,
  onClose
}: {
  purchaseId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useUnifiedPurchaseDetail(purchaseId);
  const detail = detailQuery.data;
  const [drawerState, setDrawerState] = React.useState<DrawerState>({ type: "none" });

  const closeDrawer = () => setDrawerState({ type: "none" });
  const handleMutationSuccess = () => {
    void detailQuery.refetch();
  };

  return (
    <Drawer
      anchor="right"
      open={Boolean(purchaseId)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 480 }, p: 3 } } }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          {detail ? (
            <>
              <Typography variant="h6">{detail.numeroPedido}</Typography>
              <Typography variant="body2" color="text.secondary">
                {detail.plataforma}
                {detail.contaExterna ? ` · ${detail.contaExterna.nomeExibicao}` : ""}
                {detail.merchantExterno ? ` · ${detail.merchantExterno.nomeOriginal}` : ""}
              </Typography>
            </>
          ) : (
            <Typography variant="h6">Carregando...</Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="Fechar detalhe">
          ✕
        </IconButton>
      </Stack>

      {detailQuery.isLoading && (
        <Stack alignItems="center" py={4}>
          <CircularProgress aria-label="Carregando detalhe da compra" />
        </Stack>
      )}

      {detailQuery.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void detailQuery.refetch()}>Tentar novamente</Button>}
        >
          Falha ao carregar o detalhe desta compra.
        </Alert>
      )}

      {detail && (
        <Stack gap={3}>
          <PurchaseTimeline detail={detail} />

          <Stack gap={1}>
            <Typography component="h3" variant="subtitle1" fontWeight={700}>
              Itens ({detail.itens.length})
            </Typography>
            <Stack gap={1.5}>
              {detail.itens.map((item) => {
                const pendingAction = nextItemAction(item);
                return (
                  <Box
                    key={item.id}
                    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.5 }}
                  >
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      justifyContent="space-between"
                      gap={1}
                    >
                      <Box>
                        <Typography fontWeight={600}>{item.titulo}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {item.quantidade} un · {item.precoUnitario} {item.moeda}
                        </Typography>
                      </Box>
                      {pendingAction === "Mapear produto" &&
                        detail.allowedActions.includes("SET_PRODUCT_MAPPING") && (
                          <Button
                            size="small"
                            onClick={() =>
                              setDrawerState({ type: "mapping", itemId: item.id })
                            }
                          >
                            {pendingAction}
                          </Button>
                        )}
                      {pendingAction === "Atribuir" &&
                        detail.allowedActions.includes("ASSIGN_TO_STORE") && (
                          <Button
                            size="small"
                            onClick={() =>
                              setDrawerState({ type: "assignment", itemId: item.id })
                            }
                          >
                            {pendingAction}
                          </Button>
                        )}
                    </Stack>
                    <Stack direction="row" gap={0.5} flexWrap="wrap" mt={1}>
                      {item.mapeamentos.length === 0 ? (
                        <Chip size="small" color="warning" variant="outlined" label="Sem mapping" />
                      ) : (
                        <Chip size="small" color="success" variant="outlined" label="Mapeado" />
                      )}
                      {item.atribuicoes.length === 0 ? (
                        <Chip size="small" color="warning" variant="outlined" label="Sem atribuição" />
                      ) : (
                        item.atribuicoes.map((assignment) => (
                          <Chip
                            key={assignment.id}
                            size="small"
                            variant="outlined"
                            label={`${assignment.loja.nome} ${assignment.quantidade}`}
                          />
                        ))
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Stack>

          {detail.blockedReasons.length > 0 && (
            <Stack gap={1}>
              <Typography component="h3" variant="subtitle1" fontWeight={700}>
                Bloqueios
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {detail.blockedReasons.map((reason) => (
                  <BlockedReasonChip key={reason.code} reason={reason} />
                ))}
              </Stack>
            </Stack>
          )}

          <Stack gap={1}>
            <Typography component="h3" variant="subtitle1" fontWeight={700}>
              Ações Operacionais
            </Typography>
            {detail.allowedActions.includes("MATERIALIZE_STORE_ALLOCATION") ? (
              <Stack gap={1}>
                {materializationSummaries(detail).map((summary) => (
                  <Button
                    key={`materialize-${summary.storeId}`}
                    variant="contained"
                    size="small"
                    onClick={() =>
                      setDrawerState({
                        type: "materialize",
                        storeId: summary.storeId
                      })
                    }
                    fullWidth
                  >
                    Materializar {summary.storeName} ({summary.itemCount}{" "}
                    {summary.itemCount === 1 ? "item" : "itens"}, {summary.totalUnits} un)
                  </Button>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Sem ações operacionais disponíveis.
              </Typography>
            )}
          </Stack>

          <Divider />

          <Stack gap={1}>
            <Typography component="h3" variant="subtitle1" fontWeight={700}>
              Conflitos ({detail.conflitos.length})
            </Typography>
            {detail.conflitos.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                Nenhum conflito registrado.
              </Typography>
            ) : (
              <Stack gap={1}>
                {detail.conflitos.map((conflict) => (
                  <Stack
                    key={conflict.id}
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {conflict.tipo}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Status: {conflict.status}
                      </Typography>
                    </Box>
                    {conflict.status === "ABERTO" && detail.allowedActions.includes("RESOLVE_CONFLICT") && (
                      <Button
                        size="small"
                        onClick={() =>
                          setDrawerState({ type: "conflict", conflictId: conflict.id })
                        }
                      >
                        Resolver
                      </Button>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>

          <Stack gap={1}>
            <Typography component="h3" variant="subtitle1" fontWeight={700}>
              Materializações ({detail.materializacoes.length})
            </Typography>
            {detail.materializacoes.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                Nenhuma materialização até o momento.
              </Typography>
            ) : (
              detail.materializacoes.map((materialization) => (
                <Typography key={materialization.id} variant="body2">
                  {materialization.pedidoCompra.numeroPedido} · {materialization.status}
                </Typography>
              ))
            )}
          </Stack>

          <Stack gap={1}>
            <Typography component="h3" variant="subtitle1" fontWeight={700}>
              Histórico e auditoria
            </Typography>
            {detail.history.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                Nenhum evento registrado.
              </Typography>
            ) : (
              <Stack divider={<Divider flexItem />} gap={1}>
                {detail.history.map((entry) => (
                  <Box key={entry.id}>
                    <Typography variant="body2" fontWeight={600}>
                      {entry.action}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(entry.createdAt).toLocaleString("pt-BR")}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>

          {/* Mutation Drawers */}
          {drawerState.type === "mapping" && drawerState.itemId && (
            <ItemMappingDrawer
              purchaseId={purchaseId!}
              item={detail.itens.find((i) => i.id === drawerState.itemId)!}
              open={true}
              onClose={closeDrawer}
              onSuccess={handleMutationSuccess}
            />
          )}

          {drawerState.type === "assignment" && drawerState.itemId && (
            <ItemAssignmentDrawer
              purchaseId={purchaseId!}
              item={detail.itens.find((i) => i.id === drawerState.itemId)!}
              open={true}
              onClose={closeDrawer}
              onSuccess={handleMutationSuccess}
            />
          )}

          {drawerState.type === "materialize" && drawerState.storeId && (
            <MaterializationConfirmDialog
              purchaseId={purchaseId!}
              storeId={drawerState.storeId}
              summary={
                materializationSummaries(detail).find(
                  (s) => s.storeId === drawerState.storeId
                )!
              }
              purchaseVersion={detail.version}
              open={true}
              onClose={closeDrawer}
              onSuccess={handleMutationSuccess}
            />
          )}

          {drawerState.type === "conflict" && drawerState.conflictId && (
            <ConflictResolutionDrawer
              purchaseId={purchaseId!}
              conflict={detail.conflitos.find((c) => c.id === drawerState.conflictId)!}
              open={true}
              onClose={closeDrawer}
              onSuccess={handleMutationSuccess}
            />
          )}
        </Stack>
      )}
    </Drawer>
  );
}
