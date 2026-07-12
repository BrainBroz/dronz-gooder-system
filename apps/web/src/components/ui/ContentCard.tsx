import type { ReactNode } from "react";
import { Card, CardContent, Stack, Typography } from "@mui/material";

type ContentCardProps = {
  children: ReactNode;
  title?: string;
  description?: string;
};

export function ContentCard({ children, title, description }: ContentCardProps) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ p: { xs: 2.25, md: 3 }, "&:last-child": { pb: { xs: 2.25, md: 3 } } }}>
        <Stack gap={title || description ? 2 : 0}>
          {(title || description) && (
            <Stack gap={0.5}>
              {title && (
                <Typography component="h2" variant="h6">
                  {title}
                </Typography>
              )}
              {description && (
                <Typography color="text.secondary" variant="body2">
                  {description}
                </Typography>
              )}
            </Stack>
          )}
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}
