import { useMemo, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader } from "../stores/auth";
import { catalogQueryKeys } from "../queryKeys";
import { MutationStatus } from "./ui/MutationStatus";
import { extractItems, guessCategoryColumn, guessColumn, guessWeightColumn, readSheet, type ColumnChoice, type Sheet } from "../utils/catalogImport";

type Resultado = { novos: number; jaExistentes: number; repetidosNoArquivo: number; pesosPreenchidos: number };
const NONE = "none";
const TITLES = "titulos";

export function ProductBaseImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const headers = authHeader();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ColumnChoice>({ produto: 0, categoria: null, peso: null });
  const itens = useMemo(() => (sheet ? extractItems(sheet, choice) : []), [sheet, choice]);

  const preview = useQuery<Resultado>({
    queryKey: ["product-base-import-preview", fileName, choice.produto, choice.categoria, choice.peso, itens.length],
    enabled: itens.length > 0,
    queryFn: async () => (await api.post("/product-bases/import?dryRun=true", { itens }, { headers })).data
  });
  const importar = useMutation({
    mutationFn: async () => (await api.post("/product-bases/import", { itens }, { headers })).data as Resultado,
    onSuccess: () => client.invalidateQueries({ queryKey: catalogQueryKeys.productBases })
  });

  async function choose(file: File | undefined) {
    importar.reset();
    setReadError(null);
    setSheet(null);
    if (!file) return;
    try {
      const read = await readSheet(file);
      const categoria = guessCategoryColumn(read.headers);
      setFileName(file.name);
      setSheet(read);
      setChoice({ produto: guessColumn(read.headers), categoria: categoria ?? (read.headers.length > 1 ? TITLES : null), peso: guessWeightColumn(read.headers) });
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
    }
  }

  const columns = (sheet?.headers ?? []).map((header, index) => (
    <MenuItem key={index} value={index}>{header || `Coluna ${index + 1}`}</MenuItem>
  ));
  const p = preview.data;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Importar para a base de produtos</DialogTitle>
      <DialogContent>
        <Stack gap={2} mt={0.5}>
          <Typography variant="body2" color="text.secondary">
            Envie um Excel (.xlsx) ou CSV. Entram nome, categoria e peso; não há preço nem estoque. Quem já existe é pulado, mas ganha o peso se ainda não tinha. Peso já cadastrado nunca é trocado.
          </Typography>
          <Button component="label" variant="outlined">
            {fileName || "Escolher arquivo"}
            <input hidden type="file" accept=".xlsx,.csv" onChange={(event) => void choose(event.target.files?.[0])} />
          </Button>
          {readError && <Typography variant="body2" color="error" role="alert">{readError}</Typography>}
          {sheet && (
            <>
              <TextField select size="small" label="Coluna dos produtos" value={choice.produto} onChange={(event) => setChoice({ ...choice, produto: Number(event.target.value) })}>
                {columns}
              </TextField>
              <TextField
                select size="small" label="Categoria" value={choice.categoria ?? NONE}
                onChange={(event) => {
                  const value = event.target.value;
                  setChoice({ ...choice, categoria: value === NONE ? null : value === TITLES ? TITLES : Number(value) });
                }}
              >
                <MenuItem value={NONE}>Sem categoria</MenuItem>
                <MenuItem value={TITLES}>Linhas só com título (sem valor nas outras colunas)</MenuItem>
                {columns}
              </TextField>
              <TextField
                select size="small" label="Peso (kg)" value={choice.peso ?? NONE}
                onChange={(event) => setChoice({ ...choice, peso: event.target.value === NONE ? null : Number(event.target.value) })}
              >
                <MenuItem value={NONE}>Sem peso</MenuItem>
                {columns}
              </TextField>
              {itens.length === 0 && <Typography variant="body2" role="alert">Nenhum produto encontrado com essa coluna.</Typography>}
              {itens.length > 0 && preview.isPending && <Typography variant="body2" role="status">Conferindo com a base…</Typography>}
              {itens.length > 0 && preview.isError && <Typography variant="body2" color="error" role="alert">Não foi possível conferir a base.</Typography>}
              {p && (
                <Typography variant="body2" role="status">
                  {p.novos} produtos novos serão criados e {p.pesosPreenchidos} receberão peso. {p.jaExistentes} já existem
                  {p.repetidosNoArquivo > 0 ? ` e ${p.repetidosNoArquivo} se repetem no arquivo` : ""}; esses não mudam além do peso.
                </Typography>
              )}
            </>
          )}
          <MutationStatus
            mutation={importar}
            loadingMessage="Importando…"
            successMessage={importar.data ? `Importação concluída: ${importar.data.novos} criados, ${importar.data.pesosPreenchidos} pesos preenchidos.` : ""}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        <Button variant="contained" disabled={!p || (p.novos === 0 && p.pesosPreenchidos === 0) || importar.isPending || importar.isSuccess} onClick={() => importar.mutate()}>
          Importar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
