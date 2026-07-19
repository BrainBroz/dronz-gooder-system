import * as React from "react";
import { Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import type { EntitySuggestion } from "./entitySuggestions";

const MANUAL_OPTION = "__manual__";

/**
 * Seletor de conta/merchant. As sugestões vêm exclusivamente das compras já
 * carregadas na fila — não é um cadastro completo, por isso sempre oferece
 * "Informar ID manualmente" e nunca impede um ID fora da lista.
 */
export function EntityPicker({
  label,
  suggestions,
  value,
  onChange,
  required,
  disabled
}: {
  label: string;
  suggestions: EntitySuggestion[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const matchesSuggestion = suggestions.some((s) => s.id === value);
  const [mode, setMode] = React.useState<"suggestion" | "manual">(
    suggestions.length > 0 && (value === "" || matchesSuggestion) ? "suggestion" : "manual"
  );

  // Quando as sugestões mudam (ex: troca de plataforma) e o ID selecionado
  // não está mais na lista, limpa o valor invisível para que `canSubmit`
  // não deixe o formulário avançar com um ID que o operador não consegue ver.
  React.useEffect(() => {
    if (mode === "suggestion" && value !== "" && !suggestions.some((s) => s.id === value)) {
      onChange("");
    }
  // onChange é sempre um setter estável do pai; omitir da lista é seguro.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, mode, value]);

  if (mode === "manual") {
    return (
      <Stack gap={0.5}>
        <TextField
          label={`${label} (ID)`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          disabled={disabled}
          fullWidth
        />
        {suggestions.length > 0 && (
          <Button
            size="small"
            sx={{ alignSelf: "flex-start" }}
            disabled={disabled}
            onClick={() => {
              // Se o ID digitado manualmente não corresponde a nenhuma
              // sugestão, ele não pode ficar retido de forma invisível ao
              // voltar para o select — o operador veria "vazio" mas o valor
              // antigo continuaria sendo enviado. Só preserva quando o ID
              // já é uma sugestão real.
              if (!suggestions.some((s) => s.id === value)) {
                onChange("");
              }
              setMode("suggestion");
            }}
          >
            Ver sugestões encontradas nas compras carregadas
          </Button>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap={0.5}>
      <TextField
        select
        label={label}
        value={matchesSuggestion ? value : ""}
        onChange={(event) => {
          if (event.target.value === MANUAL_OPTION) {
            setMode("manual");
            return;
          }
          onChange(event.target.value);
        }}
        required={required}
        disabled={disabled}
        fullWidth
      >
        {suggestions.map((suggestion) => (
          <MenuItem key={suggestion.id} value={suggestion.id}>
            {suggestion.name} · {suggestion.plataforma}
          </MenuItem>
        ))}
        <MenuItem value={MANUAL_OPTION}>Informar ID manualmente…</MenuItem>
      </TextField>
      <Typography variant="caption" color="text.secondary">
        Sugestões encontradas nas compras carregadas — pode não conter todas as contas ou
        merchants.
      </Typography>
    </Stack>
  );
}
