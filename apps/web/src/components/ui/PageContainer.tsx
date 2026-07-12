import type { ReactNode } from "react";
import { Box, Container } from "@mui/material";

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <Box component="section" sx={{ minWidth: 0, py: { xs: 2.5, md: 4 } }}>
      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3, lg: 4 } }}>
        {children}
      </Container>
    </Box>
  );
}
