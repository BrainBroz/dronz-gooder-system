import type { ReactNode } from "react";
import { Box, Container } from "@mui/material";

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <Box component="section" sx={{ minWidth: 0, py: { xs: 2, md: 3 } }}>
      <Container maxWidth="xl" sx={{ px: { xs: 2, md: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}
