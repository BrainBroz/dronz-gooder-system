import { useDeferredValue, useState } from "react";
import { Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, TextField, Typography } from "@mui/material";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { catalogQueryKeys } from "../queryKeys";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { ProductBaseImportDialog } from "../components/ProductBaseImportDialog";

type ProdutoBase = { id: string; nome: string; categoria: string | null; pesoKg: string | null };
type Lista = { items: ProdutoBase[]; total: number; categorias: string[] };
const PAGE_SIZE = 50;

function WeightCell({ item, canEdit }: { item: ProdutoBase; canEdit: boolean }) {
  const client = useQueryClient();
  const [text, setText] = useState(item.pesoKg === null ? "" : String(Number(item.pesoKg)));
  const save = useMutation({
    mutationFn: async (pesoKg: number | null) => (await api.patch(`/product-bases/${item.id}`, { pesoKg }, { headers: authHeader() })).data,
    onSuccess: () => client.invalidateQueries({ queryKey: catalogQueryKeys.productBases })
  });
  if (!canEdit) return <>{item.pesoKg === null ? "—" : Number(item.pesoKg)}</>;
  const commit = () => {
    const value = text.trim() === "" ? null : Number(text.replace(",", "."));
    const current = item.pesoKg === null ? null : Number(item.pesoKg);
    if (value === current || (value !== null && !(value > 0))) return;
    save.mutate(value);
  };
  return (
    <TextField
      size="small" value={text} placeholder="kg" inputMode="decimal" sx={{ width: 90 }}
      error={save.isError} inputProps={{ "aria-label": `Peso de ${item.nome}` }}
      onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
}

export function ProductBasePage() {
  const canManage = useAuthStore((s) => s.permissions.some((code) => code === "SYSTEM_ADMIN" || code === "CATALOGO_GERENCIAR"));
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState("");
  const [semPeso, setSemPeso] = useState(false);
  const [page, setPage] = useState(0);
  const [importing, setImporting] = useState(false);
  const term = useDeferredValue(search);
  const lista = useQuery<Lista>({
    queryKey: [...catalogQueryKeys.productBases, term, categoria, semPeso, page],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get("/product-bases", { headers: authHeader(), params: { search: term || undefined, categoria: categoria || undefined, semPeso: semPeso || undefined, page: page + 1, limit: PAGE_SIZE } })).data
  });
  const reset = (apply: () => void) => {
    apply();
    setPage(0);
  };
  return (
    <PageContainer>
      <Stack gap={2.5}>
        <PageHeader
          title="Base de produtos"
          description="Todos os produtos que já trabalhamos, para as duas lojas. Serve para achar o produto e reaproveitar o peso; não é estoque nem preço."
          actions={canManage && <Button variant="contained" onClick={() => setImporting(true)}>Importar</Button>}
        />
        {importing && <ProductBaseImportDialog open onClose={() => setImporting(false)} />}
        <Stack direction={{ xs: "column", sm: "row" }} gap={1.5} alignItems={{ sm: "center" }}>
          <TextField size="small" label="Buscar produto" value={search} onChange={(event) => reset(() => setSearch(event.target.value))} sx={{ minWidth: 260 }} />
          <TextField select size="small" label="Categoria" value={categoria} onChange={(event) => reset(() => setCategoria(event.target.value))} sx={{ minWidth: 220 }}>
            <MenuItem value="">Todas</MenuItem>
            {(lista.data?.categorias ?? []).map((nome) => <MenuItem key={nome} value={nome}>{nome}</MenuItem>)}
          </TextField>
          <FormControlLabel control={<Checkbox checked={semPeso} onChange={(event) => reset(() => setSemPeso(event.target.checked))} />} label="Só sem peso" />
        </Stack>
        {lista.isLoading && <Typography role="status">Carregando…</Typography>}
        {lista.isError && <Typography color="error" role="alert">Não foi possível carregar a base.</Typography>}
        {lista.data && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="Base de produtos">
              <TableHead>
                <TableRow><TableCell>Categoria</TableCell><TableCell>Produto</TableCell><TableCell>Peso (kg)</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {lista.data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.categoria ?? "—"}</TableCell>
                    <TableCell>{item.nome}</TableCell>
                    <TableCell><WeightCell key={`${item.id}:${item.pesoKg}`} item={item} canEdit={canManage} /></TableCell>
                  </TableRow>
                ))}
                {lista.data.items.length === 0 && <TableRow><TableCell colSpan={3}>Nenhum produto encontrado.</TableCell></TableRow>}
              </TableBody>
            </Table>
            <TablePagination
              component="div" count={lista.data.total} page={page} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]}
              onPageChange={(_event, next) => setPage(next)} labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
            />
          </Box>
        )}
      </Stack>
    </PageContainer>
  );
}
