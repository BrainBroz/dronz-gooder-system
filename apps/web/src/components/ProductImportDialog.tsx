import { useMemo, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { catalogQueryKeys } from "../queryKeys";
import { MutationStatus } from "./ui/MutationStatus";
import { extractItems, guessColumn, readSheet, type Sheet } from "../utils/catalogImport";

type Resultado = { novos: number; jaExistentes: number; repetidosNoArquivo: number; categoriasNovas: number };

export function ProductImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const headers = { ...authHeader(), "x-store-id": store };
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [column, setColumn] = useState(0);
  const [titulos, setTitulos] = useState(true);
  const itens = useMemo(() => (sheet ? extractItems(sheet, column, titulos) : []), [sheet, column, titulos]);

  const preview = useQuery<Resultado>({
    queryKey: ["product-import-preview", store, fileName, column, titulos, itens.length],
    enabled: itens.length > 0,
    queryFn: async () => (await api.post("/products/import?dryRun=true", { itens }, { headers })).data
  });
  const importar = useMutation({
    mutationFn: async () => (await api.post("/products/import", { itens }, { headers })).data as Resultado,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: catalogQueryKeys.products(store) }), client.invalidateQueries({ queryKey: catalogQueryKeys.categories(store) })])
  });

  async function choose(file: File | undefined) {
    importar.reset();
    setReadError(null);
    setSheet(null);
    if (!file) return;
    try {
      const read = await readSheet(file);
      setFileName(file.name);
      setSheet(read);
      setColumn(guessColumn(read.headers));
      setTitulos(read.headers.length > 1);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
    }
  }

  const p = preview.data;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Importar produtos</DialogTitle>
      <DialogContent>
        <Stack gap={2} mt={0.5}>
          <Typography variant="body2" color="text.secondary">
            Envie um Excel (.xlsx) ou CSV. Só o nome do produto é cadastrado: entram inativos, sem preço e com markup de 30%. Quem já existe na loja é pulado.
          </Typography>
          <Button component="label" variant="outlined">
            {fileName || "Escolher arquivo"}
            <input hidden type="file" accept=".xlsx,.csv" onChange={(event) => void choose(event.target.files?.[0])} />
          </Button>
          {readError && <Typography variant="body2" color="error" role="alert">{readError}</Typography>}
          {sheet && (
            <>
              <TextField select size="small" label="Coluna dos produtos" value={column} onChange={(event) => setColumn(Number(event.target.value))}>
                {sheet.headers.map((header, index) => (
                  <MenuItem key={index} value={index}>{header || `Coluna ${index + 1}`}</MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={<Checkbox checked={titulos} onChange={(event) => setTitulos(event.target.checked)} />}
                label="Linhas só com o título (sem valor nas outras colunas) são categorias"
              />
              {itens.length === 0 && <Typography variant="body2" role="alert">Nenhum produto encontrado com essa coluna.</Typography>}
              {itens.length > 0 && preview.isPending && <Typography variant="body2" role="status">Conferindo com o catálogo…</Typography>}
              {itens.length > 0 && preview.isError && <Typography variant="body2" color="error" role="alert">Não foi possível conferir o catálogo.</Typography>}
              {p && (
                <Typography variant="body2" role="status">
                  {p.novos} produtos novos e {p.categoriasNovas} categorias novas serão criados. {p.jaExistentes} já existem
                  {p.repetidosNoArquivo > 0 ? ` e ${p.repetidosNoArquivo} se repetem no arquivo` : ""}; esses são pulados.
                </Typography>
              )}
            </>
          )}
          <MutationStatus
            mutation={importar}
            loadingMessage="Importando…"
            successMessage={importar.data ? `Importação concluída: ${importar.data.novos} produtos criados.` : ""}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        <Button variant="contained" disabled={!p || p.novos === 0 || importar.isPending || importar.isSuccess} onClick={() => importar.mutate()}>
          Importar {p ? p.novos : ""} produtos
        </Button>
      </DialogActions>
    </Dialog>
  );
}
