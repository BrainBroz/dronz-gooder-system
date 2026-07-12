import type { ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions
}: PageHeaderProps) {
  return (
    <Stack
      component="header"
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "flex-start", sm: "center" }}
      justifyContent="space-between"
      gap={2}
    >
      <Box>
        {eyebrow && (
          <Typography
            color="primary.main"
            fontSize="0.75rem"
            fontWeight={700}
            letterSpacing="0.12em"
            textTransform="uppercase"
          >
            {eyebrow}
          </Typography>
        )}
        <Typography component="h1" variant="h4" mt={eyebrow ? 0.5 : 0}>
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary" mt={0.75}>
            {description}
          </Typography>
        )}
      </Box>
      {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
    </Stack>
  );
}
