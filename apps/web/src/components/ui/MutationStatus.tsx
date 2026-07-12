import { Typography } from "@mui/material";
import { extractErrorMessage } from "../../utils/errors";

type MinimalMutationState = {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
};

export function MutationStatus({
  mutation,
  successMessage,
  loadingMessage = "Salvando..."
}: {
  mutation: MinimalMutationState;
  successMessage: string;
  loadingMessage?: string;
}) {
  if (mutation.isPending)
    return (
      <Typography variant="body2" color="text.secondary" role="status">
        {loadingMessage}
      </Typography>
    );
  if (mutation.isError)
    return (
      <Typography variant="body2" color="error" role="alert">
        {extractErrorMessage(mutation.error)}
      </Typography>
    );
  if (mutation.isSuccess)
    return (
      <Typography variant="body2" color="success.main" role="status">
        {successMessage}
      </Typography>
    );
  return null;
}
