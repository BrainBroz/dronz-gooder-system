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
  Tooltip,
  Typography
} from "@mui/material";
import { useUnifiedPurchaseDetail } from "../../hooks/useUnifiedPurchases";
import { PurchaseTimeline } from "./PurchaseTimeline";
import { BlockedReasonChip } from "./BlockedReasonChip";

function nextItemAction(item: { mapeamentos: unknown[]; atribuicoes: unknown[] }) {
  if (item.mapeamentos.length === 0) return "Mapear produto";
  if (item.atribuicoes.length === 0) return "Atribuir";
  return null;
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
                      {pendingAction && (
                        <Tooltip title="Disponível no UX-1C">
                          <span>
                            <Button size="small" disabled>
                              {pendingAction}
                            </Button>
                          </span>
                        </Tooltip>
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
              Ações
            </Typography>
            <Tooltip title="Ações operacionais chegam no UX-1C">
              <span>
                <Button variant="contained" disabled fullWidth>
                  Materializar (disponível no UX-1C)
                </Button>
              </span>
            </Tooltip>
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
              detail.conflitos.map((conflict) => (
                <Typography key={conflict.id} variant="body2">
                  {conflict.tipo} · {conflict.status}
                </Typography>
              ))
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
        </Stack>
      )}
    </Drawer>
  );
}
